from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from netsim.congestion.cwnd import CwndPoint
from netsim.models.project import Project
from netsim.routing.graph import MetricType, RoutingGraph


class TransportProtocol(str, Enum):
    TCP = "tcp"
    UDP = "udp"


class ConnectionState(str, Enum):
    CLOSED = "closed"
    LISTEN = "listen"
    SYN_SENT = "syn_sent"
    SYN_RECEIVED = "syn_received"
    ESTABLISHED = "established"
    FIN_WAIT_1 = "fin_wait_1"
    FIN_WAIT_2 = "fin_wait_2"
    CLOSE_WAIT = "close_wait"
    CLOSING = "closing"
    LAST_ACK = "last_ack"
    TIME_WAIT = "time_wait"


class TcpFlag(str, Enum):
    SYN = "syn"
    ACK = "ack"
    FIN = "fin"
    RST = "rst"
    PSH = "psh"


@dataclass
class TransportSegment:
    source_port: int
    destination_port: int
    sequence_number: int
    acknowledgment_number: int
    flags: list[TcpFlag]
    payload_length: int
    advertised_window: int
    timestamp_us: int
    is_retransmission: bool = False

    def has_flag(self, flag: TcpFlag) -> bool:
        return flag in self.flags

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_port": self.source_port,
            "destination_port": self.destination_port,
            "sequence_number": self.sequence_number,
            "acknowledgment_number": self.acknowledgment_number,
            "flags": [f.value for f in self.flags],
            "payload_length": self.payload_length,
            "advertised_window": self.advertised_window,
            "timestamp_us": self.timestamp_us,
            "is_retransmission": self.is_retransmission,
        }


class TransportEventType(str, Enum):
    CONNECTION_STARTED = "connection_started"
    SYN_SENT = "syn_sent"
    SYN_RECEIVED = "syn_received"
    CONNECTION_ESTABLISHED = "connection_established"
    DATA_SEGMENT_SENT = "data_segment_sent"
    DATA_SEGMENT_RECEIVED = "data_segment_received"
    ACK_SENT = "ack_sent"
    ACK_RECEIVED = "ack_received"
    TIMEOUT = "timeout"
    RETRANSMISSION = "retransmission"
    SEGMENT_LOST = "segment_lost"
    SEGMENT_DELIVERED = "segment_delivered"
    WINDOW_UPDATED = "window_updated"
    CONGESTION_WINDOW_UPDATED = "congestion_window_updated"
    CONNECTION_CLOSED = "connection_closed"


@dataclass
class TransportEvent:
    step_index: int
    timestamp_us: int
    event_type: TransportEventType
    source_node: str
    destination_node: str
    segment: TransportSegment | None
    connection_state: ConnectionState
    cwnd_mss: float
    ssthresh_mss: float
    rtt_sample_us: int | None
    srtt_us: int
    rttvar_us: int
    rto_us: int
    description: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "timestamp_us": self.timestamp_us,
            "event_type": self.event_type.value,
            "source_node": self.source_node,
            "destination_node": self.destination_node,
            "segment": self.segment.to_dict() if self.segment else None,
            "connection_state": self.connection_state.value,
            "cwnd_mss": self.cwnd_mss,
            "ssthresh_mss": self.ssthresh_mss,
            "rtt_sample_us": self.rtt_sample_us,
            "srtt_us": self.srtt_us,
            "rttvar_us": self.rttvar_us,
            "rto_us": self.rto_us,
            "description": self.description,
        }


