from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from netsim.core.clock import SimTime
from netsim.core.delays import calculate_tx_delay_us
from netsim.core.events import SimEvent, SimEventType
from netsim.models.packet import (
    AppHeader,
    DataLinkHeader,
    EncapsulationStack,
    NetworkHeader,
    Packet,
    PacketHopRecord,
    PacketState,
    PhysicalLayerInfo,
    TransportHeader,
)
from netsim.transport import HopLink


class ApplicationProtocol(str, Enum):
    DNS = "DNS"
    HTTP = "HTTP"
    FTP = "FTP"
    SMTP = "SMTP"
    SNMP = "SNMP"


class AppProtocolState(str, Enum):
    IDLE = "idle"
    QUERY_SENT = "query_sent"
    LOOKUP_PROCESSING = "lookup_processing"
    RESPONSE_RECEIVED = "response_received"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    REQUEST_SENT = "request_sent"
    DATA_TRANSFERRING = "data_transferring"
    COMPLETED = "completed"
    FAILED = "failed"
    TERMINATED = "terminated"


@dataclass
class AppProtocolEvent:
    step_index: int
    timestamp_us: int
    node_id: str
    protocol: str
    event_type: str
    description: str
    packet_id: str | None = None
    session_id: str | None = None
    details: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "timestamp_us": self.timestamp_us,
            "node_id": self.node_id,
            "protocol": self.protocol,
            "event_type": self.event_type,
            "description": self.description,
            "packet_id": self.packet_id,
            "session_id": self.session_id,
            "details": self.details,
        }


@dataclass
class AppProtocolMetrics:
    transaction_duration_us: int
    requests_sent: int
    responses_received: int
    payload_bytes_sent: int
    payload_bytes_received: int
    success: bool
    error_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "transaction_duration_us": self.transaction_duration_us,
            "requests_sent": self.requests_sent,
            "responses_received": self.responses_received,
            "payload_bytes_sent": self.payload_bytes_sent,
            "payload_bytes_received": self.payload_bytes_received,
            "success": self.success,
            "error_message": self.error_message,
        }


def build_application_packet(
    packet_id: str,
    src_node: str,
    dst_node: str,
    path_nodes: list[str],
    hop_links: list[HopLink],
    app_header: AppHeader,
    transport_protocol: str,
    src_port: int,
    dst_port: int,
    seq_num: int | None,
    ack_num: int | None,
    flags: list[str],
    payload_size: int,
    start_time_us: int,
) -> tuple[Packet, int]:
    curr_time_us = start_time_us
    hop_history: list[PacketHopRecord] = []
    hop_index = 0

    hop_history.append(
        PacketHopRecord(
            hop_index=hop_index,
            node_id=src_node,
            link_id=None,
            timestamp_us=curr_time_us,
            state=PacketState.CREATED,
            description=f"{app_header.protocol} packet {packet_id} created at {src_node}",
        )
    )
    hop_index += 1

    current_node = src_node
    last_link_info = None

    for link_idx, link in enumerate(hop_links):
        is_forward = link.source == current_node
        next_node = link.target if is_forward else link.source

        hop_history.append(
            PacketHopRecord(
                hop_index=hop_index,
                node_id=current_node,
                link_id=link.link_id,
                timestamp_us=curr_time_us,
                state=PacketState.QUEUED,
                description=f"Packet {packet_id} queued for transmission onto link {link.link_id}",
            )
        )
        hop_index += 1

        tx_delay = calculate_tx_delay_us(max(64, payload_size), link.bandwidth_bps)
        prop_delay = link.delay_us

        last_link_info = PhysicalLayerInfo(
            link_id=link.link_id,
            bandwidth_bps=link.bandwidth_bps,
            propagation_delay_us=prop_delay,
            tx_start_us=curr_time_us,
            tx_finish_us=curr_time_us + tx_delay,
            bit_count=payload_size * 8,
            preamble_bits=None,
            signal_encoding=None,
        )

        hop_history.append(
            PacketHopRecord(
                hop_index=hop_index,
                node_id=current_node,
                link_id=link.link_id,
                timestamp_us=curr_time_us,
                state=PacketState.TRANSMITTING,
                description=f"Packet {packet_id} transmission started on link {link.link_id}",
            )
        )
        hop_index += 1

        curr_time_us += tx_delay

        hop_history.append(
            PacketHopRecord(
                hop_index=hop_index,
                node_id=current_node,
                link_id=link.link_id,
                timestamp_us=curr_time_us,
                state=PacketState.IN_FLIGHT,
                description=f"Packet {packet_id} completed transmission onto link {link.link_id}, in-flight",
            )
        )
        hop_index += 1

        curr_time_us += prop_delay

        is_last_hop = link_idx == len(hop_links) - 1
        arrival_state = PacketState.DELIVERED if is_last_hop else PacketState.IN_FLIGHT

        hop_history.append(
            PacketHopRecord(
                hop_index=hop_index,
                node_id=next_node,
                link_id=link.link_id,
                timestamp_us=curr_time_us,
                state=arrival_state,
                description=(
                    f"Packet {packet_id} delivered to destination {next_node}"
                    if is_last_hop
                    else f"Packet {packet_id} arrived at intermediate router {next_node}"
                ),
            )
        )
        hop_index += 1

        current_node = next_node

    packet = Packet(
        id=packet_id,
        src_node_id=src_node,
        dst_node_id=dst_node,
        size_bytes=payload_size,
        created_at_us=start_time_us,
        current_node_id=dst_node,
        next_hop_node_id=None,
        state=PacketState.DELIVERED,
        headers=EncapsulationStack(
            application=app_header,
            transport=TransportHeader(
                protocol=transport_protocol,
                src_port=src_port,
                dst_port=dst_port,
                seq_num=seq_num,
                ack_num=ack_num,
                window_size=65535 if transport_protocol == "TCP" else None,
                flags=flags,
                payload_length=payload_size,
                is_retransmission=False,
                connection_state="established" if transport_protocol == "TCP" else None,
            ),
            network=NetworkHeader(
                version=4,
                src_ip=f"10.0.0.{len(src_node) + 1}",
                dst_ip=f"10.0.0.{len(dst_node) + 10}",
                ttl=64,
                protocol_num=6 if transport_protocol == "TCP" else 17,
                checksum=0x4F12,
            ),
            datalink=DataLinkHeader(
                src_mac="02:00:00:00:00:01",
                dst_mac="02:00:00:00:00:02",
                ether_type=0x0800,
                crc_fcs=0x89ABCDEF,
                frame_type="Ethernet II",
                fcs_valid=True,
            ),
            physical=last_link_info,
        ),
        journey_hops=list(path_nodes),
        planned_route=list(path_nodes),
        hop_history=hop_history,
    )

    return packet, curr_time_us


def app_event_to_sim_event(event_id: int, ev: AppProtocolEvent) -> SimEvent:
    return SimEvent(
        id=event_id,
        timestamp=SimTime.from_micros(ev.timestamp_us),
        event_type=SimEventType.APPLICATION_EVENT,
        description=ev.description,
        packet_id=ev.packet_id,
        node_id=ev.node_id,
        link_id=None,
        layer="Application",
        protocol=ev.protocol,
    )
