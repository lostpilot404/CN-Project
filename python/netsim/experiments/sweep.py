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
    if target == ExperimentTarget.TCP:
        if param.param_type == SweepParameterType.MAC_PERSISTENCE:
            raise ValueError("Sweep parameter 'MacPersistence' is not supported for TCP target experiments")
    elif target == ExperimentTarget.UDP:
        if param.param_type == SweepParameterType.WINDOW_SIZE:
            raise ValueError(
                "Sweep parameter 'WindowSize' is not supported for UDP target experiments (UDP has no window flow control)"
            )
        elif param.param_type == SweepParameterType.TIMEOUT_US:
            raise ValueError(
                "Sweep parameter 'TimeoutUs' is not supported for UDP target experiments (UDP has no transport retransmissions)"
            )
        elif param.param_type == SweepParameterType.MAC_PERSISTENCE:
            raise ValueError("Sweep parameter 'MacPersistence' is not supported for UDP target experiments")
    elif target == ExperimentTarget.APPLICATION:
        if param.param_type == SweepParameterType.WINDOW_SIZE:
            raise ValueError(
                "Sweep parameter 'WindowSize' is not supported for Application target experiments (use FlowControl or TCP)"
            )
        elif param.param_type == SweepParameterType.MAC_PERSISTENCE:
            raise ValueError("Sweep parameter 'MacPersistence' is not supported for Application target experiments")
    elif target == ExperimentTarget.FLOW_CONTROL:
        if param.param_type == SweepParameterType.MAC_PERSISTENCE:
            raise ValueError("Sweep parameter 'MacPersistence' is not supported for FlowControl target experiments")
    elif target == ExperimentTarget.MAC:
        if param.param_type == SweepParameterType.QUEUE_CAPACITY:
            raise ValueError(
                "Sweep parameter 'QueueCapacity' is not supported for MAC contention experiments (MAC models channel access without L3 queuing)"
            )
        elif param.param_type == SweepParameterType.WINDOW_SIZE:
            raise ValueError("Sweep parameter 'WindowSize' is not supported for MAC target experiments")
        elif param.param_type == SweepParameterType.TIMEOUT_US:
            raise ValueError("Sweep parameter 'TimeoutUs' is not supported for MAC target experiments")


def validate_sweep_config(config: SweepConfig) -> None:
    if not config.parameter_values:
        raise ValueError("Parameter values list cannot be empty")
    if not config.seeds:
        raise ValueError("Seeds list cannot be empty")
    if config.simulation_duration_us == 0:
        raise ValueError("Simulation duration must be greater than 0 µs")
    for val in config.parameter_values:
        if math.isnan(val) or math.isinf(val):
            raise ValueError("Parameter values must be finite numbers")
    if config.target is not None:
        validate_parameter_for_target(config.parameter, config.target)


def validate_comparative_config(config: ComparativeExperimentConfig) -> None:
    if not config.seeds:
        raise ValueError("Seeds list cannot be empty")
    if config.simulation_duration_us == 0:
        raise ValueError("Simulation duration must be greater than 0 µs")
    if config.target is not None:
        if config.scenario_a.parameter_overrides:
            for p, _ in config.scenario_a.parameter_overrides:
                validate_parameter_for_target(p, config.target)
        if config.scenario_b.parameter_overrides:
            for p, _ in config.scenario_b.parameter_overrides:
                validate_parameter_for_target(p, config.target)


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
