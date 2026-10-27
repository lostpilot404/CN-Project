"""Protocol-level regression tests: link delay model, congestion control, flow control, determinism.

The link-delay, sliding-window and congestion-control expectations are hand calculations, so a
change in behaviour that keeps the tests green would have to be arithmetically identical.
"""

from __future__ import annotations

import json

import pytest

# The engine's documented timing model for a packet entering an idle path:
#   ingress processing delay 5 us at the source, 1 us per intermediate node forwarding,
#   serialisation = size_bytes * 8 / bandwidth_bps, then propagation delay.
INGRESS_US = 5
FORWARDING_US = 1


def _two_hop(api, bandwidth_bps: int = 1_000_000, propagation_us: int = 1000) -> None:
    for link_id in ("link-1", "link-2"):
        api.result(
            "update_link",
            {"linkId": link_id, "bandwidthBps": bandwidth_bps, "propagationDelayUs": propagation_us},
        )


def test_two_hop_latency_matches_the_hand_calculation(api):
    """1000 B at 1 Mbps with 1000 us propagation: 5 + (8000+1000) + 1 + (8000+1000) = 18006 us."""
    _two_hop(api)
    packet_id = api.result(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 1000, "transportProtocol": "UDP"},
    )
    api.result("run_simulation_until_empty")
    detail = api.result("get_packet_details", {"packetId": packet_id})
    history = detail["hop_history"]

    assert history[0]["timestamp_us"] == 0
    assert history[2]["timestamp_us"] == INGRESS_US
    assert history[-1]["state"] == "delivered"
    assert history[-1]["timestamp_us"] == INGRESS_US + 2 * (8000 + 1000) + FORWARDING_US


def test_bandwidth_scales_only_the_serialisation_term(api):
    """10x bandwidth must divide the serialisation term by 10 and leave propagation untouched."""
    _two_hop(api, bandwidth_bps=10_000_000, propagation_us=1000)
    packet_id = api.result(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 1000, "transportProtocol": "UDP"},
    )
    api.result("run_simulation_until_empty")
    delivered = api.result("get_packet_details", {"packetId": packet_id})["hop_history"][-1]
    assert delivered["timestamp_us"] == INGRESS_US + 2 * (800 + 1000) + FORWARDING_US


def test_link_queues_pipeline_rather_than_serialising_end_to_end(api):
    """20 x 1000 B packets through two 1 Mbps hops deliver at 5 + 20*8000 + 1 + 8000 us."""
    _two_hop(api, bandwidth_bps=1_000_000, propagation_us=0)
    api.result("reset_simulation")
    packet_ids = [
        api.result("inject_packet", {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 1000})
        for _ in range(20)
    ]
    api.result("run_simulation_until_empty")
    last = api.result("get_packet_details", {"packetId": packet_ids[-1]})["hop_history"][-1]
    assert last["timestamp_us"] == INGRESS_US + 20 * 8000 + FORWARDING_US + 8000


def test_raw_link_loss_probability_of_one_drops_the_packet(api):
    _two_hop(api)
    api.result("update_link", {"linkId": "link-1", "lossProbability": 1.0})
    packet_id = api.result("inject_packet", {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 500})
    api.result("run_simulation_until_empty")
    detail = api.result("get_packet_details", {"packetId": packet_id})
    assert detail["state"].startswith("dropped")
    assert detail["hop_history"][-1]["state"] == "dropped_link_loss"


def test_link_down_produces_exactly_one_terminal_drop(api):
    api.result("update_link", {"linkId": "link-1", "status": "down"})
    packet_id = api.result("inject_packet", {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 500})
    api.result("run_simulation_until_empty")
    detail = api.result("get_packet_details", {"packetId": packet_id})
    assert detail["state"] == "dropped_link_down"
    drops = [h for h in detail["hop_history"] if h["state"].startswith("dropped")]
    assert len(drops) == 1


def test_tcp_loses_one_segment_and_recovers_with_one_retransmission(api):
    """`dropped_segments` drops the first transmission of the listed index; the retransmission
    is delivered, so loss is repaired by the fast-retransmit path without a timeout."""
    result = api.result(
        "simulate_tcp",
        {
            "config": {
                "source_node_id": "node-1",
                "destination_node_id": "node-3",
                "payload_bytes": 8000,
                "segment_size_bytes": 1000,
                "dropped_segments": [3],
                "seed": 7,
            }
        },
    )
    metrics = result["metrics"]
    assert metrics["segments_lost"] == 1
    assert metrics["retransmissions"] == 1
    assert metrics["fast_retransmit_count"] == 1
    assert metrics["timeout_count"] == 0
    assert metrics["duplicate_acks"] == 3
    assert metrics["segments_delivered"] == 8
    assert result["completed"] is True
    assert metrics["congestion_window_max"] >= metrics["congestion_window_final"]


