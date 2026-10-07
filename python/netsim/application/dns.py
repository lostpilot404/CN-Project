from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
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


class DnsRecordType(str, Enum):
    A = "A"
    AAAA = "AAAA"
    CNAME = "CNAME"
    MX = "MX"


@dataclass
class DnsRecord:
    name: str
    record_type: DnsRecordType
    value: str
    ttl: int
    priority: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "record_type": self.record_type.value,
            "value": self.value,
            "ttl": self.ttl,
            "priority": self.priority,
        }


class DnsQueryMode(str, Enum):
    RECURSIVE = "recursive"
    ITERATIVE = "iterative"


class DnsResponseCode(str, Enum):
    NOERROR = "NOERROR"
    NXDOMAIN = "NXDOMAIN"


@dataclass
class DnsConfig:
    client_node_id: str = "host-a"
    server_node_id: str = "dns-resolver"
    auth_server_node_id: str | None = "dns-auth"
    query_name: str = "www.example.com"
    query_type: DnsRecordType = DnsRecordType.A
    query_mode: DnsQueryMode = DnsQueryMode.RECURSIVE
    query_id: int = 1001
    custom_records: list[DnsRecord] = field(default_factory=list)
    seed: int = 42

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DnsConfig:
        q_type_str = data.get("query_type", "A")
        q_type = DnsRecordType(q_type_str) if isinstance(q_type_str, str) else q_type_str
        q_mode_str = data.get("query_mode", "recursive")
        q_mode = DnsQueryMode(q_mode_str) if isinstance(q_mode_str, str) else q_mode_str

        records: list[DnsRecord] = []
        for r in data.get("custom_records", []):
            rt = DnsRecordType(r["record_type"]) if isinstance(r["record_type"], str) else r["record_type"]
            records.append(
                DnsRecord(
                    name=r["name"],
                    record_type=rt,
                    value=r["value"],
                    ttl=int(r.get("ttl", 300)),
                    priority=r.get("priority"),
                )
            )

        return cls(
            client_node_id=data.get("client_node_id", "host-a"),
            server_node_id=data.get("server_node_id", "dns-resolver"),
            auth_server_node_id=data.get("auth_server_node_id", "dns-auth"),
            query_name=data.get("query_name", "www.example.com"),
            query_type=q_type,
            query_mode=q_mode,
            query_id=int(data.get("query_id", 1001)),
            custom_records=records,
            seed=int(data.get("seed", 42)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "client_node_id": self.client_node_id,
            "server_node_id": self.server_node_id,
            "auth_server_node_id": self.auth_server_node_id,
            "query_name": self.query_name,
            "query_type": self.query_type.value,
            "query_mode": self.query_mode.value,
            "query_id": self.query_id,
            "custom_records": [r.to_dict() for r in self.custom_records],
            "seed": self.seed,
        }


@dataclass
class DnsSimResult:
    config: DnsConfig
    state: AppProtocolState
    response_code: DnsResponseCode
    answers: list[DnsRecord]
    events: list[AppProtocolEvent]
    sim_events: list[SimEvent]
    packets: list[Packet]
    metrics: AppProtocolMetrics

    def to_dict(self) -> dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "state": self.state.value,
            "response_code": self.response_code.value,
            "answers": [a.to_dict() for a in self.answers],
            "events": [e.to_dict() for e in self.events],
            "sim_events": [se.to_dict() for se in self.sim_events],
            "packets": [p.to_dict() for p in self.packets],
            "metrics": self.metrics.to_dict(),
        }


def get_default_dns_zone() -> list[DnsRecord]:
    return [
        DnsRecord(
            name="example.com",
            record_type=DnsRecordType.A,
            value="93.184.216.34",
            ttl=300,
            priority=None,
        ),
        DnsRecord(
            name="www.example.com",
            record_type=DnsRecordType.A,
            value="93.184.216.34",
            ttl=300,
            priority=None,
        ),
        DnsRecord(
            name="ipv6.example.com",
            record_type=DnsRecordType.AAAA,
            value="2606:2800:220:1:248:1893:25c8:1946",
            ttl=300,
            priority=None,
        ),
        DnsRecord(
            name="mail.example.org",
            record_type=DnsRecordType.MX,
            value="mailhost.example.org",
            ttl=600,
            priority=10,
        ),
        DnsRecord(
            name="ftp.example.com",
            record_type=DnsRecordType.CNAME,
            value="www.example.com",
            ttl=300,
            priority=None,
        ),
    ]


