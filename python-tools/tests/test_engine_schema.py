"""Schema-compatibility tests: the utilities must consume what the engine actually emits.

The fixtures elsewhere in this directory are hand-written from the engine's current output shape.
This module closes the loop by running a real parameter sweep through the Python engine and
feeding the result straight to both tools, so a change to the engine's serialisation fails here
rather than silently breaking the utilities.

Only the document *shape* and deterministic values are asserted. ``execution_time_ms`` measures
wall-clock time and is deliberately ignored.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from test_plot_metrics import read_png_header

# Keys each tool requires before it will do anything.
ANALYZER_REQUIRED_KEYS = ("experiment_name", "parameter_name", "points", "total_runs")
# Keys the annotation tables read; a rename here would print 'n/a' everywhere.
QOS_KEYS_READ = (
    "run_count",
    "mean_throughput_bps",
    "mean_goodput_bps",
    "mean_latency_us",
    "mean_jitter_us",
    "mean_loss_rate",
    "mean_retransmissions",
)

PARAMETER_VALUES = [500_000.0, 1_000_000.0]


@pytest.fixture(scope="session")
def engine_sweep_document() -> dict[str, Any]:
    """Run a real sweep through the simulation engine and return the serialised result."""
    from netsim.experiments.config import SweepConfig
    from netsim.experiments.runner import run_parameter_sweep
    from netsim.server import create_default_project

    config = SweepConfig.from_dict(
        {
            "experiment_name": "schema-compat",
            "parameter": {"kind": "link_bandwidth_bps", "link_id": "link-1"},
            "parameter_values": PARAMETER_VALUES,
            "seeds": [7],
            "simulation_duration_us": 200_000,
            "packet_count": 8,
        }
    )
    return run_parameter_sweep(config, create_default_project()).to_dict()


@pytest.fixture
def engine_sweep_file(engine_sweep_document, tmp_path: Path) -> Path:
    path = tmp_path / "engine-sweep.json"
    path.write_text(json.dumps(engine_sweep_document), encoding="utf-8")
    return path


def test_engine_emits_every_key_the_analyzer_requires(engine_sweep_document):
    missing = [key for key in ANALYZER_REQUIRED_KEYS if key not in engine_sweep_document]
    assert not missing, f"engine output is missing keys the analyzer needs: {missing}"


def test_engine_qos_objects_carry_every_metric_the_tables_read(engine_sweep_document):
    points = engine_sweep_document["points"]
    assert points, "the engine produced no parameter points"
    for point in points:
        missing = [key for key in QOS_KEYS_READ if key not in point["aggregated_qos"]]
        assert not missing, f"aggregated_qos is missing metrics the report reads: {missing}"


def test_engine_produces_one_point_per_parameter_value(engine_sweep_document):
    points = engine_sweep_document["points"]
    assert [point["parameter_value"] for point in points] == PARAMETER_VALUES


def test_engine_metrics_are_numeric_and_physical(engine_sweep_document):
    """Every analysed value must be a real number the tools can format."""
    for point in engine_sweep_document["points"]:
        qos = point["aggregated_qos"]
        for key in QOS_KEYS_READ:
            assert isinstance(qos[key], (int, float)), f"{key} is {type(qos[key]).__name__}, not numeric"
        # A sweep over link bandwidth must not invent negative or non-finite measurements.
        assert qos["mean_throughput_bps"] >= 0.0
        assert qos["mean_goodput_bps"] >= 0.0
        assert qos["mean_latency_us"] > 0.0
        assert 0.0 <= qos["mean_loss_rate"] <= 1.0
        assert qos["run_count"] == 1

    # Lower bandwidth must not deliver a lower mean latency: 500 kbps is the slower link.
    slow, fast = (point["aggregated_qos"]["mean_latency_us"] for point in engine_sweep_document["points"])
    assert slow >= fast, f"latency at 500 kbps ({slow}) should be >= latency at 1 Mbps ({fast})"


def test_analyzer_consumes_a_real_engine_export(analyze_tool, engine_sweep_file, capsys):
    assert analyze_tool.analyze_json_results(str(engine_sweep_file)) == 0
    out = capsys.readouterr().out
    assert "=== NetSim Sweep Analysis: schema-compat ===" in out
    assert f"Parameter points: {len(PARAMETER_VALUES)}" in out
    assert "n/a" not in out, "every metric the engine emits should be formattable"


def test_plotter_consumes_a_real_engine_export(plot_tool, engine_sweep_file, tmp_path):
    out_path = tmp_path / "engine.png"
    assert plot_tool.plot_experiment_metrics(str(engine_sweep_file), str(out_path)) == 0
    width, height = read_png_header(out_path)
    assert width > 0 and height > 0


def test_both_tools_agree_on_the_engine_export(analyze_tool, plot_tool, engine_sweep_file):
    """Whatever the plotter accepts, the analyser must summarise - and with the same point count."""
    document = json.loads(engine_sweep_file.read_text(encoding="utf-8"))
    series = plot_tool.parse_plot_series(document)
    parsed = analyze_tool.parse_sweep_document(document)

    assert len(series.parameters) == len(parsed.rows) == len(PARAMETER_VALUES)
    for row, parameter in zip(parsed.rows, series.parameters, strict=True):
        assert row.parameter_value == pytest.approx(parameter)
