"""Regression coverage for actual dispatch, supported inputs and portable run snapshots."""

import copy
import json

import pytest
from netsim.experiments.config import ComparativeExperimentConfig, SweepConfig
from netsim.experiments.runner import run_comparative_experiment, run_parameter_sweep
from test_parity_golden import create_two_node_project


def sweep(target="network", parameter="link_bandwidth", values=None):
    return {
        "experiment_name": "dispatch-regression",
        "target": target,
        "parameter": {"type": parameter},
        "parameter_values": values or [1_000_000, 10_000_000],
        "seeds": [42],
        "simulation_duration_us": 100_000,
        "packet_count": 8,
    }


@pytest.mark.parametrize("target", ["network", "tcp", "udp"])
def test_real_models_and_export_replay(target):
    project = create_two_node_project()
    result = run_parameter_sweep(SweepConfig.from_dict(sweep(target)), project).to_dict()
    assert len(result["run_evidence"]) == 2
    assert {r["model"] for r in result["run_evidence"]} == {target}
    if target != "network":
        assert all(r["config"]["protocol"] == target for r in result["run_evidence"])
        assert all(r["metrics"]["bytes_delivered"] > 0 for r in result["run_evidence"])
        assert all(r["effective_hops"] for r in result["run_evidence"])
    # Export is JSON-safe and sufficient without the original active topology.
    saved = json.loads(json.dumps(result, allow_nan=False))
    replay = run_parameter_sweep(SweepConfig.from_dict(saved["provenance"]["config"]), project).to_dict()
    result.pop("execution_time_ms")
    replay.pop("execution_time_ms")
    assert result == replay


@pytest.mark.parametrize("target", ["application", "flow_control", "mac"])
def test_unsupported_targets_fail_instead_of_substitution(target):
    with pytest.raises(ValueError, match="dedicated studio"):
        run_parameter_sweep(SweepConfig.from_dict(sweep(target)), create_two_node_project())


@pytest.mark.parametrize("target", ["network", "tcp", "udp"])
@pytest.mark.parametrize("parameter", ["window_size", "timeout_us", "mac_persistence"])
def test_unwired_parameters_are_never_silently_accepted(target, parameter):
    with pytest.raises(ValueError, match="not supported"):
        run_parameter_sweep(SweepConfig.from_dict(sweep(target, parameter, [1])), create_two_node_project())


@pytest.mark.parametrize(
    "parameter,values",
    [
        ("link_bandwidth", [1_000_000, 10_000_000]),
        ("propagation_delay", [1000, 10000]),
        ("queue_capacity", [1, 10]),
        ("bit_error_rate", [0, 0.0001]),
        ("packet_size_bytes", [32, 1024]),
        ("traffic_interval_us", [1000, 10000]),
        ("packet_count", [2, 8]),
    ],
)
def test_every_network_parameter_changes_effective_inputs(parameter, values):
    result = run_parameter_sweep(
        SweepConfig.from_dict(sweep(parameter=parameter, values=values)), create_two_node_project()
    )
    inputs = [r["inputs"] for r in result.run_evidence]
    if parameter in ("link_bandwidth", "propagation_delay", "queue_capacity", "bit_error_rate"):
        field = {"link_bandwidth": "bandwidth_bps", "propagation_delay": "propagation_delay_us"}.get(
            parameter, parameter
        )
        assert [i["base_project"]["links"][0][field] for i in inputs] == values
    else:
        field = {"packet_size_bytes": "packet_size", "traffic_interval_us": "interval_us"}.get(parameter, parameter)
        assert [i[field] for i in inputs] == values


@pytest.mark.parametrize("target", ["tcp", "udp"])
@pytest.mark.parametrize(
    "parameter,values,field",
    [
        ("link_bandwidth", [1_000_000, 10_000_000], "bandwidth_bps"),
        ("propagation_delay", [1000, 10000], "delay_us"),
        ("packet_size_bytes", [32, 1024], "segment_size_bytes"),
        ("packet_count", [2, 8], "payload_bytes"),
    ],
)
def test_every_transport_parameter_reaches_model(target, parameter, values, field):
    result = run_parameter_sweep(SweepConfig.from_dict(sweep(target, parameter, values)), create_two_node_project())
    evidence = result.run_evidence
    if parameter in ("link_bandwidth", "propagation_delay"):
        assert [r["effective_hops"][0][field] for r in evidence] == values
    else:
        expected = values if parameter == "packet_size_bytes" else [v * 1000 for v in values]
        assert [r["config"][field] for r in evidence] == expected


@pytest.mark.parametrize("value", [float("nan"), float("inf"), 1.5])
def test_ab_rejects_invalid_override_values(value):
    config = ComparativeExperimentConfig.from_dict(
        {
            "scenario_a": {"name": "a", "parameter_overrides": [[{"type": "packet_count"}, value]]},
            "scenario_b": {"name": "b"},
            "seeds": [42],
            "simulation_duration_us": 100000,
        }
    )
    with pytest.raises(ValueError):
        run_comparative_experiment(config, create_two_node_project())


@pytest.mark.parametrize("target", ["network", "tcp", "udp"])
def test_ab_preserves_seed_pairs_and_traffic_overrides(target):
    project = create_two_node_project()
    config = ComparativeExperimentConfig.from_dict(
        {
            "target": target,
            "scenario_a": {"name": "a", "parameter_overrides": [[{"type": "packet_count"}, 2]]},
            "scenario_b": {"name": "b", "parameter_overrides": [[{"type": "packet_count"}, 8]]},
            "seeds": [42, 43],
            "simulation_duration_us": 100000,
        }
    )
    result = run_comparative_experiment(config, project).to_dict()
    assert [(r["scenario"], r["seed"]) for r in result["run_evidence"]] == [("a", 42), ("b", 42), ("a", 43), ("b", 43)]
    if target == "network":
        assert [r["inputs"]["packet_count"] for r in result["run_evidence"]] == [2, 8, 2, 8]
    else:
        assert [r["config"]["payload_bytes"] for r in result["run_evidence"]] == [2000, 8000, 2000, 8000]
    replay = run_comparative_experiment(
        ComparativeExperimentConfig.from_dict(copy.deepcopy(result["provenance"]["config"])), project
    ).to_dict()
    assert replay["run_evidence"] == result["run_evidence"]


@pytest.mark.parametrize("target", ["tcp", "udp"])
def test_transport_refuses_unsupported_loss_and_timing(target):
    project = create_two_node_project()
    config = sweep(target)
    config["traffic_interval_us"] = 100
    with pytest.raises(ValueError, match="traffic_interval_us"):
        run_parameter_sweep(SweepConfig.from_dict(config), project)
    project.links[0].loss_probability = 0.1
    with pytest.raises(ValueError, match="stochastic"):
        run_parameter_sweep(SweepConfig.from_dict(sweep(target)), project)


def test_transport_floor_is_explicit_not_silent():
    with pytest.raises(ValueError, match="model floors"):
        run_parameter_sweep(SweepConfig.from_dict(sweep("tcp", values=[1000])), create_two_node_project())


@pytest.mark.parametrize("seed", [1.5, float("nan"), float("inf"), True])
def test_ab_seed_inputs_are_not_silently_truncated(seed):
    with pytest.raises(ValueError, match="seed must be an integer"):
        ComparativeExperimentConfig.from_dict(
            {
                "scenario_a": {"name": "a"},
                "scenario_b": {"name": "b"},
                "seeds": [seed],
                "simulation_duration_us": 100000,
            }
        )
