"""NetSim analysis toolkit --- results analyzer.

Consumes the JSON emitted by the NetSim parameter-sweep experiment
(``run_parameter_sweep_command``, also reachable from the Experiments workspace) and prints a
per-point statistical summary.

This script is optional tooling: it is not required to run NetSim, and the simulator does not
import it. It only needs the standard library.

Usage:
    python analyze_results.py <path_to_sweep_result.json>
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

# Keys the engine's SweepExperimentResult always emits. Used to fail loudly on unrecognised input
# rather than silently reporting zero results.
_REQUIRED_KEYS = ("experiment_name", "parameter_name", "points", "total_runs")


def _fmt(value: Any, unit: str = "", scale: float = 1.0, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    try:
        return f"{float(value) / scale:.{digits}f} {unit}".strip()
    except (TypeError, ValueError):
        return f"{value} {unit}".strip()


def _load(filepath: str) -> dict[str, Any]:
    with open(filepath, encoding="utf-8") as handle:
        data = json.load(handle)

    # The engine may return the result either bare or wrapped in a command envelope.
    if isinstance(data, dict) and "result" in data and isinstance(data["result"], dict):
        data = data["result"]

    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object at the top level.")

    missing = [key for key in _REQUIRED_KEYS if key not in data]
    if missing:
        raise ValueError(
            "This file is not a NetSim sweep result (missing "
            + ", ".join(missing)
            + "). Expected the JSON produced by 'run_parameter_sweep_command'."
        )
    return data


def analyze_json_results(filepath: str) -> int:
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return 1

    try:
        data = _load(filepath)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"Cannot read sweep results from {filepath}: {exc}")
        return 1

    points = data.get("points") or []
    seeds = data.get("seeds") or []

    print(f"=== NetSim Sweep Analysis: {data.get('experiment_name', 'Unnamed')} ===")
    print(f"Swept parameter : {data.get('parameter_name', 'n/a')}")
    print(f"Seeds           : {seeds if seeds else 'n/a'}")
    print(f"Parameter points: {len(points)}")
    print(f"Total runs      : {data.get('total_runs', 0)}")
    print(f"Execution time  : {data.get('execution_time_ms', 0)} ms")
    print()

    if not points:
        print("No parameter points present in this result.")
        return 0

    header = (
        f"{'parameter':>14} {'runs':>5} {'throughput':>13} {'goodput':>12} "
        f"{'mean lat':>10} {'jitter':>9} {'loss':>7} {'retx':>6}"
    )
    print(header)
    print("-" * len(header))

    for point in points:
        qos = point.get("aggregated_qos") or {}
        runs = point.get("runs") or []
        print(
            f"{_fmt(point.get('parameter_value'), digits=0):>14} "
            f"{qos.get('run_count', len(runs)):>5} "
            f"{_fmt(qos.get('mean_throughput_bps'), 'Mbps', 1e6):>13} "
            f"{_fmt(qos.get('mean_goodput_bps'), 'Mbps', 1e6):>12} "
            f"{_fmt(qos.get('mean_latency_us'), 'us', 1.0):>10} "
            f"{_fmt(qos.get('mean_jitter_us'), 'us', 1.0):>9} "
            f"{_fmt(qos.get('mean_loss_rate'), '', 1.0, 4):>7} "
            f"{_fmt(qos.get('mean_retransmissions'), '', 1.0, 2):>6}"
        )

    print()
    print("Column notes: throughput/goodput are means across the seeds for that point;")
    print("'runs' is the number of seeds aggregated; loss is a ratio in [0, 1].")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        return analyze_json_results(argv[1])
    print("Usage: python analyze_results.py <path_to_sweep_result.json>")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
