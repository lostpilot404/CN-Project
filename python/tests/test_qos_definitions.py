"""Throughput vs goodput definitions (Phase D).

Definitions under test (see netsim/core/overhead.py and netsim/qos/metrics.py):

* **Throughput** — gross wire rate at the model's documented measurement boundary:
  protocol headers + payload, including retransmitted copies where the model makes
  them. Packet-engine boundary: final delivery. Transport boundary: sender output.
* **Goodput** — unique, successfully delivered application payload bits: no headers,
  no retransmitted or duplicate payload.

Expected values are hand calculations from the documented header sizes
(IPv4 20 B, TCP 20 B, UDP 8 B) and the byte totals the models record.
"""

from __future__ import annotations

from netsim.core.engine import SimulationEngine
from netsim.core.metrics import SimulationMetrics
from netsim.core.overhead import (
    IPV4_HEADER_BYTES,
    TCP_HEADER_BYTES,
    UDP_HEADER_BYTES,
    packet_overhead_bytes,
    payload_bytes_for,
)
from netsim.models.link import Link, LinkEndpoint, LinkStatus
from netsim.models.node import Node, NodeType
from netsim.models.project import Project
from netsim.qos.aggregation import aggregate_qos
from netsim.qos.metrics import compute_network_qos, compute_transport_qos
from netsim.transport import TransportMetrics

# ---------------------------------------------------------------------------
# Overhead accounting (the single source of truth for the numerators)
# ---------------------------------------------------------------------------


def test_documented_header_sizes():
    assert IPV4_HEADER_BYTES == 20
    assert TCP_HEADER_BYTES == 20
    assert UDP_HEADER_BYTES == 8
    assert packet_overhead_bytes("TCP") == 40
    assert packet_overhead_bytes("UDP") == 28


def test_payload_bytes_are_wire_size_minus_headers():
    # Hand calculation: 1000 B TCP packet = 20 IP + 20 TCP + 960 payload.
    assert payload_bytes_for(1000, "TCP") == 960
    # 1000 B UDP packet = 20 IP + 8 UDP + 972 payload.
    assert payload_bytes_for(1000, "UDP") == 972
    # A packet smaller than its headers is all overhead and never negative.
    assert payload_bytes_for(10, "TCP") == 0
    assert payload_bytes_for(40, "TCP") == 0


# ---------------------------------------------------------------------------
# Packet engine: delivered wire bytes vs delivered payload bytes
# ---------------------------------------------------------------------------


def _direct_project() -> Project:
    a = Node.create("node-a", "Host A", NodeType.HOST, 0.0, 0.0)
    b = Node.create("node-b", "Host B", NodeType.HOST, 100.0, 0.0)
    link = Link(
        id="l-ab",
        source=LinkEndpoint(node_id="node-a", interface_id=a.interfaces[0].id),
        target=LinkEndpoint(node_id="node-b", interface_id=b.interfaces[0].id),
        bandwidth_bps=1_000_000,
        propagation_delay_us=1000,
        loss_probability=0.0,
        bit_error_rate=0.0,
        queue_capacity=50,
        status=LinkStatus.UP,
    )
    return Project.create("QoS Direct", nodes=[a, b], links=[link])


def test_engine_delivered_wire_and_payload_bytes_are_distinct():
    engine = SimulationEngine(seed=42)
    proj = _direct_project()
    engine.update_topology(proj.nodes, proj.links)
    engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    engine.run_all()

    # Hand calculation: one 1000 B TCP packet delivered whole.
    assert engine.metrics.bytes_delivered == 1000
    assert engine.metrics.bytes_payload_delivered == 960
    assert engine.metrics.packets_delivered == 1


def test_network_qos_rates_match_hand_calculated_values():
    """1000 B TCP packet delivered over a 2 s interval:
    throughput = 1000 B * 8 / 2 s = 4000 bit/s (wire);
    goodput    =  960 B * 8 / 2 s = 3840 bit/s (payload)."""
    m = SimulationMetrics()
    m.record_created(1000)
    m.record_delivered(1000, 5800, 960)
    qos = compute_network_qos(m, [], [], [], 2_000_000)

    assert qos.throughput_bytes_counted == 1000
    assert qos.goodput_payload_bytes == 960
    assert qos.throughput_bits_per_sec == 4000.0
    assert qos.goodput_bits_per_sec == 3840.0
    # They are genuinely different quantities.
    assert qos.throughput_bits_per_sec != qos.goodput_bits_per_sec


