"""
NetSim Optional Analysis Toolkit --- Metric Plotter
Generates publication-ready comparative charts from exported NetSim experiments.
"""
import sys
import json
import os

def plot_experiment_metrics(filepath: str, output_path: str = "experiment_plot.png"):
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("Matplotlib not installed. Please run: pip install -r requirements.txt")
        return

    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return

    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    runs = data.get('runs', [])
    if not runs:
        print("No runs found in experiment data.")
        return

    x_vals = []
    y_vals = []
    param_name = "Sweep Parameter"
    metric_name = "Throughput (Mbps)"

    for r in runs:
        params = r.get('parameters', {})
        metrics = r.get('metrics', {})
        if params:
            param_name = list(params.keys())[0]
            x_vals.append(params[param_name])
        y_vals.append(metrics.get('throughput_bps', 0) / 1e6)

    plt.figure(figsize=(8, 5))
    plt.plot(x_vals, y_vals, marker='o', color='#0e8ee9', linewidth=2, label='Measured Throughput')
    plt.title(f"NetSim: {data.get('experiment_name', 'Performance Analysis')}")
    plt.xlabel(param_name)
    plt.ylabel(metric_name)
    plt.grid(True, linestyle='--', alpha=0.6)
    plt.legend()
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    print(f"Saved plot to {output_path}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        plot_experiment_metrics(sys.argv[1])
    else:
        print("Usage: python plot_metrics.py <path_to_exported_results.json> [output.png]")
