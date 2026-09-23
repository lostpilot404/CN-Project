use super::{
    resolve_route_and_links, ConnectionState, TransportConfig, TransportEvent, TransportEventType,
    TransportMetrics, TransportProtocol, TransportSegment, TransportSimResult,
};
use crate::domain::Project;
use crate::error::Result;
use crate::simulation::delays::calculate_tx_delay_us;

/// Simulates authoritative educational UDP datagram transmission.
///
/// UDP guarantees:
/// - Connectionless datagram delivery
/// - No 3-way handshake
/// - No transport-layer ACKs
/// - No retransmissions (lost datagrams remain permanently lost)
/// - Multi-hop routing across real project topology links
/// - Realistic per-link drop-tail queue interaction and bottleneck bandwidth
pub fn simulate_udp(
    config: TransportConfig,
    project: Option<&Project>,
) -> Result<TransportSimResult> {
    let (derived_route, hop_links) = resolve_route_and_links(&config, project)?;

    let mut events = Vec::new();
    let mut step_index = 0;
    let mut curr_time_us: u64 = 0;

    let mss = config.segment_size_bytes.max(1);
    let total_bytes = config.payload_bytes;
    let total_datagrams = total_bytes.div_ceil(mss).max(1);

    let mut segments_sent = 0;
    let mut segments_delivered = 0;
    let mut segments_lost = 0;
    let mut bytes_sent: u64 = 0;
    let mut bytes_delivered: u64 = 0;

    let mut link_next_free_us: Vec<u64> = vec![0; hop_links.len()];
    let mut link_queue_occupancy: Vec<usize> = vec![0; hop_links.len()];

    let client_node = config.source_node_id.clone();
    let server_node = config.destination_node_id.clone();

    for d_idx in 0..total_datagrams {
        let remaining = total_bytes.saturating_sub(d_idx * mss);
        let datagram_len = remaining.min(mss);

        segments_sent += 1;
        bytes_sent += datagram_len as u64;

        let segment = TransportSegment {
            source_port: config.source_port,
            destination_port: config.destination_port,
            sequence_number: (config.initial_sequence_number + (d_idx * mss) as u32),
            acknowledgment_number: 0,
            flags: Vec::new(),
            payload_length: datagram_len,
            advertised_window: 0,
            timestamp_us: curr_time_us,
            is_retransmission: false,
        };

        events.push(TransportEvent {
            step_index,
            timestamp_us: curr_time_us,
            event_type: TransportEventType::DataSegmentSent,
            source_node: client_node.clone(),
            destination_node: server_node.clone(),
            segment: Some(segment.clone()),
            connection_state: ConnectionState::Closed,
            cwnd_mss: 0.0,
            ssthresh_mss: 0.0,
            rtt_sample_us: None,
            srtt_us: 0,
            rttvar_us: 0,
            rto_us: 0,
            description: format!(
                "Sent UDP datagram #{} [seq={}, len={} B]",
                d_idx + 1,
                segment.sequence_number,
                datagram_len
            ),
        });
        step_index += 1;

        // Check configured intentional drops
        let is_dropped_by_config = config.dropped_segments.contains(&(d_idx as u32));

        // Traverse hops & simulate link queue occupancy
        let mut is_dropped_by_queue = false;
        let mut transit_time = curr_time_us;

        for (hop_idx, hop) in hop_links.iter().enumerate() {
            let tx_delay = calculate_tx_delay_us(datagram_len, hop.bandwidth_bps);

            // Drain packets that already departed
            if transit_time >= link_next_free_us[hop_idx] {
                link_queue_occupancy[hop_idx] = 0;
            }

            if link_queue_occupancy[hop_idx] >= hop.queue_capacity {
                // Drop-Tail overflow
                is_dropped_by_queue = true;
                segments_lost += 1;
                events.push(TransportEvent {
                    step_index,
                    timestamp_us: transit_time,
                    event_type: TransportEventType::SegmentLost,
                    source_node: hop.source.clone(),
                    destination_node: hop.target.clone(),
                    segment: Some(segment.clone()),
                    connection_state: ConnectionState::Closed,
                    cwnd_mss: 0.0,
                    ssthresh_mss: 0.0,
                    rtt_sample_us: None,
                    srtt_us: 0,
                    rttvar_us: 0,
                    rto_us: 0,
                    description: format!(
                        "Drop-Tail at hop '{}' -> '{}': queue capacity ({}) exceeded. Datagram #{} lost.",
                        hop.source, hop.target, hop.queue_capacity, d_idx + 1
                    ),
                });
                step_index += 1;
                break;
            } else {
                link_queue_occupancy[hop_idx] += 1;
                let serialize_start = transit_time.max(link_next_free_us[hop_idx]);
                link_next_free_us[hop_idx] = serialize_start + tx_delay;
                transit_time = serialize_start + tx_delay + hop.delay_us;
            }
        }

        if is_dropped_by_config && !is_dropped_by_queue {
            segments_lost += 1;
            events.push(TransportEvent {
                step_index,
                timestamp_us: curr_time_us + 100,
                event_type: TransportEventType::SegmentLost,
                source_node: client_node.clone(),
                destination_node: server_node.clone(),
                segment: Some(segment.clone()),
                connection_state: ConnectionState::Closed,
                cwnd_mss: 0.0,
                ssthresh_mss: 0.0,
                rtt_sample_us: None,
                srtt_us: 0,
                rttvar_us: 0,
                rto_us: 0,
                description: format!(
                    "Controlled Loss: UDP datagram #{} intentionally dropped (no transport retransmission)",
                    d_idx + 1
                ),
            });
            step_index += 1;
        }

        if !is_dropped_by_config && !is_dropped_by_queue {
            segments_delivered += 1;
            bytes_delivered += datagram_len as u64;

            events.push(TransportEvent {
                step_index,
                timestamp_us: transit_time,
                event_type: TransportEventType::SegmentDelivered,
                source_node: client_node.clone(),
                destination_node: server_node.clone(),
                segment: Some(segment),
                connection_state: ConnectionState::Closed,
                cwnd_mss: 0.0,
                ssthresh_mss: 0.0,
                rtt_sample_us: None,
                srtt_us: 0,
                rttvar_us: 0,
                rto_us: 0,
                description: format!(
                    "UDP datagram #{} successfully delivered at destination [transit_time={} us]",
                    d_idx + 1,
                    transit_time
                ),
            });
            step_index += 1;
        }

        // Advance simulation clock for subsequent datagram transmissions
        curr_time_us += 5000; // 5ms pacing between datagrams
    }

    let completion_time_us = curr_time_us.max(1);
    let throughput_bits_per_sec =
        (bytes_sent as f64 * 8.0 * 1_000_000.0) / completion_time_us as f64;
    let throughput_bytes_per_sec = (bytes_sent as f64 * 1_000_000.0) / completion_time_us as f64;
    let goodput_bits_per_sec =
        (bytes_delivered as f64 * 8.0 * 1_000_000.0) / completion_time_us as f64;
    let total_attempts = segments_sent + segments_lost;
    let packet_loss_rate = if total_attempts > 0 {
        segments_lost as f64 / total_attempts as f64
    } else {
        0.0
    };

    let metrics = TransportMetrics {
        segments_sent,
        segments_delivered,
        retransmissions: 0,
        segments_lost,
        duplicate_acks: 0,
        bytes_sent,
        bytes_delivered,
        completion_time_us,
        average_rtt_us: 0,
        smoothed_rtt_us: 0,
        final_rto_us: 0,
        throughput_bits_per_sec,
        throughput_bytes_per_sec,
        goodput_bits_per_sec,
        packet_loss_rate,
        sender_window_occupancy_avg: 0.0,
        receiver_window_occupancy_max: 0,
        congestion_window_final: 0.0,
        congestion_window_max: 0.0,
        timeout_count: 0,
        fast_retransmit_count: 0,
    };

    events.sort_by(|a, b| {
        a.timestamp_us
            .cmp(&b.timestamp_us)
            .then_with(|| a.step_index.cmp(&b.step_index))
    });
    for (idx, event) in events.iter_mut().enumerate() {
        event.step_index = idx;
    }

    Ok(TransportSimResult {
        protocol: TransportProtocol::Udp,
        config,
        derived_route,
        events,
        cwnd_timeline: Vec::new(),
        metrics,
        completed: true,
    })
}