def test_network_qos_on_an_idle_run_is_zero_and_finite():
    qos = compute_network_qos(SimulationMetrics(), [], [], [], 1_000_000)
    assert qos.throughput_bits_per_sec == 0.0
    assert qos.goodput_bits_per_sec == 0.0
    assert qos.throughput_bytes_counted == 0
    assert qos.goodput_payload_bytes == 0
    # Zero-length interval must not divide by zero.
    qos0 = compute_network_qos(SimulationMetrics(), [], [], [], 0)
    assert qos0.throughput_bits_per_sec == 0.0
    assert qos0.goodput_bits_per_sec == 0.0


def test_network_qos_counts_lost_packets_in_neither_numerator():
    m = SimulationMetrics()
    m.record_created(1000)
    m.record_dropped_loss()
    qos = compute_network_qos(m, [], [], [], 1_000_000)
    assert qos.throughput_bits_per_sec == 0.0
    assert qos.goodput_bits_per_sec == 0.0
    assert qos.packets_lost == 1
    assert qos.loss_by_category.stochastic_loss == 1
    # Every loss category is accounted for exactly once.
    cat = qos.loss_by_category.to_dict()
    assert sum(cat.values()) == qos.packets_lost


# ---------------------------------------------------------------------------
# Transport models: sender-boundary throughput vs receiver-boundary goodput
# ---------------------------------------------------------------------------


def test_tcp_wire_accounting_covers_retransmissions_and_headers():
    """8 x 1000 B payload, segment 3 lost once and recovered by fast retransmit:

    attempts      = 8 initial + 1 retransmission = 9
    payload sent  = 8000 + 1000 retransmitted
    headers       = 9 attempts * 40 B = 360
    wire bytes    = 9360                -> throughput numerator
    delivered     = 8000 unique payload -> goodput numerator
    """
    tm = TransportMetrics(
        segments_sent=8,
        segments_delivered=8,
        retransmissions=1,
        segments_lost=1,
        bytes_sent=8000,
        bytes_delivered=8000,
        retransmitted_payload_bytes=1000,
        header_bytes_sent=360,
        wire_bytes_sent=9360,
        completion_time_us=1_000_000,
    )
    tm.throughput_bits_per_sec = (tm.wire_bytes_sent * 8.0 * 1_000_000.0) / tm.completion_time_us
    tm.goodput_bits_per_sec = (tm.bytes_delivered * 8.0 * 1_000_000.0) / tm.completion_time_us

    assert tm.throughput_bits_per_sec == 74880.0  # 9360 B * 8 / 1 s
    assert tm.goodput_bits_per_sec == 64000.0  # 8000 B * 8 / 1 s
    assert tm.throughput_bits_per_sec > tm.goodput_bits_per_sec

    qos = compute_transport_qos(tm, 1_000_000)
    assert qos.throughput_bytes_counted == 9360
    assert qos.goodput_payload_bytes == 8000
    assert qos.throughput_bits_per_sec == 74880.0
    assert qos.goodput_bits_per_sec == 64000.0
    # Transport loss lands in a single category and matches packets_lost.
    assert qos.loss_by_category.stochastic_loss == qos.packets_lost == 1


def test_tcp_service_results_report_the_documented_numerators(api):
    """The real simulate_tcp service: one controlled loss + fast retransmit.

    Exact byte totals follow from the model's accounting:
      8 initial sends + 1 retransmission -> 9 * 40 B headers = 360 B
      payload sent 8000 B + retransmitted 1000 B -> wire 9360 B
      unique delivered payload 8000 B.
    """
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
    m = result["metrics"]
    assert m["segments_sent"] == 8
    assert m["retransmissions"] == 1
    assert m["retransmitted_payload_bytes"] == 1000
    assert m["header_bytes_sent"] == 360
    assert m["wire_bytes_sent"] == 9360
    assert m["bytes_delivered"] == 8000

    t = result["completion_time_us"] if "completion_time_us" in result else m["completion_time_us"]
    assert m["throughput_bits_per_sec"] == (9360 * 8.0 * 1_000_000.0) / t
    assert m["goodput_bits_per_sec"] == (8000 * 8.0 * 1_000_000.0) / t
    assert m["throughput_bits_per_sec"] > m["goodput_bits_per_sec"]


