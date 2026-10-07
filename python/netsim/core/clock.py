"""Simulation virtual time in microseconds (µs).
Independent from wall-clock time.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import total_ordering


@total_ordering
@dataclass(frozen=True, slots=True)
class SimTime:
    micros: int = 0

    @classmethod
    def zero(cls) -> SimTime:
        return cls(0)

    def __call__(self) -> SimTime:
        return self

    @classmethod
    def from_micros(cls, us: int) -> SimTime:
        return cls(max(0, int(us)))

    @classmethod
    def from_millis(cls, ms: int) -> SimTime:
        return cls(max(0, int(ms)) * 1_000)

    def as_micros(self) -> int:
        return self.micros

    def as_millis(self) -> float:
        return self.micros / 1_000.0

    def as_secs(self) -> float:
        return self.micros / 1_000_000.0

    def add_micros(self, us: int) -> SimTime:
        return SimTime(self.micros + max(0, int(us)))

    def __add__(self, other: int | SimTime) -> SimTime:
        if isinstance(other, SimTime):
            return SimTime(self.micros + other.micros)
        return self.add_micros(other)

    def __sub__(self, other: SimTime) -> int:
        return self.micros - other.micros

    def __lt__(self, other: SimTime) -> bool:
        return self.micros < other.micros

    def __str__(self) -> str:
        return f"{self.as_millis():.3f} ms"
