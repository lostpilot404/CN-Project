"""Simulation discrete-event model and event types."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from functools import total_ordering
from typing import Any

from .clock import SimTime


class SimEventType(str, Enum):
    PACKET_CREATED = "packet_created"
    QUEUE_ENTERED = "queue_entered"
    TRANSMISSION_STARTED = "transmission_started"
    TRANSMISSION_FINISHED = "transmission_finished"
    PACKET_ARRIVED = "packet_arrived"
    PACKET_DROPPED = "packet_dropped"
    FAULT_INJECTED = "fault_injected"
    APPLICATION_EVENT = "application_event"
    ROUTE_UPDATED = "route_updated"
    TIMER_EXPIRED = "timer_expired"


@total_ordering
@dataclass
class SimEvent:
    id: int
    timestamp: SimTime
    event_type: dict[str, Any]
    description: str
    packet_id: str | None = None
    node_id: str | None = None
    link_id: str | None = None
    layer: str | None = None
    protocol: str | None = None

    @classmethod
    def create(
        cls,
        id: int,
        timestamp: SimTime,
        event_type_name: str,
        event_data: dict[str, Any],
        description: str,
    ) -> SimEvent:
        event_type = {"type": event_type_name, "data": event_data}
        packet_id = None
        node_id = None
        link_id = None
        layer = None
        protocol = None

        if event_type_name == "packet_created":
            packet_id = event_data.get("packet_id")
            node_id = event_data.get("node_id")
            layer = "Application"
            protocol = "Application"
        elif event_type_name == "queue_entered":
            packet_id = event_data.get("packet_id")
            link_id = event_data.get("link_id")
            layer = "Data Link"
            protocol = "Ethernet"
        elif event_type_name == "transmission_started" or event_type_name == "transmission_finished":
            packet_id = event_data.get("packet_id")
            link_id = event_data.get("link_id")
            layer = "Physical"
            protocol = "Bitstream"
        elif event_type_name == "packet_arrived":
            packet_id = event_data.get("packet_id")
            node_id = event_data.get("node_id")
            link_id = event_data.get("link_id")
            layer = "Network"
            protocol = "IPv4"
        elif event_type_name == "packet_dropped":
            packet_id = event_data.get("packet_id")
            link_id = event_data.get("location_id")
            layer = "Network"
        elif event_type_name == "ack_received" or event_type_name == "timeout" or event_type_name == "retransmission":
            packet_id = event_data.get("packet_id")
            layer = "Transport"
            protocol = "TCP"
        elif event_type_name == "route_updated":
            node_id = event_data.get("node_id")
            layer = "Network"
            protocol = "Routing"
        elif event_type_name == "fault_injected":
            node_id = event_data.get("target_id")
            layer = "Physical"
        elif event_type_name == "application_event":
            packet_id = event_data.get("packet_id")
            node_id = event_data.get("node_id")
            layer = "Application"
            protocol = event_data.get("protocol")

        return cls(
            id=id,
            timestamp=timestamp,
            event_type=event_type,
            description=description,
            packet_id=packet_id,
            node_id=node_id,
            link_id=link_id,
            layer=layer,
            protocol=protocol,
        )

    def __lt__(self, other: SimEvent) -> bool:
        if self.timestamp.as_micros() != other.timestamp.as_micros():
            return self.timestamp.as_micros() < other.timestamp.as_micros()
        return self.id < other.id

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, SimEvent):
            return False
        return self.timestamp.as_micros() == other.timestamp.as_micros() and self.id == other.id

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp.as_micros(),
            "event_type": self.event_type,
            "description": self.description,
            "packet_id": self.packet_id,
            "node_id": self.node_id,
            "link_id": self.link_id,
            "layer": self.layer,
            "protocol": self.protocol,
        }
