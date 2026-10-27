from __future__ import annotations

import math

from netsim.experiments.config import (
    ComparativeExperimentConfig,
    ExperimentTarget,
    SweepConfig,
    SweepParameter,
    SweepParameterType,
)
from netsim.models.project import Project


def validate_parameter_for_target(param: SweepParameter, target: ExperimentTarget) -> None:
    supported = {
        ExperimentTarget.NETWORK: {
            SweepParameterType.LINK_BANDWIDTH,
            SweepParameterType.PROPAGATION_DELAY,
            SweepParameterType.QUEUE_CAPACITY,
            SweepParameterType.BIT_ERROR_RATE,
            SweepParameterType.PACKET_SIZE_BYTES,
            SweepParameterType.TRAFFIC_INTERVAL_US,
            SweepParameterType.PACKET_COUNT,
        },
        ExperimentTarget.TCP: {
            SweepParameterType.LINK_BANDWIDTH,
            SweepParameterType.PROPAGATION_DELAY,
            SweepParameterType.PACKET_SIZE_BYTES,
            SweepParameterType.PACKET_COUNT,
        },
        ExperimentTarget.UDP: {
            SweepParameterType.LINK_BANDWIDTH,
            SweepParameterType.PROPAGATION_DELAY,
            SweepParameterType.PACKET_SIZE_BYTES,
            SweepParameterType.PACKET_COUNT,
        },
    }
    if target not in supported:
        raise ValueError(f"Target '{target.value}' is not supported by the experiment runner; use its dedicated studio")
    if param.param_type not in supported[target]:
        raise ValueError(f"Parameter '{param.param_type.value}' is not supported for target '{target.value}'")


#: (minimum, maximum) bounds for each sweep parameter, or None for an open bound.
PARAMETER_BOUNDS: dict[SweepParameterType, tuple[float | None, float | None]] = {
    SweepParameterType.LINK_BANDWIDTH: (1.0, None),
    SweepParameterType.PROPAGATION_DELAY: (0.0, None),
    SweepParameterType.QUEUE_CAPACITY: (1.0, None),
    SweepParameterType.BIT_ERROR_RATE: (0.0, 1.0),
    SweepParameterType.PACKET_SIZE_BYTES: (1.0, None),
    SweepParameterType.TRAFFIC_INTERVAL_US: (1.0, None),
    SweepParameterType.PACKET_COUNT: (1.0, None),
    SweepParameterType.WINDOW_SIZE: (1.0, None),
    SweepParameterType.TIMEOUT_US: (1.0, None),
    SweepParameterType.MAC_PERSISTENCE: (0.0, 1.0),
}


def validate_parameter_value(param: SweepParameter, value: float) -> None:
    """Reject parameter values that would produce a physically meaningless run."""
    if not math.isfinite(value):
        raise ValueError("Parameter values must be finite numbers")
    if (
        param.param_type != SweepParameterType.BIT_ERROR_RATE
        and param.param_type != SweepParameterType.MAC_PERSISTENCE
        and not float(value).is_integer()
    ):
        raise ValueError(f"Parameter {param.param_type.value} requires an integer")
    bounds = PARAMETER_BOUNDS.get(param.param_type)
    if bounds is None:
        return
    low, high = bounds
    if low is not None and value < low:
        raise ValueError(f"Sweep value {value:g} for '{param.param_type.value}' must be >= {low:g}")
    if high is not None and value > high:
        raise ValueError(f"Sweep value {value:g} for '{param.param_type.value}' must be <= {high:g}")


def validate_parameter_values(param: SweepParameter, values: list[float]) -> None:
    for value in values:
        validate_parameter_value(param, value)


def validate_sweep_config(config: SweepConfig) -> None:
    if not config.parameter_values:
        raise ValueError("Parameter values list cannot be empty")
    if not config.seeds:
        raise ValueError("Seeds list cannot be empty")
    if config.simulation_duration_us <= 0:
        raise ValueError("Simulation duration must be greater than 0 µs")
    for val in config.parameter_values:
        if math.isnan(val) or math.isinf(val):
            raise ValueError("Parameter values must be finite numbers")
    validate_parameter_values(config.parameter, config.parameter_values)
    validate_parameter_for_target(config.parameter, config.target or ExperimentTarget.NETWORK)


def validate_comparative_config(config: ComparativeExperimentConfig) -> None:
    if not config.seeds:
        raise ValueError("Seeds list cannot be empty")
    if config.simulation_duration_us <= 0:
        raise ValueError("Simulation duration must be greater than 0 µs")
    for scenario in (config.scenario_a, config.scenario_b):
        if scenario.parameter_overrides:
            for param, value in scenario.parameter_overrides:
                validate_parameter_value(param, value)
    target = config.target or ExperimentTarget.NETWORK
    validate_parameter_for_target(SweepParameter(SweepParameterType.PACKET_COUNT), target)
    for scenario in (config.scenario_a, config.scenario_b):
        for p, _ in scenario.parameter_overrides or []:
            validate_parameter_for_target(p, target)


def apply_parameter_to_project(
    project: Project,
    param: SweepParameter,
    value: float,
) -> None:
    if param.param_type == SweepParameterType.LINK_BANDWIDTH:
        bw = int(max(1.0, value))
        if param.link_id:
            link = next((lnk for lnk in project.links if lnk.id == param.link_id), None)
            if link is None:
                raise ValueError(f"Link '{param.link_id}' not found")
            link.bandwidth_bps = bw
        else:
            for link in project.links:
                link.bandwidth_bps = bw
    elif param.param_type == SweepParameterType.PROPAGATION_DELAY:
        delay = int(max(0.0, value))
        if param.link_id:
            link = next((lnk for lnk in project.links if lnk.id == param.link_id), None)
            if link is None:
                raise ValueError(f"Link '{param.link_id}' not found")
            link.propagation_delay_us = delay
        else:
            for link in project.links:
                link.propagation_delay_us = delay
    elif param.param_type == SweepParameterType.QUEUE_CAPACITY:
        cap = int(max(1.0, value))
        if param.link_id:
            link = next((lnk for lnk in project.links if lnk.id == param.link_id), None)
            if link is None:
                raise ValueError(f"Link '{param.link_id}' not found")
            link.queue_capacity = cap
        else:
            for link in project.links:
                link.queue_capacity = cap
    elif param.param_type == SweepParameterType.BIT_ERROR_RATE:
        ber = max(0.0, min(1.0, value))
        if param.link_id:
            link = next((lnk for lnk in project.links if lnk.id == param.link_id), None)
            if link is None:
                raise ValueError(f"Link '{param.link_id}' not found")
            link.bit_error_rate = ber
        else:
            for link in project.links:
                link.bit_error_rate = ber
