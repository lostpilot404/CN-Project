"""Packet model with 5-layer encapsulation headers and hop history."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class PacketState(str, Enum):
    CREATED = "created"
    QUEUED = "queued"
    TRANSMITTING = "transmitting"
    IN_FLIGHT = "in_flight"
    DELIVERED = "delivered"
    DROPPED_QUEUE_FULL = "dropped_queue_full"
    DROPPED_BIT_ERROR = "dropped_bit_error"
    DROPPED_LINK_DOWN = "dropped_link_down"
    DROPPED_LINK_LOSS = "dropped_link_loss"
    DROPPED_TTL_EXPIRED = "dropped_ttl_expired"
    RETRANSMITTED = "retransmitted"

    @classmethod
    def terminal_drop_states(cls) -> tuple[PacketState, ...]:
        """States that represent a final, non-recoverable packet outcome."""
        return (
            cls.DROPPED_QUEUE_FULL,
            cls.DROPPED_BIT_ERROR,
            cls.DROPPED_LINK_DOWN,
            cls.DROPPED_LINK_LOSS,
            cls.DROPPED_TTL_EXPIRED,
        )

    def is_terminal_drop(self) -> bool:
        return self in PacketState.terminal_drop_states()


@dataclass
class AppHeader:
    protocol: str  # "HTTP", "DNS", "FTP", "SMTP", "SNMP", "RAW"
    payload_preview: str
    message_type: str | None = None
    session_id: str | None = None
    transaction_id: int | None = None
    resource_or_command: str | None = None
    status_code: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol,
            "payload_preview": self.payload_preview,
            "message_type": self.message_type,
            "session_id": self.session_id,
            "transaction_id": self.transaction_id,
            "resource_or_command": self.resource_or_command,
            "status_code": self.status_code,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AppHeader:
        return cls(
            protocol=data.get("protocol", "RAW"),
            payload_preview=data.get("payload_preview", ""),
            message_type=data.get("message_type"),
            session_id=data.get("session_id"),
            transaction_id=data.get("transaction_id"),
            resource_or_command=data.get("resource_or_command"),
            status_code=data.get("status_code"),
        )


@dataclass
class TransportHeader:
    protocol: str  # "TCP", "UDP"
    src_port: int
    dst_port: int
    seq_num: int | None = None
    ack_num: int | None = None
    window_size: int | None = None
    flags: list[str] = field(default_factory=list)
    payload_length: int | None = None
    is_retransmission: bool | None = None
    connection_state: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol,
            "src_port": self.src_port,
            "dst_port": self.dst_port,
            "seq_num": self.seq_num,
            "ack_num": self.ack_num,
            "window_size": self.window_size,
            "flags": self.flags,
            "payload_length": self.payload_length,
            "is_retransmission": self.is_retransmission,
            "connection_state": self.connection_state,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TransportHeader:
        return cls(
            protocol=data.get("protocol", "TCP"),
            src_port=int(data.get("src_port", 0)),
            dst_port=int(data.get("dst_port", 0)),
            seq_num=data.get("seq_num"),
            ack_num=data.get("ack_num"),
            window_size=data.get("window_size"),
            flags=data.get("flags", []),
            payload_length=data.get("payload_length"),
            is_retransmission=data.get("is_retransmission"),
            connection_state=data.get("connection_state"),
        )


@dataclass
class NetworkHeader:
    version: int  # 4 or 6
    src_ip: str
    dst_ip: str
    ttl: int
    protocol_num: int
    checksum: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "src_ip": self.src_ip,
            "dst_ip": self.dst_ip,
            "ttl": self.ttl,
            "protocol_num": self.protocol_num,
            "checksum": self.checksum,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> NetworkHeader:
        return cls(
            version=int(data.get("version", 4)),
            src_ip=data.get("src_ip", "0.0.0.0"),
            dst_ip=data.get("dst_ip", "0.0.0.0"),
            ttl=int(data.get("ttl", 64)),
            protocol_num=int(data.get("protocol_num", 6)),
            checksum=int(data.get("checksum", 0)),
        )


@dataclass
class DataLinkHeader:
    src_mac: str
    dst_mac: str
    ether_type: int
    crc_fcs: int
    frame_type: str | None = None
    fcs_valid: bool | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "src_mac": self.src_mac,
            "dst_mac": self.dst_mac,
            "ether_type": self.ether_type,
            "crc_fcs": self.crc_fcs,
            "frame_type": self.frame_type,
            "fcs_valid": self.fcs_valid,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DataLinkHeader:
        return cls(
            src_mac=data.get("src_mac", "00:00:00:00:00:00"),
            dst_mac=data.get("dst_mac", "00:00:00:00:00:00"),
            ether_type=int(data.get("ether_type", 0x0800)),
            crc_fcs=int(data.get("crc_fcs", 0)),
            frame_type=data.get("frame_type"),
            fcs_valid=data.get("fcs_valid"),
        )


@dataclass
class PhysicalLayerInfo:
    link_id: str | None = None
    bandwidth_bps: int | None = None
    propagation_delay_us: int | None = None
    tx_start_us: int | None = None
    tx_finish_us: int | None = None
    bit_count: int = 0
    preamble_bits: str | None = None
    signal_encoding: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "link_id": self.link_id,
            "bandwidth_bps": self.bandwidth_bps,
            "propagation_delay_us": self.propagation_delay_us,
            "tx_start_us": self.tx_start_us,
            "tx_finish_us": self.tx_finish_us,
            "bit_count": self.bit_count,
            "preamble_bits": self.preamble_bits,
            "signal_encoding": self.signal_encoding,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PhysicalLayerInfo:
        return cls(
            link_id=data.get("link_id"),
            bandwidth_bps=data.get("bandwidth_bps"),
            propagation_delay_us=data.get("propagation_delay_us"),
            tx_start_us=data.get("tx_start_us"),
            tx_finish_us=data.get("tx_finish_us"),
            bit_count=int(data.get("bit_count", 0)),
            preamble_bits=data.get("preamble_bits"),
            signal_encoding=data.get("signal_encoding"),
        )


@dataclass
class EncapsulationStack:
    application: AppHeader
    transport: TransportHeader
    network: NetworkHeader
    datalink: DataLinkHeader
    physical: PhysicalLayerInfo | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "application": self.application.to_dict(),
            "transport": self.transport.to_dict(),
            "network": self.network.to_dict(),
            "datalink": self.datalink.to_dict(),
            "physical": self.physical.to_dict() if self.physical else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EncapsulationStack:
        return cls(
            application=AppHeader.from_dict(data.get("application", {})),
            transport=TransportHeader.from_dict(data.get("transport", {})),
            network=NetworkHeader.from_dict(data.get("network", {})),
            datalink=DataLinkHeader.from_dict(data.get("datalink", {})),
            physical=PhysicalLayerInfo.from_dict(data["physical"]) if data.get("physical") else None,
        )


@dataclass
class PacketHopRecord:
    hop_index: int
    node_id: str
    link_id: str | None
    timestamp_us: int
    state: PacketState
    description: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "hop_index": self.hop_index,
            "node_id": self.node_id,
            "link_id": self.link_id,
            "timestamp_us": self.timestamp_us,
            "state": self.state.value,
            "description": self.description,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PacketHopRecord:
        st_val = data.get("state", "created")
        st = PacketState(st_val) if isinstance(st_val, str) else PacketState.CREATED
        return cls(
            hop_index=int(data.get("hop_index", 0)),
            node_id=data.get("node_id", ""),
            link_id=data.get("link_id"),
            timestamp_us=int(data.get("timestamp_us", 0)),
            state=st,
            description=data.get("description", ""),
        )


@dataclass
class Packet:
    id: str
    src_node_id: str
    dst_node_id: str
    size_bytes: int
    created_at_us: int
    current_node_id: str
    state: PacketState
    headers: EncapsulationStack
    journey_hops: list[str] = field(default_factory=list)
    next_hop_node_id: str | None = None
    planned_route: list[str] = field(default_factory=list)
    hop_history: list[PacketHopRecord] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "src_node_id": self.src_node_id,
            "dst_node_id": self.dst_node_id,
            "size_bytes": self.size_bytes,
            "created_at_us": self.created_at_us,
            "current_node_id": self.current_node_id,
            "next_hop_node_id": self.next_hop_node_id,
            "state": self.state.value,
            "headers": self.headers.to_dict(),
            "journey_hops": self.journey_hops,
            "planned_route": self.planned_route,
            "hop_history": [h.to_dict() for h in self.hop_history],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Packet:
        st_val = data.get("state", "created")
        st = PacketState(st_val) if isinstance(st_val, str) else PacketState.CREATED
        return cls(
            id=data["id"],
            src_node_id=data["src_node_id"],
            dst_node_id=data["dst_node_id"],
            size_bytes=int(data.get("size_bytes", 1000)),
            created_at_us=int(data.get("created_at_us", 0)),
            current_node_id=data.get("current_node_id", data["src_node_id"]),
            next_hop_node_id=data.get("next_hop_node_id"),
            state=st,
            headers=EncapsulationStack.from_dict(data.get("headers", {})),
            journey_hops=data.get("journey_hops", []),
            planned_route=data.get("planned_route", []),
            hop_history=[PacketHopRecord.from_dict(h) for h in data.get("hop_history", [])],
        )
