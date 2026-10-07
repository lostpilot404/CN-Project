import json
import threading
import time
import urllib.request

import pytest
from netsim.server import HTTPServer, NetSimRequestHandler


@pytest.fixture(scope="module")
def server_url():
    port = 8799
    server = HTTPServer(("127.0.0.1", port), NetSimRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    server.shutdown()
    server.server_close()


def post_api(url: str, cmd: str, args: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"{url}/api/{cmd}",
        data=json.dumps(args or {}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def test_health_check(server_url):
    req = urllib.request.Request(f"{server_url}/health")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        assert data["status"] == "ok"
        assert data["backend"] == "python"


def test_project_and_topology_api(server_url):
    proj_resp = post_api(server_url, "get_project")
    assert proj_resp["status"] == "ok"
    assert "nodes" in proj_resp["result"]

    add_resp = post_api(
        server_url,
        "add_node",
        {"label": "New Switch", "node_type": "switch", "x": 500, "y": 300},
    )
    assert add_resp["status"] == "ok"
    assert add_resp["result"]["label"] == "New Switch"


def test_algorithms_api(server_url):
    csum = post_api(
        server_url,
        "calculate_internet_checksum",
        {"input_hex": "4500003c1c4640004006"},
    )
    assert csum["status"] == "ok"
    assert "checksum_hex" in csum["result"]

    crc = post_api(
        server_url,
        "calculate_crc",
        {"data_bits": "1101", "polynomial": "1011"},
    )
    assert crc["status"] == "ok"
    assert "remainder" in crc["result"]
    assert "transmitted_codeword" in crc["result"]


def test_flow_control_api(server_url):
    res = post_api(
        server_url,
        "simulate_go_back_n",
        {"config": {"protocol": "go_back_n", "total_frames_to_send": 4}},
    )
    assert res["status"] == "ok"
    assert res["result"]["protocol"] == "go_back_n"


def test_transport_and_app_api(server_url):
    dns_res = post_api(
        server_url,
        "simulate_dns",
        {"config": {"query_name": "example.com"}},
    )
    assert dns_res["status"] == "ok"
    assert dns_res["result"]["config"]["query_name"] == "example.com"
