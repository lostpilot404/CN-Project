"""API contract tests: hostile input, error mapping and regression coverage for fixed defects.

Each test names the defect it guards. All requests go through the real HTTP service, so the
tests fail if request parsing, validation or error mapping regresses.
"""

from __future__ import annotations

import json

import pytest

# ---------------------------------------------------------------------------
# Transport-level contract
# ---------------------------------------------------------------------------


def test_valid_command_returns_ok_envelope(api):
    body = api.call("get_project")
    assert body["status"] == "ok"
    assert body["status_code"] == 200
    assert "nodes" in body["result"]


def test_health_endpoint_reports_the_python_authority(api_server):
    import urllib.request

    with urllib.request.urlopen(f"{api_server}/health", timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    assert payload["status"] == "ok"
    assert payload["backend"] == "python"
    assert payload["authority"] == "python-simulation-core"
    assert "version" in payload
    assert "current_time_us" in payload


@pytest.mark.parametrize(
    "cmd",
    [
        "no_such_command",
        "..%2F..%2Fetc%2Fpasswd",
        "",
        "get_project%3Brm%20-rf%20%2F",
        "DROP%20TABLE",
        "%00",
        "a" * 512,
    ],
)
def test_unknown_or_injected_command_names_are_rejected(api, cmd):
    """The command name is only ever a dictionary lookup key: it is never executed or interpolated."""
    message = api.error(cmd, {}, status=404)
    assert "Unknown API command" in message


@pytest.mark.parametrize("body", [b"{not json", b"[1,2,3]", b'"a string"', b"42"])
def test_non_object_request_bodies_are_rejected_without_a_traceback(api, body):
    status, payload = api.raw("get_project", body)
    assert status == 400
    assert payload["status"] == "error"
    assert "Traceback" not in json.dumps(payload)


def test_empty_body_is_treated_as_no_arguments(api):
    status, payload = api.raw("get_project", b"")
    assert status == 200
    assert payload["status"] == "ok"


# ---------------------------------------------------------------------------
# Regression tests for defects found and fixed during the audit
# ---------------------------------------------------------------------------


def test_regression_a_link_can_be_added_even_when_every_port_is_in_use(api):
    """The shipped default project wires up all three nodes, so add_link used to fail with
    'No free interface available'. A new port is now provisioned automatically."""
    for index in range(3):
        link = api.result(
            "add_link",
            {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 5_000_000},
        )
        assert link["source"]["node_id"] == "node-1"
        assert link["source"]["interface_id"] != ""
        assert index >= 0

    project = api.result("get_project")
    node1 = next(n for n in project["nodes"] if n["id"] == "node-1")
    assert len(node1["interfaces"]) >= 4
    # every interface is either free or attached to a link that exists
    link_ids = {lnk["id"] for lnk in project["links"]}
    for iface in node1["interfaces"]:
        assert iface["link_id"] is None or iface["link_id"] in link_ids


def test_regression_add_link_still_rejects_a_busy_explicit_interface(api):
    busy = api.result("get_project")["nodes"][0]["interfaces"][0]["id"]
    message = api.error(
        "add_link",
        {"sourceNodeId": "node-1", "targetNodeId": "node-3", "sourceInterfaceId": busy},
    )
    assert "already connected" in message


def test_regression_remove_node_requires_an_identifier(api):
    message = api.error("remove_node", {})
    assert "node identifier is required" in message


def test_regression_remove_node_rejects_an_unknown_identifier(api):
    message = api.error("remove_node", {"nodeId": "ghost"})
    assert "not found" in message


def test_regression_run_simulation_micros_rejects_non_positive_durations(api):
    """A negative duration used to return a silent 0-us run."""
    assert "at least 1 microsecond" in api.error("run_simulation_micros", {"durationUs": -1})
    assert "at least 1 microsecond" in api.error("run_simulation_micros", {"durationUs": 0})
    assert "must be an integer" in api.error("run_simulation_micros", {"durationUs": "soon"})


def test_regression_get_packet_details_rejects_an_unknown_packet(api):
    """An unknown packet id used to return a 200 with a null result."""
    assert "does not exist" in api.error("get_packet_details", {"packetId": "pkt-999"})
    assert "identifier is required" in api.error("get_packet_details", {})


def test_regression_subnet_calculation_requires_an_input(api):
    """A missing CIDR used to fall back to a hard-coded 192.168.1.0/24."""
    message = api.error("calculate_ipv4_subnet", {})
    assert "IPv4 address or CIDR block is required" in message


def test_regression_checksum_commands_require_their_inputs(api):
    assert "data' is required" in api.error("calculate_simple_checksum", {})
    assert "required to verify a checksum" in api.error("verify_internet_checksum", {})


def test_regression_dns_rejects_an_empty_query_name(api):
    """An empty query name used to be answered with NXDOMAIN instead of being rejected."""
    assert "must not be empty" in api.error("simulate_dns", {"config": {"query_name": ""}})
    assert "must not be empty" in api.error("simulate_dns", {"config": {"query_name": "   "}})
    assert "must not be negative" in api.error("simulate_dns", {"config": {"query_id": -5}})


@pytest.mark.parametrize(
    ("cmd", "payload", "fragment"),
    [
        ("simulate_tcp", {"config": "not-an-object"}, "'config' must be a JSON object"),
        ("simulate_dns", {"config": [1, 2]}, "'config' must be a JSON object"),
        ("simulate_csma_cd", {"config": 7}, "'config' must be a JSON object"),
        ("simulate_http", {"config": {"request": "GET"}}, "'request' must be a JSON object"),
        ("simulate_dns", {"config": {"custom_records": "www.example.com"}}, "must be a JSON array"),
        ("simulate_dns", {"config": {"custom_records": [{"name": "a"}]}}, "requires 'name'"),
        (
            "run_parameter_sweep_command",
            {"config": {"parameter": "link_bandwidth"}},
            "'config.parameter' must be a JSON object",
        ),
    ],
)
def test_regression_malformed_nested_configs_are_client_errors(api, cmd, payload, fragment):
    """Nested values used to reach `.get` directly and surface as HTTP 500 parser faults."""
    assert fragment in api.error(cmd, payload)


def test_regression_sweep_validation_is_a_client_error(api):
    assert "'nonsense' is not a valid SweepParameterType" in api.error(
        "run_parameter_sweep_command", {"config": {"parameter": {"type": "nonsense"}}}
    )
    assert "must be >= 1" in api.error(
        "run_parameter_sweep_command",
        {"config": {"parameter": {"type": "link_bandwidth"}, "parameter_values": [-5]}},
    )
    assert "must be <= 1" in api.error(
        "run_parameter_sweep_command",
        {"config": {"parameter": {"type": "bit_error_rate"}, "parameter_values": [1.5]}},
    )
    assert "at least one parameter value" in api.error(
        "run_parameter_sweep_command",
        {"config": {"parameter": {"type": "link_bandwidth"}, "parameter_values": []}},
    )


def test_regression_project_json_must_decode_to_an_object(api):
    assert "object" in api.error("load_project_json", {"jsonContent": "[1,2,3]"})
    assert "not valid JSON" in api.error("load_project_json", {"jsonContent": "{oops"})


def test_regression_self_loop_error_is_a_structured_client_error(api):
    """A self-loop used to raise a bare ValueError that could escape the error mapping."""
    assert "to itself" in api.error("add_link", {"sourceNodeId": "node-1", "targetNodeId": "node-1"})


def test_regression_omitted_node_type_still_defaults_to_pc(api):
    """The lookalike-key rejection must not break the documented default: a request that
    simply omits the device kind still creates a PC."""
    node = api.result("add_node", {"label": "Bare"})
    assert node["node_type"] == "pc"


# ---------------------------------------------------------------------------
# Validation coverage across the command surface
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cmd", "payload", "fragment"),
    [
        ("add_node", {"label": "X", "nodeType": "quantum"}, "Invalid node type"),
        ("add_node", {"label": "X", "x": "abc"}, "could not convert string to float"),
        ("add_node", {"label": "X", "id": "node-1"}, "already exists"),
        ("add_node", {"label": "X", "type": "router"}, "Unknown node-type field 'type'"),
        ("add_node", {"label": "X", "device_type": "router"}, "Unknown node-type field 'device_type'"),
        ("add_node", {"label": "X", "kind": "router"}, "Unknown node-type field 'kind'"),
        ("update_node", {"nodeId": "ghost"}, "not found"),
        ("update_node", {"nodeId": "node-1", "nodeState": "exploded"}, "Invalid node state"),
        ("add_link", {}, "Both source and target node identifiers are required"),
        ("add_link", {"sourceNodeId": "node-1", "targetNodeId": "ghost"}, "not found"),
        ("add_link", {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bandwidthBps": 0}, "greater than 0"),
        ("add_link", {"sourceNodeId": "node-1", "targetNodeId": "node-3", "lossProbability": 7}, "between 0.0 and 1.0"),
        ("add_link", {"sourceNodeId": "node-1", "targetNodeId": "node-3", "bitErrorRate": -1}, "between 0.0 and 1.0"),
        ("update_link", {"linkId": "ghost"}, "not found"),
        ("update_link", {"linkId": "link-1", "status": "melting"}, "Invalid link status"),
        ("update_interface", {"nodeId": "node-1", "interfaceId": "ghost"}, "not found"),
        ("update_interface", {"nodeId": "node-1", "interfaceId": "if-1", "ipv4": "999.1.1.1"}, "Invalid IPv4"),
        ("update_interface", {"nodeId": "node-1", "interfaceId": "if-1", "subnetMask": "255.0.999.0"}, "Invalid IPv4"),
        ("update_interface", {"nodeId": "node-1", "interfaceId": "if-1", "ipv6": "12345::zz"}, "Invalid IPv6"),
        (
            "update_interface",
            {"nodeId": "node-1", "interfaceId": "if-1", "status": "melting"},
            "Invalid interface status",
        ),
        ("inject_packet", {"srcNodeId": "node-1", "dstNodeId": "ghost"}, "not found"),
        ("inject_packet", {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 0}, "at least 1 byte"),
        ("calculate_ipv4_subnet", {"input": "300.1.2.3/24"}, "Invalid IPv4 address"),
        ("calculate_ipv4_subnet", {"input": "10.0.0.0/33"}, "must be between 0 and 32"),
        ("validate_ipv6_address", {"address": "12345::zz"}, "characters permitted"),
        ("calculate_hamming_encode", {"dataBits": ""}, "cannot be empty"),
        ("calculate_hamming_encode", {"dataBits": "10x1"}, "invalid character"),
        ("calculate_hamming_encode", {"dataBits": "1011", "parityMode": "maybe"}, "Unsupported parity mode"),
        ("calculate_crc", {"dataBits": "1011", "polynomial": "zzz"}, "invalid character"),
        ("calculate_routing_table", {"nodeId": "node-1"}, "not an L3 routing device"),
        ("calculate_routing_table", {"nodeId": "node-2", "metricType": "latency"}, "Invalid routing metric"),
        ("calculate_routing_table", {"nodeId": "node-2", "algorithm": "floyd"}, "Unsupported routing algorithm"),
        ("simulate_go_back_n", {"config": {"protocol": "nonsense"}}, "not a valid FlowControlProtocol"),
        ("simulate_sliding_window", {"config": {"window_size": 0}}, "Window size must be at least 1"),
        ("simulate_sliding_window", {"config": {"window_size": 4, "sequence_space": 2}}, "sequence space"),
        ("simulate_csma_cd", {"config": {"protocol": "nonsense"}}, "not a valid MacProtocol"),
        ("simulate_pure_aloha", {"config": {"num_stations": 0}}, "num_stations must be >= 1"),
        ("simulate_pure_aloha", {"config": {"offered_load_g": -1.0}}, "cannot be negative"),
        ("simulate_tcp", {"config": {"payload_bytes": 0}}, "Payload size must be at least 1 byte"),
        ("simulate_udp", {"config": {"segment_size_bytes": 0}}, "Segment size must be at least 1 byte"),
        ("simulate_tcp", {"config": {"source_node_id": "node-1", "destination_node_id": "node-1"}}, "must differ"),
        ("simulate_http", {"config": {"request": {"method": "PATCH"}}}, "not a valid HttpMethod"),
        ("run_comparative_experiment_command", {"config": {}}, "scenario_a' and 'scenario_b"),
    ],
)
def test_validation_errors_are_structured_400s(api, cmd, payload, fragment):
    assert fragment in api.error(cmd, payload)


def test_transport_defaults_resolve_to_the_project_endpoints(api):
    """Transport commands default to first -> last project node instead of the dead host-a/host-b."""
    project = api.result("get_project")
    first, last = project["nodes"][0]["id"], project["nodes"][-1]["id"]
    for cmd in ("simulate_tcp", "simulate_udp"):
        result = api.result(cmd, {"config": {"payload_bytes": 2000, "segment_size_bytes": 1000}})
        assert result["config"]["source_node_id"] == first
        assert result["config"]["destination_node_id"] == last
        assert result["derived_route"][0] == first
        assert result["derived_route"][-1] == last


# ---------------------------------------------------------------------------
# Regression tests for defects found during the quality audit
# ---------------------------------------------------------------------------


def test_regression_nat_protocol_is_case_insensitive(api):
    """`add_static_dnat_rule` lower-cased the protocol and then compared it against an
    upper-case enum, so every rule submitted by the UI (which sends 'TCP') was rejected."""
    api.result("get_or_create_nat_table", {"routerNodeId": "node-2", "publicIp": "203.0.113.1"})
    for index, protocol in enumerate(("TCP", "tcp", "Tcp", "UDP", "ICMP")):
        table = api.result(
            "add_static_dnat_rule",
            {
                "routerNodeId": "node-2",
                "publicIp": "203.0.113.1",
                "publicPort": 8080 + index,
                "privateIp": "192.168.1.10",
                "privatePort": 80,
                "protocol": protocol,
            },
        )
        assert table["public_ip"] == "203.0.113.1"
    assert "Invalid NAT protocol 'SCTP'" in api.error(
        "add_static_dnat_rule",
        {
            "routerNodeId": "node-2",
            "publicPort": 1,
            "privateIp": "192.168.1.10",
            "privatePort": 2,
            "protocol": "SCTP",
        },
    )


def test_regression_nat_outbound_and_inbound_translate(api):
    api.result("get_or_create_nat_table", {"routerNodeId": "node-2", "publicIp": "203.0.113.1"})
    api.result(
        "add_static_dnat_rule",
        {
            "routerNodeId": "node-2",
            "publicPort": 8080,
            "privateIp": "192.168.1.10",
            "privatePort": 80,
            "protocol": "TCP",
        },
    )
    outbound = api.result(
        "simulate_nat_outbound",
        {
            "routerNodeId": "node-2",
            "publicIp": "203.0.113.1",
            "srcIp": "192.168.1.10",
            "srcPort": 40000,
            "dstIp": "8.8.8.8",
            "dstPort": 443,
            "protocol": "TCP",
        },
    )
    assert "203.0.113.1" in json.dumps(outbound)

    inbound = api.result(
        "simulate_nat_inbound",
        {
            "routerNodeId": "node-2",
            "srcIp": "8.8.8.8",
            "srcPort": 5555,
            "dstIp": "203.0.113.1",
            "dstPort": 8080,
            "protocol": "TCP",
        },
    )
    assert "192.168.1.10" in json.dumps(inbound)


@pytest.mark.parametrize(
    ("entry", "fragment"),
    [
        ({"fault_type": {"link_down": {"link_id": "link-1"}}}, "Fault type is required"),
        ({"fault_type": {"type": "nonsense"}}, "Unknown fault type 'nonsense'"),
        ({"fault_type": {"type": "link_down"}}, "requires a 'link_id'"),
        ({"fault_type": {"type": "link_down", "link_id": "ghost"}}, "unknown link 'ghost'"),
        ({"fault_type": {"type": "node_failure", "node_id": "ghost"}}, "unknown node 'ghost'"),
        ({"fault_type": {"type": "bandwidth_degradation", "link_id": "link-1"}}, "new_bandwidth_bps"),
        ({"fault_type": {"type": "queue_capacity_change", "link_id": "link-1", "new_capacity": 0}}, "new_capacity"),
        ({"fault_type": {"type": "bit_error", "link_id": "link-1", "error_rate": 2.0}}, "error_rate"),
        ({"fault_type": {"type": "link_down", "link_id": "link-1"}, "timestamp_us": "later"}, "must be an integer"),
        ({"fault_type": {"type": "link_down", "link_id": "link-1"}, "timestamp_us": -5}, "must be >= 0"),
        ({"fault_type": "link_down", "target_id": "link-1"}, "must be an object"),
        ({"fault_type": ["link_down"]}, "must be an object"),
        ({}, "requires a 'fault_type'"),
    ],
)
def test_regression_invalid_fault_entries_are_rejected(api, entry, fragment):
    """A fault with a missing or unknown target used to be accepted and then silently ignored
    when the engine executed it, so the UI showed a scheduled fault that did nothing."""
    assert fragment in api.error("schedule_fault_command", {"entry": entry})


def test_regression_link_down_fault_actually_drops_traffic_then_reset_restores_it(api):
    api.result(
        "schedule_fault_command",
        {
            "entry": {
                "fault_id": "f1",
                "timestamp_us": 0,
                "fault_type": {"type": "link_down", "link_id": "link-1"},
            }
        },
    )
    packet_id = api.result(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 1000, "transportProtocol": "UDP"},
    )
    api.result("run_simulation_until_empty")
    packet = api.result("get_packet_details", {"packetId": packet_id})
    assert packet["state"] == "dropped_link_down"
    assert sum(1 for hop in packet["hop_history"] if hop["state"].startswith("dropped")) == 1

    events = api.result("get_simulation_state")["recent_events"]
    assert sum(1 for event in events if event["event_type"]["type"] == "fault_injected") == 1
    assert sum(1 for event in events if event["event_type"]["type"] == "packet_dropped") == 1

    # reset() must bring the faulted link back
    api.result("reset_simulation")
    after = api.result(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 1000, "transportProtocol": "UDP"},
    )
    api.result("run_simulation_until_empty")
    assert api.result("get_packet_details", {"packetId": after})["state"] == "delivered"


