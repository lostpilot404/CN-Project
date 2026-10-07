use crate::domain::Project;
use crate::error::{NetSimError, Result};
use crate::experiments::config::{
    ComparativeExperimentConfig, ExperimentTarget, SweepConfig, SweepParameter,
};

/// Validates whether a parameter is supported for a given experiment target.
pub fn validate_parameter_for_target(
    param: &SweepParameter,
    target: ExperimentTarget,
) -> Result<()> {
    match target {
        ExperimentTarget::Tcp => match param {
            SweepParameter::LinkBandwidth { .. }
            | SweepParameter::PropagationDelay { .. }
            | SweepParameter::QueueCapacity { .. }
            | SweepParameter::BitErrorRate { .. }
            | SweepParameter::PacketSizeBytes
            | SweepParameter::TrafficIntervalUs
            | SweepParameter::PacketCount
            | SweepParameter::WindowSize
            | SweepParameter::TimeoutUs => Ok(()),
            SweepParameter::MacPersistence => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'MacPersistence' is not supported for TCP target experiments"
                    .to_string(),
            )),
        },
        ExperimentTarget::Udp => match param {
            SweepParameter::LinkBandwidth { .. }
            | SweepParameter::PropagationDelay { .. }
            | SweepParameter::QueueCapacity { .. }
            | SweepParameter::BitErrorRate { .. }
            | SweepParameter::PacketSizeBytes
            | SweepParameter::TrafficIntervalUs
            | SweepParameter::PacketCount => Ok(()),
            SweepParameter::WindowSize => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'WindowSize' is not supported for UDP target experiments (UDP has no window flow control)"
                    .to_string(),
            )),
            SweepParameter::TimeoutUs => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'TimeoutUs' is not supported for UDP target experiments (UDP has no transport retransmissions)"
                    .to_string(),
            )),
            SweepParameter::MacPersistence => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'MacPersistence' is not supported for UDP target experiments"
                    .to_string(),
            )),
        },
        ExperimentTarget::Application => match param {
            SweepParameter::LinkBandwidth { .. }
            | SweepParameter::PropagationDelay { .. }
            | SweepParameter::QueueCapacity { .. }
            | SweepParameter::BitErrorRate { .. }
            | SweepParameter::PacketSizeBytes
            | SweepParameter::TrafficIntervalUs
            | SweepParameter::PacketCount
            | SweepParameter::TimeoutUs => Ok(()),
            SweepParameter::WindowSize => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'WindowSize' is not supported for Application target experiments (use FlowControl or TCP)"
                    .to_string(),
            )),
            SweepParameter::MacPersistence => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'MacPersistence' is not supported for Application target experiments"
                    .to_string(),
            )),
        },
        ExperimentTarget::FlowControl => match param {
            SweepParameter::LinkBandwidth { .. }
            | SweepParameter::PropagationDelay { .. }
            | SweepParameter::QueueCapacity { .. }
            | SweepParameter::BitErrorRate { .. }
            | SweepParameter::PacketSizeBytes
            | SweepParameter::TrafficIntervalUs
            | SweepParameter::PacketCount
            | SweepParameter::WindowSize
            | SweepParameter::TimeoutUs => Ok(()),
            SweepParameter::MacPersistence => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'MacPersistence' is not supported for FlowControl target experiments"
                    .to_string(),
            )),
        },
        ExperimentTarget::Mac => match param {
            SweepParameter::LinkBandwidth { .. }
            | SweepParameter::PropagationDelay { .. }
            | SweepParameter::PacketSizeBytes
            | SweepParameter::TrafficIntervalUs
            | SweepParameter::PacketCount
            | SweepParameter::MacPersistence
            | SweepParameter::BitErrorRate { .. } => Ok(()),
            SweepParameter::QueueCapacity { .. } => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'QueueCapacity' is not supported for MAC contention experiments (MAC models channel access without L3 queuing)"
                    .to_string(),
            )),
            SweepParameter::WindowSize => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'WindowSize' is not supported for MAC target experiments"
                    .to_string(),
            )),
            SweepParameter::TimeoutUs => Err(NetSimError::InvalidConfiguration(
                "Sweep parameter 'TimeoutUs' is not supported for MAC target experiments"
                    .to_string(),
            )),
        },
    }
}

