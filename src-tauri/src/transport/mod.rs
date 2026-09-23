pub mod tcp;
pub mod udp;

use crate::congestion::CwndPoint;
use crate::domain::Project;
use crate::error::{NetSimError, Result};
use crate::routing::{MetricType, RoutingGraph};
use serde::{Deserialize, Serialize};

/// Supported Layer 4 transport protocols.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportProtocol {
    Tcp,
    Udp,
}

/// TCP Connection states modeled for educational state visualization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Closed,
    Listen,
    SynSent,
    SynReceived,
    Established,
    FinWait1,
    FinWait2,
    CloseWait,
    Closing,
    LastAck,
    TimeWait,
}

/// TCP Control Flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TcpFlag {
    Syn,
    Ack,
    Fin,
    Rst,
    Psh,
}

/// Layer 4 Transport Segment representation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportSegment {
    pub source_port: u16,
    pub destination_port: u16,
    pub sequence_number: u32,
    pub acknowledgment_number: u32,
    pub flags: Vec<TcpFlag>,
    pub payload_length: usize,
    pub advertised_window: u32,
    pub timestamp_us: u64,
    pub is_retransmission: bool,
}

impl TransportSegment {
    pub fn has_flag(&self, flag: TcpFlag) -> bool {
        self.flags.contains(&flag)
    }
}

/// Discrete transport-level events recorded during simulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportEventType {
    ConnectionStarted,
    SynSent,
    SynReceived,
    ConnectionEstablished,
    DataSegmentSent,
    DataSegmentReceived,
    AckSent,
    AckReceived,
    Timeout,
    Retransmission,
    SegmentLost,
    SegmentDelivered,
    WindowUpdated,
    CongestionWindowUpdated,
    ConnectionClosed,
}

/// Step event for UI timeline and educational trace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportEvent {
    pub step_index: usize,
    pub timestamp_us: u64,
    pub event_type: TransportEventType,
    pub source_node: String,
    pub destination_node: String,
    pub segment: Option<TransportSegment>,
    pub connection_state: ConnectionState,
    pub cwnd_mss: f64,
    pub ssthresh_mss: f64,
    pub rtt_sample_us: Option<u64>,
    pub srtt_us: u64,
    pub rttvar_us: u64,
    pub rto_us: u64,
    pub description: String,
}

/// Jacobson / Karn RTT and RTO Estimator using integer/fixed-point-safe arithmetic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RttEstimator {
    pub srtt_us: u64,
    pub rttvar_us: u64,
    pub rto_us: u64,
    pub min_rto_us: u64,
    pub max_rto_us: u64,
    pub sample_count: usize,
    pub total_rtt_us: u64,
}

impl RttEstimator {
    pub fn new(initial_rto_us: u64, min_rto_us: u64, max_rto_us: u64) -> Self {
        Self {
            srtt_us: initial_rto_us,
            rttvar_us: initial_rto_us / 2,
            rto_us: initial_rto_us.clamp(min_rto_us, max_rto_us),
            min_rto_us,
            max_rto_us,
            sample_count: 0,
            total_rtt_us: 0,
        }
    }

    /// Update with a valid non-retransmitted RTT sample (Karn's rule).
    pub fn update_sample(&mut self, sample_us: u64) {
        self.sample_count += 1;
        self.total_rtt_us += sample_us;

        if self.sample_count == 1 {
            // First valid RTT sample R: SRTT = R, RTTVAR = R/2, RTO = SRTT + 4*RTTVAR
            self.srtt_us = sample_us;
            self.rttvar_us = sample_us / 2;
        } else {
            // Subsequent samples:
            // alpha = 1/8 (0.125), beta = 1/4 (0.25)
            // RTTVAR = (1 - beta)*RTTVAR + beta*|SRTT - R|
            let diff = self.srtt_us.abs_diff(sample_us);
            self.rttvar_us = (3 * self.rttvar_us + diff) / 4;

            // SRTT = (1 - alpha)*SRTT + alpha*R
            self.srtt_us = (7 * self.srtt_us + sample_us) / 8;
        }

        // RTO = SRTT + 4 * RTTVAR clamped to [min_rto, max_rto]
        let raw_rto = self.srtt_us + 4 * self.rttvar_us;
        self.rto_us = raw_rto.clamp(self.min_rto_us, self.max_rto_us);
    }

    pub fn average_rtt_us(&self) -> u64 {
        if self.sample_count > 0 {
            self.total_rtt_us / self.sample_count as u64
        } else {
            self.srtt_us
        }
    }
}