@dataclass
class RttEstimator:
    srtt_us: int
    rttvar_us: int
    rto_us: int
    min_rto_us: int
    max_rto_us: int
    sample_count: int = 0
    total_rtt_us: int = 0

    @classmethod
    def new(cls, initial_rto_us: int, min_rto_us: int, max_rto_us: int) -> RttEstimator:
        rto = max(min_rto_us, min(initial_rto_us, max_rto_us))
        return cls(
            srtt_us=initial_rto_us,
            rttvar_us=initial_rto_us // 2,
            rto_us=rto,
            min_rto_us=min_rto_us,
            max_rto_us=max_rto_us,
            sample_count=0,
            total_rtt_us=0,
        )

    def update_sample(self, sample_us: int) -> None:
        self.sample_count += 1
        self.total_rtt_us += sample_us

        if self.sample_count == 1:
            self.srtt_us = sample_us
            self.rttvar_us = sample_us // 2
        else:
            diff = abs(self.srtt_us - sample_us)
            self.rttvar_us = (3 * self.rttvar_us + diff) // 4
            self.srtt_us = (7 * self.srtt_us + sample_us) // 8

        raw_rto = self.srtt_us + 4 * self.rttvar_us
        self.rto_us = max(self.min_rto_us, min(raw_rto, self.max_rto_us))

    def average_rtt_us(self) -> int:
        if self.sample_count > 0:
            return self.total_rtt_us // self.sample_count
        return self.srtt_us


@dataclass
class TransportMetrics:
    segments_sent: int = 0
    segments_delivered: int = 0
    retransmissions: int = 0
    segments_lost: int = 0
    duplicate_acks: int = 0
    bytes_sent: int = 0
    bytes_delivered: int = 0
    completion_time_us: int = 0
    average_rtt_us: int = 0
    smoothed_rtt_us: int = 0
    final_rto_us: int = 0
    throughput_bits_per_sec: float = 0.0
    throughput_bytes_per_sec: float = 0.0
    goodput_bits_per_sec: float = 0.0
    packet_loss_rate: float = 0.0
    sender_window_occupancy_avg: float = 0.0
    receiver_window_occupancy_max: int = 0
    congestion_window_final: float = 0.0
    congestion_window_max: float = 0.0
    timeout_count: int = 0
    fast_retransmit_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "segments_sent": self.segments_sent,
            "segments_delivered": self.segments_delivered,
            "retransmissions": self.retransmissions,
            "segments_lost": self.segments_lost,
            "duplicate_acks": self.duplicate_acks,
            "bytes_sent": self.bytes_sent,
            "bytes_delivered": self.bytes_delivered,
            "completion_time_us": self.completion_time_us,
            "average_rtt_us": self.average_rtt_us,
            "smoothed_rtt_us": self.smoothed_rtt_us,
            "final_rto_us": self.final_rto_us,
            "throughput_bits_per_sec": self.throughput_bits_per_sec,
            "throughput_bytes_per_sec": self.throughput_bytes_per_sec,
            "goodput_bits_per_sec": self.goodput_bits_per_sec,
            "packet_loss_rate": self.packet_loss_rate,
            "sender_window_occupancy_avg": self.sender_window_occupancy_avg,
            "receiver_window_occupancy_max": self.receiver_window_occupancy_max,
            "congestion_window_final": self.congestion_window_final,
            "congestion_window_max": self.congestion_window_max,
            "timeout_count": self.timeout_count,
            "fast_retransmit_count": self.fast_retransmit_count,
        }


