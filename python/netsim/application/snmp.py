from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from netsim.application import (
    AppProtocolEvent,
    AppProtocolMetrics,
    AppProtocolState,
    app_event_to_sim_event,
    build_application_packet,
)
from netsim.core.events import SimEvent
from netsim.models.packet import AppHeader, Packet
from netsim.models.project import Project
from netsim.transport import (
    TransportConfig,
    TransportProtocol,
    resolve_route_and_links,
)


@dataclass
class MibObject:
    oid: str
    name: str
    syntax: str
    value: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "oid": self.oid,
            "name": self.name,
            "syntax": self.syntax,
            "value": self.value,
            "description": self.description,
        }


@dataclass
class SnmpConfig:
    manager_node_id: str = "nms-manager"
    agent_node_id: str = "router-core"
    community: str = "public"
    requested_oid: str = "1.3.6.1.2.1.1.1.0"
    port: int = 161
    seed: int = 42

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SnmpConfig:
        return cls(
            manager_node_id=data.get("manager_node_id", "nms-manager"),
            agent_node_id=data.get("agent_node_id", "router-core"),
            community=data.get("community", "public"),
            requested_oid=data.get("requested_oid", "1.3.6.1.2.1.1.1.0"),
            port=int(data.get("port", 161)),
            seed=int(data.get("seed", 42)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "manager_node_id": self.manager_node_id,
            "agent_node_id": self.agent_node_id,
            "community": self.community,
            "requested_oid": self.requested_oid,
            "port": self.port,
            "seed": self.seed,
        }


@dataclass
class SnmpSimResult:
    config: SnmpConfig
    state: AppProtocolState
    found_object: MibObject | None
    events: list[AppProtocolEvent]
    sim_events: list[SimEvent]
    packets: list[Packet]
    metrics: AppProtocolMetrics

    def to_dict(self) -> dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "state": self.state.value,
            "found_object": self.found_object.to_dict() if self.found_object else None,
            "events": [e.to_dict() for e in self.events],
            "sim_events": [se.to_dict() for se in self.sim_events],
            "packets": [p.to_dict() for p in self.packets],
            "metrics": self.metrics.to_dict(),
        }


def get_default_mib_tree() -> list[MibObject]:
    return [
        MibObject(
            oid="1.3.6.1.2.1.1.1.0",
            name="sysDescr.0",
            syntax="DisplayString",
            value="NetSim CoreOS Router v2.4 (x86_64, Educational Edition)",
            description="A textual description of the network entity.",
        ),
        MibObject(
            oid="1.3.6.1.2.1.1.3.0",
            name="sysUpTime.0",
            syntax="TimeTicks",
            value="1248900 (3 hours, 28 minutes, 9 seconds)",
            description="The time since the network management portion was initialized.",
        ),
        MibObject(
            oid="1.3.6.1.2.1.1.5.0",
            name="sysName.0",
            syntax="DisplayString",
            value="Gateway-R1.internal",
            description="An administratively-assigned name for this managed node.",
        ),
        MibObject(
            oid="1.3.6.1.2.1.2.2.1.10.1",
            name="ifInOctets.1",
            syntax="Counter32",
            value="849203948",
            description="The total number of octets received on interface eth0.",
        ),
        MibObject(
            oid="1.3.6.1.2.1.2.2.1.16.1",
            name="ifOutOctets.1",
            syntax="Counter32",
            value="729482109",
            description="The total number of octets transmitted out of interface eth0.",
        ),
    ]


