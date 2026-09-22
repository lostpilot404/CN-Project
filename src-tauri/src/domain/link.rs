use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkStatus {
    Up,
    Down,
    Degraded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkEndpoint {
    pub node_id: String,
    pub interface_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub id: String,
    pub source: LinkEndpoint,
    pub target: LinkEndpoint,
    /// Bandwidth in bits per second (e.g. 10_000_000 for 10 Mbps)
    pub bandwidth_bps: u64,
    /// Propagation delay in microseconds
    pub propagation_delay_us: u64,
    /// Packet loss probability between 0.0 and 1.0
    pub loss_probability: f64,
    /// Bit error rate between 0.0 and 1.0
    pub bit_error_rate: f64,
    /// Maximum number of packets in the link buffer
    pub queue_capacity: usize,
    pub status: LinkStatus,
}

use crate::error::{NetSimError, Result};

impl Link {
    pub fn new(id: String, source: LinkEndpoint, target: LinkEndpoint) -> Self {
        Self {
            id,
            source,
            target,
            bandwidth_bps: 10_000_000,    // Default 10 Mbps
            propagation_delay_us: 10_000, // Default 10 ms
            loss_probability: 0.0,
            bit_error_rate: 0.0,
            queue_capacity: 50,
            status: LinkStatus::Up,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.bandwidth_bps == 0 {
            return Err(NetSimError::InvalidProperty(
                "Link bandwidth must be greater than 0 bps".to_string(),
            ));
        }
        if !(0.0..=1.0).contains(&self.loss_probability) || self.loss_probability.is_nan() {
            return Err(NetSimError::InvalidProperty(
                "Link loss probability must be between 0.0 and 1.0".to_string(),
            ));
        }
        if !(0.0..=1.0).contains(&self.bit_error_rate) || self.bit_error_rate.is_nan() {
            return Err(NetSimError::InvalidProperty(
                "Link bit error rate must be between 0.0 and 1.0".to_string(),
            ));
        }
        if self.queue_capacity == 0 {
            return Err(NetSimError::InvalidProperty(
                "Link queue capacity must be at least 1 packet".to_string(),
            ));
        }
        if self.source.node_id == self.target.node_id {
            return Err(NetSimError::InvalidConnection(
                "Cannot connect a node to itself".to_string(),
            ));
        }
        Ok(())
    }
}
