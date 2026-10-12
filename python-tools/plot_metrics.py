"""NetSim analysis toolkit --- metric plotter.

Reads a JSON parameter-sweep result from NetSim and draws throughput and latency against the swept
parameter. Optional tooling: not required to run NetSim, and the simulator does not import it.

    pip install -r requirements.txt
    python plot_metrics.py <path_to_sweep_result.json> [output.png]

Only matplotlib is needed for the plot itself; results are read with the standard library.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

_REQUIRED_KEYS = ("experiment_name", "parameter_name", "points")


def _load(filepath: str) -> dict[str, Any]:
    with open(filepath, encoding="utf-8") as handle:
        data = json.load(handle)

    # Accept either the bare result or a command envelope.
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


def plot_experiment_metrics(filepath: str, output_path: str = "experiment_plot.png") -> int:
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
        data = _load(filepath)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"Cannot read sweep results from {filepath}: {exc}")
        return 1

    points = [p for p in (data.get("points") or []) if isinstance(p, dict)]
    if not points:
        print("No parameter points present in this result; nothing to plot.")
        return 1

    xs = [float(p.get("parameter_value") or 0.0) for p in points]
    qos = [p.get("aggregated_qos") or {} for p in points]

    throughput_mbps = [float(q.get("mean_throughput_bps") or 0.0) / 1e6 for q in qos]
    goodput_mbps = [float(q.get("mean_goodput_bps") or 0.0) / 1e6 for q in qos]
    latency_ms = [float(q.get("mean_latency_us") or 0.0) / 1e3 for q in qos]

    parameter_name = data.get("parameter_name", "parameter")

    fig, (ax_throughput, ax_latency) = plt.subplots(2, 1, sharex=True, figsize=(8, 7))

    ax_throughput.plot(xs, throughput_mbps, marker="o", label="Throughput")
    ax_throughput.plot(xs, goodput_mbps, marker="s", linestyle="--", label="Goodput")
    ax_throughput.set_ylabel("Mbps")
    ax_throughput.set_title(f"{data.get('experiment_name', 'Sweep')} — {parameter_name}")
    ax_throughput.grid(True, alpha=0.3)
    ax_throughput.legend()

    ax_latency.plot(xs, latency_ms, marker="o", color="tab:orange", label="Mean latency")
    ax_latency.set_xlabel(parameter_name)
    ax_latency.set_ylabel("ms")
    ax_latency.grid(True, alpha=0.3)
    ax_latency.legend()

    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)
    print(f"Wrote {output_path} ({len(points)} parameter points, seeds={data.get('seeds', [])}).")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: python plot_metrics.py <path_to_sweep_result.json> [output.png]")
        return 2
    output = argv[2] if len(argv) > 2 else "experiment_plot.png"
    return plot_experiment_metrics(argv[1], output)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