/// Validates that a sweep configuration is well-formed.
pub fn validate_sweep_config(config: &SweepConfig) -> Result<()> {
    if config.parameter_values.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "Parameter values list cannot be empty".to_string(),
        ));
    }
    if config.seeds.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "Seeds list cannot be empty".to_string(),
        ));
    }
    if config.simulation_duration_us == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "Simulation duration must be greater than 0 µs".to_string(),
        ));
    }
    for val in &config.parameter_values {
        if val.is_nan() || val.is_infinite() {
            return Err(NetSimError::InvalidConfiguration(
                "Parameter values must be finite numbers".to_string(),
            ));
        }
    }
    if let Some(target) = config.target {
        validate_parameter_for_target(&config.parameter, target)?;
    }
    Ok(())
}

/// Validates that a comparative experiment configuration is well-formed.
pub fn validate_comparative_config(config: &ComparativeExperimentConfig) -> Result<()> {
    if config.seeds.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "Seeds list cannot be empty".to_string(),
        ));
    }
    if config.simulation_duration_us == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "Simulation duration must be greater than 0 µs".to_string(),
        ));
    }
    if let Some(target) = config.target {
        if let Some(ref overrides) = config.scenario_a.parameter_overrides {
            for (p, _) in overrides {
                validate_parameter_for_target(p, target)?;
            }
        }
        if let Some(ref overrides) = config.scenario_b.parameter_overrides {
            for (p, _) in overrides {
                validate_parameter_for_target(p, target)?;
            }
        }
    }
    Ok(())
}

/// Modifies a project copy according to a sweep parameter and value.
pub fn apply_parameter_to_project(
    project: &mut Project,
    param: &SweepParameter,
    value: f64,
) -> Result<()> {
    match param {
        SweepParameter::LinkBandwidth { link_id } => {
            let bw = (value.max(1.0)) as u64;
            if let Some(lid) = link_id {
                let link = project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *lid)
                    .ok_or_else(|| NetSimError::LinkNotFound(lid.clone()))?;
                link.bandwidth_bps = bw;
            } else {
                for link in &mut project.links {
                    link.bandwidth_bps = bw;
                }
            }
        }
        SweepParameter::PropagationDelay { link_id } => {
            let delay = (value.max(0.0)) as u64;
            if let Some(lid) = link_id {
                let link = project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *lid)
                    .ok_or_else(|| NetSimError::LinkNotFound(lid.clone()))?;
                link.propagation_delay_us = delay;
            } else {
                for link in &mut project.links {
                    link.propagation_delay_us = delay;
                }
            }
        }
        SweepParameter::QueueCapacity { link_id } => {
            let cap = (value.max(1.0)) as usize;
            if let Some(lid) = link_id {
                let link = project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *lid)
                    .ok_or_else(|| NetSimError::LinkNotFound(lid.clone()))?;
                link.queue_capacity = cap;
            } else {
                for link in &mut project.links {
                    link.queue_capacity = cap;
                }
            }
        }
        SweepParameter::BitErrorRate { link_id } => {
            let ber = value.clamp(0.0, 1.0);
            if let Some(lid) = link_id {
                let link = project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *lid)
                    .ok_or_else(|| NetSimError::LinkNotFound(lid.clone()))?;
                link.bit_error_rate = ber;
            } else {
                for link in &mut project.links {
                    link.bit_error_rate = ber;
                }
            }
        }
        SweepParameter::PacketSizeBytes
        | SweepParameter::TrafficIntervalUs
        | SweepParameter::PacketCount
        | SweepParameter::WindowSize
        | SweepParameter::TimeoutUs
        | SweepParameter::MacPersistence => {
            // These affect traffic/protocol generation parameters during runner execution,
            // not the project topology itself.
        }
    }
    Ok(())
}
