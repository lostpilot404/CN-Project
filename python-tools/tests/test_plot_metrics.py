"""Tests for ``python-tools/plot_metrics.py``.

The plotting tests verify the actual bytes written: PNG signature, chunk structure (IHDR first,
IEND last, chunks tiling the file) and header dimensions. They deliberately do not assert on
rendered pixels, fonts, or file size, none of which are stable across machines.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import pytest
from conftest import make_point, make_qos, make_sweep


def read_png_header(path: Path) -> tuple[int, int]:
    """Validate the PNG chunk stream and return ``(width, height)``.

    Walks the real chunk layout rather than using an image library, so the check does not depend
    on any optional dependency being installed.
    """
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "missing PNG signature"

    offset = 8
    chunks: list[str] = []
    while offset < len(data):
        (length,) = struct.unpack(">I", data[offset : offset + 4])
        chunks.append(data[offset + 4 : offset + 8].decode("ascii"))
        offset += 12 + length

    assert chunks[0] == "IHDR", f"first chunk must be IHDR, got {chunks[0]!r}"
    assert chunks[-1] == "IEND", f"last chunk must be IEND, got {chunks[-1]!r}"
    assert offset == len(data), "chunk lengths must tile the file exactly"
    assert "IDAT" in chunks, "no image data chunk present"

    width, height = struct.unpack(">II", data[16:24])
    return width, height


# ----------------------------------------------------------------------------------------- happy path


def test_writes_a_structurally_valid_png(plot_tool, sweep_file, tmp_path, capsys):
    out_path = tmp_path / "plot.png"
    assert plot_tool.plot_experiment_metrics(str(sweep_file), str(out_path)) == 0
    assert out_path.is_file()

    width, height = read_png_header(out_path)
    # The figure is 8x7 in at 150 dpi; assert a sane range rather than an exact pixel count so the
    # test does not fail if the author resizes the figure.
    assert width >= 600, f"unexpectedly narrow plot: {width}px"
    assert height >= 500, f"unexpectedly short plot: {height}px"

    assert f"Wrote {out_path} (2 parameter points, seeds=[7, 8])." in capsys.readouterr().out


def test_accepts_a_command_envelope(plot_tool, write_json, tmp_path):
    path = write_json({"status": "ok", "result": make_sweep()})
    out_path = tmp_path / "envelope.png"
    assert plot_tool.plot_experiment_metrics(str(path), str(out_path)) == 0
    read_png_header(out_path)


def test_default_output_path_is_used_when_none_is_given(plot_tool, sweep_file, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert plot_tool.plot_experiment_metrics(str(sweep_file)) == 0
    assert (tmp_path / "experiment_plot.png").is_file()


def test_main_accepts_an_explicit_output_path(plot_tool, sweep_file, tmp_path):
    out_path = tmp_path / "explicit.png"
    assert plot_tool.main(["plot_metrics.py", str(sweep_file), str(out_path)]) == 0
    assert out_path.is_file()


# ------------------------------------------------------------------------------------ series parsing


def test_series_converts_to_plot_units(plot_tool):
    series = plot_tool.parse_plot_series(make_sweep())
    assert series.parameters == [500000.0, 1000000.0]
    assert series.throughput_mbps == [2.0, 4.0]
    assert series.goodput_mbps == [1.5, 3.0]
    assert series.latency_ms == [12.5, 8.0]


def test_absent_metric_becomes_zero_but_is_not_invented_when_corrupt(plot_tool):
    absent = make_sweep(points=[{"parameter_value": 1.0, "aggregated_qos": {"run_count": 1}}])
    series = plot_tool.parse_plot_series(absent)
    assert series.throughput_mbps == [0.0]
    assert series.latency_ms == [0.0]

    corrupt = make_sweep(points=[make_point(1.0, make_qos(throughput_bps="broken"))])
    with pytest.raises(plot_tool.SweepDataError):
        plot_tool.parse_plot_series(corrupt)


def test_point_without_aggregated_qos_is_plotted_as_zero(plot_tool, write_json, tmp_path):
    """An absent qos block means nothing was measured, which plots as zero - not as a crash."""
    payload = make_sweep(points=[{"parameter_value": 1.0}])
    out_path = tmp_path / "noqos.png"
    assert plot_tool.plot_experiment_metrics(str(write_json(payload)), str(out_path)) == 0
    read_png_header(out_path)
    series = plot_tool.parse_plot_series(payload)
    assert series.parameters == [1.0]
    assert series.throughput_mbps == [0.0]


def test_top_level_array_is_rejected(plot_tool, write_json, tmp_path, capsys):
    assert plot_tool.plot_experiment_metrics(str(write_json([1, 2, 3])), str(tmp_path / "arr.png")) == 1
    captured = capsys.readouterr()
    assert "Expected a JSON object at the top level." in captured.out
    assert captured.err == ""


def test_bool_is_not_accepted_as_a_number(plot_tool):
    with pytest.raises(plot_tool.SweepDataError):
        plot_tool.parse_plot_series(make_sweep(points=[{"parameter_value": True, "aggregated_qos": {}}]))


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_parameter_values_are_rejected(plot_tool, value):
    with pytest.raises(plot_tool.SweepDataError):
        plot_tool.parse_plot_series(make_sweep(points=[{"parameter_value": value, "aggregated_qos": {}}]))


# ------------------------------------------------------------------------------------ empty datasets


def test_empty_points_reports_and_fails_without_writing(plot_tool, write_json, tmp_path, capsys):
    out_path = tmp_path / "empty.png"
    assert plot_tool.plot_experiment_metrics(str(write_json(make_sweep(points=[]))), str(out_path)) == 1
    assert "No parameter points present in this result; nothing to plot." in capsys.readouterr().out
    assert not out_path.exists()


def test_null_points_reports_and_fails_without_writing(plot_tool, write_json, tmp_path, capsys):
    out_path = tmp_path / "null.png"
    assert plot_tool.plot_experiment_metrics(str(write_json(make_sweep(points=None))), str(out_path)) == 1
    assert "nothing to plot" in capsys.readouterr().out
    assert not out_path.exists()


# -------------------------------------------------------------------------------- structural errors


def test_points_that_is_not_a_list_is_rejected(plot_tool, write_json, tmp_path, capsys):
    assert plot_tool.plot_experiment_metrics(str(write_json(make_sweep(points="nope"))), str(tmp_path / "a.png")) == 1
    captured = capsys.readouterr()
    assert "'points' must be a JSON array (received str)" in captured.out
    assert captured.err == ""


def test_missing_parameter_value_is_explained(plot_tool, write_json, tmp_path, capsys):
    payload = make_sweep(points=[{"aggregated_qos": make_qos()}])
    assert plot_tool.plot_experiment_metrics(str(write_json(payload)), str(tmp_path / "b.png")) == 1
    captured = capsys.readouterr()
    assert "parameter_value is missing" in captured.out
    assert captured.err == ""


def test_non_numeric_parameter_value_is_rejected_not_coerced(plot_tool, write_json, tmp_path, capsys):
    """Regression: a non-numeric x value previously raised an uncaught ValueError."""
    payload = make_sweep(points=[make_point("abc")])
    assert plot_tool.plot_experiment_metrics(str(write_json(payload)), str(tmp_path / "c.png")) == 1
    captured = capsys.readouterr()
    assert "must be a number (received 'abc')" in captured.out
    assert captured.err == ""


def test_aggregated_qos_that_is_not_an_object_is_rejected(plot_tool, write_json, tmp_path, capsys):
    """Regression: a non-object aggregated_qos previously raised an uncaught AttributeError."""
    payload = make_sweep(points=[{"parameter_value": 1.0, "aggregated_qos": "nope"}])
    assert plot_tool.plot_experiment_metrics(str(write_json(payload)), str(tmp_path / "d.png")) == 1
    captured = capsys.readouterr()
    assert "aggregated_qos' must be a JSON object (received str)" in captured.out
    assert captured.err == ""


def test_missing_required_keys_is_reported(plot_tool, write_json, tmp_path, capsys):
    assert plot_tool.plot_experiment_metrics(str(write_json({"points": []})), str(tmp_path / "e.png")) == 1
    assert "is not a NetSim sweep result" in capsys.readouterr().out


def test_malformed_json_is_reported(plot_tool, tmp_path, capsys):
    path = tmp_path / "broken.json"
    path.write_text("[not json", encoding="utf-8")
    assert plot_tool.plot_experiment_metrics(str(path), str(tmp_path / "f.png")) == 1
    captured = capsys.readouterr()
    assert "not valid JSON" in captured.out
    assert captured.err == ""


# ------------------------------------------------------------------------------------ file handling


def test_missing_file_is_reported(plot_tool, tmp_path, capsys):
    missing = tmp_path / "absent.json"
    assert plot_tool.plot_experiment_metrics(str(missing), str(tmp_path / "g.png")) == 1
    assert f"File not found: {missing}" in capsys.readouterr().out


def test_unwritable_output_path_is_reported(plot_tool, sweep_file, tmp_path, capsys):
    """Regression: saving into a missing directory previously raised an uncaught OSError."""
    out_path = tmp_path / "no-such-dir" / "plot.png"
    assert plot_tool.plot_experiment_metrics(str(sweep_file), str(out_path)) == 1
    captured = capsys.readouterr()
    assert f"Cannot write the plot to {out_path}" in captured.out
    assert captured.err == ""


def test_matplotlib_unavailable_gives_a_clear_message(plot_tool, sweep_file, tmp_path, monkeypatch, capsys):
    """With no matplotlib the tool must explain how to install it, not traceback."""
    monkeypatch.setitem(sys.modules, "matplotlib", None)
    monkeypatch.setitem(sys.modules, "matplotlib.pyplot", None)

    assert plot_tool.plot_experiment_metrics(str(sweep_file), str(tmp_path / "h.png")) == 1
    captured = capsys.readouterr()
    assert "Matplotlib not installed. Please run: pip install -r requirements.txt" in captured.out
    assert captured.err == ""
    assert not (tmp_path / "h.png").exists()


# ------------------------------------------------------------------------------------------- CLI


def test_no_arguments_prints_usage_and_exits_two(plot_tool, capsys):
    assert plot_tool.main(["plot_metrics.py"]) == 2
    assert "Usage: python plot_metrics.py" in capsys.readouterr().out


def test_sweep_data_error_is_a_value_error(plot_tool):
    assert issubclass(plot_tool.SweepDataError, ValueError)
