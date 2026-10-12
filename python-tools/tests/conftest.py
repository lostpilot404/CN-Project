"""Shared fixtures for the ``python-tools/`` utility tests.

The two utilities are standalone scripts, and ``python-tools`` is not a valid Python package name
(the hyphen), so each is loaded from its path and registered in ``sys.modules`` under a stable
name. Tests therefore exercise the real modules that the command line runs, not copies.

Fixtures are written into pytest's ``tmp_path``; nothing here reads or writes user files, the
network, or any location outside the temporary directory.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

TOOLS_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = TOOLS_DIR.parent
PYTHON_DIR = REPO_ROOT / "python"

# The engine is imported by the schema-compatibility tests, which need `python/` importable.
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))


def load_tool(name: str) -> ModuleType:
    """Import ``python-tools/<name>.py`` by path, caching it under the module name *name*."""
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(name, TOOLS_DIR / f"{name}.py")
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"cannot load {name} from {TOOLS_DIR}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def analyze_tool() -> ModuleType:
    return load_tool("analyze_results")


@pytest.fixture(scope="session")
def plot_tool() -> ModuleType:
    return load_tool("plot_metrics")


def make_qos(
    *,
    run_count: int = 2,
    throughput_bps: Any = 2_000_000.0,
    goodput_bps: Any = 1_500_000.0,
    latency_us: Any = 12500.0,
    jitter_us: Any = 250.0,
    loss_rate: Any = 0.0125,
    retransmissions: Any = 1.5,
) -> dict[str, Any]:
    """Build one ``aggregated_qos`` object using the engine's real key names."""
    return {
        "run_count": run_count,
        "mean_throughput_bps": throughput_bps,
        "mean_goodput_bps": goodput_bps,
        "mean_latency_us": latency_us,
        "mean_jitter_us": jitter_us,
        "mean_loss_rate": loss_rate,
        "mean_retransmissions": retransmissions,
    }


def make_point(parameter_value: Any, qos: dict[str, Any] | None = None, **extra: Any) -> dict[str, Any]:
    point: dict[str, Any] = {
        "parameter_value": parameter_value,
        "aggregated_qos": qos if qos is not None else make_qos(),
    }
    point.update(extra)
    return point


def make_sweep(**overrides: Any) -> dict[str, Any]:
    """A small sweep document matching the schema ``run_parameter_sweep_command`` emits.

    The values are chosen so the expected formatted output can be verified by hand:

    * point 1 - 2_000_000 bps -> ``2.00 Mbps``; 12 500 us -> ``12500.00 us``
    * point 2 - 4_000_000 bps -> ``4.00 Mbps``; 8 000 us -> ``8000.00 us``
    """
    document: dict[str, Any] = {
        "experiment_name": "fixture-sweep",
        "parameter_name": "link_bandwidth_link-1",
        "seeds": [7, 8],
        "total_runs": 6,
        "execution_time_ms": 12,
        "points": [
            {
                "parameter_value": 500000.0,
                "aggregated_qos": make_qos(run_count=2),
                "runs": [{"seed": 7}, {"seed": 8}],
            },
            {
                "parameter_value": 1000000.0,
                "aggregated_qos": make_qos(
                    run_count=3,
                    throughput_bps=4_000_000.0,
                    goodput_bps=3_000_000.0,
                    latency_us=8000.0,
                    jitter_us=0.0,
                    loss_rate=0.0,
                    retransmissions=0.0,
                ),
                "runs": [{"seed": 7}, {"seed": 8}, {"seed": 9}],
            },
        ],
    }
    document.update(overrides)
    return document


@pytest.fixture
def write_json(tmp_path: Path):
    """Return a helper that writes *payload* to a JSON file inside ``tmp_path``."""

    def _write(payload: Any, name: str = "sweep.json") -> Path:
        path = tmp_path / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    return _write


@pytest.fixture
def sweep_file(write_json) -> Path:
    return write_json(make_sweep())
