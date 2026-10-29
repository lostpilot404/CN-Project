"""HTTP request-surface hardening: body-size caps and malformed-request handling.

The service is loopback-only and the browser client sends small JSON documents; these tests
pin the structured rejections a hostile or buggy client must receive instead of a crash,
an unstructured error page, or a traceback.
"""

from __future__ import annotations

import http.client

# Import from the uniquely named helper rather than `conftest`: python-tools/tests/ has a
# conftest.py too and neither directory is a package, so the bare name was ambiguous.
from _api_port import API_PORT
from netsim.server import MAX_REQUEST_BYTES


def _raw_post(path: str, body: bytes, headers: dict[str, str]) -> tuple[int, str]:
    """POST with full control over headers (urllib always computes Content-Length)."""
    conn = http.client.HTTPConnection("127.0.0.1", API_PORT, timeout=30)
    try:
        conn.request("POST", path, body=body, headers=headers)
        resp = conn.getresponse()
        return resp.status, resp.read().decode("utf-8")
    finally:
        conn.close()


def test_oversized_bodies_are_refused_with_a_structured_413(api_server):
    status, raw = _raw_post(
        "/api/get_project",
        b"x" * (MAX_REQUEST_BYTES + 1),
        {"Content-Type": "application/json"},
    )
    assert status == 413
    assert "error" in raw
    assert "request_too_large" in raw
    assert "Traceback" not in raw


def test_malformed_content_length_is_a_structured_400(api_server):
    status, raw = _raw_post(
        "/api/get_project",
        b"{}",
        {"Content-Type": "application/json", "Content-Length": "banana"},
    )
    assert status == 400
    assert "Malformed Content-Length" in raw
    assert "Traceback" not in raw


def test_negative_content_length_is_a_structured_400(api_server):
    status, raw = _raw_post(
        "/api/get_project",
        b"{}",
        {"Content-Type": "application/json", "Content-Length": "-5"},
    )
    assert status == 400
    assert "Content-Length" in raw
    assert "Traceback" not in raw


def test_malformed_json_bodies_are_rejected_without_tracebacks(api):
    status, body = api.raw("get_project", b"{not json")
    assert status == 400
    assert body["status"] == "error"
    assert "Malformed JSON" in body["message"]
    assert "Traceback" not in body["message"]


def test_non_object_json_bodies_are_rejected(api):
    for payload in (b"[1, 2, 3]", b'"a string"', b"42", b"null"):
        status, body = api.raw("get_project", payload)
        assert status == 400
        assert body["status"] == "error"
        assert "JSON object" in body["message"]


def test_invalid_utf8_bodies_are_rejected(api):
    status, body = api.raw("get_project", b"\xff\xfe\x00bad")
    assert status == 400
    assert body["status"] == "error"
