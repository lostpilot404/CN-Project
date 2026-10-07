from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from netsim.faults.model import FaultSchedule, FaultScheduleEntry, FaultType
from netsim.models.project import Project


class SweepParameterType(str, Enum):
    LINK_BANDWIDTH = "link_bandwidth"
    PROPAGATION_DELAY = "propagation_delay"
    QUEUE_CAPACITY = "queue_capacity"
    BIT_ERROR_RATE = "bit_error_rate"
    PACKET_SIZE_BYTES = "packet_size_bytes"
    TRAFFIC_INTERVAL_US = "traffic_interval_us"
    PACKET_COUNT = "packet_count"
    WINDOW_SIZE = "window_size"
    TIMEOUT_US = "timeout_us"
    MAC_PERSISTENCE = "mac_persistence"


@dataclass
class SweepParameter:
    param_type: SweepParameterType
    link_id: str | None = None

    def name(self) -> str:
        if self.param_type == SweepParameterType.LINK_BANDWIDTH:
            return f"link_bandwidth_{self.link_id}" if self.link_id else "link_bandwidth_all"
        elif self.param_type == SweepParameterType.PROPAGATION_DELAY:
            return f"propagation_delay_{self.link_id}" if self.link_id else "propagation_delay_all"
        elif self.param_type == SweepParameterType.QUEUE_CAPACITY:
            return f"queue_capacity_{self.link_id}" if self.link_id else "queue_capacity_all"
        elif self.param_type == SweepParameterType.BIT_ERROR_RATE:
            return f"bit_error_rate_{self.link_id}" if self.link_id else "bit_error_rate_all"
        else:
            return self.param_type.value

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SweepParameter:
        p_type_str = data.get("type", "link_bandwidth")
        p_type = SweepParameterType(p_type_str) if isinstance(p_type_str, str) else p_type_str
        return cls(
            param_type=p_type,
            link_id=data.get("link_id"),
        )

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.param_type.value}
        if self.link_id is not None:
            d["link_id"] = self.link_id
        return d


class ExperimentTarget(str, Enum):
    TCP = "tcp"
    UDP = "udp"
    APPLICATION = "application"
    FLOW_CONTROL = "flow_control"
    MAC = "mac"