def test_regression_every_fault_type_executes(api):
    api.result("update_link", {"linkId": "link-2", "bandwidthBps": 10_000_000})
    faults = [
        {
            "fault_id": "a",
            "timestamp_us": 0,
            "fault_type": {"type": "bandwidth_degradation", "link_id": "link-2", "new_bandwidth_bps": 500_000},
        },
        {
            "fault_id": "b",
            "timestamp_us": 1,
            "fault_type": {"type": "queue_capacity_change", "link_id": "link-2", "new_capacity": 5},
        },
        {
            "fault_id": "c",
            "timestamp_us": 2,
            "fault_type": {"type": "bit_error", "link_id": "link-2", "error_rate": 0.4},
        },
        {"fault_id": "d", "timestamp_us": 3, "fault_type": {"type": "node_failure", "node_id": "node-3"}},
        {"fault_id": "e", "timestamp_us": 4, "fault_type": {"type": "link_restore", "link_id": "link-1"}},
    ]
    for entry in faults:
        api.result("schedule_fault_command", {"entry": entry})

    api.result("inject_packet", {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 1000})
    api.result("run_simulation_until_empty")
    events = api.result("get_simulation_state")["recent_events"]
    injected = [event for event in events if event["event_type"]["type"] == "fault_injected"]
    assert len(injected) == len(faults), f"only {len(injected)} of {len(faults)} faults executed"

    api.result("reset_simulation")
    link = next(link for link in api.result("get_project")["links"] if link["id"] == "link-2")
    assert link["status"] == "up"