/// Measured end-to-end transport performance metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportMetrics {
    pub segments_sent: usize,
    pub segments_delivered: usize,
    pub retransmissions: usize,
    pub segments_lost: usize,
    pub duplicate_acks: usize,
    pub bytes_sent: u64,
    pub bytes_delivered: u64,
    pub completion_time_us: u64,
    pub average_rtt_us: u64,
    pub smoothed_rtt_us: u64,
    pub final_rto_us: u64,
    pub throughput_bits_per_sec: f64,
    pub throughput_bytes_per_sec: f64,
    pub goodput_bits_per_sec: f64,
    pub packet_loss_rate: f64,
    pub sender_window_occupancy_avg: f64,
    pub receiver_window_occupancy_max: usize,
    pub congestion_window_final: f64,
    pub congestion_window_max: f64,
    pub timeout_count: usize,
    pub fast_retransmit_count: usize,
}

/// Configuration for Layer 4 Transport simulations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportConfig {
    pub protocol: TransportProtocol,
    pub source_node_id: String,
    pub destination_node_id: String,
    pub source_port: u16,
    pub destination_port: u16,
    pub payload_bytes: usize,
    pub segment_size_bytes: usize,
    pub initial_sequence_number: u32,
    pub initial_cwnd_mss: f64,
    pub initial_ssthresh_mss: f64,
    pub initial_rto_us: u64,
    pub receive_window_bytes: u32,
    pub seed: u64,
    /// 0-indexed segment sequence numbers to drop intentionally
    #[serde(default)]
    pub dropped_segments: Vec<u32>,
    pub maximum_retries: u32,
}

impl Default for TransportConfig {
    fn default() -> Self {
        Self {
            protocol: TransportProtocol::Tcp,
            source_node_id: "host-a".to_string(),
            destination_node_id: "host-b".to_string(),
            source_port: 49152,
            destination_port: 80,
            payload_bytes: 8000,
            segment_size_bytes: 1000,
            initial_sequence_number: 1000,
            initial_cwnd_mss: 1.0,
            initial_ssthresh_mss: 16.0,
            initial_rto_us: 100_000, // 100ms
            receive_window_bytes: 32_000,
            seed: 42,
            dropped_segments: Vec::new(),
            maximum_retries: 5,
        }
    }
}

/// Complete simulation result output with derived multi-hop route and traces.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportSimResult {
    pub protocol: TransportProtocol,
    pub config: TransportConfig,
    pub derived_route: Vec<String>,
    pub events: Vec<TransportEvent>,
    pub cwnd_timeline: Vec<CwndPoint>,
    pub metrics: TransportMetrics,
    pub completed: bool,
}

/// Characteristics of a physical link hop along the derived transport route.
#[derive(Debug, Clone)]
pub struct HopLink {
    pub link_id: String,
    pub source: String,
    pub target: String,
    pub bandwidth_bps: u64,
    pub delay_us: u64,
    pub queue_capacity: usize,
}

/// Derives the authoritative multi-hop path and link characteristics from project topology or defaults.
pub fn resolve_route_and_links(
    config: &TransportConfig,
    project: Option<&Project>,
) -> Result<(Vec<String>, Vec<HopLink>)> {
    if let Some(proj) = project {
        let graph = RoutingGraph::from_project(proj, MetricType::HopCount);
        if let Some((path_nodes, path_edges)) =
            graph.find_path(&config.source_node_id, &config.destination_node_id)
        {
            let mut hop_links = Vec::new();
            for edge in path_edges {
                let queue_cap = proj
                    .links
                    .iter()
                    .find(|l| l.id == edge.link_id)
                    .map(|l| l.queue_capacity)
                    .unwrap_or(50);

                hop_links.push(HopLink {
                    link_id: edge.link_id,
                    source: edge.source,
                    target: edge.target,
                    bandwidth_bps: edge.bandwidth_bps.max(1_000_000),
                    delay_us: edge.delay_us.max(100),
                    queue_capacity: queue_cap,
                });
            }
            Ok((path_nodes, hop_links))
        } else {
            Err(NetSimError::RouteUnreachable(format!(
                "Destination '{}' is unreachable from '{}' across topology",
                config.destination_node_id, config.source_node_id
            )))
        }
    } else {
        // Default educational 2-hop baseline topology: Host A -> Router 1 -> Host B
        let path_nodes = vec![
            config.source_node_id.clone(),
            "router-1".to_string(),
            config.destination_node_id.clone(),
        ];
        let hop_links = vec![
            HopLink {
                link_id: "link-a-r1".to_string(),
                source: config.source_node_id.clone(),
                target: "router-1".to_string(),
                bandwidth_bps: 10_000_000,
                delay_us: 10_000,
                queue_capacity: 50,
            },
            HopLink {
                link_id: "link-r1-b".to_string(),
                source: "router-1".to_string(),
                target: config.destination_node_id.clone(),
                bandwidth_bps: 10_000_000,
                delay_us: 10_000,
                queue_capacity: 50,
            },
        ];
        Ok((path_nodes, hop_links))
    }
}

pub use tcp::simulate_tcp;
pub use udp::simulate_udp;
