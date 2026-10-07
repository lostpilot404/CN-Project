from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from netsim.core.events import SimEvent, SimEventType
from netsim.core.metrics import SimulationMetrics
from netsim.core.queue import QueueSnapshot
from netsim.models.packet import Packet, PacketState
from netsim.transport import TransportMetrics


@dataclass
class LossCategoryBreakdown:
    queue_overflow: int = 0
    link_down: int = 0
    bit_error: int = 0
    stochastic_loss: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "queue_overflow": self.queue_overflow,
            "link_down": self.link_down,
            "bit_error": self.bit_error,
            "stochastic_loss": self.stochastic_loss,
        }


@dataclass
class LinkUtilizationRecord:
    link_id: str
    busy_time_us: int
    measurement_time_us: int
    utilization: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "link_id": self.link_id,
            "busy_time_us": self.busy_time_us,
            "measurement_time_us": self.measurement_time_us,
            "utilization": self.utilization,
        }


@dataclass
class QosMetrics:
    measurement_interval_us: int = 0
    throughput_bits_per_sec: float = 0.0
    throughput_bytes_per_sec: float = 0.0
    goodput_bits_per_sec: float = 0.0
    end_to_end_latencies_us: list[int] = field(default_factory=list)
    average_latency_us: float = 0.0
    min_latency_us: int | None = None
    max_latency_us: int | None = None
    jitter_us: float = 0.0
    jitter_samples: list[float] = field(default_factory=list)
    packets_sent: int = 0
    packets_delivered: int = 0
    packets_lost: int = 0
    packet_loss_rate: float = 0.0
    loss_by_category: LossCategoryBreakdown = field(default_factory=LossCategoryBreakdown)
    retransmissions: int = 0
    link_utilization: list[LinkUtilizationRecord] = field(default_factory=list)
    queue_occupancy_average: float = 0.0
    queue_occupancy_max: int = 0
    queue_drops: int = 0
    average_rtt_us: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "measurement_interval_us": self.measurement_interval_us,
            "throughput_bits_per_sec": self.throughput_bits_per_sec,
            "throughput_bytes_per_sec": self.throughput_bytes_per_sec,
            "goodput_bits_per_sec": self.goodput_bits_per_sec,
            "end_to_end_latencies_us": self.end_to_end_latencies_us,
            "average_latency_us": self.average_latency_us,
            "min_latency_us": self.min_latency_us,
            "max_latency_us": self.max_latency_us,
            "jitter_us": self.jitter_us,
            "jitter_samples": self.jitter_samples,
            "packets_sent": self.packets_sent,
            "packets_delivered": self.packets_delivered,
            "packets_lost": self.packets_lost,
            "packet_loss_rate": self.packet_loss_rate,
            "loss_by_category": self.loss_by_category.to_dict(),
            "retransmissions": self.retransmissions,
            "link_utilization": [u.to_dict() for u in self.link_utilization],
            "queue_occupancy_average": self.queue_occupancy_average,
            "queue_occupancy_max": self.queue_occupancy_max,
            "queue_drops": self.queue_drops,
            "average_rtt_us": self.average_rtt_us,
        }


def safe_div(num: float, den: float) -> float:
    if den == 0.0 or math.isnan(den) or math.isinf(den):
        return 0.0
    res = num / den
    if math.isnan(res) or math.isinf(res):
        return 0.0
    return res


