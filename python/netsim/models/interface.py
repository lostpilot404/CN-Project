"""Network interface model."""

from dataclasses import dataclass
from enum import Enum
from typing import Any


class InterfaceStatus(str, Enum):
    UP = "up"
    DOWN = "down"


@dataclass
class Interface:
    id: str
    name: str
    node_id: str
    mac_address: str
    ipv4: str | None = None
    subnet_mask: str | None = None
    ipv6: str | None = None
    link_id: str | None = None
    status: InterfaceStatus = InterfaceStatus.UP

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "node_id": self.node_id,
            "mac_address": self.mac_address,
            "ipv4": self.ipv4,
            "subnet_mask": self.subnet_mask,
            "ipv6": self.ipv6,
            "link_id": self.link_id,
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Interface":
        status_val = data.get("status", "up")
        status = InterfaceStatus(status_val) if isinstance(status_val, str) else InterfaceStatus.UP
        return cls(
            id=data["id"],
            name=data["name"],
            node_id=data.get("node_id", ""),
            mac_address=data.get("mac_address", ""),
            ipv4=data.get("ipv4"),
            subnet_mask=data.get("subnet_mask"),
            ipv6=data.get("ipv6"),
            link_id=data.get("link_id"),
            status=status,
        )
