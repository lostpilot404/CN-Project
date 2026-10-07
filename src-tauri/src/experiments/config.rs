use crate::domain::Project;
use crate::faults::FaultSchedule;
use serde::{Deserialize, Serialize};

/// Identifies which parameter is being swept in a parameter sweep experiment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SweepParameter {
    /// Link bandwidth in bits per second. If link_id is None, applied to all links.
    LinkBandwidth { link_id: Option<String> },
    /// Link propagation delay in microseconds. If link_id is None, applied to all links.
    PropagationDelay { link_id: Option<String> },
    /// Link buffer queue capacity in packets. If link_id is None, applied to all links.
    QueueCapacity { link_id: Option<String> },
    /// Link bit error rate in [0.0, 1.0]. If link_id is None, applied to all links.
    BitErrorRate { link_id: Option<String> },
    /// Packet payload size in bytes.
    PacketSizeBytes,
    /// Inter-arrival transmission interval in microseconds.
    TrafficIntervalUs,
    /// Total number of packets injected in the test flow.
    PacketCount,
}

impl SweepParameter {
    pub fn name(&self) -> String {
        match self {
            SweepParameter::LinkBandwidth { link_id } => match link_id {
                Some(id) => format!("link_bandwidth_{}", id),
                None => "link_bandwidth_all".to_string(),
            },
            SweepParameter::PropagationDelay { link_id } => match link_id {
                Some(id) => format!("propagation_delay_{}", id),
                None => "propagation_delay_all".to_string(),
            },
            SweepParameter::QueueCapacity { link_id } => match link_id {
                Some(id) => format!("queue_capacity_{}", id),
                None => "queue_capacity_all".to_string(),
            },
            SweepParameter::BitErrorRate { link_id } => match link_id {
                Some(id) => format!("bit_error_rate_{}", id),
                None => "bit_error_rate_all".to_string(),
            },
            SweepParameter::PacketSizeBytes => "packet_size_bytes".to_string(),
            SweepParameter::TrafficIntervalUs => "traffic_interval_us".to_string(),
            SweepParameter::PacketCount => "packet_count".to_string(),
        }
    }
}

/// Configuration for a parameter sweep experiment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SweepConfig {
    pub experiment_name: String,
    pub parameter: SweepParameter,
    pub parameter_values: Vec<f64>,
    pub seeds: Vec<u64>,
    pub simulation_duration_us: u64,
    pub base_project: Option<Project>,
    pub traffic_src_id: Option<String>,
    pub traffic_dst_id: Option<String>,
    pub packet_size_bytes: Option<usize>,
    pub traffic_interval_us: Option<u64>,
    pub packet_count: Option<usize>,
    pub fault_schedule: Option<FaultSchedule>,
}

/// Scenario definition for comparative experiments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparativeScenarioConfig {
    pub name: String,
    pub description: String,
    pub project_override: Option<Project>,
    pub fault_schedule: Option<FaultSchedule>,
    pub parameter_overrides: Option<Vec<(SweepParameter, f64)>>,
}

/// Configuration for comparative A/B experiment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparativeExperimentConfig {
    pub experiment_name: String,
    pub scenario_a: ComparativeScenarioConfig,
    pub scenario_b: ComparativeScenarioConfig,
    pub seeds: Vec<u64>,
    pub simulation_duration_us: u64,
    pub base_project: Option<Project>,
    pub traffic_src_id: Option<String>,
    pub traffic_dst_id: Option<String>,
    pub packet_size_bytes: Option<usize>,
    pub traffic_interval_us: Option<u64>,
    pub packet_count: Option<usize>,
}
