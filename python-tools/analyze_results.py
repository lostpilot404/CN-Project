"""
NetSim Optional Analysis Toolkit --- Results Analyzer
This script consumes exported JSON/CSV results from NetSim and computes statistical summaries.
Python is optional and not required for the core NetSim desktop application.
"""
import sys
import json
import os

def analyze_json_results(filepath: str):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return

    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    print(f"=== NetSim Experiment Analysis: {data.get('experiment_name', 'Unnamed')} ===")
    print(f"Seed: {data.get('seed', 'N/A')}")
    print(f"Schema Version: {data.get('schema_version', 1)}")
    
    runs = data.get('runs', [])
    print(f"Total Sweep Runs: {len(runs)}")
    
    for idx, run in enumerate(runs, 1):
        print(f"\nRun #{idx}:")
        params = run.get('parameters', {})
        metrics = run.get('metrics', {})
        print(f"  Parameters: {params}")
        print(f"  Throughput: {metrics.get('throughput_bps', 0) / 1e6:.2f} Mbps")
        print(f"  Avg Latency: {metrics.get('avg_latency_ms', 0):.2f} ms")
        print(f"  Loss Ratio: {metrics.get('loss_ratio', 0) * 100:.1f}%")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        analyze_json_results(sys.argv[1])
    else:
        print("Usage: python analyze_results.py <path_to_exported_results.json>")