def test_regression_new_project_does_not_inherit_nat_state(api):
    """NAT tables used to survive `create_project`, so a fresh project failed with
    "Static DNAT port collision" for a port it had never configured."""
    api.result("get_or_create_nat_table", {"routerNodeId": "node-2", "publicIp": "203.0.113.1"})
    api.result(
        "add_static_dnat_rule",
        {
            "routerNodeId": "node-2",
            "publicPort": 8080,
            "privateIp": "192.168.1.10",
            "privatePort": 80,
            "protocol": "TCP",
        },
    )
    api.result(
        "simulate_nat_outbound",
        {
            "routerNodeId": "node-2",
            "publicIp": "203.0.113.1",
            "srcIp": "192.168.1.10",
            "srcPort": 40000,
            "dstIp": "8.8.8.8",
            "dstPort": 443,
            "protocol": "TCP",
        },
    )

    api.result("create_project", {"name": "fresh"})
    table = api.result("get_or_create_nat_table", {"routerNodeId": "node-2", "publicIp": "203.0.113.1"})
    assert table["entries"] == [], "dynamic SNAT mappings leaked into the new project"
    assert table["static_rules"] == [], "static port forwards leaked into the new project"
    # The same public port must be usable again in the new project.
    again = api.result(
        "add_static_dnat_rule",
        {
            "routerNodeId": "node-2",
            "publicPort": 8080,
            "privateIp": "192.168.1.10",
            "privatePort": 80,
            "protocol": "TCP",
        },
    )
    assert len(again["static_rules"]) == 1


def test_regression_demo_packet_honours_its_endpoints(api):
    """The command ignored `srcNodeId`/`dstNodeId` and always used the first and last node."""
    packet_id = api.result("schedule_demo_packet", {"srcNodeId": "node-3", "dstNodeId": "node-1"})
    assert api.result("get_packet_details", {"packetId": packet_id})["src_node_id"] == "node-3"

    api.result("create_project", {"name": "demo-default"})
    default_id = api.result("schedule_demo_packet", {})
    assert api.result("get_packet_details", {"packetId": default_id})["src_node_id"] == "node-1"

    assert "not found" in api.error("schedule_demo_packet", {"srcNodeId": "ghost"})
    assert "different source and destination" in api.error(
        "schedule_demo_packet", {"srcNodeId": "node-1", "dstNodeId": "node-1"}
    )
