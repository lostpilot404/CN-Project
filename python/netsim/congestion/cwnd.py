from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class CongestionPhase(str, Enum):
    SLOW_START = "slow_start"
    CONGESTION_AVOIDANCE = "congestion_avoidance"
    FAST_RECOVERY = "fast_recovery"
    TIMEOUT_RECOVERY = "timeout_recovery"


@dataclass
class CwndPoint:
    timestamp_us: int
    cwnd_mss: float
    cwnd_bytes: int
    ssthresh_mss: float
    phase: CongestionPhase
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp_us": self.timestamp_us,
            "cwnd_mss": self.cwnd_mss,
            "cwnd_bytes": self.cwnd_bytes,
            "ssthresh_mss": self.ssthresh_mss,
            "phase": self.phase.value,
            "reason": self.reason,
        }


@dataclass
class CongestionController:
    cwnd_mss: float
    ssthresh_mss: float
    mss_bytes: int
    phase: CongestionPhase = CongestionPhase.SLOW_START
    duplicate_ack_count: int = 0
    timeline: list[CwndPoint] = field(default_factory=list)
    ca_accumulator: float = 0.0

    @classmethod
    def new(cls, initial_cwnd_mss: float, initial_ssthresh_mss: float, mss_bytes: int) -> CongestionController:
        cwnd = max(1.0, initial_cwnd_mss)
        ssthresh = max(2.0, initial_ssthresh_mss)
        controller = cls(
            cwnd_mss=cwnd,
            ssthresh_mss=ssthresh,
            mss_bytes=max(1, mss_bytes),
            phase=CongestionPhase.SLOW_START,
            duplicate_ack_count=0,
            timeline=[],
            ca_accumulator=0.0,
        )
        controller.record_point(0, "Initial state (Slow Start)")
        return controller

    def cwnd_bytes(self) -> int:
        return int(round(self.cwnd_mss * float(self.mss_bytes)))

    def record_point(self, timestamp_us: int, reason: str) -> None:
        self.timeline.append(
            CwndPoint(
                timestamp_us=timestamp_us,
                cwnd_mss=round(self.cwnd_mss * 1000.0) / 1000.0,
                cwnd_bytes=self.cwnd_bytes(),
                ssthresh_mss=round(self.ssthresh_mss * 1000.0) / 1000.0,
                phase=self.phase,
                reason=reason,
            )
        )

    def on_new_ack(self, timestamp_us: int, bytes_acked: int) -> None:
        self.duplicate_ack_count = 0

        if self.phase == CongestionPhase.SLOW_START:
            increment = max(1.0, float(bytes_acked) / float(self.mss_bytes))
            self.cwnd_mss += increment

            if self.cwnd_mss >= self.ssthresh_mss:
                self.phase = CongestionPhase.CONGESTION_AVOIDANCE
                self.ca_accumulator = 0.0
                self.record_point(
                    timestamp_us,
                    f"Reached ssthresh ({self.ssthresh_mss:.1f} MSS); transitioned from Slow Start to Congestion Avoidance",
                )
            else:
                self.record_point(
                    timestamp_us,
                    f"Slow Start: cwnd increased to {self.cwnd_mss:.2f} MSS",
                )
        elif self.phase == CongestionPhase.CONGESTION_AVOIDANCE:
            # RFC 5681 additive increase: cwnd += MSS * MSS / cwnd once per ACK that covers new
            # data, i.e. +1/cwnd MSS per ACK and therefore +1 MSS per round trip. The accumulator
            # only tracks when a full MSS worth of increase has been applied, so the +1 MSS
            # milestone is reported exactly once per RTT; adding it to cwnd as well would double
            # the additive-increase rate to +2 MSS per RTT.
            step = 1.0 / max(1.0, self.cwnd_mss)
            self.cwnd_mss += step
            self.ca_accumulator += step
            if self.ca_accumulator >= 1.0:
                self.ca_accumulator -= 1.0
                self.record_point(
                    timestamp_us,
                    f"Congestion Avoidance: additive increase (+1 MSS per round trip) -> cwnd is now {self.cwnd_mss:.2f} MSS",
                )
            else:
                self.record_point(
                    timestamp_us,
                    f"Congestion Avoidance: cwnd incremental update -> {self.cwnd_mss:.2f} MSS",
                )
        elif self.phase == CongestionPhase.FAST_RECOVERY:
            self.cwnd_mss = self.ssthresh_mss
            self.phase = CongestionPhase.CONGESTION_AVOIDANCE
            self.ca_accumulator = 0.0
            self.record_point(
                timestamp_us,
                f"Exited Fast Recovery: new data ACKed, cwnd deflated to ssthresh ({self.ssthresh_mss:.1f} MSS)",
            )
        elif self.phase == CongestionPhase.TIMEOUT_RECOVERY:
            self.cwnd_mss += 1.0
            if self.cwnd_mss >= self.ssthresh_mss:
                self.phase = CongestionPhase.CONGESTION_AVOIDANCE
                self.record_point(
                    timestamp_us,
                    f"Timeout Recovery: reached ssthresh ({self.ssthresh_mss:.1f} MSS) -> Congestion Avoidance",
                )
            else:
                self.phase = CongestionPhase.SLOW_START
                self.record_point(
                    timestamp_us,
                    f"Timeout Recovery: cwnd increased to {self.cwnd_mss:.2f} MSS in Slow Start",
                )

    def on_duplicate_ack(self, timestamp_us: int) -> bool:
        self.duplicate_ack_count += 1

        if self.phase == CongestionPhase.FAST_RECOVERY:
            self.cwnd_mss += 1.0
            self.record_point(
                timestamp_us,
                f"Fast Recovery: duplicate ACK #{self.duplicate_ack_count} inflated cwnd to {self.cwnd_mss:.2f} MSS",
            )
            return False

        if self.duplicate_ack_count == 3:
            self.ssthresh_mss = max(2.0, self.cwnd_mss / 2.0)
            self.cwnd_mss = self.ssthresh_mss + 3.0
            self.phase = CongestionPhase.FAST_RECOVERY
            self.record_point(
                timestamp_us,
                f"3 Duplicate ACKs received! Fast Retransmit triggered: ssthresh = {self.ssthresh_mss:.1f} MSS, cwnd = {self.cwnd_mss:.1f} MSS (Fast Recovery)",
            )
            return True
        else:
            self.record_point(
                timestamp_us,
                f"Duplicate ACK #{self.duplicate_ack_count} received",
            )
            return False

    def on_timeout(self, timestamp_us: int) -> None:
        self.ssthresh_mss = max(2.0, self.cwnd_mss / 2.0)
        self.cwnd_mss = 1.0
        self.phase = CongestionPhase.TIMEOUT_RECOVERY
        self.duplicate_ack_count = 0
        self.ca_accumulator = 0.0
        self.record_point(
            timestamp_us,
            f"RTO Timeout expired! Strong congestion response: ssthresh = {self.ssthresh_mss:.1f} MSS, cwnd = 1.0 MSS (Timeout Recovery)",
        )

    def on_packet_loss(self, timestamp_us: int, reason: str) -> None:
        self.ssthresh_mss = max(2.0, self.cwnd_mss / 2.0)
        self.cwnd_mss = self.ssthresh_mss
        self.phase = CongestionPhase.CONGESTION_AVOIDANCE
        self.duplicate_ack_count = 0
        self.ca_accumulator = 0.0
        self.record_point(
            timestamp_us,
            f"Packet loss ({reason}): multiplicative decrease -> ssthresh = {self.ssthresh_mss:.1f} MSS, cwnd = {self.cwnd_mss:.1f} MSS",
        )
