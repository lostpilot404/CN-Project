"""Link buffer queue model implementing Drop-Tail FIFO queueing."""

from collections import deque
from dataclasses import dataclass
from typing import Any


class QueueFullError(Exception):
    """Raised when queue capacity is exceeded (Drop-Tail)."""


@dataclass(slots=True)
class QueueSnapshot:
    link_id: str
    occupancy: int
    capacity: int
    is_transmitting: bool
    total_enqueued: int
    total_dropped_overflow: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "link_id": self.link_id,
            "occupancy": self.occupancy,
            "capacity": self.capacity,
            "is_transmitting": self.is_transmitting,
            "total_enqueued": self.total_enqueued,
            "total_dropped_overflow": self.total_dropped_overflow,
        }


class LinkQueue:
    def __init__(self, link_id: str, capacity: int):
        self.link_id = link_id
        self.capacity = max(1, capacity)
        self.buffer: deque[str] = deque()
        self.is_transmitting = False
        self.total_enqueued = 0
        self.total_dropped_overflow = 0

    def enqueue(self, packet_id: str) -> None:
        """Enqueue packet ID. If full, increments drop counter and raises QueueFullError."""
        if len(self.buffer) >= self.capacity:
            self.total_dropped_overflow += 1
            raise QueueFullError("Queue capacity exceeded (Drop-Tail)")
        self.buffer.append(packet_id)
        self.total_enqueued += 1

    def dequeue(self) -> str | None:
        """Dequeues the head packet ID in FIFO order."""
        if self.buffer:
            return self.buffer.popleft()
        return None

    def peek(self) -> str | None:
        if self.buffer:
            return self.buffer[0]
        return None

    def occupancy(self) -> int:
        return len(self.buffer)

    def is_empty(self) -> bool:
        return len(self.buffer) == 0

    def reset(self) -> None:
        self.buffer.clear()
        self.is_transmitting = False
        self.total_enqueued = 0
        self.total_dropped_overflow = 0

    def get_snapshot(self) -> QueueSnapshot:
        return QueueSnapshot(
            link_id=self.link_id,
            occupancy=len(self.buffer),
            capacity=self.capacity,
            is_transmitting=self.is_transmitting,
            total_enqueued=self.total_enqueued,
            total_dropped_overflow=self.total_dropped_overflow,
        )