def simulate_dns(config: DnsConfig, project: Project | None = None) -> DnsSimResult:
    zone = get_default_dns_zone()
    zone.extend(config.custom_records)

    events: list[AppProtocolEvent] = []
    packets: list[Packet] = []
    step_index = 0
    curr_time_us = 0

    transport_cfg = TransportConfig(
        protocol=TransportProtocol.UDP,
        source_node_id=config.client_node_id,
        destination_node_id=config.server_node_id,
        source_port=53120,
        destination_port=53,
        payload_bytes=64,
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

    # 1. Client creates and sends query
    query_pkt_id = f"pkt-dns-q-{config.query_id}"
    app_header_q = AppHeader(
        protocol="DNS",
        payload_preview=f"DNS Standard Query {config.query_id}: {config.query_type.value} {config.query_name}",
        message_type="Query",
        session_id=f"dns-{config.query_id}",
        transaction_id=config.query_id,
        resource_or_command=f"{config.query_type.value} {config.query_name}",
        status_code=None,
    )

    q_packet, arrival_time_us = build_application_packet(
        query_pkt_id,
        config.client_node_id,
        config.server_node_id,
        path_nodes,
        hop_links,
        app_header_q,
        "UDP",
        53120,
        53,
        None,
        None,
        [],
        64,
        curr_time_us,
    )

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="DNS",
            event_type="DNS_QUERY_SENT",
            description=f"Client {config.client_node_id} sent {config.query_type.value} query for '{config.query_name}' (ID: {config.query_id}) to resolver {config.server_node_id}",
            packet_id=query_pkt_id,
            session_id=f"dns-{config.query_id}",
            details=f"Mode: {config.query_mode.value}, Transmit time: {curr_time_us} µs",
        )
    )
    step_index += 1
    packets.append(q_packet)
    curr_time_us = arrival_time_us

    # 2. Server receives query and performs lookup
    curr_time_us += 50
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="DNS",
            event_type="DNS_LOOKUP",
            description=f"Resolver {config.server_node_id} inspecting local zone database for '{config.query_type.value} {config.query_name}'",
            packet_id=None,
            session_id=f"dns-{config.query_id}",
            details=f"Zone database records searched: {len(zone)}",
        )
    )
    step_index += 1

    matching_records = [
        r for r in zone if r.name.lower() == config.query_name.lower() and r.record_type == config.query_type
    ]

    if len(matching_records) > 0:
        response_code = DnsResponseCode.NOERROR
        found_records = matching_records
    else:
        if config.auth_server_node_id is not None:
            if config.query_mode == DnsQueryMode.ITERATIVE:
                events.append(
                    AppProtocolEvent(
                        step_index=step_index,
                        timestamp_us=curr_time_us + 20,
                        node_id=config.server_node_id,
                        protocol="DNS",
                        event_type="DNS_REFERRAL",
                        description=f"Resolver {config.server_node_id} referred client to authoritative DNS server {config.auth_server_node_id}",
                        packet_id=None,
                        session_id=f"dns-{config.query_id}",
                        details="Referral NS response returned in iterative step",
                    )
                )
                step_index += 1
            else:
                events.append(
                    AppProtocolEvent(
                        step_index=step_index,
                        timestamp_us=curr_time_us + 30,
                        node_id=config.server_node_id,
                        protocol="DNS",
                        event_type="DNS_RECURSIVE_FORWARD",
                        description=f"Resolver {config.server_node_id} recursively queries authoritative server {config.auth_server_node_id}",
                        packet_id=None,
                        session_id=f"dns-{config.query_id}",
                        details="Upstream authoritative query dispatched",
                    )
                )
                step_index += 1
        response_code = DnsResponseCode.NXDOMAIN
        found_records = []

    answers = list(found_records)

    # 3. Server sends DNS Response back to client
    resp_pkt_id = f"pkt-dns-r-{config.query_id}"
    status_str = "NOERROR" if response_code == DnsResponseCode.NOERROR else "NXDOMAIN"

    app_header_r = AppHeader(
        protocol="DNS",
        payload_preview=f"DNS Response {config.query_id}: {status_str} ({len(found_records)} answers)",
        message_type="Response",
        session_id=f"dns-{config.query_id}",
        transaction_id=config.query_id,
        resource_or_command=f"{config.query_type.value} {config.query_name}",
        status_code=status_str,
    )

    return_nodes = list(reversed(path_nodes))
    return_links = list(reversed(hop_links))

    r_packet, final_arrival_us = build_application_packet(
        resp_pkt_id,
        config.server_node_id,
        config.client_node_id,
        return_nodes,
        return_links,
        app_header_r,
        "UDP",
        53,
        53120,
        None,
        None,
        [],
        len(found_records) * 32 + 64,
        curr_time_us,
    )

    event_type_str = "DNS_RESPONSE_SENT" if response_code == DnsResponseCode.NOERROR else "DNS_NXDOMAIN"

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="DNS",
            event_type=event_type_str,
            description=f"DNS Server {config.server_node_id} dispatched {status_str} response with {len(found_records)} record(s) to {config.client_node_id}",
            packet_id=resp_pkt_id,
            session_id=f"dns-{config.query_id}",
            details=f"Response status: {status_str}, records returned: {found_records}",
        )
    )
    step_index += 1
    packets.append(r_packet)
    curr_time_us = final_arrival_us

    # Client receives response
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="DNS",
            event_type="DNS_RESPONSE_RECEIVED",
            description=f"Client {config.client_node_id} received DNS response (Status: {status_str}, Answers: {len(answers)})",
            packet_id=None,
            session_id=f"dns-{config.query_id}",
            details=f"Total transaction latency: {curr_time_us} µs",
        )
    )

    sim_events = [app_event_to_sim_event(idx + 1, ev) for idx, ev in enumerate(events)]

    state = AppProtocolState.COMPLETED if response_code == DnsResponseCode.NOERROR else AppProtocolState.FAILED

    metrics = AppProtocolMetrics(
        transaction_duration_us=curr_time_us,
        requests_sent=1,
        responses_received=1,
        payload_bytes_sent=64,
        payload_bytes_received=len(answers) * 32 + 64,
        success=(response_code == DnsResponseCode.NOERROR),
        error_message=(
            f"Domain '{config.query_name}' not found (NXDOMAIN)" if response_code == DnsResponseCode.NXDOMAIN else None
        ),
    )

    return DnsSimResult(
        config=config,
        state=state,
        response_code=response_code,
        answers=answers,
        events=events,
        sim_events=sim_events,
        packets=packets,
        metrics=metrics,
    )
