"""Network link model and endpoint specifications."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class LinkStatus(str, Enum):
    UP = "up"
    DOWN = "down"
    DEGRADED = "degraded"


@dataclass
class LinkEndpoint:
    node_id: str
    interface_id: str

    def to_dict(self) -> dict[str, str]:
        return {
            "node_id": self.node_id,
            "interface_id": self.interface_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LinkEndpoint:
        return cls(
            node_id=data["node_id"],
            interface_id=data["interface_id"],
        )


@dataclass
class Link:
    id: str
    source: LinkEndpoint
    target: LinkEndpoint
    bandwidth_bps: int = 10_000_000
    propagation_delay_us: int = 10_000
    loss_probability: float = 0.0
    bit_error_rate: float = 0.0
    queue_capacity: int = 50
    status: LinkStatus = LinkStatus.UP

    def __init__(
        self,
        id: str,
        source: LinkEndpoint,
        target: LinkEndpoint,
        bandwidth_bps: int = 10_000_000,
        propagation_delay_us: int = 10_000,
        loss_probability: float = 0.0,
        bit_error_rate: float = 0.0,
        queue_capacity: int = 50,
        status: LinkStatus = LinkStatus.UP,
        packet_loss_rate: float | None = None,
    ):
        if packet_loss_rate is not None:
            loss_probability = packet_loss_rate
        self.id = id
        self.source = source
        self.target = target
        self.bandwidth_bps = bandwidth_bps
        self.propagation_delay_us = propagation_delay_us
        self.loss_probability = loss_probability
        self.bit_error_rate = bit_error_rate
        self.queue_capacity = queue_capacity
        self.status = status

    @property
    def packet_loss_rate(self) -> float:
        return self.loss_probability

    @packet_loss_rate.setter
    def packet_loss_rate(self, value: float) -> None:
        self.loss_probability = value

    def validate(self) -> None:
        if self.bandwidth_bps <= 0:
            raise ValueError("Link bandwidth must be greater than 0 bps")
        if not (0.0 <= self.loss_probability <= 1.0):
            raise ValueError("Link loss probability must be between 0.0 and 1.0")
        if not (0.0 <= self.bit_error_rate <= 1.0):
            raise ValueError("Link bit error rate must be between 0.0 and 1.0")
        if self.queue_capacity < 1:
            raise ValueError("Link queue capacity must be at least 1 packet")
        if self.source.node_id == self.target.node_id:
            raise ValueError("Cannot connect a node to itself")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source.to_dict(),
            "target": self.target.to_dict(),
            "bandwidth_bps": self.bandwidth_bps,
            "propagation_delay_us": self.propagation_delay_us,
            "loss_probability": self.loss_probability,
            "bit_error_rate": self.bit_error_rate,
            "queue_capacity": self.queue_capacity,
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Link:
        st_val = data.get("status", "up")
        st = LinkStatus(st_val) if isinstance(st_val, str) else LinkStatus.UP
        return cls(
            id=data["id"],
            source=LinkEndpoint.from_dict(data["source"]),
            target=LinkEndpoint.from_dict(data["target"]),
            bandwidth_bps=int(data.get("bandwidth_bps", 10_000_000)),
            propagation_delay_us=int(data.get("propagation_delay_us", 10_000)),
            loss_probability=float(data.get("loss_probability", 0.0)),
            bit_error_rate=float(data.get("bit_error_rate", 0.0)),
            queue_capacity=int(data.get("queue_capacity", 50)),
            status=st,
        )
