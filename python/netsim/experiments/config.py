from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from netsim.core.schema import require_dict, require_list
from netsim.faults.model import FaultSchedule
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
        data = require_dict(data, "config.parameter")
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
        data = require_dict(data, "config")
        target_val = data.get("target")
        target = ExperimentTarget(target_val) if target_val else None
        param = SweepParameter.from_dict(data.get("parameter", {}))
        proj_data = data.get("base_project")
        base_proj = Project.from_dict(require_dict(proj_data, "config.base_project")) if proj_data else None

        fs_data = data.get("fault_schedule")
        fs = FaultSchedule.from_dict(fs_data) if fs_data else None

        try:
            parameter_values = [float(v) for v in require_list(data.get("parameter_values", []), "parameter_values")]
            seeds = [int(s) for s in require_list(data.get("seeds", [42]), "seeds")]
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid sweep configuration: {exc}") from exc
        if not parameter_values:
            raise ValueError("Sweep requires at least one parameter value")
        if not seeds:
            raise ValueError("Sweep requires at least one seed")

        return cls(
            experiment_name=data.get("experiment_name", "sweep_experiment"),
            target=target,
            parameter=param,
            parameter_values=parameter_values,
            seeds=seeds,
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

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ComparativeScenarioConfig:
        if not isinstance(data, dict):
            raise ValueError("Comparative scenario must be a JSON object")
        overrides: list[tuple[SweepParameter, float]] | None = None
        raw_overrides = data.get("parameter_overrides")
        if raw_overrides:
            if not isinstance(raw_overrides, list):
                raise ValueError("'parameter_overrides' must be a list of [parameter, value] pairs")
            overrides = []
            for index, entry in enumerate(raw_overrides):
                if not isinstance(entry, (list, tuple)) or len(entry) != 2:
                    raise ValueError(
                        f"parameter_overrides[{index}] must be a [parameter, value] pair, received {entry!r}"
                    )
                param_dict, value = entry
                if not isinstance(param_dict, dict):
                    raise ValueError(f"parameter_overrides[{index}][0] must be a parameter object")
                overrides.append((SweepParameter.from_dict(param_dict), float(value)))

        project_override = None
        raw_project = data.get("project_override")
        if raw_project:
            project_override = Project.from_dict(raw_project)

        fault_schedule = None
        raw_schedule = data.get("fault_schedule")
        if raw_schedule:
            fault_schedule = FaultSchedule.from_dict(raw_schedule)

        return cls(
            name=data.get("name", "Scenario"),
            description=data.get("description", ""),
            project_override=project_override,
            fault_schedule=fault_schedule,
            parameter_overrides=overrides,
        )


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

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ComparativeExperimentConfig:
        if not isinstance(data, dict):
            raise ValueError("Comparative experiment configuration must be a JSON object")

        scenario_a_data = data.get("scenario_a")
        scenario_b_data = data.get("scenario_b")
        if not scenario_a_data or not scenario_b_data:
            raise ValueError("Both 'scenario_a' and 'scenario_b' definitions are required")
        scenario_a_data = require_dict(scenario_a_data, "scenario_a")
        scenario_b_data = require_dict(scenario_b_data, "scenario_b")

        target_val = data.get("target")
        target = ExperimentTarget(target_val) if target_val else None
        proj_data = data.get("base_project")
        base_proj = Project.from_dict(require_dict(proj_data, "config.base_project")) if proj_data else None

        return cls(
            experiment_name=data.get("experiment_name", "comparative_experiment"),
            scenario_a=ComparativeScenarioConfig.from_dict(scenario_a_data),
            scenario_b=ComparativeScenarioConfig.from_dict(scenario_b_data),
            seeds=[int(s) for s in data.get("seeds", [42])],
            simulation_duration_us=int(data.get("simulation_duration_us", 1_000_000)),
            target=target,
            base_project=base_proj,
            traffic_src_id=data.get("traffic_src_id"),
            traffic_dst_id=data.get("traffic_dst_id"),
            packet_size_bytes=data.get("packet_size_bytes"),
            traffic_interval_us=data.get("traffic_interval_us"),
            packet_count=data.get("packet_count"),
        )
