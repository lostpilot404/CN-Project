"""Circuit-switching educational model: setup, admission control, blocking and teardown.

Expected behaviour (see netsim/switching/circuit.py for the model assumptions):

* A circuit reserves its bandwidth on every link of the routed path during setup.
* Admission is all-or-nothing: a request that cannot get its full rate on every
  hop is blocked and leaves no partial reservations behind.
* Teardown releases the reservations and the capacity is immediately reusable.
* Topology mutations and project resets keep the reservations consistent.
"""

from __future__ import annotations

import pytest


def _request(api, src: str, dst: str, bandwidth_bps: int, circuit_id: str | None = None):
    args = {"sourceNodeId": src, "targetNodeId": dst, "bandwidthBps": bandwidth_bps}
    if circuit_id is not None:
        args["circuitId"] = circuit_id
    return api.result("request_circuit", args)


def _link_view(state: dict, link_id: str) -> dict:
    view = next((entry for entry in state["links"] if entry["link_id"] == link_id), None)
    assert view is not None, f"link {link_id} missing from circuit state"
    return view


# ---------------------------------------------------------------------------
# Successful setup
# ---------------------------------------------------------------------------


def test_successful_setup_reserves_capacity_on_every_link_of_the_path(api):
    # Default topology: node-1 -- link-1 -- node-2 -- link-2 -- node-3 (10 Mbps links).
    result = _request(api, "node-1", "node-3", 1_000_000, circuit_id="voice-1")

    assert result["accepted"] is True
    assert result["circuit_id"] == "voice-1"
    assert result["path"] == ["node-1", "node-2", "node-3"]
    assert sorted(result["link_ids"]) == ["link-1", "link-2"]
    assert result["reason"] == ""

    state = api.result("get_circuit_state")
    for link_id in ("link-1", "link-2"):
        view = _link_view(state, link_id)
        assert view["reserved_bps"] == 1_000_000
        assert view["available_bps"] == 10_000_000 - 1_000_000
        assert view["utilization"] == pytest.approx(0.1)

    m = state["metrics"]
    assert m["requests_total"] == 1
    assert m["requests_accepted"] == 1
    assert m["requests_blocked"] == 0
    assert m["circuits_active"] == 1


# ---------------------------------------------------------------------------
# Admission control and blocking
# ---------------------------------------------------------------------------


def test_insufficient_capacity_blocks_the_request_and_leaves_no_reservations(api):
    # Ask for more than a link can carry: must be blocked before any reservation.
    result = _request(api, "node-1", "node-3", 20_000_000)

    assert result["accepted"] is False
    assert result["circuit_id"] is None
    assert "Insufficient capacity" in result["reason"]
    assert "link-1" in result["reason"] or "link-2" in result["reason"]

    state = api.result("get_circuit_state")
    for link_id in ("link-1", "link-2"):
        view = _link_view(state, link_id)
        assert view["reserved_bps"] == 0
        assert view["available_bps"] == 10_000_000
    assert state["metrics"]["requests_blocked"] == 1
    assert state["circuits"] == []


def test_competing_requests_block_when_the_capacity_is_taken(api):
    # First request takes the full link capacity; the second must be blocked.
    first = _request(api, "node-1", "node-3", 10_000_000)
    assert first["accepted"] is True

    second = _request(api, "node-1", "node-3", 1_000_000)
    assert second["accepted"] is False
    assert "Insufficient capacity" in second["reason"]

    state = api.result("get_circuit_state")
    assert state["metrics"]["requests_accepted"] == 1
    assert state["metrics"]["requests_blocked"] == 1
    assert state["metrics"]["circuits_active"] == 1
    # Hand calculation: acceptance 1/2, blocking 1/2.
    assert state["metrics"]["acceptance_rate"] == pytest.approx(0.5)
    assert state["metrics"]["blocking_rate"] == pytest.approx(0.5)


def test_competing_requests_can_share_capacity_that_remains(api):
    a = _request(api, "node-1", "node-3", 4_000_000, "c-a")
    b = _request(api, "node-1", "node-3", 4_000_000, "c-b")
    c = _request(api, "node-1", "node-3", 4_000_000, "c-c")
    assert a["accepted"] and b["accepted"]
    assert c["accepted"] is False

    state = api.result("get_circuit_state")
    assert _link_view(state, "link-1")["reserved_bps"] == 8_000_000
    assert _link_view(state, "link-1")["available_bps"] == 2_000_000