def test_udp_service_results_report_headers_in_throughput_only(api):
    """8 x 1000 B datagrams, no loss:
    wire     = 8000 + 8 * 28 = 8224 B -> throughput numerator
    payload  = 8000 B                 -> goodput numerator.
    """
    result = api.result(
        "simulate_udp",
        {
            "config": {
                "source_node_id": "node-1",
                "destination_node_id": "node-3",
                "payload_bytes": 8000,
                "segment_size_bytes": 1000,
                "seed": 7,
            }
        },
    )
    m = result["metrics"]
    assert m["segments_sent"] == 8
    assert m["header_bytes_sent"] == 8 * 28 == 224
    assert m["wire_bytes_sent"] == 8224
    assert m["bytes_sent"] == 8000
    assert m["bytes_delivered"] == 8000

    t = m["completion_time_us"]
    assert m["throughput_bits_per_sec"] == (8224 * 8.0 * 1_000_000.0) / t
    assert m["goodput_bits_per_sec"] == (8000 * 8.0 * 1_000_000.0) / t
    # The difference is exactly the header overhead rate.
    assert m["throughput_bits_per_sec"] - m["goodput_bits_per_sec"] == (224 * 8.0 * 1_000_000.0) / t


def test_udp_with_loss_counts_only_delivered_payload_as_goodput(api):
    """Datagram 2 dropped: 8 sent, 7 delivered.
    throughput numerator = 8224 B wire (lost datagram still consumed wire time);
    goodput numerator    = 7000 B unique delivered payload.
    """
    result = api.result(
        "simulate_udp",
        {
            "config": {
                "source_node_id": "node-1",
                "destination_node_id": "node-3",
                "payload_bytes": 8000,
                "segment_size_bytes": 1000,
                "dropped_segments": [2],
                "seed": 7,
            }
        },
    )
    m = result["metrics"]
    assert m["segments_sent"] == 8
    assert m["segments_delivered"] == 7
    assert m["bytes_delivered"] == 7000
    assert m["wire_bytes_sent"] == 8224

    t = m["completion_time_us"]
    assert m["throughput_bits_per_sec"] == (8224 * 8.0 * 1_000_000.0) / t
    assert m["goodput_bits_per_sec"] == (7000 * 8.0 * 1_000_000.0) / t


# ---------------------------------------------------------------------------
# Live engine QoS through the real service
# ---------------------------------------------------------------------------


def test_live_qos_metrics_expose_distinct_rates_with_the_payload_ratio(api):
    api.result(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 1000, "transportProtocol": "TCP"},
    )
    api.result("run_simulation_until_empty")
    qos = api.result("get_current_qos_metrics")

    assert qos["throughput_bytes_counted"] == 1000
    assert qos["goodput_payload_bytes"] == 960
    # Hand ratio: goodput / throughput = payload / wire = 960 / 1000 = 0.96.
    assert qos["goodput_bits_per_sec"] / qos["throughput_bits_per_sec"] == 0.96


# ---------------------------------------------------------------------------
# Aggregation stays semantically consistent
# ---------------------------------------------------------------------------


def test_aggregation_preserves_distinct_throughput_and_goodput_means():
    m1 = SimulationMetrics()
    m1.record_delivered(1000, 100, 960)
    m2 = SimulationMetrics()
    m2.record_delivered(500, 100, 460)
    q1 = compute_network_qos(m1, [], [], [], 1_000_000)
    q2 = compute_network_qos(m2, [], [], [], 1_000_000)
    agg = aggregate_qos([q1, q2])

    # Hand calculation: mean throughput = (8000 + 4000)/2 = 6000 bit/s,
    # mean goodput = (7680 + 3680)/2 = 5680 bit/s.
    assert agg.mean_throughput_bps == 6000.0
    assert agg.mean_goodput_bps == 5680.0
    assert agg.mean_throughput_bps != agg.mean_goodput_bps