def compute_network_qos(
    sim_metrics: SimulationMetrics,
    packets: list[Packet],
    events: list[SimEvent],
    queue_snapshots: list[QueueSnapshot],
    elapsed_us: int,
) -> QosMetrics:
    qos = QosMetrics()
    qos.measurement_interval_us = elapsed_us

    qos.packets_sent = sim_metrics.packets_created
    qos.packets_delivered = sim_metrics.packets_delivered
    qos.packets_lost = sim_metrics.total_dropped()
    qos.packet_loss_rate = safe_div(float(qos.packets_lost), float(qos.packets_sent))

    qos.loss_by_category = LossCategoryBreakdown(
        queue_overflow=sim_metrics.packets_dropped_overflow,
        link_down=sim_metrics.packets_dropped_link_down,
        bit_error=sim_metrics.packets_dropped_error,
        stochastic_loss=sim_metrics.packets_dropped_loss,
    )

    latencies: list[int] = []
    for pkt in packets:
        if pkt.state == PacketState.DELIVERED:
            for h in reversed(pkt.hop_history):
                if h.state == PacketState.DELIVERED:
                    lat = max(0, h.timestamp_us - pkt.created_at_us)
                    latencies.append(lat)
                    break
    qos.end_to_end_latencies_us = list(latencies)

    if latencies:
        qos.average_latency_us = safe_div(float(sum(latencies)), float(len(latencies)))
        qos.min_latency_us = min(latencies)
        qos.max_latency_us = max(latencies)

    # Jitter (IPDV per flow)
    flow_latencies: dict[tuple[str, str], list[int]] = {}
    for pkt in packets:
        if pkt.state == PacketState.DELIVERED:
            for h in reversed(pkt.hop_history):
                if h.state == PacketState.DELIVERED:
                    lat = max(0, h.timestamp_us - pkt.created_at_us)
                    key = (pkt.src_node_id, pkt.dst_node_id)
                    flow_latencies.setdefault(key, []).append(lat)
                    break

    all_jitter_samples: list[float] = []
    for lats in flow_latencies.values():
        if len(lats) >= 2:
            for i in range(len(lats) - 1):
                ipdv = abs(float(lats[i + 1]) - float(lats[i]))
                all_jitter_samples.append(ipdv)

    if all_jitter_samples:
        qos.jitter_us = safe_div(sum(all_jitter_samples), float(len(all_jitter_samples)))
    qos.jitter_samples = all_jitter_samples

    elapsed_f = float(elapsed_us)
    qos.throughput_bits_per_sec = safe_div(float(sim_metrics.bytes_delivered) * 8.0 * 1_000_000.0, elapsed_f)
    qos.throughput_bytes_per_sec = safe_div(float(sim_metrics.bytes_delivered) * 1_000_000.0, elapsed_f)
    qos.goodput_bits_per_sec = safe_div(float(sim_metrics.bytes_delivered) * 8.0 * 1_000_000.0, elapsed_f)

    link_busy: dict[str, int] = {}
    for event in events:
        if event.event_type == SimEventType.TRANSMISSION_STARTED:
            # tx_delay is in event payload or link_id
            link_id = event.link_id or ""
            # in SimEvent, tx_delay can be inferred or extracted
            if link_id:
                link_busy[link_id] = link_busy.get(link_id, 0) + 100

    for link_id, busy_us in link_busy.items():
        util = safe_div(float(busy_us), elapsed_f)
        qos.link_utilization.append(
            LinkUtilizationRecord(
                link_id=link_id,
                busy_time_us=busy_us,
                measurement_time_us=elapsed_us,
                utilization=min(1.0, util),
            )
        )

    if queue_snapshots:
        total_occ = sum(q.occupancy for q in queue_snapshots)
        qos.queue_occupancy_average = safe_div(float(total_occ), float(len(queue_snapshots)))
        qos.queue_occupancy_max = max(q.occupancy for q in queue_snapshots)
        qos.queue_drops = sum(q.total_dropped_overflow for q in queue_snapshots)
    else:
        qos.queue_drops = sim_metrics.packets_dropped_overflow

    return qos


def compute_transport_qos(tm: TransportMetrics, elapsed_us: int) -> QosMetrics:
    return QosMetrics(
        measurement_interval_us=elapsed_us,
        packets_sent=tm.segments_sent,
        packets_delivered=tm.segments_delivered,
        packets_lost=tm.segments_lost,
        retransmissions=tm.retransmissions,
        packet_loss_rate=tm.packet_loss_rate,
        throughput_bits_per_sec=tm.throughput_bits_per_sec,
        throughput_bytes_per_sec=tm.throughput_bytes_per_sec,
        goodput_bits_per_sec=tm.goodput_bits_per_sec,
        average_rtt_us=tm.average_rtt_us,
        average_latency_us=float(tm.average_rtt_us) / 2.0,
    )