def test_tcp_slow_start_doubles_the_in_flight_window_each_round(api):
    api.result("create_project", {"name": "slow-start"})
    result = api.result(
        "simulate_tcp",
        {
            "config": {
                "source_node_id": "node-1",
                "destination_node_id": "node-3",
                "payload_bytes": 40_000,
                "segment_size_bytes": 1000,
                "initial_cwnd_mss": 1,
                "initial_ssthresh_mss": 16,
                "seed": 42,
            }
        },
    )
    sends = [e for e in result["events"] if e["event_type"] == "data_segment_sent"]
    first = sends[0]["timestamp_us"]
    rounds: dict[int, int] = {}
    for event in sends:
        bucket = round((event["timestamp_us"] - first) / 20_000)
        rounds[bucket] = rounds.get(bucket, 0) + 1
    per_round = [rounds[k] for k in sorted(rounds)]
    assert per_round[:4] == [1, 2, 4, 8], "slow start must double the window every RTT"
    assert result["metrics"]["segments_delivered"] == 40


def test_tcp_congestion_avoidance_adds_one_mss_per_round_trip(api):
    """RFC 5681 additive increase: cwnd += 1/cwnd MSS per ACK, i.e. +1 MSS per round trip.

    The defect this guards against added the +1 MSS milestone to cwnd *in addition* to the
    fractional step, doubling the additive-increase rate to +2 MSS per RTT.
    """
    api.result("create_project", {"name": "congestion-avoidance"})
    result = api.result(
        "simulate_tcp",
        {
            "config": {
                "source_node_id": "node-1",
                "destination_node_id": "node-3",
                "payload_bytes": 40_000,
                "segment_size_bytes": 1000,
                "initial_cwnd_mss": 1,
                "initial_ssthresh_mss": 16,
                "seed": 42,
            }
        },
    )
    cwnd = [point["cwnd_mss"] for point in result["cwnd_timeline"]]
    ssthresh = 16.0
    diffs = [cwnd[i + 1] - cwnd[i] for i in range(len(cwnd) - 1)]

    slow_start = [d for i, d in enumerate(diffs) if cwnd[i] < ssthresh]
    assert slow_start and all(abs(d - 1.0) < 1e-9 for d in slow_start), "slow start adds exactly 1 MSS per ACK"

    start = next(i for i, value in enumerate(cwnd) if value >= ssthresh)
    avoidance = diffs[start:]
    assert avoidance, "the transfer must enter congestion avoidance"
    assert all(0 < d < 1.0 for d in avoidance), "congestion avoidance must not jump a full MSS at once"

    # One round trip of ACKs increases cwnd by ~1 MSS (16 samples: cwnd starts at ~16.97 MSS).
    window = avoidance[:16]
    assert 0.95 <= sum(window) <= 1.05, f"one RTT of additive increase was {sum(window):.3f} MSS, expected ~1"


@pytest.mark.parametrize("protocol", ["go_back_n", "selective_repeat"])
def test_flow_control_loss_recovery_matches_the_protocol_definition(api, protocol):
    """Go-Back-N re-sends the whole window after the loss; Selective Repeat re-sends one frame."""
    result = api.result(
        f"simulate_{protocol}",
        {
            "config": {
                "protocol": protocol,
                "window_size": 4,
                "sequence_space": 8,
                "total_frames_to_send": 6,
                "frame_tx_time_us": 10_000,
                "prop_delay_us": 40_000,
                "ack_tx_time_us": 2_000,
                "timeout_us": 150_000,
                "seed": 42,
                "dropped_frame_indices": [2],
            }
        },
    )
    metrics = result["metrics"]
    expected_retransmissions = 4 if protocol == "go_back_n" else 1
    assert metrics["dropped_or_corrupted_frames"] == 1
    assert metrics["retransmissions"] == expected_retransmissions
    assert metrics["completed_frames"] == 6


