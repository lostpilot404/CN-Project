"""Routing table data structures."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class RouteTableEntry:
    destination: str
    destination_label: str
    next_hop: str | None
    interface_id: str | None
    metric: int
    path: list[str]
    is_reachable: bool
    protocol: str

    @property
    def cost(self) -> int:
        return self.metric

    @property
    def next_hop_node_id(self) -> str | None:
        return self.next_hop

    def to_dict(self) -> dict[str, Any]:
        return {
            "destination": self.destination,
            "destination_label": self.destination_label,
            "next_hop": self.next_hop,
            "interface_id": self.interface_id,
            "metric": self.metric,
            "path": self.path,
            "is_reachable": self.is_reachable,
            "protocol": self.protocol,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RouteTableEntry:
        return cls(
            destination=data["destination"],
            destination_label=data.get("destination_label", data["destination"]),
            next_hop=data.get("next_hop"),
            interface_id=data.get("interface_id"),
            metric=int(data.get("metric", 0)),
            path=data.get("path", []),
            is_reachable=bool(data.get("is_reachable", False)),
            protocol=data.get("protocol", "Direct"),
        )


@dataclass
class RoutingTable:
    node_id: str
    node_label: str
    algorithm: str
    metric_type: str
    entries: list[RouteTableEntry]

    def get_route(self, destination: str) -> RouteTableEntry | None:
        for e in self.entries:
            if e.destination == destination:
                return e
        return None

    def find_route(self, destination: str) -> RouteTableEntry | None:
        return self.get_route(destination)

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "node_label": self.node_label,
            "algorithm": self.algorithm,
            "metric_type": self.metric_type,
            "entries": [e.to_dict() for e in self.entries],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RoutingTable:
        return cls(
            node_id=data["node_id"],
            node_label=data.get("node_label", data["node_id"]),
            algorithm=data.get("algorithm", "Dijkstra"),
            metric_type=data.get("metric_type", "HopCount"),
            entries=[RouteTableEntry.from_dict(e) for e in data.get("entries", [])],
        )
