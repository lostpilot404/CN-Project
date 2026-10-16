"""Simulation metrics accumulator and safe ratios."""

from dataclasses import dataclass
from typing import Any


@dataclass
class SimulationMetrics:
    packets_created: int = 0
    packets_delivered: int = 0
    packets_dropped_overflow: int = 0
    packets_dropped_loss: int = 0
    packets_dropped_error: int = 0
    packets_dropped_link_down: int = 0
    packets_dropped_ttl: int = 0
    packets_dropped_no_route: int = 0
    bytes_transmitted: int = 0
    bytes_delivered: int = 0
    total_latency_us: int = 0
    min_latency_us: int | None = None
    max_latency_us: int | None = None

    def record_created(self, size_bytes: int) -> None:
        self.packets_created += 1

    def record_tx(self, size_bytes: int) -> None:
        self.bytes_transmitted += size_bytes

    def record_delivered(self, size_bytes: int, latency_us: int) -> None:
        self.packets_delivered += 1
        self.bytes_delivered += size_bytes
        self.total_latency_us += latency_us

        if self.min_latency_us is None:
            self.min_latency_us = latency_us
        else:
            self.min_latency_us = min(self.min_latency_us, latency_us)

        if self.max_latency_us is None:
            self.max_latency_us = latency_us
        else:
            self.max_latency_us = max(self.max_latency_us, latency_us)

    def record_dropped_overflow(self) -> None:
        self.packets_dropped_overflow += 1

    def record_dropped_loss(self) -> None:
        self.packets_dropped_loss += 1

    def record_dropped_error(self) -> None:
        self.packets_dropped_error += 1

    def record_dropped_link_down(self) -> None:
        self.packets_dropped_link_down += 1

    def record_dropped_ttl(self) -> None:
        self.packets_dropped_ttl += 1

    def record_dropped_no_route(self) -> None:
        self.packets_dropped_no_route += 1

    def total_dropped(self) -> int:
        return (
            self.packets_dropped_overflow
            + self.packets_dropped_loss
            + self.packets_dropped_error
            + self.packets_dropped_link_down
            + self.packets_dropped_ttl
            + self.packets_dropped_no_route
        )

    def delivery_ratio(self) -> float:
        if self.packets_created == 0:
            return 0.0
        return self.packets_delivered / float(self.packets_created)

    def loss_ratio(self) -> float:
        if self.packets_created == 0:
            return 0.0
        return self.total_dropped() / float(self.packets_created)

    def avg_latency_ms(self) -> float:
        if self.packets_delivered == 0:
            return 0.0
        return (self.total_latency_us / float(self.packets_delivered)) / 1_000.0

    def throughput_bps(self, elapsed_sim_time_us: int) -> float:
        if elapsed_sim_time_us <= 0:
            return 0.0
        return (self.bytes_delivered * 8.0 * 1_000_000.0) / float(elapsed_sim_time_us)

    def reset(self) -> None:
        self.packets_created = 0
        self.packets_delivered = 0
        self.packets_dropped_overflow = 0
        self.packets_dropped_loss = 0
        self.packets_dropped_error = 0
        self.packets_dropped_link_down = 0
        self.packets_dropped_ttl = 0
        self.packets_dropped_no_route = 0
        self.bytes_transmitted = 0
        self.bytes_delivered = 0
        self.total_latency_us = 0
        self.min_latency_us = None
        self.max_latency_us = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "packets_created": self.packets_created,
            "packets_delivered": self.packets_delivered,
            "packets_dropped_overflow": self.packets_dropped_overflow,
            "packets_dropped_loss": self.packets_dropped_loss,
            "packets_dropped_error": self.packets_dropped_error,
            "packets_dropped_link_down": self.packets_dropped_link_down,
            "packets_dropped_ttl": self.packets_dropped_ttl,
            "packets_dropped_no_route": self.packets_dropped_no_route,
            "bytes_transmitted": self.bytes_transmitted,
            "bytes_delivered": self.bytes_delivered,
            "total_latency_us": self.total_latency_us,
            "min_latency_us": self.min_latency_us,
            "max_latency_us": self.max_latency_us,
        }
