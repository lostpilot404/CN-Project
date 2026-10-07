use crate::faults::RouteChangeRecord;
use crate::qos::{AggregatedQos, QosMetrics};
use serde::{Deserialize, Serialize};

/// Result from a single simulation run within a parameter sweep.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SweepRunResult {
    pub parameter_value: f64,
    pub seed: u64,
    pub qos: QosMetrics,
    pub route_changes: Vec<RouteChangeRecord>,
}

/// Aggregated result for a single parameter value across multiple seeds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SweepPointResult {
    pub parameter_value: f64,
    pub aggregated_qos: AggregatedQos,
    pub runs: Vec<SweepRunResult>,
}

/// Comprehensive outcome of a parameter sweep experiment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SweepExperimentResult {
    pub experiment_name: String,
    pub parameter_name: String,
    pub points: Vec<SweepPointResult>,
    pub total_runs: usize,
    pub seeds: Vec<u64>,
    pub execution_time_ms: u64,
}

/// Comparative metric delta between two scenarios.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricDelta {
    pub metric_name: String,
    pub val_a: f64,
    pub val_b: f64,
    pub diff: f64,
    pub percent_change: Option<f64>,
}

/// Comprehensive outcome of a comparative A/B experiment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparativeExperimentResult {
    pub experiment_name: String,
    pub scenario_a_name: String,
    pub scenario_b_name: String,
    pub qos_a: AggregatedQos,
    pub qos_b: AggregatedQos,
    pub deltas: Vec<MetricDelta>,
    pub route_changes_a: Vec<RouteChangeRecord>,
    pub route_changes_b: Vec<RouteChangeRecord>,
    pub runs_count_per_scenario: usize,
    pub execution_time_ms: u64,
}
