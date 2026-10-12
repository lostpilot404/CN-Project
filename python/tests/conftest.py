"""Shared pytest fixtures.

The API fixtures run the real HTTP service in-process on a loopback port, so integration tests
exercise the same request/response path as the browser client (routing, JSON body parsing,
structured error mapping) rather than calling ``dispatch_command`` directly.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any

import pytest

# Add the python directory to the path so `netsim` can be imported directly.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from netsim.server import HTTPServer, NetSimRequestHandler  # noqa: E402

API_PORT = 8798


@pytest.fixture(scope="session")
def api_server():
    """A running NetSim service on a dedicated loopback port."""
    server = HTTPServer(("127.0.0.1", API_PORT), NetSimRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.1)
    yield f"http://127.0.0.1:{API_PORT}"
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def post_raw(url: str, cmd: str, args: dict[str, Any] | None = None, body: bytes | None = None):
    """POST a command and return ``(http_status, parsed_body)``."""
    payload = body if body is not None else json.dumps(args or {}).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/api/{cmd}",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:  # pragma: no cover - the service always returns JSON
            return exc.code, {"status": "error", "message": raw}


class ApiClient:
    """Thin typed wrapper over the HTTP command surface."""

    def __init__(self, url: str) -> None:
        self.url = url

    def call(self, cmd: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
        status, body = post_raw(self.url, cmd, args)
        return {"status_code": status, **body}

    def result(self, cmd: str, args: dict[str, Any] | None = None) -> Any:
        status, body = post_raw(self.url, cmd, args)
        assert status == 200, f"{cmd} -> HTTP {status}: {body.get('message')}"
        assert body["status"] == "ok", f"{cmd} -> {body.get('message')}"
        return body.get("result")

    def error(self, cmd: str, args: dict[str, Any] | None = None, *, status: int = 400) -> str:
        """Assert a structured error response and return its message."""
        http_status, body = post_raw(self.url, cmd, args)
        assert http_status == status, f"{cmd} returned HTTP {http_status} (expected {status}): {body}"
        assert body.get("status") == "error", f"{cmd} did not return an error payload: {body}"
        message = body.get("message")
        assert isinstance(message, str) and message, f"{cmd} error payload has no message: {body}"
        assert "Traceback" not in json.dumps(body), f"{cmd} leaked a traceback"
        return message

    def raw(self, cmd: str, body: bytes) -> tuple[int, dict[str, Any]]:
        return post_raw(self.url, cmd, body=body)


@pytest.fixture()
def api(api_server) -> ApiClient:
    """An API client positioned on a freshly created default project."""
    client = ApiClient(api_server)
    client.result("create_project", {"name": "pytest-session"})
    return client
