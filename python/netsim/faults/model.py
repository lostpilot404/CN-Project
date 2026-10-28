"""Runtime fault injection model definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from netsim.core.schema import require_int


@dataclass
class RouteChangeRecord:
    source_node_id: str
    destination_node_id: str
    before_path: list[str] | None
    after_path: list[str] | None
    reachable_before: bool
    reachable_after: bool
    affected_links: list[str]
    fault_id: str
    timestamp_us: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_node_id": self.source_node_id,
            "destination_node_id": self.destination_node_id,
            "before_path": self.before_path,
            "after_path": self.after_path,
            "reachable_before": self.reachable_before,
            "reachable_after": self.reachable_after,
            "affected_links": self.affected_links,
            "fault_id": self.fault_id,
            "timestamp_us": self.timestamp_us,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RouteChangeRecord:
        return cls(
            source_node_id=data["source_node_id"],
            destination_node_id=data["destination_node_id"],
            before_path=data.get("before_path"),
            after_path=data.get("after_path"),
            reachable_before=bool(data.get("reachable_before", False)),
            reachable_after=bool(data.get("reachable_after", False)),
            affected_links=data.get("affected_links", []),
            fault_id=data.get("fault_id", ""),
            timestamp_us=int(data.get("timestamp_us", 0)),
        )


@dataclass
class FaultType:
    type: str
    link_id: str | None = None
    node_id: str | None = None
    new_bandwidth_bps: int | None = None
    new_capacity: int | None = None
    error_rate: float | None = None
    packet_id: str | None = None
    drop_probability: float | None = None

    def is_link_down(self) -> bool:
        return self.type == "link_down"

    def is_link_restore(self) -> bool:
        return self.type == "link_restore"

    def is_bandwidth_degradation(self) -> bool:
        return self.type == "bandwidth_degradation"

    def is_queue_capacity_change(self) -> bool:
        return self.type == "queue_capacity_change"

    def is_node_failure(self) -> bool:
        return self.type == "node_failure"

    def is_node_recovery(self) -> bool:
        return self.type == "node_recovery"

    def is_packet_drop(self) -> bool:
        return self.type == "packet_drop"

    def is_bit_error(self) -> bool:
        return self.type == "bit_error"

    @classmethod
    def link_down(cls, link_id: str) -> FaultType:
        return cls(type="link_down", link_id=link_id)

    @classmethod
    def link_restore(cls, link_id: str) -> FaultType:
        return cls(type="link_restore", link_id=link_id)

    @classmethod
    def bandwidth_degradation(cls, link_id: str, new_bandwidth_bps: int) -> FaultType:
        return cls(type="bandwidth_degradation", link_id=link_id, new_bandwidth_bps=new_bandwidth_bps)

    @classmethod
    def queue_capacity_change(cls, link_id: str, new_capacity: int) -> FaultType:
        return cls(type="queue_capacity_change", link_id=link_id, new_capacity=new_capacity)

    @classmethod
    def node_failure(cls, node_id: str) -> FaultType:
        return cls(type="node_failure", node_id=node_id)

    @classmethod
    def node_recovery(cls, node_id: str) -> FaultType:
        return cls(type="node_recovery", node_id=node_id)

    @classmethod
    def packet_drop(cls, packet_id: str = "", drop_probability: float = 1.0) -> FaultType:
        return cls(type="packet_drop", packet_id=packet_id, drop_probability=drop_probability)

    @classmethod
    def bit_error(cls, link_id: str, error_rate: float) -> FaultType:
        return cls(type="bit_error", link_id=link_id, error_rate=error_rate)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type}
        if self.link_id is not None:
            d["link_id"] = self.link_id
        if self.node_id is not None:
            d["node_id"] = self.node_id
        if self.new_bandwidth_bps is not None:
            d["new_bandwidth_bps"] = self.new_bandwidth_bps
        if self.new_capacity is not None:
            d["new_capacity"] = self.new_capacity
        if self.error_rate is not None:
            d["error_rate"] = self.error_rate
        if self.packet_id is not None:
            d["packet_id"] = self.packet_id
        if self.drop_probability is not None:
            d["drop_probability"] = self.drop_probability
        return d

    KNOWN_TYPES = (
        "link_down",
        "link_restore",
        "bandwidth_degradation",
        "queue_capacity_change",
        "node_failure",
        "node_recovery",
        "packet_drop",
        "bit_error",
    )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FaultType:
        if "type" not in data:
            raise ValueError(f"Fault type is required. Expected one of: {', '.join(cls.KNOWN_TYPES)}")
        fault_type = str(data["type"])
        if fault_type not in cls.KNOWN_TYPES:
            raise ValueError(f"Unknown fault type '{fault_type}'. Expected one of: {', '.join(cls.KNOWN_TYPES)}")
        return cls(
            type=fault_type,
            link_id=data.get("link_id"),
            node_id=data.get("node_id"),
            new_bandwidth_bps=data.get("new_bandwidth_bps"),
            new_capacity=data.get("new_capacity"),
            error_rate=data.get("error_rate"),
            packet_id=data.get("packet_id"),
            drop_probability=data.get("drop_probability"),
        )


@dataclass
class FaultScheduleEntry:
    fault_id: str
    timestamp_us: int
    fault_type: FaultType
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "fault_id": self.fault_id,
            "timestamp_us": self.timestamp_us,
            "fault_type": self.fault_type.to_dict() if hasattr(self.fault_type, "to_dict") else self.fault_type,
            "description": self.description,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FaultScheduleEntry:
        ft_raw = data.get("fault_type", {})
        if not isinstance(ft_raw, dict):
            # A bare string such as "link_down" used to slip through and crash target
            # validation with AttributeError (HTTP 500). Reject it as a client error with
            # guidance toward the documented object shape.
            raise ValueError(
                "fault_type must be an object like "
                f"{{'type': 'link_down', 'link_id': ...}} (received {type(ft_raw).__name__})"
            )
        ft = FaultType.from_dict(ft_raw)
        return cls(
            fault_id=data["fault_id"],
            timestamp_us=require_int(data.get("timestamp_us", 0), "fault timestamp_us", minimum=0),
            fault_type=ft,
            description=data.get("description", ""),
        )


@dataclass
class FaultSchedule:
    entries: list[FaultScheduleEntry] = field(default_factory=list)

    def sorted_entries(self) -> list[FaultScheduleEntry]:
        return sorted(self.entries, key=lambda e: e.timestamp_us)

    def to_dict(self) -> dict[str, Any]:
        return {"entries": [e.to_dict() for e in self.entries]}

    @classmethod
    def from_dict(cls, data: dict[str, Any] | list[Any]) -> FaultSchedule:
        """Deserialise a fault schedule from ``{"entries": [...]}`` or a bare entry list."""
        if isinstance(data, list):
            raw_entries = data
        elif isinstance(data, dict):
            raw_entries = data.get("entries", [])
        else:
            raise ValueError("Fault schedule must be an object with an 'entries' list")
        if not isinstance(raw_entries, list):
            raise ValueError("Fault schedule 'entries' must be a list")
        entries: list[FaultScheduleEntry] = []
        for index, raw in enumerate(raw_entries):
            if not isinstance(raw, dict):
                raise ValueError(f"Fault schedule entry {index} must be an object")
            fault_id = raw.get("fault_id") or f"fault-{index + 1}"
            entry = FaultScheduleEntry.from_dict({**raw, "fault_id": fault_id})
            entries.append(entry)
        return cls(entries=entries)


def fault_target_id(ft: FaultType | dict[str, Any]) -> str:
    if isinstance(ft, FaultType):
        if ft.link_id:
            return ft.link_id
        if ft.node_id:
            return ft.node_id
        if ft.packet_id:
            return ft.packet_id
        return ""
    ft_type = ft.get("type", "")
    if ft_type in ("link_down", "link_restore", "bandwidth_degradation", "queue_capacity_change", "bit_error"):
        return ft.get("link_id", "")
    elif ft_type in ("node_failure", "node_recovery"):
        return ft.get("node_id", "")
    elif ft_type == "packet_drop":
        return ft.get("packet_id", "")
    return ""


def fault_type_label(ft: FaultType | dict[str, Any]) -> str:
    if isinstance(ft, FaultType):
        if ft.type == "bandwidth_degradation":
            return f"bandwidth_degradation:{ft.new_bandwidth_bps or 0}"
        elif ft.type == "queue_capacity_change":
            return f"queue_capacity_change:{ft.new_capacity or 0}"
        elif ft.type == "bit_error":
            return f"bit_error:{ft.error_rate or 0.0:.6f}"
        return ft.type
    ft_type = ft.get("type", "")
    if ft_type == "bandwidth_degradation":
        return f"bandwidth_degradation:{ft.get('new_bandwidth_bps', 0)}"
    elif ft_type == "queue_capacity_change":
        return f"queue_capacity_change:{ft.get('new_capacity', 0)}"
    elif ft_type == "bit_error":
        rate = ft.get("error_rate", 0.0)
        return f"bit_error:{rate:.6f}"
    return ft_type
