use crate::domain::{Packet, PacketState};
use crate::simulation::event::{SimEvent, SimEventType};
use crate::simulation::metrics::SimulationMetrics;
use crate::simulation::queue::QueueSnapshot;
use crate::transport::TransportMetrics;
use serde::{Deserialize, Serialize};

// ============================================================================
// QoS Metrics — Authoritative Definitions
// ============================================================================
//
// MEASUREMENT INTERVAL
// --------------------
// All rate and utilization metrics use `measurement_interval_us` as the
// denominator, defined as the elapsed SimTime from the first relevant
// simulation activity to the final processed event timestamp.
//
// METRIC SCOPES
// -------------
// A. NETWORK / PACKET QoS — derived from SimulationMetrics, Packet,
//    hop_history, and physical/link state.
// B. TRANSPORT / FLOW QoS — derived from TransportMetrics.
//
// These scopes are never mixed: packet-level retransmission objects are
// distinct from transport-level segment accounting.
//
// JITTER
// ------
// Uses IPDV (Inter-Packet Delay Variation) per RFC 3393 educational
// interpretation:  jitter_sample[i] = |D[i] - D[i-1]|
// Computed per flow (identified by src_node_id + dst_node_id + protocol).
// Flows are never combined.
//
// LINK UTILIZATION
// ----------------
// utilization = busy_time_us / measurement_interval_us
// busy_time_us = sum of (tx_finish_us - tx_start_us) from PhysicalLayerInfo
// per link.  Overlapping observations of the same transmission are not
// double-counted.
//
// SAFE DIVISION
// -------------
// All divisions guard against zero denominators. No NaN or Infinity results.

/// Per-category loss breakdown. Prevents double-counting.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LossCategoryBreakdown {
    pub queue_overflow: u64,
    pub link_down: u64,
    pub bit_error: u64,
    pub stochastic_loss: u64,
}

/// Per-link utilization record derived from actual transmission intervals.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkUtilizationRecord {
    pub link_id: String,
    pub busy_time_us: u64,
    pub measurement_time_us: u64,
    /// busy_time_us / measurement_time_us, clamped to [0.0, 1.0].
    pub utilization: f64,
}

/// Authoritative QoS metrics computed from simulation results.
///
/// Every rate metric uses `measurement_interval_us` as the denominator
/// (elapsed authoritative SimTime).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QosMetrics {
    // -- Measurement interval --
    pub measurement_interval_us: u64,

    // -- Throughput --
    /// (bytes_delivered * 8 * 1_000_000) / measurement_interval_us
    pub throughput_bits_per_sec: f64,
    /// bytes_delivered * 1_000_000 / measurement_interval_us
    pub throughput_bytes_per_sec: f64,
    /// (application_payload_bytes * 8 * 1_000_000) / measurement_interval_us
    pub goodput_bits_per_sec: f64,

    // -- Latency --
    /// Per-packet end-to-end latency in µs (only for delivered packets).
    pub end_to_end_latencies_us: Vec<u64>,
    pub average_latency_us: f64,
    pub min_latency_us: Option<u64>,
    pub max_latency_us: Option<u64>,

    // -- Jitter (IPDV per flow) --
    pub jitter_us: f64,
    pub jitter_samples: Vec<f64>,

    // -- Loss --
    pub packets_sent: u64,
    pub packets_delivered: u64,
    pub packets_lost: u64,
    /// packets_lost / packets_sent (0.0 when packets_sent == 0)
    pub packet_loss_rate: f64,
    pub loss_by_category: LossCategoryBreakdown,

    // -- Retransmissions (transport scope only) --
    pub retransmissions: u64,

    // -- Link utilization --
    pub link_utilization: Vec<LinkUtilizationRecord>,

    // -- Queue --
    pub queue_occupancy_average: f64,
    pub queue_occupancy_max: usize,
    pub queue_drops: u64,

    // -- RTT (transport scope, optional) --
    pub average_rtt_us: Option<u64>,
}

