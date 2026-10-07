use super::QosMetrics;
use serde::{Deserialize, Serialize};

/// Aggregated QoS across multiple experiment runs.
///
/// Only completed runs contribute to aggregation.
/// Failed runs are preserved in the experiment result but excluded here.
/// Outliers are never silently discarded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedQos {
    pub run_count: usize,
    pub mean_throughput_bps: f64,
    pub mean_goodput_bps: f64,
    pub mean_latency_us: f64,
    pub min_latency_us: Option<u64>,
    pub max_latency_us: Option<u64>,
    pub mean_jitter_us: f64,
    pub mean_loss_rate: f64,
    pub mean_retransmissions: f64,
    pub stddev_latency_us: f64,
    pub stddev_throughput_bps: f64,
}

impl Default for AggregatedQos {
    fn default() -> Self {
        Self {
            run_count: 0,
            mean_throughput_bps: 0.0,
            mean_goodput_bps: 0.0,
            mean_latency_us: 0.0,
            min_latency_us: None,
            max_latency_us: None,
            mean_jitter_us: 0.0,
            mean_loss_rate: 0.0,
            mean_retransmissions: 0.0,
            stddev_latency_us: 0.0,
            stddev_throughput_bps: 0.0,
        }
    }
}

/// Aggregate QoS metrics from multiple completed runs.
///
/// Precondition: `runs` must contain only metrics from successfully completed runs.
/// This function does not discard outliers.
pub fn aggregate_qos(runs: &[QosMetrics]) -> AggregatedQos {
    if runs.is_empty() {
        return AggregatedQos::default();
    }

    let n = runs.len() as f64;
    let count = runs.len();

    let mean_throughput: f64 = runs.iter().map(|r| r.throughput_bits_per_sec).sum::<f64>() / n;
    let mean_goodput: f64 = runs.iter().map(|r| r.goodput_bits_per_sec).sum::<f64>() / n;
    let mean_latency: f64 = runs.iter().map(|r| r.average_latency_us).sum::<f64>() / n;
    let mean_jitter: f64 = runs.iter().map(|r| r.jitter_us).sum::<f64>() / n;
    let mean_loss: f64 = runs.iter().map(|r| r.packet_loss_rate).sum::<f64>() / n;
    let mean_retx: f64 = runs.iter().map(|r| r.retransmissions as f64).sum::<f64>() / n;

    let global_min = runs.iter().filter_map(|r| r.min_latency_us).min();
    let global_max = runs.iter().filter_map(|r| r.max_latency_us).max();

    // Standard deviation (population)
    let var_latency: f64 = runs
        .iter()
        .map(|r| (r.average_latency_us - mean_latency).powi(2))
        .sum::<f64>()
        / n;
    let var_throughput: f64 = runs
        .iter()
        .map(|r| (r.throughput_bits_per_sec - mean_throughput).powi(2))
        .sum::<f64>()
        / n;

    AggregatedQos {
        run_count: count,
        mean_throughput_bps: mean_throughput,
        mean_goodput_bps: mean_goodput,
        mean_latency_us: mean_latency,
        min_latency_us: global_min,
        max_latency_us: global_max,
        mean_jitter_us: mean_jitter,
        mean_loss_rate: mean_loss,
        mean_retransmissions: mean_retx,
        stddev_latency_us: var_latency.sqrt(),
        stddev_throughput_bps: var_throughput.sqrt(),
    }
}
