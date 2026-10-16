"""Project import/export contract: validation, recovery and round trips.

Guards the ``load_project_json`` / ``save_project_json`` workflow that the UI's
Import/Export buttons drive. A rejected import must leave the current project
untouched; a successful round trip must preserve the supported project state.
"""

from __future__ import annotations

import json


def _current_project(api):
    return api.result("get_project")


def _save(api) -> str:
    return api.result("save_project_json")


# ---------------------------------------------------------------------------
# Round trip
# ---------------------------------------------------------------------------


def test_export_import_round_trip_preserves_supported_state(api):
    api.result("create_project", {"name": "Round Trip"})
    api.result("add_node", {"label": "Host A", "nodeType": "pc", "x": 10, "y": 20, "id": "rt-a"})
    api.result("add_node", {"label": "R1", "nodeType": "router", "x": 200, "y": 20, "id": "rt-r1"})
    api.result("add_link", {"sourceNodeId": "rt-a", "targetNodeId": "rt-r1", "id": "rt-l1", "bandwidthBps": 5_000_000})

    exported = _save(api)
    before = _current_project(api)

    # Mutate the session so the import demonstrably restores state.
    api.result("create_project", {"name": "Scratch"})
    assert _current_project(api)["metadata"]["name"] == "Scratch"
    assert [n["id"] for n in _current_project(api)["nodes"]] != [n["id"] for n in before["nodes"]]

    restored = api.result("load_project_json", {"jsonContent": exported})
    assert restored["metadata"]["name"] == before["metadata"]["name"]
    assert [n["id"] for n in restored["nodes"]] == [n["id"] for n in before["nodes"]]
    assert [n["label"] for n in restored["nodes"]] == [n["label"] for n in before["nodes"]]
    assert [lnk["id"] for lnk in restored["links"]] == [lnk["id"] for lnk in before["links"]]
    restored_link = next(lnk for lnk in restored["links"] if lnk["id"] == "rt-l1")
    assert restored_link["bandwidth_bps"] == 5_000_000
    assert restored["schemaVersion"] == 1

    after = _current_project(api)
    assert after == restored


def test_saved_document_is_valid_json_with_expected_shape(api):
    doc = json.loads(_save(api))
    assert doc["schemaVersion"] == 1
    assert isinstance(doc["nodes"], list)
    assert isinstance(doc["links"], list)
    assert "metadata" in doc


# ---------------------------------------------------------------------------
# Rejected imports leave the current project intact
# ---------------------------------------------------------------------------


def test_invalid_json_is_rejected_and_the_project_is_unchanged(api):
    before = _current_project(api)
    message = api.error("load_project_json", {"jsonContent": "{not json"})
    assert "not valid JSON" in message
    assert _current_project(api) == before


def test_non_object_documents_are_rejected(api):
    before = _current_project(api)
    for body in ("[1,2,3]", '"a string"', "42", "null"):
        message = api.error("load_project_json", {"jsonContent": body})
        assert "object" in message
    assert _current_project(api) == before


def test_missing_content_is_rejected(api):
    message = api.error("load_project_json", {})
    assert "No project JSON supplied" in message


def test_unsupported_schema_versions_are_rejected_explicitly(api):
    before = _current_project(api)
    doc = json.dumps(
        {
            "schemaVersion": 2,
            "metadata": {"name": "Future"},
            "nodes": [],
            "links": [],
        }
    )
    message = api.error("load_project_json", {"jsonContent": doc})
    assert "schema version 2" in message
    assert "version 1" in message
    assert _current_project(api) == before


def test_duplicate_identifiers_are_rejected(api):
    before = _current_project(api)
    doc = json.dumps(
        {
            "schemaVersion": 1,
            "metadata": {"name": "Dupes"},
            "nodes": [
                {"id": "n1", "label": "A", "node_type": "pc", "position": {"x": 0, "y": 0}, "interfaces": []},
                {"id": "n1", "label": "B", "node_type": "pc", "position": {"x": 0, "y": 0}, "interfaces": []},
            ],
            "links": [],
        }
    )
    message = api.error("load_project_json", {"jsonContent": doc})
    assert "duplicate node identifiers" in message
    assert _current_project(api) == before


def test_links_referencing_unknown_nodes_are_rejected(api):
    before = _current_project(api)
    doc = json.dumps(
        {
            "schemaVersion": 1,
            "metadata": {"name": "Dangling"},
            "nodes": [{"id": "n1", "label": "A", "node_type": "pc", "position": {"x": 0, "y": 0}, "interfaces": []}],
            "links": [
                {
                    "id": "l1",
                    "source": {"node_id": "n1", "interface_id": "if1"},
                    "target": {"node_id": "ghost", "interface_id": "if2"},
                }
            ],
        }
    )
    message = api.error("load_project_json", {"jsonContent": doc})
    assert "unknown target node" in message or "unknown source node" in message
    assert _current_project(api) == before


# ---------------------------------------------------------------------------
# Import resets engine and per-project registries
# ---------------------------------------------------------------------------


def test_import_resets_engine_nat_and_circuit_state(api):
    api.result(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 500},
    )
    api.result("run_simulation_until_empty")
    api.result("get_or_create_nat_table", {"routerNodeId": "node-2", "publicIp": "203.0.113.1"})
    api.result(
        "request_circuit",
        {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 1000, "circuitId": "c-old"},
    )

    exported = _save(api)
    api.result("load_project_json", {"jsonContent": exported})

    state = api.result("get_simulation_state")
    assert state["current_time_us"] == 0
    assert state["metrics"]["packets_created"] == 0
    circuits = api.result("get_circuit_state")
    assert circuits["circuits"] == []
    assert circuits["metrics"]["requests_total"] == 0