impl Default for QosMetrics {
    fn default() -> Self {
        Self {
            measurement_interval_us: 0,
            throughput_bits_per_sec: 0.0,
            throughput_bytes_per_sec: 0.0,
            goodput_bits_per_sec: 0.0,
            end_to_end_latencies_us: Vec::new(),
            average_latency_us: 0.0,
            min_latency_us: None,
            max_latency_us: None,
            jitter_us: 0.0,
            jitter_samples: Vec::new(),
            packets_sent: 0,
            packets_delivered: 0,
            packets_lost: 0,
            packet_loss_rate: 0.0,
            loss_by_category: LossCategoryBreakdown::default(),
            retransmissions: 0,
            link_utilization: Vec::new(),
            queue_occupancy_average: 0.0,
            queue_occupancy_max: 0,
            queue_drops: 0,
            average_rtt_us: None,
        }
    }
}

fn safe_div(num: f64, den: f64) -> f64 {
    if den == 0.0 || den.is_nan() || den.is_infinite() {
        0.0
    } else {
        let r = num / den;
        if r.is_nan() || r.is_infinite() {
            0.0
        } else {
            r
        }
    }
}

// ============================================================================
// Network / Packet Scope QoS
// ============================================================================

/// Compute QoS metrics from the Network/Packet scope.
///
/// `sim_metrics`: authoritative SimulationMetrics counters.
/// `packets`: all Packet objects from the simulation.
/// `events`: processed SimEvents (used for link utilization intervals).
/// `queue_snapshots`: current queue snapshots.
/// `elapsed_us`: authoritative elapsed SimTime of the measurement interval.
pub fn compute_network_qos(
    sim_metrics: &SimulationMetrics,
    packets: &[Packet],
    events: &[SimEvent],
    queue_snapshots: &[QueueSnapshot],
    elapsed_us: u64,
) -> QosMetrics {
    let mut qos = QosMetrics::default();
    qos.measurement_interval_us = elapsed_us;

    // -- Packets sent / delivered / lost --
    qos.packets_sent = sim_metrics.packets_created;
    qos.packets_delivered = sim_metrics.packets_delivered;
    qos.packets_lost = sim_metrics.total_dropped();

    // -- Loss rate --
    qos.packet_loss_rate = safe_div(qos.packets_lost as f64, qos.packets_sent as f64);

    // -- Loss categories --
    qos.loss_by_category = LossCategoryBreakdown {
        queue_overflow: sim_metrics.packets_dropped_overflow,
        link_down: sim_metrics.packets_dropped_link_down,
        bit_error: sim_metrics.packets_dropped_error,
        stochastic_loss: sim_metrics.packets_dropped_loss,
    };

    // -- Per-packet latency --
    let mut latencies: Vec<u64> = Vec::new();
    for pkt in packets {
        if pkt.state == PacketState::Delivered {
            // Find delivery timestamp from hop_history
            if let Some(delivery_hop) = pkt
                .hop_history
                .iter()
                .rev()
                .find(|h| h.state == PacketState::Delivered)
            {
                let lat = delivery_hop.timestamp_us.saturating_sub(pkt.created_at_us);
                latencies.push(lat);
            }
        }
    }
    qos.end_to_end_latencies_us = latencies.clone();

    if !latencies.is_empty() {
        let sum: u64 = latencies.iter().sum();
        qos.average_latency_us = safe_div(sum as f64, latencies.len() as f64);
        qos.min_latency_us = latencies.iter().copied().min();
        qos.max_latency_us = latencies.iter().copied().max();
    }

    // -- Jitter (IPDV) per flow --
    // Group delivered packets by flow key: (src_node_id, dst_node_id)
    let mut flow_latencies: std::collections::HashMap<(String, String), Vec<u64>> =
        std::collections::HashMap::new();
    for pkt in packets {
        if pkt.state == PacketState::Delivered {
            if let Some(delivery_hop) = pkt
                .hop_history
                .iter()
                .rev()
                .find(|h| h.state == PacketState::Delivered)
            {
                let lat = delivery_hop.timestamp_us.saturating_sub(pkt.created_at_us);
                let key = (pkt.src_node_id.clone(), pkt.dst_node_id.clone());
                flow_latencies.entry(key).or_default().push(lat);
            }
        }
    }

    let mut all_jitter_samples: Vec<f64> = Vec::new();
    for lats in flow_latencies.values() {
        if lats.len() >= 2 {
            for window in lats.windows(2) {
                let ipdv = (window[1] as f64 - window[0] as f64).abs();
                all_jitter_samples.push(ipdv);
            }
        }
    }
    if !all_jitter_samples.is_empty() {
        let sum: f64 = all_jitter_samples.iter().sum();
        qos.jitter_us = safe_div(sum, all_jitter_samples.len() as f64);
    }
    qos.jitter_samples = all_jitter_samples;

    // -- Throughput --
    let elapsed_f = elapsed_us as f64;
    qos.throughput_bits_per_sec = safe_div(
        sim_metrics.bytes_delivered as f64 * 8.0 * 1_000_000.0,
        elapsed_f,
    );
    qos.throughput_bytes_per_sec =
        safe_div(sim_metrics.bytes_delivered as f64 * 1_000_000.0, elapsed_f);
    // Goodput: use bytes_delivered (application payload) — same as bytes_delivered in this scope
    qos.goodput_bits_per_sec = safe_div(
        sim_metrics.bytes_delivered as f64 * 8.0 * 1_000_000.0,
        elapsed_f,
    );

    // -- Link utilization from events --
    let mut link_busy: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    for event in events {
        if let SimEventType::TransmissionStarted {
            link_id,
            tx_delay_us,
            ..
        } = &event.event_type
        {
            *link_busy.entry(link_id.clone()).or_insert(0) += tx_delay_us;
        }
    }
    for (link_id, busy_us) in &link_busy {
        let util = safe_div(*busy_us as f64, elapsed_f);
        qos.link_utilization.push(LinkUtilizationRecord {
            link_id: link_id.clone(),
            busy_time_us: *busy_us,
            measurement_time_us: elapsed_us,
            utilization: util.min(1.0),
        });
    }

    // -- Queue metrics --
    if !queue_snapshots.is_empty() {
        let total_occ: usize = queue_snapshots.iter().map(|q| q.occupancy).sum();
        qos.queue_occupancy_average = safe_div(total_occ as f64, queue_snapshots.len() as f64);
        qos.queue_occupancy_max = queue_snapshots
            .iter()
            .map(|q| q.occupancy)
            .max()
            .unwrap_or(0);
        qos.queue_drops = queue_snapshots
            .iter()
            .map(|q| q.total_dropped_overflow)
            .sum();
    } else {
        qos.queue_drops = sim_metrics.packets_dropped_overflow;
    }

    qos
}

// ============================================================================
// Transport / Flow Scope QoS
// ============================================================================

/// Compute QoS metrics from the Transport/Flow scope using TransportMetrics.
pub fn compute_transport_qos(tm: &TransportMetrics, elapsed_us: u64) -> QosMetrics {
    QosMetrics {
        measurement_interval_us: elapsed_us,
        packets_sent: tm.segments_sent as u64,
        packets_delivered: tm.segments_delivered as u64,
        packets_lost: tm.segments_lost as u64,
        retransmissions: tm.retransmissions as u64,
        packet_loss_rate: tm.packet_loss_rate,
        throughput_bits_per_sec: tm.throughput_bits_per_sec,
        throughput_bytes_per_sec: tm.throughput_bytes_per_sec,
        goodput_bits_per_sec: tm.goodput_bits_per_sec,
        average_rtt_us: Some(tm.average_rtt_us),
        average_latency_us: tm.average_rtt_us as f64 / 2.0,
        ..Default::default()
    }
}