def simulate_snmp(config: SnmpConfig, project: Project | None = None) -> SnmpSimResult:
    events: list[AppProtocolEvent] = []
    packets: list[Packet] = []
    step_index = 0
    curr_time_us = 0

    transport_cfg = TransportConfig(
        protocol=TransportProtocol.UDP,
        source_node_id=config.manager_node_id,
        destination_node_id=config.agent_node_id,
        source_port=54161,
        destination_port=config.port,
        payload_bytes=84,
        segment_size_bytes=512,
        initial_sequence_number=1,
        initial_cwnd_mss=1.0,
        initial_ssthresh_mss=16.0,
        initial_rto_us=100_000,
        receive_window_bytes=4096,
        seed=config.seed,
        dropped_segments=[],
        maximum_retries=0,
    )

    path_nodes, hop_links = resolve_route_and_links(transport_cfg, project)
    return_nodes = list(reversed(path_nodes))
    return_links = list(reversed(hop_links))

    # 1. Manager sends GetRequest PDU
    req_pkt_id = "pkt-snmp-get-req"
    req_pkt, req_arr_us = build_application_packet(
        req_pkt_id,
        config.manager_node_id,
        config.agent_node_id,
        path_nodes,
        hop_links,
        AppHeader(
            protocol="SNMP",
            payload_preview=f"GetRequest OID: {config.requested_oid} (Community: {config.community})",
            message_type="GetRequest",
            session_id=f"snmp-{config.port}",
            transaction_id=101,
            resource_or_command=config.requested_oid,
            status_code=None,
        ),
        "UDP",
        54161,
        config.port,
        None,
        None,
        [],
        84,
        curr_time_us,
    )

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.manager_node_id,
            protocol="SNMP",
            event_type="SNMP_GET_REQUEST",
            description=f"Manager {config.manager_node_id} sent GetRequest for OID '{config.requested_oid}' to agent {config.agent_node_id}",
            packet_id=req_pkt_id,
            session_id=f"snmp-{config.port}",
            details=f"Community: {config.community}",
        )
    )
    step_index += 1
    packets.append(req_pkt)
    curr_time_us = req_arr_us

    # 2. Agent evaluates MIB tree
    curr_time_us += 30
    mib_tree = get_default_mib_tree()
    matched = next((m for m in mib_tree if m.oid == config.requested_oid), None)

    if matched is not None:
        events.append(
            AppProtocolEvent(
                step_index=step_index,
                timestamp_us=curr_time_us,
                node_id=config.agent_node_id,
                protocol="SNMP",
                event_type="SNMP_AGENT_LOOKUP",
                description=f"Agent {config.agent_node_id} located MIB object '{matched.name}' = '{matched.value}'",
                packet_id=None,
                session_id=f"snmp-{config.port}",
                details=f"Syntax: {matched.syntax}, Description: {matched.description}",
            )
        )
        step_index += 1
        response_str = f"{matched.name} = {matched.value}"
        found_obj = matched
        is_error = False
    else:
        events.append(
            AppProtocolEvent(
                step_index=step_index,
                timestamp_us=curr_time_us,
                node_id=config.agent_node_id,
                protocol="SNMP",
                event_type="SNMP_UNKNOWN_OID",
                description=f"Agent {config.agent_node_id}: requested OID '{config.requested_oid}' is unknown (noSuchName / noSuchObject)",
                packet_id=None,
                session_id=f"snmp-{config.port}",
                details="Error status: noSuchName (2)",
            )
        )
        step_index += 1
        response_str = "error: noSuchName"
        found_obj = None
        is_error = True

    # 3. Agent sends GetResponse PDU back to Manager
    resp_pkt_id = "pkt-snmp-get-resp"
    status_code_str = "noSuchName" if is_error else "noError"

    resp_pkt, resp_arr_us = build_application_packet(
        resp_pkt_id,
        config.agent_node_id,
        config.manager_node_id,
        return_nodes,
        return_links,
        AppHeader(
            protocol="SNMP",
            payload_preview=f"GetResponse: {response_str}",
            message_type="GetResponse",
            session_id=f"snmp-{config.port}",
            transaction_id=101,
            resource_or_command=config.requested_oid,
            status_code=status_code_str,
        ),
        "UDP",
        config.port,
        54161,
        None,
        None,
        [],
        112,
        curr_time_us,
    )

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.agent_node_id,
            protocol="SNMP",
            event_type="SNMP_GET_RESPONSE",
            description=f"Agent dispatched GetResponse ({status_code_str}) to {config.manager_node_id}",
            packet_id=resp_pkt_id,
            session_id=f"snmp-{config.port}",
            details=f"Result payload: {response_str}",
        )
    )
    step_index += 1
    packets.append(resp_pkt)
    curr_time_us = resp_arr_us

    # 4. Manager receives response
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.manager_node_id,
            protocol="SNMP",
            event_type="SNMP_RESPONSE_RECEIVED",
            description=f"Manager received SNMP response: {'noSuchName error' if is_error else response_str}",
            packet_id=None,
            session_id=f"snmp-{config.port}",
            details=f"Round-trip time: {curr_time_us} µs",
        )
    )

    sim_events = [app_event_to_sim_event(idx + 1, ev) for idx, ev in enumerate(events)]

    state = AppProtocolState.FAILED if is_error else AppProtocolState.COMPLETED

    metrics = AppProtocolMetrics(
        transaction_duration_us=curr_time_us,
        requests_sent=1,
        responses_received=1,
        payload_bytes_sent=84,
        payload_bytes_received=112,
        success=not is_error,
        error_message=(f"OID '{config.requested_oid}' is not present in MIB (noSuchName)" if is_error else None),
    )

    return SnmpSimResult(
        config=config,
        state=state,
        found_object=found_obj,
        events=events,
        sim_events=sim_events,
        packets=packets,
        metrics=metrics,
    )
