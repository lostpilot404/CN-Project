from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from netsim.faults.model import RouteChangeRecord
from netsim.qos.aggregation import AggregatedQos
from netsim.qos.metrics import QosMetrics


@dataclass
class SweepRunResult:
    parameter_value: float
    seed: int
    qos: QosMetrics
    route_changes: list[RouteChangeRecord]

    def to_dict(self) -> dict[str, Any]:
        return {
            "parameter_value": self.parameter_value,
            "seed": self.seed,
            "qos": self.qos.to_dict(),
            "route_changes": [r.to_dict() for r in self.route_changes],
        }


@dataclass
class SweepPointResult:
    parameter_value: float
    aggregated_qos: AggregatedQos
    runs: list[SweepRunResult]

    def to_dict(self) -> dict[str, Any]:
        return {
            "parameter_value": self.parameter_value,
            "aggregated_qos": self.aggregated_qos.to_dict(),
            "runs": [r.to_dict() for r in self.runs],
        }


@dataclass
class SweepExperimentResult:
    experiment_name: str
    parameter_name: str
    points: list[SweepPointResult]
    total_runs: int
    seeds: list[int]
    execution_time_ms: int
    provenance: dict[str, Any] = field(default_factory=dict)
    run_evidence: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_name": self.experiment_name,
            "parameter_name": self.parameter_name,
            "points": [p.to_dict() for p in self.points],
            "total_runs": self.total_runs,
            "seeds": self.seeds,
            "execution_time_ms": self.execution_time_ms,
            "provenance": self.provenance,
            "run_evidence": self.run_evidence,
        }


@dataclass
class MetricDelta:
    metric_name: str
    val_a: float
    val_b: float
    diff: float
    percent_change: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "metric_name": self.metric_name,
            "val_a": self.val_a,
            "val_b": self.val_b,
            "diff": self.diff,
            "percent_change": self.percent_change,
        }


@dataclass
class ComparativeExperimentResult:
    experiment_name: str
    scenario_a_name: str
    scenario_b_name: str
    qos_a: AggregatedQos
    qos_b: AggregatedQos
    deltas: list[MetricDelta]
    route_changes_a: list[RouteChangeRecord]
    route_changes_b: list[RouteChangeRecord]
    runs_count_per_scenario: int
    execution_time_ms: int
    provenance: dict[str, Any] = field(default_factory=dict)
    run_evidence: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_name": self.experiment_name,
            "scenario_a_name": self.scenario_a_name,
            "scenario_b_name": self.scenario_b_name,
            "qos_a": self.qos_a.to_dict(),
            "qos_b": self.qos_b.to_dict(),
            "deltas": [d.to_dict() for d in self.deltas],
            "route_changes_a": [r.to_dict() for r in self.route_changes_a],
            "route_changes_b": [r.to_dict() for r in self.route_changes_b],
            "runs_count_per_scenario": self.runs_count_per_scenario,
            "execution_time_ms": self.execution_time_ms,
            "provenance": self.provenance,
            "run_evidence": self.run_evidence,
        }
