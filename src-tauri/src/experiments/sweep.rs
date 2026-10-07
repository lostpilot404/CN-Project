use crate::domain::Project;
use crate::error::{NetSimError, Result};
use crate::experiments::config::{SweepConfig, SweepParameter};

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
        | SweepParameter::PacketCount => {
            // These affect traffic generation parameters during runner execution,
            // not the project topology itself.
        }
    }
    Ok(())
}
