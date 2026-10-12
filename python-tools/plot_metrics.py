"""NetSim analysis toolkit --- metric plotter.

Reads a JSON parameter-sweep result from NetSim and draws throughput and latency against the swept
parameter. Optional tooling: not required to run NetSim, and the simulator does not import it.

    pip install -r requirements.txt
    python plot_metrics.py <path_to_sweep_result.json> [output.png]

Only matplotlib is needed for the plot itself; results are read with the standard library.

Validation contract
-------------------
Unlike the summariser, a chart cannot show a gap where an axis value is missing, so this script is
strict: every point must carry a **numeric** ``parameter_value``, and an explicitly non-numeric
metric is treated as corrupt data rather than as zero. Both cases are reported as a clear error
with a non-zero exit status instead of a traceback.

A metric that is simply *absent* or ``null`` is plotted as ``0.0``: nothing was measured, which is
a truthful zero for a mean. Values that are present but unparseable are never silently replaced.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Any

_REQUIRED_KEYS = ("experiment_name", "parameter_name", "points")


class SweepDataError(ValueError):
    """The loaded document is not a usable NetSim sweep result."""


@dataclass(frozen=True)
class PlotSeries:
    """Plot-ready numeric columns; index *i* is the same parameter point in every list."""

    parameters: list[float]
    throughput_mbps: list[float]
    goodput_mbps: list[float]
    latency_ms: list[float]


def _as_object(value: Any, field: str) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    raise SweepDataError(f"'{field}' must be a JSON object (received {type(value).__name__})")


def _number(value: Any, field: str) -> float | None:
    """Return *value* as a float, ``None`` when absent, or raise when present but unparseable."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise SweepDataError(f"{field} must be a number (received bool)")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise SweepDataError(f"{field} must be a number (received {value!r})") from exc
    if result != result or result in (float("inf"), float("-inf")):  # NaN / inf
        raise SweepDataError(f"{field} must be a finite number (received {value!r})")
    return result


def _metric_or_zero(qos: dict[str, Any], key: str, field: str) -> float:
    """Absent metric -> 0.0; present but unparseable -> error (never a silent substitution)."""
    value = _number(qos.get(key), field)
    return 0.0 if value is None else value


def parse_plot_series(data: Any) -> PlotSeries:
    """Validate *data* and normalise it into column-oriented numeric series."""
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

    raw_points = data.get("points")
    if raw_points is None:
        raw_points = []
    if not isinstance(raw_points, list):
        raise SweepDataError(f"'points' must be a JSON array (received {type(raw_points).__name__})")

    parameters: list[float] = []
    throughput_mbps: list[float] = []
    goodput_mbps: list[float] = []
    latency_ms: list[float] = []

    for index, raw_point in enumerate(raw_points):
        point = _as_object(raw_point, f"points[{index}]")
        qos = _as_object(point.get("aggregated_qos"), f"points[{index}].aggregated_qos")

        parameter = _number(point.get("parameter_value"), f"points[{index}].parameter_value")
        if parameter is None:
            raise SweepDataError(
                f"points[{index}].parameter_value is missing; the swept parameter is the x-axis "
                "and every point needs a numeric value to be plotted."
            )

        parameters.append(parameter)
        throughput_mbps.append(
            _metric_or_zero(qos, "mean_throughput_bps", f"points[{index}].aggregated_qos.mean_throughput_bps") / 1e6
        )
        goodput_mbps.append(
            _metric_or_zero(qos, "mean_goodput_bps", f"points[{index}].aggregated_qos.mean_goodput_bps") / 1e6
        )
        latency_ms.append(
            _metric_or_zero(qos, "mean_latency_us", f"points[{index}].aggregated_qos.mean_latency_us") / 1e3
        )

    return PlotSeries(
        parameters=parameters,
        throughput_mbps=throughput_mbps,
        goodput_mbps=goodput_mbps,
        latency_ms=latency_ms,
    )


def _load(filepath: str) -> tuple[dict[str, Any], PlotSeries]:
    with open(filepath, encoding="utf-8") as handle:
        data = json.load(handle)
    inner = data["result"] if isinstance(data, dict) and isinstance(data.get("result"), dict) else data
    return (inner if isinstance(inner, dict) else {}), parse_plot_series(data)


def plot_experiment_metrics(filepath: str, output_path: str = "experiment_plot.png") -> int:
    """Render the sweep at *filepath* to *output_path*; return a process exit status."""
    try:
        import matplotlib

        matplotlib.use("Agg")  # headless: write a file instead of opening a window
        import matplotlib.pyplot as plt
    except ImportError:
        print("Matplotlib not installed. Please run: pip install -r requirements.txt")
        return 1

    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return 1

    try:
        meta, series = _load(filepath)
    except json.JSONDecodeError as exc:
        print(f"Cannot read sweep results from {filepath}: not valid JSON ({exc})")
        return 1
    except (OSError, ValueError) as exc:
        print(f"Cannot read sweep results from {filepath}: {exc}")
        return 1

    if not series.parameters:
        print("No parameter points present in this result; nothing to plot.")
        return 1

    parameter_name = str(meta.get("parameter_name") or "parameter")
    experiment = str(meta.get("experiment_name") or "Sweep")

    fig, (ax_throughput, ax_latency) = plt.subplots(2, 1, sharex=True, figsize=(8, 7))

    ax_throughput.plot(series.parameters, series.throughput_mbps, marker="o", label="Throughput")
    ax_throughput.plot(series.parameters, series.goodput_mbps, marker="s", linestyle="--", label="Goodput")
    ax_throughput.set_ylabel("Mbps")
    ax_throughput.set_title(f"{experiment} — {parameter_name}")
    ax_throughput.grid(True, alpha=0.3)
    ax_throughput.legend()

    ax_latency.plot(series.parameters, series.latency_ms, marker="o", color="tab:orange", label="Mean latency")
    ax_latency.set_xlabel(parameter_name)
    ax_latency.set_ylabel("ms")
    ax_latency.grid(True, alpha=0.3)
    ax_latency.legend()

    fig.tight_layout()
    try:
        fig.savefig(output_path, dpi=150)
    except (OSError, ValueError) as exc:
        print(f"Cannot write the plot to {output_path}: {exc}")
        return 1
    finally:
        plt.close(fig)

    print(f"Wrote {output_path} ({len(series.parameters)} parameter points, seeds={meta.get('seeds', [])}).")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: python plot_metrics.py <path_to_sweep_result.json> [output.png]")
        return 2
    output = argv[2] if len(argv) > 2 else "experiment_plot.png"
    return plot_experiment_metrics(argv[1], output)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
