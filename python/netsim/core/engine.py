"""Discrete-event network simulation engine."""

from __future__ import annotations

import heapq
from enum import Enum
from typing import Any

from ..faults.model import fault_target_id, fault_type_label
from ..models.link import Link, LinkStatus
from ..models.packet import (
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
from .clock import SimTime
from .delays import calculate_arrival_time_us, calculate_tx_delay_us
from .events import SimEvent
from .metrics import SimulationMetrics
from .queue import LinkQueue
from .rng import DeterministicRng


class SimulationStatus(str, Enum):
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"


class SimulationEngine:
    def __init__(self, seed: int):
        self.current_time = SimTime.zero()
        self.event_queue: list[SimEvent] = []
        self.processed_events: list[SimEvent] = []
        self.link_queues: dict[str, LinkQueue] = {}
        self.packets: dict[str, Packet] = {}
        self.metrics = SimulationMetrics()
        self.status = SimulationStatus.READY
        self.rng = DeterministicRng(seed)
        self.next_event_id = 1
        self.next_packet_id = 1
        self.links_cache: dict[str, Link] = {}
        self.pending_faults: dict[str, dict[str, Any]] = {}
        self.node_pre_fault_link_states: dict[str, dict[str, LinkStatus]] = {}
        self.failed_nodes: set[str] = set()

    def schedule_fault(self, fault_id: str, timestamp_us: int, fault_type: Any) -> None:
        target_id = fault_target_id(fault_type)
        ft_label = fault_type_label(fault_type)
        self.pending_faults[fault_id] = fault_type
        self.schedule_event(
            SimTime.from_micros(timestamp_us),
            "fault_injected",
            {
                "target_id": target_id,
                "fault_type": f"{ft_label}:{fault_id}",
            },
            f"Fault '{fault_id}' scheduled at {timestamp_us} µs",
        )

    def all_packets(self) -> list[Packet]:
        return list(self.packets.values())

    def update_links(self, links: list[Link]) -> None:
        self.links_cache.clear()
        current_ids = {lnk.id for lnk in links}
        self.link_queues = {k: v for k, v in self.link_queues.items() if k in current_ids}
        for link in links:
            self.links_cache[link.id] = link
            if link.id not in self.link_queues:
                self.link_queues[link.id] = LinkQueue(link.id, link.queue_capacity)

    def schedule_event(
        self,
        timestamp: SimTime,
        event_type_name: str,
        event_data: dict[str, Any],
        description: str,
    ) -> None:
        event_id = self.next_event_id
        self.next_event_id += 1
        event = SimEvent.create(
            id=event_id,
            timestamp=timestamp,
            event_type_name=event_type_name,
            event_data=event_data,
            description=description,
        )
        heapq.heappush(self.event_queue, event)

    def inject_packet(
        self,
        src_node_id: str,
        dst_node_id: str,
        size_bytes: int,
        app_protocol: str,
        transport_protocol: str,
    ) -> str:
        packet_id = f"pkt-{self.next_packet_id}"
        self.next_packet_id += 1

        link = self._find_link_for_packet(src_node_id, dst_node_id)
        if link:
            target = link.target.node_id if link.source.node_id == src_node_id else link.source.node_id
            if target == dst_node_id:
                planned_route = [src_node_id, dst_node_id]
            else:
                planned_route = [src_node_id, target, dst_node_id]
        else:
            planned_route = [src_node_id, dst_node_id]

        initial_hop = PacketHopRecord(
            hop_index=0,
            node_id=src_node_id,
            link_id=None,
            timestamp_us=self.current_time.as_micros(),
            state=PacketState.CREATED,
            description=f"Packet {packet_id} created at node {src_node_id}",
        )

        packet = Packet(
            id=packet_id,
            src_node_id=src_node_id,
            dst_node_id=dst_node_id,
            size_bytes=size_bytes,
            created_at_us=self.current_time.as_micros(),
            current_node_id=src_node_id,
            next_hop_node_id=None,
            state=PacketState.CREATED,
            headers=EncapsulationStack(
                application=AppHeader(
                    protocol=app_protocol,
                    payload_preview=f"Data payload ({size_bytes} bytes)",
                    message_type=f"{app_protocol} Data",
                    session_id=None,
                    transaction_id=None,
                    resource_or_command=None,
                    status_code=None,
                ),
                transport=TransportHeader(
                    protocol=transport_protocol,
                    src_port=49152,
                    dst_port=80 if app_protocol == "HTTP" else 53,
                    seq_num=100,
                    ack_num=None,
                    window_size=65535,
                    flags=["ACK"] if transport_protocol == "TCP" else [],
                    payload_length=size_bytes,
                    is_retransmission=False,
                    connection_state="ESTABLISHED" if transport_protocol == "TCP" else None,
                ),
                network=NetworkHeader(
                    version=4,
                    src_ip=f"192.168.1.{self.next_packet_id + 10}",
                    dst_ip="10.0.0.100",
                    ttl=64,
                    protocol_num=6 if transport_protocol == "TCP" else 17,
                    checksum=0xA4F2,
                ),
                datalink=DataLinkHeader(
                    src_mac="02:00:00:00:00:01",
                    dst_mac="02:00:00:00:00:02",
                    ether_type=0x0800,
                    crc_fcs=0x3BC1A920,
                    frame_type="Ethernet II (DIX)",
                    fcs_valid=True,
                ),
                physical=PhysicalLayerInfo(
                    link_id=None,
                    bandwidth_bps=None,
                    propagation_delay_us=None,
                    tx_start_us=None,
                    tx_finish_us=None,
                    bit_count=size_bytes * 8,
                    preamble_bits=None,
                    signal_encoding=None,
                ),
            ),
            journey_hops=[src_node_id],
            planned_route=planned_route,
            hop_history=[initial_hop],
        )

        self.packets[packet_id] = packet
        self.metrics.record_created(size_bytes)

        self.schedule_event(
            self.current_time,
            "packet_created",
            {
                "packet_id": packet_id,
                "node_id": src_node_id,
                "size_bytes": size_bytes,
            },
            f"Packet {packet_id} ({size_bytes} bytes, {app_protocol}/{transport_protocol}) generated at node {src_node_id}",
        )

        if link:
            link_id = link.id
            entry_time = self.current_time.add_micros(5)
            queue_cap = link.queue_capacity

            self.schedule_event(
                entry_time,
                "queue_entered",
                {
                    "packet_id": packet_id,
                    "link_id": link_id,
                    "queue_occupancy": self._get_queue_occupancy(link_id),
                    "queue_capacity": queue_cap,
                },
                f"Packet {packet_id} entered queue for link {link_id}",
            )
        else:
            self.schedule_event(
                self.current_time.add_micros(10),
                "packet_dropped",
                {
                    "packet_id": packet_id,
                    "reason": "No route or link available from node",
                    "location_id": src_node_id,
                },
                f"Packet {packet_id} dropped: no link found",
            )

        return packet_id

    def _find_link_for_packet(self, src_node_id: str, dst_node_id: str) -> Link | None:
        for link in self.links_cache.values():
            if (link.source.node_id == src_node_id and link.target.node_id == dst_node_id) or (
                link.target.node_id == src_node_id and link.source.node_id == dst_node_id
            ):
                return link
        for link in self.links_cache.values():
            if link.source.node_id == src_node_id or link.target.node_id == src_node_id:
                return link
        return None

    def _get_queue_occupancy(self, link_id: str) -> int:
        q = self.link_queues.get(link_id)
        return q.occupancy() if q else 0

    def step(self) -> SimEvent | None:
        if self.event_queue:
            event = heapq.heappop(self.event_queue)
            self.current_time = event.timestamp
            self._process_event(event)
            self.processed_events.append(event)

            if not self.event_queue:
                self.status = SimulationStatus.COMPLETED
            else:
                self.status = SimulationStatus.PAUSED
            return event
        else:
            self.status = SimulationStatus.COMPLETED
            return None

    def run_until(self, target_time: SimTime) -> int:
        count = 0
        self.status = SimulationStatus.RUNNING
        while self.event_queue:
            peek_event = self.event_queue[0]
            if peek_event.timestamp > target_time:
                break
            if self.step() is not None:
                count += 1
        if not self.event_queue:
            self.status = SimulationStatus.COMPLETED
        else:
            self.status = SimulationStatus.PAUSED
        return count

    def run_all(self) -> int:
        count = 0
        self.status = SimulationStatus.RUNNING
        while self.step() is not None:
            count += 1
        self.status = SimulationStatus.COMPLETED
        return count

    def pause(self) -> None:
        if self.status == SimulationStatus.RUNNING:
            self.status = SimulationStatus.PAUSED

    def _process_event(self, event: SimEvent) -> None:
        evt_type = event.event_type.get("type")
        evt_data = event.event_type.get("data", {})

        if evt_type == "packet_created":
            pass
        elif evt_type == "queue_entered":
            packet_id = evt_data.get("packet_id", "")
            link_id = evt_data.get("link_id", "")
            link = self.links_cache.get(link_id)
            if link:
                if link.status != LinkStatus.UP:
                    pkt = self.packets.get(packet_id)
                    if pkt:
                        pkt.state = PacketState.DROPPED_LINK_DOWN
                        hop_idx = len(pkt.hop_history)
                        pkt.hop_history.append(
                            PacketHopRecord(
                                hop_index=hop_idx,
                                node_id=pkt.current_node_id,
                                link_id=link_id,
                                timestamp_us=self.current_time.as_micros(),
                                state=PacketState.DROPPED_LINK_DOWN,
                                description=f"Packet {packet_id} dropped: link {link_id} is down",
                            )
                        )
                    self.metrics.record_dropped_link_down()
                    self.schedule_event(
                        self.current_time,
                        "packet_dropped",
                        {
                            "packet_id": packet_id,
                            "reason": "Link status is down",
                            "location_id": link_id,
                        },
                        f"Packet {packet_id} dropped: link {link_id} is down",
                    )
                    return

                queue = self.link_queues.setdefault(link_id, LinkQueue(link_id, link.queue_capacity))
                try:
                    queue.enqueue(packet_id)
                    pkt = self.packets.get(packet_id)
                    if pkt:
                        pkt.state = PacketState.QUEUED
                        hop_idx = len(pkt.hop_history)
                        pkt.hop_history.append(
                            PacketHopRecord(
                                hop_index=hop_idx,
                                node_id=pkt.current_node_id,
                                link_id=link_id,
                                timestamp_us=self.current_time.as_micros(),
                                state=PacketState.QUEUED,
                                description=f"Packet {packet_id} entered queue for link {link_id}",
                            )
                        )
                    if not queue.is_transmitting:
                        self._trigger_link_transmission(link_id)
                except Exception:
                    # Drop-Tail
                    pkt = self.packets.get(packet_id)
                    if pkt:
                        pkt.state = PacketState.DROPPED_QUEUE_FULL
                        hop_idx = len(pkt.hop_history)
                        pkt.hop_history.append(
                            PacketHopRecord(
                                hop_index=hop_idx,
                                node_id=pkt.current_node_id,
                                link_id=link_id,
                                timestamp_us=self.current_time.as_micros(),
                                state=PacketState.DROPPED_QUEUE_FULL,
                                description=f"Packet {packet_id} dropped: queue for link {link_id} is full ({link.queue_capacity}/{link.queue_capacity})",
                            )
                        )
                    self.metrics.record_dropped_overflow()
                    self.schedule_event(
                        self.current_time,
                        "packet_dropped",
                        {
                            "packet_id": packet_id,
                            "reason": "Queue capacity exceeded (Drop-Tail)",
                            "location_id": link_id,
                        },
                        f"Packet {packet_id} dropped: queue for link {link_id} is full ({link.queue_capacity}/{link.queue_capacity})",
                    )

        elif evt_type == "transmission_started":
            pass
        elif evt_type == "transmission_finished":
            packet_id = evt_data.get("packet_id", "")
            link_id = evt_data.get("link_id", "")
            queue = self.link_queues.get(link_id)
            if queue:
                queue.is_transmitting = False
            pkt = self.packets.get(packet_id)
            if pkt:
                if pkt.state not in (
                    PacketState.DROPPED_BIT_ERROR,
                    PacketState.DROPPED_LINK_DOWN,
                    PacketState.DROPPED_QUEUE_FULL,
                ):
                    pkt.state = PacketState.IN_FLIGHT
                    hop_idx = len(pkt.hop_history)
                    pkt.hop_history.append(
                        PacketHopRecord(
                            hop_index=hop_idx,
                            node_id=pkt.current_node_id,
                            link_id=link_id,
                            timestamp_us=self.current_time.as_micros(),
                            state=PacketState.IN_FLIGHT,
                            description=f"Packet {packet_id} completed transmission onto link {link_id}, in-flight",
                        )
                    )
            self._trigger_link_transmission(link_id)

        elif evt_type == "packet_arrived":
            packet_id = evt_data.get("packet_id", "")
            node_id = evt_data.get("node_id", "")
            pkt = self.packets.get(packet_id)
            if pkt and pkt.state in (
                PacketState.DROPPED_BIT_ERROR,
                PacketState.DROPPED_LINK_DOWN,
                PacketState.DROPPED_QUEUE_FULL,
            ):
                return

            size_bytes = pkt.size_bytes if pkt else 0
            created_at_us = pkt.created_at_us if pkt else 0
            latency_us = max(0, self.current_time.as_micros() - created_at_us)
            dst_node_id = pkt.dst_node_id if pkt else ""
            is_final = (node_id == dst_node_id) or not dst_node_id

            if pkt:
                pkt.current_node_id = node_id
                pkt.journey_hops.append(node_id)
                hop_idx = len(pkt.hop_history)
                pkt.hop_history.append(
                    PacketHopRecord(
                        hop_index=hop_idx,
                        node_id=node_id,
                        link_id=None,
                        timestamp_us=self.current_time.as_micros(),
                        state=PacketState.DELIVERED if is_final else PacketState.IN_FLIGHT,
                        description=(
                            f"Packet {packet_id} delivered to destination {node_id}"
                            if is_final
                            else f"Packet {packet_id} arrived at transit node {node_id}"
                        ),
                    )
                )

            if is_final:
                if pkt:
                    pkt.state = PacketState.DELIVERED
                self.metrics.record_delivered(size_bytes, latency_us)
            else:
                prev_node = None
                if pkt and len(pkt.journey_hops) >= 2:
                    prev_node = pkt.journey_hops[-2]

                next_link = None
                for lnk in self.links_cache.values():
                    if (lnk.source.node_id == node_id and lnk.target.node_id != prev_node) or (
                        lnk.target.node_id == node_id and lnk.source.node_id != prev_node
                    ):
                        next_link = lnk
                        break

                if next_link:
                    link_id = next_link.id
                    queue_cap = next_link.queue_capacity
                    occ = self._get_queue_occupancy(link_id)
                    self.schedule_event(
                        self.current_time.add_micros(1),
                        "queue_entered",
                        {
                            "packet_id": packet_id,
                            "link_id": link_id,
                            "queue_occupancy": occ,
                            "queue_capacity": queue_cap,
                        },
                        f"Packet {packet_id} forwarding: entered queue for link {link_id}",
                    )
                else:
                    if pkt:
                        pkt.state = PacketState.DELIVERED
                    self.metrics.record_delivered(size_bytes, latency_us)

        elif evt_type == "packet_dropped":
            packet_id = evt_data.get("packet_id", "")
            reason = evt_data.get("reason", "")
            location_id = evt_data.get("location_id", "")
            pkt = self.packets.get(packet_id)
            if pkt:
                if pkt.state not in (
                    PacketState.DROPPED_QUEUE_FULL,
                    PacketState.DROPPED_LINK_DOWN,
                    PacketState.DROPPED_BIT_ERROR,
                ):
                    pkt.state = PacketState.DROPPED_BIT_ERROR
                hop_idx = len(pkt.hop_history)
                pkt.hop_history.append(
                    PacketHopRecord(
                        hop_index=hop_idx,
                        node_id=pkt.current_node_id,
                        link_id=location_id,
                        timestamp_us=self.current_time.as_micros(),
                        state=pkt.state,
                        description=f"Packet {packet_id} dropped: {reason}",
                    )
                )

        elif evt_type == "fault_injected":
            ft_str = evt_data.get("fault_type", "")
            if ":" in ft_str:
                fault_id = ft_str.rsplit(":", 1)[-1]
                fault = self.pending_faults.pop(fault_id, None)
                if fault:
                    self._execute_fault(fault)

    def _trigger_link_transmission(self, link_id: str) -> None:
        queue = self.link_queues.get(link_id)
        if not queue or queue.is_transmitting:
            return
        next_pkt_id = queue.dequeue()
        if not next_pkt_id:
            return
        queue.is_transmitting = True

        link = self.links_cache.get(link_id)
        if not link:
            return

        pkt = self.packets.get(next_pkt_id)
        size_bytes = pkt.size_bytes if pkt else 1000
        tx_delay_us = calculate_tx_delay_us(size_bytes, link.bandwidth_bps)

        if pkt:
            pkt.state = PacketState.TRANSMITTING
            hop_idx = len(pkt.hop_history)
            pkt.hop_history.append(
                PacketHopRecord(
                    hop_index=hop_idx,
                    node_id=pkt.current_node_id,
                    link_id=link_id,
                    timestamp_us=self.current_time.as_micros(),
                    state=PacketState.TRANSMITTING,
                    description=f"Packet {next_pkt_id} began transmission on link {link_id} (tx_delay: {tx_delay_us} µs)",
                )
            )
            if pkt.headers.physical:
                pkt.headers.physical.link_id = link_id
                pkt.headers.physical.bandwidth_bps = link.bandwidth_bps
                pkt.headers.physical.propagation_delay_us = link.propagation_delay_us
                pkt.headers.physical.tx_start_us = self.current_time.as_micros()
                pkt.headers.physical.tx_finish_us = self.current_time.add_micros(tx_delay_us).as_micros()

        self.metrics.record_tx(size_bytes)

        # 1. Transmission Started
        self.schedule_event(
            self.current_time,
            "transmission_started",
            {
                "packet_id": next_pkt_id,
                "link_id": link_id,
                "tx_delay_us": tx_delay_us,
            },
            f"Packet {next_pkt_id} began transmission on link {link_id} (tx_delay: {tx_delay_us} µs)",
        )

        # 2. Transmission Finished
        tx_end_time = self.current_time.add_micros(tx_delay_us)
        self.schedule_event(
            tx_end_time,
            "transmission_finished",
            {
                "packet_id": next_pkt_id,
                "link_id": link_id,
            },
            f"Packet {next_pkt_id} completed transmission onto link {link_id}",
        )

        # 3. Propagation & Arrival or Loss
        arrival_time_us = calculate_arrival_time_us(
            self.current_time.as_micros(),
            tx_delay_us,
            link.propagation_delay_us,
        )
        arrival_time = SimTime.from_micros(arrival_time_us)

        is_lost = self.rng.gen_bool(link.loss_probability)
        is_bit_error = self.rng.gen_bool(link.bit_error_rate)

        if is_lost:
            self.metrics.record_dropped_loss()
            self.schedule_event(
                arrival_time,
                "packet_dropped",
                {
                    "packet_id": next_pkt_id,
                    "reason": "Stochastic packet loss on link",
                    "location_id": link_id,
                },
                f"Packet {next_pkt_id} dropped in transit on link {link_id} (loss rate: {link.loss_probability * 100.0:.1f}%)",
            )
        elif is_bit_error:
            self.metrics.record_dropped_error()
            self.schedule_event(
                arrival_time,
                "packet_dropped",
                {
                    "packet_id": next_pkt_id,
                    "reason": "CRC FCS frame check error (bit corruption)",
                    "location_id": link_id,
                },
                f"Packet {next_pkt_id} corrupted by bit errors on link {link_id}",
            )
        else:
            if pkt:
                target_node = link.target.node_id if pkt.current_node_id == link.source.node_id else link.source.node_id
            else:
                target_node = link.target.node_id

            self.schedule_event(
                arrival_time,
                "packet_arrived",
                {
                    "packet_id": next_pkt_id,
                    "node_id": target_node,
                    "link_id": link_id,
                },
                f"Packet {next_pkt_id} arrived at node {target_node} via link {link_id}",
            )

    def _execute_fault(self, fault: Any) -> None:
        if hasattr(fault, "to_dict"):
            fault_data = fault.to_dict()
        elif isinstance(fault, dict):
            fault_data = fault
        else:
            fault_data = {}
        ft = fault_data.get("type")
        if ft == "link_down":
            link = self.links_cache.get(fault_data.get("link_id", ""))
            if link:
                link.status = LinkStatus.DOWN
        elif ft == "link_restore":
            link = self.links_cache.get(fault_data.get("link_id", ""))
            if link:
                link.status = LinkStatus.UP
        elif ft == "bandwidth_degradation":
            link = self.links_cache.get(fault_data.get("link_id", ""))
            if link:
                link.bandwidth_bps = int(fault_data.get("new_bandwidth_bps", link.bandwidth_bps))
        elif ft == "queue_capacity_change":
            link = self.links_cache.get(fault_data.get("link_id", ""))
            new_cap = int(fault_data.get("new_capacity", 50))
            if link:
                link.queue_capacity = new_cap
            queue = self.link_queues.get(fault_data.get("link_id", ""))
            if queue:
                queue.capacity = max(1, new_cap)
        elif ft == "node_failure":
            node_id = fault_data.get("node_id", "")
            saved = {}
            for link in self.links_cache.values():
                if link.source.node_id == node_id or link.target.node_id == node_id:
                    saved[link.id] = link.status
                    link.status = LinkStatus.DOWN
            self.node_pre_fault_link_states[node_id] = saved
            self.failed_nodes.add(node_id)
        elif ft == "node_recovery":
            node_id = fault_data.get("node_id", "")
            self.failed_nodes.discard(node_id)
            saved = self.node_pre_fault_link_states.pop(node_id, None)
            if saved:
                for lid, status in saved.items():
                    link = self.links_cache.get(lid)
                    if link:
                        link.status = status
            else:
                for link in self.links_cache.values():
                    if (
                        link.source.node_id == node_id or link.target.node_id == node_id
                    ) and link.status == LinkStatus.DOWN:
                        link.status = LinkStatus.UP
        elif ft == "packet_drop":
            pkt_id = fault_data.get("packet_id", "")
            pkt = self.packets.get(pkt_id)
            if pkt and pkt.state not in (
                PacketState.DELIVERED,
                PacketState.DROPPED_QUEUE_FULL,
                PacketState.DROPPED_BIT_ERROR,
                PacketState.DROPPED_LINK_DOWN,
            ):
                pkt.state = PacketState.DROPPED_BIT_ERROR
                hop_idx = len(pkt.hop_history)
                pkt.hop_history.append(
                    PacketHopRecord(
                        hop_index=hop_idx,
                        node_id=pkt.current_node_id,
                        link_id=None,
                        timestamp_us=self.current_time.as_micros(),
                        state=PacketState.DROPPED_BIT_ERROR,
                        description=f"Packet {pkt_id} dropped by fault injection",
                    )
                )
                self.metrics.record_dropped_loss()
        elif ft == "bit_error":
            link = self.links_cache.get(fault_data.get("link_id", ""))
            if link:
                link.bit_error_rate = float(fault_data.get("error_rate", link.bit_error_rate))

    def reset(self, seed: int | None = None) -> None:
        self.current_time = SimTime.zero()
        self.event_queue.clear()
        self.processed_events.clear()
        self.packets.clear()
        for q in self.link_queues.values():
            q.reset()
        self.metrics.reset()
        self.status = SimulationStatus.READY
        if seed is not None:
            self.rng.reseed(seed)
        self.next_event_id = 1
        self.next_packet_id = 1
        self.pending_faults.clear()
        self.node_pre_fault_link_states.clear()
        self.failed_nodes.clear()

    def get_snapshot(self) -> dict[str, Any]:
        recent = [e.to_dict() for e in reversed(self.processed_events[-50:])]
        queues = [q.get_snapshot().to_dict() for q in self.link_queues.values()]
        packets_list = sorted(self.packets.values(), key=lambda p: p.created_at_us)
        return {
            "current_time_us": self.current_time.as_micros(),
            "status": self.status.value,
            "pending_events_count": len(self.event_queue),
            "processed_events_count": len(self.processed_events),
            "recent_events": recent,
            "metrics": self.metrics.to_dict(),
            "queues": queues,
            "packets": [p.to_dict() for p in packets_list],
        }

    get_state_snapshot = get_snapshot
