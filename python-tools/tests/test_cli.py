"""End-to-end CLI tests.

Everything else in this directory imports the tool modules directly. These tests instead run the
scripts the way a user does - ``python python-tools/<script>.py ...`` in a fresh interpreter - which
is the only way to cover the ``__main__`` entry point, the real ``SystemExit`` status a shell sees,
and the fact that the scripts work regardless of the current working directory.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from conftest import TOOLS_DIR

ANALYZE = "analyze_results.py"
PLOT = "plot_metrics.py"

# Rendering a figure in a cold interpreter is the slowest step here.
TIMEOUT_SECONDS = 120


def run_tool(script: str, *args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOLS_DIR / script), *args],
        capture_output=True,
        text=True,
        cwd=cwd,
        timeout=TIMEOUT_SECONDS,
        check=False,
    )


# ------------------------------------------------------------------------------------- analyzer


def test_analyze_cli_reports_a_sweep(sweep_file):
    result = run_tool(ANALYZE, str(sweep_file))
    assert result.returncode == 0, result.stderr
    assert "=== NetSim Sweep Analysis: fixture-sweep ===" in result.stdout
    assert "Parameter points: 2" in result.stdout
    assert result.stderr == ""


def test_analyze_cli_exits_one_for_a_missing_file(tmp_path):
    result = run_tool(ANALYZE, str(tmp_path / "absent.json"))
    assert result.returncode == 1
    assert "File not found" in result.stdout
    assert result.stderr == ""


def test_analyze_cli_exits_two_without_arguments():
    result = run_tool(ANALYZE)
    assert result.returncode == 2
    assert "Usage: python analyze_results.py" in result.stdout


def test_analyze_cli_rejects_malformed_input_without_a_traceback(write_json):
    # Every required key is present, so the failure is specifically the malformed 'points' shape.
    bad = write_json({"experiment_name": "e", "parameter_name": "p", "total_runs": 0, "points": "not-a-list"})
    result = run_tool(ANALYZE, str(bad))
    assert result.returncode == 1
    assert "'points' must be a JSON array" in result.stdout
    assert result.stderr == "", "a rejected file must not print a traceback"
    assert "Traceback" not in result.stdout


def test_analyze_cli_works_from_an_unrelated_directory(sweep_file, tmp_path):
    """The scripts take an absolute or relative path; neither should depend on the caller's cwd."""
    result = run_tool(ANALYZE, str(sweep_file), cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert "Parameter points: 2" in result.stdout


# --------------------------------------------------------------------------------------- plotter


def test_plot_cli_writes_a_file(sweep_file, tmp_path):
    out_path = tmp_path / "cli.png"
    result = run_tool(PLOT, str(sweep_file), str(out_path))
    assert result.returncode == 0, result.stderr
    assert out_path.is_file()
    assert out_path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert result.stderr == ""


def test_plot_cli_defaults_the_output_name_in_the_current_directory(sweep_file, tmp_path):
    result = run_tool(PLOT, str(sweep_file), cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "experiment_plot.png").is_file()


def test_plot_cli_exits_two_without_arguments():
    result = run_tool(PLOT)
    assert result.returncode == 2
    assert "Usage: python plot_metrics.py" in result.stdout


def test_plot_cli_exits_one_for_an_empty_sweep(write_json, tmp_path):
    result = run_tool(
        PLOT, str(write_json({"experiment_name": "e", "parameter_name": "p", "points": []})), str(tmp_path / "x.png")
    )
    assert result.returncode == 1
    assert "nothing to plot" in result.stdout
    assert result.stderr == ""


def test_plot_cli_reports_a_bad_output_path_without_a_traceback(sweep_file, tmp_path):
    result = run_tool(PLOT, str(sweep_file), str(tmp_path / "missing-dir" / "x.png"))
    assert result.returncode == 1
    assert "Cannot write the plot to" in result.stdout
    assert "Traceback" not in result.stdout


@pytest.mark.parametrize("script", [ANALYZE, PLOT])
def test_scripts_do_not_emit_a_traceback_on_unexpected_types(script, write_json, tmp_path):
    """A point that is a bare integer is structurally wrong; both tools must say so calmly."""
    bad = write_json({"experiment_name": "e", "parameter_name": "p", "points": [1]})
    args = [str(bad)] if script == ANALYZE else [str(bad), str(tmp_path / "y.png")]
    result = run_tool(script, *args)
    assert result.returncode == 1
    assert "Traceback" not in result.stdout
    assert result.stderr == ""
