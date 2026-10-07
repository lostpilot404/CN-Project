from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from netsim.qos.metrics import QosMetrics


@dataclass
class AggregatedQos:
    run_count: int = 0
    mean_throughput_bps: float = 0.0
    mean_goodput_bps: float = 0.0
    mean_latency_us: float = 0.0
    min_latency_us: int | None = None
    max_latency_us: int | None = None
    mean_jitter_us: float = 0.0
    mean_loss_rate: float = 0.0
    mean_retransmissions: float = 0.0
    stddev_latency_us: float = 0.0
    stddev_throughput_bps: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_count": self.run_count,
            "mean_throughput_bps": self.mean_throughput_bps,
            "mean_goodput_bps": self.mean_goodput_bps,
            "mean_latency_us": self.mean_latency_us,
            "min_latency_us": self.min_latency_us,
            "max_latency_us": self.max_latency_us,
            "mean_jitter_us": self.mean_jitter_us,
            "mean_loss_rate": self.mean_loss_rate,
            "mean_retransmissions": self.mean_retransmissions,
            "stddev_latency_us": self.stddev_latency_us,
            "stddev_throughput_bps": self.stddev_throughput_bps,
        }


def aggregate_qos(runs: list[QosMetrics]) -> AggregatedQos:
    if not runs:
        return AggregatedQos()

    n = float(len(runs))
    count = len(runs)

    mean_throughput = sum(r.throughput_bits_per_sec for r in runs) / n
    mean_goodput = sum(r.goodput_bits_per_sec for r in runs) / n
    mean_latency = sum(r.average_latency_us for r in runs) / n
    mean_jitter = sum(r.jitter_us for r in runs) / n
    mean_loss = sum(r.packet_loss_rate for r in runs) / n
    mean_retx = sum(float(r.retransmissions) for r in runs) / n

    min_lats = [r.min_latency_us for r in runs if r.min_latency_us is not None]
    max_lats = [r.max_latency_us for r in runs if r.max_latency_us is not None]
    global_min = min(min_lats) if min_lats else None
    global_max = max(max_lats) if max_lats else None

    var_latency = sum((r.average_latency_us - mean_latency) ** 2 for r in runs) / n
    var_throughput = sum((r.throughput_bits_per_sec - mean_throughput) ** 2 for r in runs) / n

    return AggregatedQos(
        run_count=count,
        mean_throughput_bps=mean_throughput,
        mean_goodput_bps=mean_goodput,
        mean_latency_us=mean_latency,
        min_latency_us=global_min,
        max_latency_us=global_max,
        mean_jitter_us=mean_jitter,
        mean_loss_rate=mean_loss,
        mean_retransmissions=mean_retx,
        stddev_latency_us=math.sqrt(var_latency),
        stddev_throughput_bps=math.sqrt(var_throughput),
    )