@dataclass
class TransportConfig:
    protocol: TransportProtocol = TransportProtocol.TCP
    source_node_id: str = "host-a"
    destination_node_id: str = "host-b"
    source_port: int = 49152
    destination_port: int = 80
    payload_bytes: int = 8000
    segment_size_bytes: int = 1000
    initial_sequence_number: int = 1000
    initial_cwnd_mss: float = 1.0
    initial_ssthresh_mss: float = 16.0
    initial_rto_us: int = 100_000
    receive_window_bytes: int = 32_000
    seed: int = 42
    dropped_segments: list[int] = field(default_factory=list)
    maximum_retries: int = 5

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TransportConfig:
        proto_str = data.get("protocol", "tcp")
        if isinstance(proto_str, TransportProtocol):
            proto = proto_str
        else:
            proto = TransportProtocol(str(proto_str).lower())
        return cls(
            protocol=proto,
            source_node_id=data.get("source_node_id", "host-a"),
            destination_node_id=data.get("destination_node_id", "host-b"),
            source_port=int(data.get("source_port", 49152)),
            destination_port=int(data.get("destination_port", 80)),
            payload_bytes=int(data.get("payload_bytes", 8000)),
            segment_size_bytes=int(data.get("segment_size_bytes", 1000)),
            initial_sequence_number=int(data.get("initial_sequence_number", 1000)),
            initial_cwnd_mss=float(data.get("initial_cwnd_mss", 1.0)),
            initial_ssthresh_mss=float(data.get("initial_ssthresh_mss", 16.0)),
            initial_rto_us=int(data.get("initial_rto_us", 100_000)),
            receive_window_bytes=int(data.get("receive_window_bytes", 32_000)),
            seed=int(data.get("seed", 42)),
            dropped_segments=list(data.get("dropped_segments", [])),
            maximum_retries=int(data.get("maximum_retries", 5)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol.value,
            "source_node_id": self.source_node_id,
            "destination_node_id": self.destination_node_id,
            "source_port": self.source_port,
            "destination_port": self.destination_port,
            "payload_bytes": self.payload_bytes,
            "segment_size_bytes": self.segment_size_bytes,
            "initial_sequence_number": self.initial_sequence_number,
            "initial_cwnd_mss": self.initial_cwnd_mss,
            "initial_ssthresh_mss": self.initial_ssthresh_mss,
            "initial_rto_us": self.initial_rto_us,
            "receive_window_bytes": self.receive_window_bytes,
            "seed": self.seed,
            "dropped_segments": self.dropped_segments,
            "maximum_retries": self.maximum_retries,
        }


@dataclass
class HopLink:
    link_id: str
    source: str
    target: str
    bandwidth_bps: int
    delay_us: int
    queue_capacity: int


@dataclass
class TransportSimResult:
    protocol: TransportProtocol
    config: TransportConfig
    derived_route: list[str]
    events: list[TransportEvent]
    cwnd_timeline: list[CwndPoint]
    metrics: TransportMetrics
    completed: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol.value,
            "config": self.config.to_dict(),
            "derived_route": self.derived_route,
            "events": [e.to_dict() for e in self.events],
            "cwnd_timeline": [p.to_dict() for p in self.cwnd_timeline],
            "metrics": self.metrics.to_dict(),
            "completed": self.completed,
        }


def resolve_route_and_links(
    config: TransportConfig,
    project: Project | None = None,
) -> tuple[list[str], list[HopLink]]:
    if project is not None:
        graph = RoutingGraph.from_project(project, MetricType.HOP_COUNT)
        path = graph.find_path(config.source_node_id, config.destination_node_id)
        if path is not None:
            path_nodes, path_edges = path
            hop_links: list[HopLink] = []
            for edge in path_edges:
                queue_cap = 50
                for lnk in project.links:
                    if lnk.id == edge.link_id:
                        queue_cap = lnk.queue_capacity
                        break
                hop_links.append(
                    HopLink(
                        link_id=edge.link_id,
                        source=edge.source,
                        target=edge.target,
                        bandwidth_bps=max(1_000_000, edge.bandwidth_bps),
                        delay_us=max(100, edge.delay_us),
                        queue_capacity=queue_cap,
                    )
                )
            return path_nodes, hop_links
        else:
            raise ValueError(
                f"Destination '{config.destination_node_id}' is unreachable from '{config.source_node_id}' across topology"
            )
    else:
        path_nodes = [
            config.source_node_id,
            "router-1",
            config.destination_node_id,
        ]
        hop_links = [
            HopLink(
                link_id="link-a-r1",
                source=config.source_node_id,
                target="router-1",
                bandwidth_bps=10_000_000,
                delay_us=10_000,
                queue_capacity=50,
            ),
            HopLink(
                link_id="link-r1-b",
                source="router-1",
                target=config.destination_node_id,
                bandwidth_bps=10_000_000,
                delay_us=10_000,
                queue_capacity=50,
            ),
        ]
        return path_nodes, hop_links
