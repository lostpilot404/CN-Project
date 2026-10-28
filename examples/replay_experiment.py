"""Replay a downloaded sweep/A-B JSON snapshot with the same Python implementation.

PYTHONPATH=python python examples/replay_experiment.py netsim-sweep.json > replay.json
Wall-clock execution_time_ms may differ. No active UI project or service is needed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from netsim.experiments.config import ComparativeExperimentConfig, SweepConfig
from netsim.experiments.runner import run_comparative_experiment, run_parameter_sweep
from netsim.models.project import Project


def main() -> None:
    saved = json.loads(Path(sys.argv[1]).read_text())
    if saved["provenance"]["schema_version"] != 1:
        raise ValueError("Unsupported snapshot schema")
    config = saved["provenance"]["config"]
    project = Project.from_dict(config["base_project"])
    if "scenario_a" in config:
        result = run_comparative_experiment(ComparativeExperimentConfig.from_dict(config), project)
    else:
        result = run_parameter_sweep(SweepConfig.from_dict(config), project)
    print(json.dumps(result.to_dict(), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
