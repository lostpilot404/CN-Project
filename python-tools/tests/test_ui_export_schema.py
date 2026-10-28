"""The JSON produced by the UI's experiment export must be consumable by python-tools.

``src/lib/exportResults.ts`` exports the *verbatim* sweep result object. These tests pin
that shape against the two consumer parsers (``analyze_results.parse_sweep_document`` and
``plot_metrics.parse_plot_series``) so the export format cannot drift away from the tools.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import ModuleType

# The exact structure sweepResultToJson() writes (SweepExperimentResult + QosMetrics).
UI_SWEEP_EXPORT = {
    "experiment_name": "Bandwidth Sweep Analysis",
    "parameter_name": "link_bandwidth",
    "points": [
        {
            "parameter_value": 1_000_000,
            "aggregated_qos": {
                "run_count": 2,
                "mean_throughput_bps": 9600.0,
                "mean_goodput_bps": 8000.0,
                "mean_latency_us": 120.5,
                "min_latency_us": 100,
                "max_latency_us": 150,
                "mean_jitter_us": 12.25,
                "mean_loss_rate": 0.1,
                "mean_retransmissions": 2.0,
                "stddev_latency_us": 2.5,
                "stddev_throughput_bps": 10.0,
            },
            "runs": [
                {
                    "parameter_value": 1_000_000,
                    "seed": 42,
                    "qos": {
                        "measurement_interval_us": 2000,
                        "throughput_bits_per_sec": 9600,
                        "throughput_bytes_per_sec": 1200,
                        "goodput_bits_per_sec": 8000,
                        "throughput_bytes_counted": 2400,
                        "goodput_payload_bytes": 2000,
                        "end_to_end_latencies_us": [100, 150],
                        "average_latency_us": 120.5,
                        "min_latency_us": 100,
                        "max_latency_us": 150,
                        "jitter_us": 12.25,
                        "jitter_samples": [5, 20],
                        "packets_sent": 10,
                        "packets_delivered": 9,
                        "packets_lost": 1,
                        "packet_loss_rate": 0.1,
                        "loss_by_category": {
                            "queue_overflow": 0,
                            "link_down": 0,
                            "bit_error": 0,
                            "stochastic_loss": 1,
                            "ttl_expired": 0,
                            "no_route": 0,
                        },
                        "retransmissions": 2,
                        "link_utilization": [],
                        "queue_occupancy_average": 1.5,
                        "queue_occupancy_max": 4,
                        "queue_drops": 0,
                        "average_rtt_us": 300,
                    },
                    "route_changes": [],
                }
            ],
        },
        {
            "parameter_value": 10_000_000,
            "aggregated_qos": {
                "run_count": 1,
                "mean_throughput_bps": 96000.0,
                "mean_goodput_bps": 80000.0,
                "mean_latency_us": 50.25,
                "min_latency_us": 40,
                "max_latency_us": 60,
                "mean_jitter_us": 5.5,
                "mean_loss_rate": 0.0,
                "mean_retransmissions": 0.0,
                "stddev_latency_us": 0.0,
                "stddev_throughput_bps": 0.0,
            },
            "runs": [],
        },
    ],
    "total_runs": 3,
    "seeds": [42, 101],
    "execution_time_ms": 42,
}


def test_analyze_results_parses_the_ui_json_export(analyze_tool: ModuleType) -> None:
    doc = analyze_tool.parse_sweep_document(json.loads(json.dumps(UI_SWEEP_EXPORT)))
    assert doc.experiment_name == "Bandwidth Sweep Analysis"
    assert doc.parameter_name == "link_bandwidth"
    assert doc.total_runs == 3
    assert doc.seeds == [42, 101]
    assert len(doc.rows) == 2
    first = doc.rows[0]
    assert first.parameter_value == 1_000_000
    assert first.throughput_bps == 9600.0
    assert first.goodput_bps == 8000.0
    assert first.latency_us == 120.5
    assert first.run_count == 2


def test_plot_metrics_parses_the_ui_json_export(plot_tool: ModuleType) -> None:
    series = plot_tool.parse_plot_series(UI_SWEEP_EXPORT)
    assert series.parameters == [1_000_000.0, 10_000_000.0]
    assert len(series.throughput_mbps) == 2
    assert len(series.latency_ms) == 2


def test_analyze_results_cli_consumes_an_exported_file(analyze_tool: ModuleType, tmp_path: Path) -> None:
    filepath = tmp_path / "netsim-sweep-bandwidth-sweep-analysis-20261016120000.json"
    filepath.write_text(json.dumps(UI_SWEEP_EXPORT), encoding="utf-8")
    assert analyze_tool.analyze_json_results(str(filepath)) == 0