@dataclass
class SweepConfig:
    experiment_name: str
    parameter: SweepParameter
    parameter_values: list[float]
    seeds: list[int]
    simulation_duration_us: int
    target: ExperimentTarget | None = None
    base_project: Project | None = None
    traffic_src_id: str | None = None
    traffic_dst_id: str | None = None
    packet_size_bytes: int | None = None
    traffic_interval_us: int | None = None
    packet_count: int | None = None
    fault_schedule: FaultSchedule | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SweepConfig:
        target_val = data.get("target")
        target = ExperimentTarget(target_val) if target_val else None
        param = SweepParameter.from_dict(data.get("parameter", {}))
        proj_data = data.get("base_project")
        base_proj = Project.from_dict(proj_data) if proj_data else None

        fs_data = data.get("fault_schedule")
        fs = None
        if fs_data:
            entries = []
            for e in fs_data.get("entries", []):
                ft_dict = e.get("fault_type", {})
                ft_type_str = ft_dict.get("type", "packet_drop")
                # Construct FaultType
                if ft_type_str == "link_down":
                    ft = FaultType.link_down(ft_dict.get("link_id", ""))
                elif ft_type_str == "link_restore":
                    ft = FaultType.link_restore(ft_dict.get("link_id", ""))
                elif ft_type_str == "node_failure":
                    ft = FaultType.node_failure(ft_dict.get("node_id", ""))
                elif ft_type_str == "node_recovery":
                    ft = FaultType.node_recovery(ft_dict.get("node_id", ""))
                elif ft_type_str == "bandwidth_degradation":
                    ft = FaultType.bandwidth_degradation(
                        ft_dict.get("link_id", ""), int(ft_dict.get("new_bandwidth_bps", 1000000))
                    )
                elif ft_type_str == "queue_capacity_change":
                    ft = FaultType.queue_capacity_change(
                        ft_dict.get("link_id", ""), int(ft_dict.get("new_capacity", 50))
                    )
                elif ft_type_str == "bit_error":
                    ft = FaultType.bit_error(ft_dict.get("link_id", ""), float(ft_dict.get("error_rate", 0.0)))
                else:
                    ft = FaultType.packet_drop(
                        ft_dict.get("target_id", ""), float(ft_dict.get("drop_probability", 1.0))
                    )
                entries.append(
                    FaultScheduleEntry(
                        fault_id=e.get("fault_id", ""),
                        timestamp_us=int(e.get("timestamp_us", 0)),
                        fault_type=ft,
                    )
                )
            fs = FaultSchedule(entries=entries)

        return cls(
            experiment_name=data.get("experiment_name", "sweep_experiment"),
            target=target,
            parameter=param,
            parameter_values=[float(v) for v in data.get("parameter_values", [])],
            seeds=[int(s) for s in data.get("seeds", [42])],
            simulation_duration_us=int(data.get("simulation_duration_us", 1_000_000)),
            base_project=base_proj,
            traffic_src_id=data.get("traffic_src_id"),
            traffic_dst_id=data.get("traffic_dst_id"),
            packet_size_bytes=data.get("packet_size_bytes"),
            traffic_interval_us=data.get("traffic_interval_us"),
            packet_count=data.get("packet_count"),
            fault_schedule=fs,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_name": self.experiment_name,
            "target": self.target.value if self.target else None,
            "parameter": self.parameter.to_dict(),
            "parameter_values": self.parameter_values,
            "seeds": self.seeds,
            "simulation_duration_us": self.simulation_duration_us,
            "base_project": self.base_project.to_dict() if self.base_project else None,
            "traffic_src_id": self.traffic_src_id,
            "traffic_dst_id": self.traffic_dst_id,
            "packet_size_bytes": self.packet_size_bytes,
            "traffic_interval_us": self.traffic_interval_us,
            "packet_count": self.packet_count,
            "fault_schedule": self.fault_schedule.to_dict() if self.fault_schedule else None,
        }


@dataclass
class ComparativeScenarioConfig:
    name: str
    description: str
    project_override: Project | None = None
    fault_schedule: FaultSchedule | None = None
    parameter_overrides: list[tuple[SweepParameter, float]] | None = None

    def to_dict(self) -> dict[str, Any]:
        overrides = None
        if self.parameter_overrides is not None:
            overrides = [[p.to_dict(), v] for p, v in self.parameter_overrides]
        return {
            "name": self.name,
            "description": self.description,
            "project_override": self.project_override.to_dict() if self.project_override else None,
            "fault_schedule": self.fault_schedule.to_dict() if self.fault_schedule else None,
            "parameter_overrides": overrides,
        }


@dataclass
class ComparativeExperimentConfig:
    experiment_name: str
    scenario_a: ComparativeScenarioConfig
    scenario_b: ComparativeScenarioConfig
    seeds: list[int]
    simulation_duration_us: int
    target: ExperimentTarget | None = None
    base_project: Project | None = None
    traffic_src_id: str | None = None
    traffic_dst_id: str | None = None
    packet_size_bytes: int | None = None
    traffic_interval_us: int | None = None
    packet_count: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_name": self.experiment_name,
            "target": self.target.value if self.target else None,
            "scenario_a": self.scenario_a.to_dict(),
            "scenario_b": self.scenario_b.to_dict(),
            "seeds": self.seeds,
            "simulation_duration_us": self.simulation_duration_us,
            "base_project": self.base_project.to_dict() if self.base_project else None,
            "traffic_src_id": self.traffic_src_id,
            "traffic_dst_id": self.traffic_dst_id,
            "packet_size_bytes": self.packet_size_bytes,
            "traffic_interval_us": self.traffic_interval_us,
            "packet_count": self.packet_count,
        }