# ---------------------------------------------------------------------------
# Teardown and reuse
# ---------------------------------------------------------------------------


def test_teardown_releases_the_reservation_and_capacity_is_reusable(api):
    first = _request(api, "node-1", "node-3", 10_000_000, "c-1")
    assert first["accepted"] is True

    teardown = api.result("teardown_circuit", {"circuitId": "c-1"})
    assert teardown["circuit_id"] == "c-1"
    assert teardown["state"] == "released"

    state = api.result("get_circuit_state")
    assert _link_view(state, "link-1")["reserved_bps"] == 0
    assert state["metrics"]["circuits_active"] == 0
    assert state["metrics"]["circuits_released"] == 1

    # The released capacity is immediately reusable at the same rate.
    again = _request(api, "node-1", "node-3", 10_000_000, "c-2")
    assert again["accepted"] is True
    assert _link_view(api.result("get_circuit_state"), "link-1")["reserved_bps"] == 10_000_000


def test_tearing_down_an_unknown_or_already_released_circuit_is_rejected(api):
    api.result(
        "request_circuit",
        {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 1000, "circuitId": "c-x"},
    )
    api.result("teardown_circuit", {"circuitId": "c-x"})

    msg = api.error("teardown_circuit", {"circuitId": "ghost"})
    assert "does not exist" in msg
    msg = api.error("teardown_circuit", {"circuitId": "c-x"})
    assert "already been released" in msg
    msg = api.error("teardown_circuit", {})
    assert "identifier is required" in msg


# ---------------------------------------------------------------------------
# Routing and topology interaction
# ---------------------------------------------------------------------------


def test_a_down_link_blocks_new_circuits_over_the_affected_path(api):
    api.result("update_link", {"linkId": "link-1", "status": "down"})
    result = _request(api, "node-1", "node-3", 1000)
    assert result["accepted"] is False
    assert "No path exists" in result["reason"]

    api.result("update_link", {"linkId": "link-1", "status": "up"})
    result = _request(api, "node-1", "node-3", 1000)
    assert result["accepted"] is True


def test_topology_mutations_release_affected_circuits(api):
    api.result(
        "request_circuit",
        {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 1000, "circuitId": "c-live"},
    )
    api.result("remove_link", {"linkId": "link-1"})

    state = api.result("get_circuit_state")
    circuit = next(c for c in state["circuits"] if c["circuit_id"] == "c-live")
    assert circuit["state"] == "released"
    assert "removed" in (circuit["released_reason"] or "")
    assert state["metrics"]["circuits_active"] == 0


def test_project_resets_clear_circuit_state(api):
    api.result(
        "request_circuit",
        {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 1000, "circuitId": "c-old"},
    )
    api.result("create_project", {"name": "fresh"})
    state = api.result("get_circuit_state")
    assert state["circuits"] == []
    assert state["metrics"]["requests_total"] == 0
    # The fresh default topology can accept circuits again.
    result = _request(api, "node-1", "node-3", 1000)
    assert result["accepted"] is True


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


def test_malformed_circuit_requests_are_rejected_with_structured_errors(api):
    msg = api.error("request_circuit", {"sourceNodeId": "ghost", "targetNodeId": "node-3", "bandwidthBps": 1000})
    assert "not found" in msg

    msg = api.error("request_circuit", {"sourceNodeId": "node-1", "targetNodeId": "node-1", "bandwidthBps": 1000})
    assert "distinct" in msg

    msg = api.error("request_circuit", {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 0})
    assert "at least 1" in msg

    msg = api.error("request_circuit", {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": "lots"})
    assert "integer" in msg

    msg = api.error("request_circuit", {"sourceNodeId": "node-1", "targetNodeId": "node-3"})
    assert "bandwidth" in msg.lower()

    _request(api, "node-1", "node-3", 1000, circuit_id="dup")
    msg = api.error(
        "request_circuit",
        {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 1000, "circuitId": "dup"},
    )
    assert "already in use" in msg

    msg = api.error(
        "request_circuit", {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 1000, "circuitId": "  "}
    )
    assert "empty" in msg