def test_flow_control_stalls_at_the_window_size(api):
    """Hand timeline: a = 40000/10000 = 4, window 4 of 8 => the sender stalls until the first ACK
    returns at 50 ms + 2 ms + 40 ms = 92 ms."""
    result = api.result(
        "simulate_go_back_n",
        {
            "config": {
                "protocol": "go_back_n",
                "window_size": 4,
                "sequence_space": 8,
                "total_frames_to_send": 8,
                "frame_tx_time_us": 10_000,
                "prop_delay_us": 40_000,
                "ack_tx_time_us": 2_000,
                "timeout_us": 150_000,
                "seed": 42,
            }
        },
    )
    sent = [e["timestamp_us"] for e in result["events"] if e["event_type"] == "frame_sent"]
    assert sent[:4] == [0, 10_000, 20_000, 30_000]
    assert sent[4] == 92_000
    assert result["metrics"]["completion_time_us"] == 172_000
    assert result["metrics"]["retransmissions"] == 0


def test_identical_configuration_produces_identical_results(api):
    """Determinism: the same configuration must be reproducible byte for byte."""
    config = {
        "config": {
            "protocol": "go_back_n",
            "window_size": 4,
            "sequence_space": 8,
            "total_frames_to_send": 6,
            "dropped_frame_indices": [2],
            "seed": 42,
        }
    }
    first = api.result("simulate_go_back_n", config)
    second = api.result("simulate_go_back_n", config)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


def test_parameter_sweep_varies_with_the_parameter_and_repeats_exactly(api):
    """A bandwidth sweep must move latency in the expected direction and be reproducible."""
    config = {
        "config": {
            "target": "network",
            "parameter": {"type": "link_bandwidth"},
            "parameter_values": [100_000, 1_000_000, 10_000_000],
            "seeds": [42, 43, 44],
            "simulation_duration_us": 2_000_000,
            "packet_count": 40,
            "packet_size_bytes": 1000,
            "traffic_interval_us": 3000,
        }
    }
    first = api.result("run_parameter_sweep_command", config)
    second = api.result("run_parameter_sweep_command", config)

    # `execution_time_ms` is wall-clock and legitimately differs between runs.
    def measurable(result: dict) -> str:
        return json.dumps({k: v for k, v in result.items() if k != "execution_time_ms"}, sort_keys=True)

    assert measurable(first) == measurable(second), "the sweep must be reproducible"

    assert first["total_runs"] == 9
    points = first["points"]
    assert [p["parameter_value"] for p in points] == [100_000, 1_000_000, 10_000_000]
    latencies = [p["aggregated_qos"]["mean_latency_us"] for p in points]
    assert latencies[0] > latencies[1] > latencies[2], f"latency must fall as bandwidth rises: {latencies}"
    for point in points:
        assert point["aggregated_qos"]["run_count"] == 3


def test_comparative_experiment_reports_a_measured_delta(api):
    """A/B comparison must run both scenarios and report per-metric deltas."""
    config = {
        "config": {
            "experiment_name": "ab",
            "scenario_a": {"name": "1 Mbps", "parameter_overrides": [[{"type": "link_bandwidth"}, 1_000_000]]},
            "scenario_b": {"name": "128 kbps", "parameter_overrides": [[{"type": "link_bandwidth"}, 128_000]]},
            "seeds": [42, 43],
            "simulation_duration_us": 2_000_000,
            "packet_count": 30,
            "packet_size_bytes": 1000,
            "traffic_interval_us": 3000,
        }
    }
    result = api.result("run_comparative_experiment_command", config)
    assert result["runs_count_per_scenario"] == 2
    by_name = {delta["metric_name"]: delta for delta in result["deltas"]}
    assert {"throughput_bps", "latency_us", "jitter_us", "loss_rate", "retransmissions"} <= set(by_name)
    assert by_name["latency_us"]["val_b"] > by_name["latency_us"]["val_a"], "the slower link must show higher latency"
    assert by_name["throughput_bps"]["val_a"] >= by_name["throughput_bps"]["val_b"]
    assert set(result["qos_a"].keys()) and set(result["qos_b"].keys())


def test_qos_metrics_on_an_idle_project_are_zero_and_finite(api):
    metrics = api.result("get_current_qos_metrics")
    assert metrics["packets_sent"] == 0
    assert metrics["average_latency_us"] == 0
    assert metrics["packet_loss_rate"] == 0
    for key, value in metrics.items():
        if isinstance(value, float):
            assert value == value, f"{key} is NaN"
