"""NetSim analysis toolkit --- results analyzer.

Consumes the JSON emitted by the NetSim parameter-sweep experiment
(``run_parameter_sweep_command``, also reachable from the Experiments workspace) and prints a
per-point statistical summary.

This script is optional tooling: it is not required to run NetSim, and the simulator does not
import it. It only needs the standard library.

Usage:
    python analyze_results.py <path_to_sweep_result.json>

Validation contract
-------------------
*Structural* problems mean the document is not a sweep result at all, and are reported as a clear
error with a non-zero exit status: the top level is not an object, a required key is missing,
``points`` is not an array, a point is not an object, or ``aggregated_qos`` is not an object.

*Value* problems are tolerated, because a summariser's job is to report what is there: a metric
that is absent, null or not a number is printed as ``n/a`` rather than being silently coerced to a
number that was never measured.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Any

# Keys the engine's SweepExperimentResult always emits. Used to fail loudly on unrecognised input
# rather than silently reporting zero results.
_REQUIRED_KEYS = ("experiment_name", "parameter_name", "points", "total_runs")


class SweepDataError(ValueError):
    """The loaded document is not a usable NetSim sweep result."""


@dataclass(frozen=True)
class SweepRow:
    """One aggregated parameter point, with non-measured metrics left as ``None``."""

    parameter_value: float | None
    run_count: int
    throughput_bps: float | None
    goodput_bps: float | None
    latency_us: float | None
    jitter_us: float | None
    loss_rate: float | None
    retransmissions: float | None


@dataclass(frozen=True)
class SweepDocument:
    """A validated sweep result ready for reporting."""

    experiment_name: str
    parameter_name: str
    seeds: list[Any]
    total_runs: int
    execution_time_ms: Any
    rows: list[SweepRow]


def _opt_float(value: Any) -> float | None:
    """Return *value* as a float, or ``None`` when it is absent or not a finite number."""
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return result


def _opt_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_object(value: Any, field: str) -> dict[str, Any]:
    """Return *value* as a mapping, or raise :class:`SweepDataError` describing the shape."""
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    raise SweepDataError(f"'{field}' must be a JSON object (received {type(value).__name__})")


def _fmt(value: float | None, unit: str = "", scale: float = 1.0, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    return f"{value / scale:.{digits}f} {unit}".strip()


def _parse_rows(points: Any) -> list[SweepRow]:
    if points is None:
        return []
    if not isinstance(points, list):
        raise SweepDataError(f"'points' must be a JSON array (received {type(points).__name__})")

    rows: list[SweepRow] = []
    for index, raw_point in enumerate(points):
        point = _as_object(raw_point, f"points[{index}]")
        qos = _as_object(point.get("aggregated_qos"), f"points[{index}].aggregated_qos")

        runs = point.get("runs")
        run_count = _opt_int(qos.get("run_count"))
        if run_count is None:
            run_count = len(runs) if isinstance(runs, list) else 0

        rows.append(
            SweepRow(
                parameter_value=_opt_float(point.get("parameter_value")),
                run_count=run_count,
                throughput_bps=_opt_float(qos.get("mean_throughput_bps")),
                goodput_bps=_opt_float(qos.get("mean_goodput_bps")),
                latency_us=_opt_float(qos.get("mean_latency_us")),
                jitter_us=_opt_float(qos.get("mean_jitter_us")),
                loss_rate=_opt_float(qos.get("mean_loss_rate")),
                retransmissions=_opt_float(qos.get("mean_retransmissions")),
            )
        )
    return rows


def parse_sweep_document(data: Any) -> SweepDocument:
    """Validate *data* and normalise it into a :class:`SweepDocument`.

    Accepts either the bare command result or the full ``{"status": ..., "result": {...}}``
    envelope that the HTTP API returns. Raises :class:`SweepDataError` on structural problems.
    """
    if isinstance(data, dict) and isinstance(data.get("result"), dict):
        data = data["result"]

    if not isinstance(data, dict):
        raise SweepDataError("Expected a JSON object at the top level.")

    missing = [key for key in _REQUIRED_KEYS if key not in data]
    if missing:
        raise SweepDataError(
            "This file is not a NetSim sweep result (missing "
            + ", ".join(missing)
            + "). Expected the JSON produced by 'run_parameter_sweep_command'."
        )

    seeds = data.get("seeds")
    total_runs = _opt_int(data.get("total_runs"))

    return SweepDocument(
        experiment_name=str(data.get("experiment_name") or "Unnamed"),
        parameter_name=str(data.get("parameter_name") or "n/a"),
        seeds=seeds if isinstance(seeds, list) else [],
        total_runs=total_runs if total_runs is not None else 0,
        execution_time_ms=data.get("execution_time_ms", 0),
        rows=_parse_rows(data.get("points")),
    )


def _load(filepath: str) -> SweepDocument:
    with open(filepath, encoding="utf-8") as handle:
        data = json.load(handle)
    return parse_sweep_document(data)


def analyze_json_results(filepath: str) -> int:
    """Print a summary of the sweep result at *filepath*; return a process exit status."""
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return 1

    try:
        doc = _load(filepath)
    except json.JSONDecodeError as exc:
        print(f"Cannot read sweep results from {filepath}: not valid JSON ({exc})")
        return 1
    except (OSError, ValueError) as exc:
        print(f"Cannot read sweep results from {filepath}: {exc}")
        return 1

    print(f"=== NetSim Sweep Analysis: {doc.experiment_name} ===")
    print(f"Swept parameter : {doc.parameter_name}")
    print(f"Seeds           : {doc.seeds if doc.seeds else 'n/a'}")
    print(f"Parameter points: {len(doc.rows)}")
    print(f"Total runs      : {doc.total_runs}")
    print(f"Execution time  : {doc.execution_time_ms} ms")
    print()

    if not doc.rows:
        print("No parameter points present in this result.")
        return 0

    header = (
        f"{'parameter':>14} {'runs':>5} {'throughput':>13} {'goodput':>12} "
        f"{'mean lat':>10} {'jitter':>9} {'loss':>7} {'retx':>6}"
    )
    print(header)
    print("-" * len(header))

    for row in doc.rows:
        print(
            f"{_fmt(row.parameter_value, digits=0):>14} "
            f"{row.run_count:>5} "
            f"{_fmt(row.throughput_bps, 'Mbps', 1e6):>13} "
            f"{_fmt(row.goodput_bps, 'Mbps', 1e6):>12} "
            f"{_fmt(row.latency_us, 'us', 1.0):>10} "
            f"{_fmt(row.jitter_us, 'us', 1.0):>9} "
            f"{_fmt(row.loss_rate, '', 1.0, 4):>7} "
            f"{_fmt(row.retransmissions, '', 1.0, 2):>6}"
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
