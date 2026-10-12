"""Tests for ``python-tools/analyze_results.py``.

These drive the real module through its public entry points (``analyze_json_results`` and
``main``) and check the printed report and the process exit status that a shell sees.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest
from conftest import make_point, make_qos, make_sweep

HEADER = (
    f"{'parameter':>14} {'runs':>5} {'throughput':>13} {'goodput':>12} "
    f"{'mean lat':>10} {'jitter':>9} {'loss':>7} {'retx':>6}"
)


def rows_of(out: str) -> list[list[str]]:
    """Return the table body as whitespace-separated tokens, ignoring column padding.

    The body starts after the dashed separator line and ends at the first blank line, so this
    does not depend on column widths or on the values themselves.
    """
    lines = out.splitlines()
    separator = next(i for i, line in enumerate(lines) if line.strip() and set(line.strip()) == {"-"})
    rows: list[list[str]] = []
    for line in lines[separator + 1 :]:
        if not line.strip():
            break
        rows.append(line.split())
    return rows


# --------------------------------------------------------------------------------------- values


def test_valid_sweep_prints_a_hand_verified_table(analyze_tool, sweep_file, capsys):
    status = analyze_tool.analyze_json_results(str(sweep_file))
    out = capsys.readouterr().out
    assert status == 0

    assert "=== NetSim Sweep Analysis: fixture-sweep ===" in out
    assert "Swept parameter : link_bandwidth_link-1" in out
    assert "Seeds           : [7, 8]" in out
    assert "Parameter points: 2" in out
    assert "Total runs      : 6" in out
    assert HEADER in out

    assert rows_of(out) == [
        # parameter, runs, throughput,     goodput,      mean latency, jitter,     loss,   retx
        ["500000", "2", "2.00", "Mbps", "1.50", "Mbps", "12500.00", "us", "250.00", "us", "0.0125", "1.50"],
        ["1000000", "3", "4.00", "Mbps", "3.00", "Mbps", "8000.00", "us", "0.00", "us", "0.0000", "0.00"],
    ]


def test_accepts_a_command_envelope(analyze_tool, write_json, capsys):
    """The HTTP API wraps results; the tool must unwrap them."""
    path = write_json({"status": "ok", "result": make_sweep()})
    assert analyze_tool.analyze_json_results(str(path)) == 0
    assert "Parameter points: 2" in capsys.readouterr().out


def test_run_count_falls_back_to_the_length_of_runs(analyze_tool, write_json, capsys):
    qos = make_qos()
    del qos["run_count"]
    payload = make_sweep(points=[make_point(1.0, qos, runs=[{"seed": 1}, {"seed": 2}, {"seed": 3}])])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    assert rows_of(capsys.readouterr().out)[0][1] == "3"


def test_missing_metrics_are_reported_as_na_rather_than_invented(analyze_tool, write_json, capsys):
    """Each unmeasured metric renders as a bare 'n/a' rather than a fabricated number."""
    payload = make_sweep(points=[{"parameter_value": 1.0, "aggregated_qos": {"run_count": 1}}])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    row = rows_of(capsys.readouterr().out)[0]
    # parameter, runs, then one 'n/a' for each of the six metrics.
    assert row == ["1", "1", "n/a", "n/a", "n/a", "n/a", "n/a", "n/a"]


def test_non_numeric_metric_is_reported_as_na_and_neighbours_survive(analyze_tool, write_json, capsys):
    """A corrupt throughput value becomes 'n/a'; the other metrics still report correctly."""
    payload = make_sweep(points=[make_point(1.0, make_qos(throughput_bps="not-a-number"))])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    row = rows_of(capsys.readouterr().out)[0]
    assert row == ["1", "2", "n/a", "1.50", "Mbps", "12500.00", "us", "250.00", "us", "0.0125", "1.50"]


# ------------------------------------------------------------------------------------ empty sets


def test_empty_point_list_succeeds_and_says_so(analyze_tool, write_json, capsys):
    assert analyze_tool.analyze_json_results(str(write_json(make_sweep(points=[])))) == 0
    out = capsys.readouterr().out
    assert "Parameter points: 0" in out
    assert "No parameter points present in this result." in out


def test_null_points_is_treated_as_empty(analyze_tool, write_json, capsys):
    assert analyze_tool.analyze_json_results(str(write_json(make_sweep(points=None)))) == 0
    assert "No parameter points present" in capsys.readouterr().out


# -------------------------------------------------------------------------------- structural errors


def test_missing_required_keys_names_every_missing_key(analyze_tool, write_json, capsys):
    assert analyze_tool.analyze_json_results(str(write_json({}))) == 1
    out = capsys.readouterr().out
    assert "is not a NetSim sweep result" in out
    for key in ("experiment_name", "parameter_name", "points", "total_runs"):
        assert key in out


def test_a_key_that_is_present_is_not_reported_as_missing(analyze_tool, write_json, capsys):
    """Only genuinely absent keys should be named in the error."""
    assert analyze_tool.analyze_json_results(str(write_json({"points": []}))) == 1
    out = capsys.readouterr().out
    assert "missing experiment_name, parameter_name, total_runs" in out
    assert "points," not in out


def test_malformed_json_reports_a_clean_error(analyze_tool, tmp_path, capsys):
    path = tmp_path / "broken.json"
    path.write_text("{not valid json", encoding="utf-8")
    assert analyze_tool.analyze_json_results(str(path)) == 1
    captured = capsys.readouterr()
    assert "not valid JSON" in captured.out
    assert captured.err == ""


def test_top_level_array_is_rejected(analyze_tool, write_json, capsys):
    assert analyze_tool.analyze_json_results(str(write_json([1, 2, 3]))) == 1
    assert "Expected a JSON object at the top level." in capsys.readouterr().out


def test_points_that_is_not_a_list_is_rejected_not_miscounted(analyze_tool, write_json, capsys):
    """Regression: a string was iterated, so 'points': 'notalist' reported 8 points and crashed."""
    assert analyze_tool.analyze_json_results(str(write_json(make_sweep(points="notalist")))) == 1
    captured = capsys.readouterr()
    assert "'points' must be a JSON array (received str)" in captured.out
    assert "Parameter points: 8" not in captured.out
    assert captured.err == ""


def test_a_point_that_is_not_an_object_is_rejected(analyze_tool, write_json, capsys):
    assert analyze_tool.analyze_json_results(str(write_json(make_sweep(points=[1, 2])))) == 1
    captured = capsys.readouterr()
    assert "'points[0]' must be a JSON object (received int)" in captured.out
    assert captured.err == ""


def test_aggregated_qos_that_is_not_an_object_is_rejected(analyze_tool, write_json, capsys):
    """Regression: a non-object aggregated_qos previously raised AttributeError."""
    payload = make_sweep(points=[{"parameter_value": 1.0, "aggregated_qos": "nope"}])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 1
    captured = capsys.readouterr()
    assert "'points[0].aggregated_qos' must be a JSON object (received str)" in captured.out
    assert captured.err == ""


# ------------------------------------------------------------------------------------ file access


def test_missing_file_reports_the_path(analyze_tool, tmp_path, capsys):
    missing = tmp_path / "absent.json"
    assert analyze_tool.analyze_json_results(str(missing)) == 1
    assert f"File not found: {missing}" in capsys.readouterr().out


def test_directory_instead_of_a_file_is_rejected(analyze_tool, tmp_path, capsys):
    assert analyze_tool.analyze_json_results(str(tmp_path)) == 1
    captured = capsys.readouterr()
    assert "Cannot read sweep results from" in captured.out
    assert captured.err == ""


@pytest.mark.skipif(not hasattr(os, "getuid") or os.getuid() == 0, reason="root bypasses permission bits")
def test_unreadable_file_is_rejected(analyze_tool, sweep_file, capsys):
    sweep_file.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0o600, then drop all read bits
    sweep_file.chmod(0o000)
    try:
        assert analyze_tool.analyze_json_results(str(sweep_file)) == 1
    finally:
        sweep_file.chmod(0o644)
    captured = capsys.readouterr()
    assert "Cannot read sweep results from" in captured.out
    assert captured.err == ""


# ------------------------------------------------------------------------------------------- CLI


def test_no_arguments_prints_usage_and_exits_two(analyze_tool, capsys):
    assert analyze_tool.main(["analyze_results.py"]) == 2
    assert "Usage: python analyze_results.py" in capsys.readouterr().out


def test_main_passes_the_path_argument_through(analyze_tool, sweep_file, capsys):
    assert analyze_tool.main(["analyze_results.py", str(sweep_file)]) == 0
    assert "Parameter points: 2" in capsys.readouterr().out


def test_main_reports_a_missing_file_without_crashing(analyze_tool, tmp_path, capsys):
    assert analyze_tool.main(["analyze_results.py", str(tmp_path / "nope.json")]) == 1
    assert "File not found" in capsys.readouterr().out


# ---------------------------------------------------------------------------------- unit: helpers


@pytest.mark.parametrize(
    ("value", "args", "expected"),
    [
        (None, {}, "n/a"),
        (0.0, {}, "0.00"),
        (2_000_000.0, {"unit": "Mbps", "scale": 1e6}, "2.00 Mbps"),
        (0.0125, {"digits": 4}, "0.0125"),
        (500000.0, {"digits": 0}, "500000"),
        (12500.0, {"unit": "us"}, "12500.00 us"),
    ],
)
def test_fmt(analyze_tool, value, args, expected):
    assert analyze_tool._fmt(value, **args) == expected


def test_parse_sweep_document_is_the_entry_point_used_by_the_cli(analyze_tool):
    doc = analyze_tool.parse_sweep_document(make_sweep())
    assert doc.experiment_name == "fixture-sweep"
    assert doc.total_runs == 6
    assert len(doc.rows) == 2
    assert doc.rows[0].throughput_bps == pytest.approx(2_000_000.0)


def test_parse_rejects_structural_damage_with_a_typed_error(analyze_tool):
    with pytest.raises(analyze_tool.SweepDataError):
        analyze_tool.parse_sweep_document({"experiment_name": "e", "parameter_name": "p", "points": 3})


def test_sweep_data_error_is_a_value_error(analyze_tool):
    # Callers that already catch ValueError keep working.
    assert issubclass(analyze_tool.SweepDataError, ValueError)


def test_unnamed_metadata_falls_back_to_placeholders(analyze_tool, capsys, write_json):
    """A sweep with empty experiment metadata still reports something usable."""
    payload = make_sweep(experiment_name="", parameter_name="")
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    out = capsys.readouterr().out
    assert "=== NetSim Sweep Analysis: Unnamed ===" in out
    assert "Swept parameter : n/a" in out


def test_a_point_without_aggregated_qos_reports_no_metrics(analyze_tool, write_json, capsys):
    """The key may be absent entirely; that is a gap, not a structural error."""
    payload = make_sweep(points=[{"parameter_value": 1.0}])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    assert rows_of(capsys.readouterr().out)[0] == ["1", "0", "n/a", "n/a", "n/a", "n/a", "n/a", "n/a"]


def test_non_finite_metrics_are_reported_as_na(analyze_tool, write_json, capsys):
    """NaN and infinity are not measurements; the summary must not print them as numbers."""
    payload = make_sweep(points=[make_point(1.0, make_qos(throughput_bps=float("nan"), latency_us=float("inf")))])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    out = capsys.readouterr().out
    row = rows_of(out)[0]
    # NaN throughput and infinite latency become 'n/a'; the numeric fields beside them survive.
    assert row == ["1", "2", "n/a", "1.50", "Mbps", "n/a", "250.00", "us", "0.0125", "1.50"]
    assert "inf" not in row and "nan" not in out.lower()


def test_non_numeric_run_count_falls_back_to_zero(analyze_tool, write_json, capsys):
    """A corrupt run_count must not be printed verbatim or crash the table."""
    qos = make_qos()
    qos["run_count"] = "many"
    payload = make_sweep(points=[make_point(1.0, qos)])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    assert rows_of(capsys.readouterr().out)[0][1] == "0"


def test_boolean_is_not_accepted_as_a_metric(analyze_tool, write_json, capsys):
    """JSON true is not a measurement; it must not be formatted as 1.00."""
    payload = make_sweep(points=[make_point(1.0, make_qos(throughput_bps=True))])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    assert rows_of(capsys.readouterr().out)[0][2] == "n/a"


def test_independent_reading_of_a_temporary_fixture(analyze_tool, write_json, capsys):
    """A single point with values that cannot be confused with the defaults."""
    payload = make_sweep(points=[make_point(250000.0, make_qos(throughput_bps=1_000_000.0, latency_us=1000.0))])
    assert analyze_tool.analyze_json_results(str(write_json(payload))) == 0
    row = rows_of(capsys.readouterr().out)[0]
    assert row[:8] == ["250000", "2", "1.00", "Mbps", "1.50", "Mbps", "1000.00", "us"]


def test_does_not_require_the_engine_to_be_importable(analyze_tool):
    """The analyser is standalone tooling; it must not depend on the simulation package."""
    source = Path(analyze_tool.__file__).read_text(encoding="utf-8")
    assert "import netsim" not in source
    assert "from netsim" not in source
