"""Network node model and default interface generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .interface import Interface


class NodeType(str, Enum):
    PC = "pc"
    HOST = "pc"
    SERVER = "server"
    ROUTER = "router"
    SWITCH = "switch"
    ACCESS_POINT = "access_point"
    GENERIC = "generic"


class NodeState(str, Enum):
    UP = "up"
    DOWN = "down"
    DEGRADED = "degraded"


@dataclass
class Position:
    x: float
    y: float

    def to_dict(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Position:
        return cls(x=float(data.get("x", 0.0)), y=float(data.get("y", 0.0)))


@dataclass
class Node:
    id: str
    label: str
    node_type: NodeType
    position: Position
    interfaces: list[Interface] = field(default_factory=list)
    state: NodeState = NodeState.UP

    @classmethod
    def create(cls, id: str, label: str, node_type: NodeType, x: float = 0.0, y: float = 0.0) -> Node:
        return cls(id=id, label=label, node_type=node_type, position=Position(x=x, y=y))

    def __post_init__(self) -> None:
        if not self.interfaces:
            self.interfaces = self.generate_default_interfaces()

    def generate_default_interfaces(self) -> list[Interface]:
        # 32-bit FNV-style fold: h = (h * 31 + byte) mod 2**32, matching the documented
        # interface-naming hash so generated MAC/interface ids stay stable across runs.
        h = 0
        for b in self.id.encode("utf-8"):
            h = ((h * 31) + b) & 0xFFFFFFFF
        mac_prefix = f"{(h >> 8) & 0xFF:02x}:{h & 0xFF:02x}"
        h_low = h & 0xFF

        if self.node_type == NodeType.PC:
            iface = Interface(
                id=f"{self.id}-eth0",
                name="eth0",
                node_id=self.id,
                mac_address=f"02:00:00:01:{mac_prefix}",
                ipv4="192.168.1.10",
                subnet_mask="255.255.255.0",
            )
            return [iface]
        elif self.node_type == NodeType.SERVER:
            iface = Interface(
                id=f"{self.id}-eth0",
                name="eth0",
                node_id=self.id,
                mac_address=f"02:00:00:02:{mac_prefix}",
                ipv4="10.0.0.100",
                subnet_mask="255.255.255.0",
            )
            return [iface]
        elif self.node_type == NodeType.ROUTER:
            res = []
            for i in range(4):
                iface = Interface(
                    id=f"{self.id}-eth{i}",
                    name=f"eth{i}",
                    node_id=self.id,
                    mac_address=f"02:00:00:03:{h_low:02x}:{i:02x}",
                    ipv4=f"10.{i}.1.1",
                    subnet_mask="255.255.255.0",
                )
                res.append(iface)
            return res
        elif self.node_type == NodeType.SWITCH:
            res = []
            for i in range(1, 9):
                iface = Interface(
                    id=f"{self.id}-port{i}",
                    name=f"port{i}",
                    node_id=self.id,
                    mac_address=f"02:00:00:04:{h_low:02x}:{i:02x}",
                )
                res.append(iface)
            return res
        elif self.node_type == NodeType.ACCESS_POINT:
            return [
                Interface(
                    id=f"{self.id}-eth0",
                    name="eth0",
                    node_id=self.id,
                    mac_address=f"02:00:00:05:{h_low:02x}:01",
                ),
                Interface(
                    id=f"{self.id}-wlan0",
                    name="wlan0",
                    node_id=self.id,
                    mac_address=f"02:00:00:05:{h_low:02x}:02",
                ),
            ]
        else:  # Generic
            return [
                Interface(
                    id=f"{self.id}-eth0",
                    name="eth0",
                    node_id=self.id,
                    mac_address=f"02:00:00:06:{h_low:02x}:01",
                ),
                Interface(
                    id=f"{self.id}-eth1",
                    name="eth1",
                    node_id=self.id,
                    mac_address=f"02:00:00:06:{h_low:02x}:02",
                ),
            ]

    def first_free_interface(self) -> Interface | None:
        for iface in self.interfaces:
            if iface.link_id is None:
                return iface
        return None

    def attach_link(self, interface_id: str, link_id: str) -> None:
        for iface in self.interfaces:
            if iface.id == interface_id or iface.name == interface_id:
                if iface.link_id is not None and iface.link_id != link_id:
                    raise ValueError(
                        f"Interface '{interface_id}' on node '{self.id}' is already connected to link '{iface.link_id}'"
                    )
                iface.link_id = link_id
                return
        raise ValueError(f"Interface '{interface_id}' not found on node '{self.id}'")

    def detach_link(self, link_id: str) -> None:
        for iface in self.interfaces:
            if iface.link_id == link_id:
                iface.link_id = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "node_type": self.node_type.value,
            "position": self.position.to_dict(),
            "interfaces": [i.to_dict() for i in self.interfaces],
            "state": self.state.value,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Node:
        nt = NodeType(data.get("node_type", "generic"))
        st = NodeState(data.get("state", "up"))
        pos = Position.from_dict(data.get("position", {"x": 0.0, "y": 0.0}))
        ifaces = [Interface.from_dict(i) for i in data.get("interfaces", [])]
        node = cls(
            id=data["id"],
            label=data.get("label", data["id"]),
            node_type=nt,
            position=pos,
            interfaces=ifaces,
            state=st,
        )
        return node
