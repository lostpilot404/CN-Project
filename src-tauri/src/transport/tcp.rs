use super::{
    resolve_route_and_links, ConnectionState, HopLink, RttEstimator, TcpFlag, TransportConfig,
    TransportEvent, TransportEventType, TransportMetrics, TransportProtocol, TransportSegment,
    TransportSimResult,
};
use crate::congestion::CongestionController;
use crate::domain::Project;
use crate::error::Result;
use crate::simulation::delays::calculate_tx_delay_us;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
struct InFlightSegment {
    seq: u32,
    len: usize,
    tx_time_us: u64,
    is_retransmit: bool,
    retries: u32,
}

#[derive(Debug, Clone)]
struct ArrivingAck {
    ack_number: u32,
    rx_time_us: u64,
}

/// Computes the transmission and propagation delay across a multi-hop link path.
fn calculate_forward_delay(links: &[HopLink], size_bytes: usize) -> u64 {
    links
        .iter()
        .map(|l| calculate_tx_delay_us(size_bytes, l.bandwidth_bps) + l.delay_us)
        .sum()
}

/// Simulates authoritative educational TCP with Jacobson/Karn RTT, Reno congestion control,
/// byte-oriented sequence numbers, cumulative ACKs, Fast Retransmit, and multi-hop queue drop-tail.
pub fn simulate_tcp(
    config: TransportConfig,
    project: Option<&Project>,
) -> Result<TransportSimResult> {
    let (derived_route, hop_links) = resolve_route_and_links(&config, project)?;

    let mut events = Vec::new();
    let mut step_index = 0;
    let mut curr_time_us: u64 = 0;

    let mss = config.segment_size_bytes.max(1);
    let mut congestion_controller = CongestionController::new(
        config.initial_cwnd_mss,
        config.initial_ssthresh_mss,
        mss as u64,
    );

    // Initial RTO clamped between 10ms and 3s
    let mut rtt_estimator = RttEstimator::new(config.initial_rto_us.max(10_000), 10_000, 3_000_000);

    let mut connection_state = ConnectionState::SynSent;

    let mut segments_sent = 0;
    let mut retransmissions = 0;
    let mut segments_lost = 0;
    let mut duplicate_acks = 0;
    let mut bytes_sent: u64 = 0;
    let mut bytes_delivered: u64 = 0;
    let mut timeout_count = 0;
    let mut fast_retransmit_count = 0;
    let mut receiver_window_occupancy_max = 0;
    let mut max_observed_cwnd = config.initial_cwnd_mss;

    // Multi-hop link state tracking for queue occupancy & drop-tail
    let mut link_next_free_us: Vec<u64> = vec![0; hop_links.len()];
    let mut link_queue_occupancy: Vec<usize> = vec![0; hop_links.len()];

    let client_node = config.source_node_id.clone();
    let server_node = config.destination_node_id.clone();

    // ==========================================
    // 1. THREE-WAY HANDSHAKE (SYN -> SYN-ACK -> ACK)
    // ==========================================
    let client_isn = config.initial_sequence_number;
    let server_isn = 5000u32;

    // Client sends SYN
    let syn_segment = TransportSegment {
        source_port: config.source_port,
        destination_port: config.destination_port,
        sequence_number: client_isn,
        acknowledgment_number: 0,
        flags: vec![TcpFlag::Syn],
        payload_length: 0,
        advertised_window: config.receive_window_bytes,
        timestamp_us: curr_time_us,
        is_retransmission: false,
    };

    events.push(TransportEvent {
        step_index,
        timestamp_us: curr_time_us,
        event_type: TransportEventType::SynSent,
        source_node: client_node.clone(),
        destination_node: server_node.clone(),
        segment: Some(syn_segment.clone()),
        connection_state,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: format!(
            "Client initiates TCP 3-way handshake: sent SYN [seq={}]",
            client_isn
        ),
    });
    step_index += 1;

    // SYN traverses hops to Server
    let syn_transit_delay = calculate_forward_delay(&hop_links, 40);
    let server_syn_rx_time = curr_time_us + syn_transit_delay;

    // Server receives SYN & enters SynReceived
    events.push(TransportEvent {
        step_index,
        timestamp_us: server_syn_rx_time,
        event_type: TransportEventType::SynReceived,
        source_node: client_node.clone(),
        destination_node: server_node.clone(),
        segment: Some(syn_segment),
        connection_state: ConnectionState::SynReceived,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: format!(
            "Server received SYN; transitioned from LISTEN to SYN-RECEIVED, replying with SYN-ACK [seq={}, ack={}]",
            server_isn,
            client_isn + 1
        ),
    });
    step_index += 1;

    // Server sends SYN-ACK back to Client
    let synack_segment = TransportSegment {
        source_port: config.destination_port,
        destination_port: config.source_port,
        sequence_number: server_isn,
        acknowledgment_number: client_isn + 1,
        flags: vec![TcpFlag::Syn, TcpFlag::Ack],
        payload_length: 0,
        advertised_window: config.receive_window_bytes,
        timestamp_us: server_syn_rx_time,
        is_retransmission: false,
    };

    let synack_transit_delay = calculate_forward_delay(&hop_links, 40);
    let client_synack_rx_time = server_syn_rx_time + synack_transit_delay;

    // Handshake RTT measurement: from client sending SYN to receiving SYN-ACK
    let handshake_rtt = client_synack_rx_time - curr_time_us;
    rtt_estimator.update_sample(handshake_rtt);

    // Client receives SYN-ACK & enters Established
    connection_state = ConnectionState::Established;
    events.push(TransportEvent {
        step_index,
        timestamp_us: client_synack_rx_time,
        event_type: TransportEventType::ConnectionEstablished,
        source_node: server_node.clone(),
        destination_node: client_node.clone(),
        segment: Some(synack_segment),
        connection_state,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: Some(handshake_rtt),
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: format!(
            "Client received SYN-ACK. First RTT sample = {} us (SRTT={} us, RTO={} us). Client state: ESTABLISHED",
            handshake_rtt, rtt_estimator.srtt_us, rtt_estimator.rto_us
        ),
    });
    step_index += 1;

    // Client sends ACK to finalize handshake
    let handshake_ack = TransportSegment {
        source_port: config.source_port,
        destination_port: config.destination_port,
        sequence_number: client_isn + 1,
        acknowledgment_number: server_isn + 1,
        flags: vec![TcpFlag::Ack],
        payload_length: 0,
        advertised_window: config.receive_window_bytes,
        timestamp_us: client_synack_rx_time,
        is_retransmission: false,
    };

    let handshake_complete_time = client_synack_rx_time + calculate_forward_delay(&hop_links, 40);
    events.push(TransportEvent {
        step_index,
        timestamp_us: handshake_complete_time,
        event_type: TransportEventType::ConnectionEstablished,
        source_node: client_node.clone(),
        destination_node: server_node.clone(),
        segment: Some(handshake_ack),
        connection_state,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description:
            "Server received final ACK. 3-way handshake COMPLETE. Both endpoints ESTABLISHED."
                .to_string(),
    });
    step_index += 1;

    curr_time_us = client_synack_rx_time;

    // ==========================================
    // 2. BYTE-ORIENTED DATA TRANSFER & CONGESTION
    // ==========================================
    let total_payload = config.payload_bytes;
    let data_start_seq = client_isn + 1;
    let max_seq = data_start_seq + total_payload as u32;

    let mut send_base = data_start_seq;
    let mut next_seq = data_start_seq;
    let mut rcv_nxt = data_start_seq;

    let mut in_flight: Vec<InFlightSegment> = Vec::new();
    let mut pending_acks: Vec<ArrivingAck> = Vec::new();
    let mut receiver_buffer: BTreeMap<u32, usize> = BTreeMap::new();
    let mut data_seg_counter: u32 = 0;

    let mut total_window_samples = 0;
    let mut cumulative_window_occupancy = 0.0;

    // Simulation loop advances until all data is acknowledged or max retries exceeded
    let mut iteration_guard = 0;
    while send_base < max_seq && iteration_guard < 100_000 {
        iteration_guard += 1;

        if congestion_controller.cwnd_mss > max_observed_cwnd {
            max_observed_cwnd = congestion_controller.cwnd_mss;
        }

        // Effective send window = min(cwnd_bytes, rwnd_bytes)
        let cwnd_bytes = congestion_controller.cwnd_bytes();
        let effective_window = cwnd_bytes.min(config.receive_window_bytes as u64);
        let in_flight_bytes: u64 = in_flight.iter().map(|s| s.len as u64).sum();

        total_window_samples += 1;
        cumulative_window_occupancy += in_flight_bytes as f64 / effective_window.max(1) as f64;

        // Try to transmit new segments if window allows and data remains
        while in_flight_bytes + mss as u64 <= effective_window && next_seq < max_seq {
            let seg_len = (max_seq - next_seq).min(mss as u32) as usize;
            let current_seg_idx = data_seg_counter;
            data_seg_counter += 1;

            segments_sent += 1;
            bytes_sent += seg_len as u64;

            let data_segment = TransportSegment {
                source_port: config.source_port,
                destination_port: config.destination_port,
                sequence_number: next_seq,
                acknowledgment_number: server_isn + 1,
                flags: vec![TcpFlag::Ack, TcpFlag::Psh],
                payload_length: seg_len,
                advertised_window: config.receive_window_bytes,
                timestamp_us: curr_time_us,
                is_retransmission: false,
            };

            events.push(TransportEvent {
                step_index,
                timestamp_us: curr_time_us,
                event_type: TransportEventType::DataSegmentSent,
                source_node: client_node.clone(),
                destination_node: server_node.clone(),
                segment: Some(data_segment.clone()),
                connection_state,
                cwnd_mss: congestion_controller.cwnd_mss,
                ssthresh_mss: congestion_controller.ssthresh_mss,
                rtt_sample_us: None,
                srtt_us: rtt_estimator.srtt_us,
                rttvar_us: rtt_estimator.rttvar_us,
                rto_us: rtt_estimator.rto_us,
                description: format!(
                    "Sent data segment [seq={}, len={}, seg_idx={}]. In-flight: {}/{} B",
                    next_seq,
                    seg_len,
                    current_seg_idx,
                    in_flight_bytes + seg_len as u64,
                    effective_window
                ),
            });
            step_index += 1;

            // Check if segment is intentionally dropped by configuration
            let is_dropped_by_config = config.dropped_segments.contains(&current_seg_idx);

            // Check multi-hop queue drop-tail behavior along path
            let mut is_dropped_by_queue = false;
            let mut transit_time = curr_time_us;

            for (hop_idx, hop) in hop_links.iter().enumerate() {
                let tx_delay = calculate_tx_delay_us(seg_len, hop.bandwidth_bps);
                // Release queue slots whose transmission completed before arrival
                if transit_time >= link_next_free_us[hop_idx] {
                    link_queue_occupancy[hop_idx] = 0;
                }

                if link_queue_occupancy[hop_idx] >= hop.queue_capacity {
                    // Drop-tail overflow!
                    is_dropped_by_queue = true;
                    segments_lost += 1;
                    events.push(TransportEvent {
                        step_index,
                        timestamp_us: transit_time,
                        event_type: TransportEventType::SegmentLost,
                        source_node: hop.source.clone(),
                        destination_node: hop.target.clone(),
                        segment: Some(data_segment.clone()),
                        connection_state,
                        cwnd_mss: congestion_controller.cwnd_mss,
                        ssthresh_mss: congestion_controller.ssthresh_mss,
                        rtt_sample_us: None,
                        srtt_us: rtt_estimator.srtt_us,
                        rttvar_us: rtt_estimator.rttvar_us,
                        rto_us: rtt_estimator.rto_us,
                        description: format!(
                            "Drop-Tail at hop '{}' -> '{}': queue capacity ({}) exceeded. Segment [seq={}] lost.",
                            hop.source, hop.target, hop.queue_capacity, next_seq
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
                    segment: Some(data_segment.clone()),
                    connection_state,
                    cwnd_mss: congestion_controller.cwnd_mss,
                    ssthresh_mss: congestion_controller.ssthresh_mss,
                    rtt_sample_us: None,
                    srtt_us: rtt_estimator.srtt_us,
                    rttvar_us: rtt_estimator.rttvar_us,
                    rto_us: rtt_estimator.rto_us,
                    description: format!(
                        "Controlled Loss: Segment [seq={}, seg_idx={}] intentionally dropped",
                        next_seq, current_seg_idx
                    ),
                });
                step_index += 1;
            }

            let will_arrive = !is_dropped_by_config && !is_dropped_by_queue;
            let arrival_time = transit_time;

            in_flight.push(InFlightSegment {
                seq: next_seq,
                len: seg_len,
                tx_time_us: curr_time_us,
                is_retransmit: false,
                retries: 0,
            });

            next_seq += seg_len as u32;

            // If segment will arrive, calculate receiver handling and resulting ACK return time
            if will_arrive {
                let rx_time = arrival_time;
                let seg_seq = data_segment.sequence_number;
                let seg_length = data_segment.payload_length;

                let ack_to_generate = if seg_seq == rcv_nxt {
                    // In-order reception: deliver contiguous data
                    rcv_nxt += seg_length as u32;
                    while let Some(&buffered_len) = receiver_buffer.get(&rcv_nxt) {
                        rcv_nxt += buffered_len as u32;
                        receiver_buffer.remove(&(rcv_nxt - buffered_len as u32));
                    }
                    rcv_nxt
                } else if seg_seq > rcv_nxt {
                    // Out-of-order reception: buffer segment and send duplicate ACK
                    receiver_buffer.insert(seg_seq, seg_length);
                    let current_buf_bytes: usize = receiver_buffer.values().sum();
                    if current_buf_bytes > receiver_window_occupancy_max {
                        receiver_window_occupancy_max = current_buf_bytes;
                    }
                    rcv_nxt
                } else {
                    // Stale or duplicate segment
                    rcv_nxt
                };

                let ack_return_delay = calculate_forward_delay(&hop_links, 40);
                pending_acks.push(ArrivingAck {
                    ack_number: ack_to_generate,
                    rx_time_us: rx_time + ack_return_delay,
                });
                pending_acks.sort_by_key(|a| a.rx_time_us);
            }
        }

        // Determine earliest event: either next arriving ACK or Timeout of oldest segment
        let oldest_tx_time = in_flight
            .first()
            .map(|s| s.tx_time_us)
            .unwrap_or(curr_time_us);
        let timeout_time = oldest_tx_time + rtt_estimator.rto_us;

        let next_ack = pending_acks.first().cloned();

        match next_ack {
            Some(ack_info) if ack_info.rx_time_us <= timeout_time => {
                // ACK arrives before timeout!
                pending_acks.remove(0);
                curr_time_us = ack_info.rx_time_us;

                let ack_seg = TransportSegment {
                    source_port: config.destination_port,
                    destination_port: config.source_port,
                    sequence_number: server_isn + 1,
                    acknowledgment_number: ack_info.ack_number,
                    flags: vec![TcpFlag::Ack],
                    payload_length: 0,
                    advertised_window: config.receive_window_bytes,
                    timestamp_us: curr_time_us,
                    is_retransmission: false,
                };

                if ack_info.ack_number > send_base {
                    // --- NEW ACK: Acknowledges new contiguous data ---
                    let bytes_acked = ack_info.ack_number - send_base;
                    send_base = ack_info.ack_number;
                    bytes_delivered += bytes_acked as u64;

                    // Check Karn's rule: measure RTT only if oldest acknowledged was not retransmitted
                    let mut sampled_rtt: Option<u64> = None;
                    if let Some(pos) = in_flight.iter().position(|s| s.seq < send_base) {
                        let acknowledged_seg = &in_flight[pos];
                        if !acknowledged_seg.is_retransmit {
                            let sample = curr_time_us.saturating_sub(acknowledged_seg.tx_time_us);
                            rtt_estimator.update_sample(sample);
                            sampled_rtt = Some(sample);
                        }
                    }

                    // Remove acknowledged segments from in-flight
                    in_flight.retain(|s| s.seq >= send_base);

                    congestion_controller.on_new_ack(curr_time_us, bytes_acked as u64);

                    events.push(TransportEvent {
                        step_index,
                        timestamp_us: curr_time_us,
                        event_type: TransportEventType::AckReceived,
                        source_node: server_node.clone(),
                        destination_node: client_node.clone(),
                        segment: Some(ack_seg),
                        connection_state,
                        cwnd_mss: congestion_controller.cwnd_mss,
                        ssthresh_mss: congestion_controller.ssthresh_mss,
                        rtt_sample_us: sampled_rtt,
                        srtt_us: rtt_estimator.srtt_us,
                        rttvar_us: rtt_estimator.rttvar_us,
                        rto_us: rtt_estimator.rto_us,
                        description: format!(
                            "Received ACK [ack={}]. Acknowledged {} bytes. Send base now {}. Cwnd={:.2} MSS ({:?})",
                            ack_info.ack_number,
                            bytes_acked,
                            send_base,
                            congestion_controller.cwnd_mss,
                            congestion_controller.phase
                        ),
                    });
                    step_index += 1;
                } else if ack_info.ack_number == send_base && !in_flight.is_empty() {
                    // --- DUPLICATE ACK ---
                    duplicate_acks += 1;
                    let is_fast_retransmit = congestion_controller.on_duplicate_ack(curr_time_us);

                    events.push(TransportEvent {
                        step_index,
                        timestamp_us: curr_time_us,
                        event_type: TransportEventType::AckReceived,
                        source_node: server_node.clone(),
                        destination_node: client_node.clone(),
                        segment: Some(ack_seg),
                        connection_state,
                        cwnd_mss: congestion_controller.cwnd_mss,
                        ssthresh_mss: congestion_controller.ssthresh_mss,
                        rtt_sample_us: None,
                        srtt_us: rtt_estimator.srtt_us,
                        rttvar_us: rtt_estimator.rttvar_us,
                        rto_us: rtt_estimator.rto_us,
                        description: format!(
                            "Duplicate cumulative ACK received [ack={}]. Dup count = {}.",
                            ack_info.ack_number, congestion_controller.duplicate_ack_count
                        ),
                    });
                    step_index += 1;

                    // Fast Retransmit on 3 duplicate ACKs
                    if is_fast_retransmit {
                        fast_retransmit_count += 1;
                        retransmissions += 1;

                        let missing_seg = in_flight.first_mut().unwrap();
                        missing_seg.is_retransmit = true;
                        missing_seg.tx_time_us = curr_time_us;
                        missing_seg.retries += 1;

                        let retransmit_seg = TransportSegment {
                            source_port: config.source_port,
                            destination_port: config.destination_port,
                            sequence_number: missing_seg.seq,
                            acknowledgment_number: server_isn + 1,
                            flags: vec![TcpFlag::Ack, TcpFlag::Psh],
                            payload_length: missing_seg.len,
                            advertised_window: config.receive_window_bytes,
                            timestamp_us: curr_time_us,
                            is_retransmission: true,
                        };

                        events.push(TransportEvent {
                            step_index,
                            timestamp_us: curr_time_us,
                            event_type: TransportEventType::Retransmission,
                            source_node: client_node.clone(),
                            destination_node: server_node.clone(),
                            segment: Some(retransmit_seg.clone()),
                            connection_state,
                            cwnd_mss: congestion_controller.cwnd_mss,
                            ssthresh_mss: congestion_controller.ssthresh_mss,
                            rtt_sample_us: None,
                            srtt_us: rtt_estimator.srtt_us,
                            rttvar_us: rtt_estimator.rttvar_us,
                            rto_us: rtt_estimator.rto_us,
                            description: format!(
                                "FAST RETRANSMIT: 3 duplicate ACKs detected. Immediately retransmitted missing segment [seq={}, len={}]. Entered Fast Recovery.",
                                missing_seg.seq, missing_seg.len
                            ),
                        });
                        step_index += 1;

                        // Retransmitted segment traverses network
                        let forward_delay = calculate_forward_delay(&hop_links, missing_seg.len);
                        let arrival_time = curr_time_us + forward_delay;

                        // Missing segment arrives, freeing receiver buffer
                        let rx_time = arrival_time;
                        let missing_len = missing_seg.len;
                        rcv_nxt += missing_len as u32;
                        while let Some(&buffered_len) = receiver_buffer.get(&rcv_nxt) {
                            rcv_nxt += buffered_len as u32;
                            receiver_buffer.remove(&(rcv_nxt - buffered_len as u32));
                        }

                        let ack_return_delay = calculate_forward_delay(&hop_links, 40);
                        pending_acks.push(ArrivingAck {
                            ack_number: rcv_nxt,
                            rx_time_us: rx_time + ack_return_delay,
                        });
                        pending_acks.sort_by_key(|a| a.rx_time_us);
                    }
                }
            }
            _ => {
                // Timeout occurred!
                if let Some(oldest_seg) = in_flight.first_mut() {
                    curr_time_us = timeout_time;
                    timeout_count += 1;
                    retransmissions += 1;

                    congestion_controller.on_timeout(curr_time_us);

                    // Exponential RTO backoff clamped to max bound
                    rtt_estimator.rto_us = (rtt_estimator.rto_us * 2)
                        .clamp(rtt_estimator.min_rto_us, rtt_estimator.max_rto_us);

                    oldest_seg.retries += 1;
                    oldest_seg.is_retransmit = true;
                    oldest_seg.tx_time_us = curr_time_us;

                    let retransmit_seg = TransportSegment {
                        source_port: config.source_port,
                        destination_port: config.destination_port,
                        sequence_number: oldest_seg.seq,
                        acknowledgment_number: server_isn + 1,
                        flags: vec![TcpFlag::Ack, TcpFlag::Psh],
                        payload_length: oldest_seg.len,
                        advertised_window: config.receive_window_bytes,
                        timestamp_us: curr_time_us,
                        is_retransmission: true,
                    };

                    events.push(TransportEvent {
                        step_index,
                        timestamp_us: curr_time_us,
                        event_type: TransportEventType::Timeout,
                        source_node: client_node.clone(),
                        destination_node: server_node.clone(),
                        segment: Some(retransmit_seg.clone()),
                        connection_state,
                        cwnd_mss: congestion_controller.cwnd_mss,
                        ssthresh_mss: congestion_controller.ssthresh_mss,
                        rtt_sample_us: None,
                        srtt_us: rtt_estimator.srtt_us,
                        rttvar_us: rtt_estimator.rttvar_us,
                        rto_us: rtt_estimator.rto_us,
                        description: format!(
                            "RTO TIMEOUT on segment [seq={}]. Retransmission #{} sent. cwnd reset to 1 MSS, ssthresh={:.1} MSS, backed-off RTO={} us.",
                            oldest_seg.seq, oldest_seg.retries, congestion_controller.ssthresh_mss, rtt_estimator.rto_us
                        ),
                    });
                    step_index += 1;

                    if oldest_seg.retries > config.maximum_retries {
                        break;
                    }

                    // Successful retransmission delivery
                    let forward_delay = calculate_forward_delay(&hop_links, oldest_seg.len);
                    let arrival_time = curr_time_us + forward_delay;

                    let rx_time = arrival_time;
                    let missing_len = oldest_seg.len;
                    rcv_nxt += missing_len as u32;
                    while let Some(&buffered_len) = receiver_buffer.get(&rcv_nxt) {
                        rcv_nxt += buffered_len as u32;
                        receiver_buffer.remove(&(rcv_nxt - buffered_len as u32));
                    }

                    let ack_return_delay = calculate_forward_delay(&hop_links, 40);
                    pending_acks.push(ArrivingAck {
                        ack_number: rcv_nxt,
                        rx_time_us: rx_time + ack_return_delay,
                    });
                    pending_acks.sort_by_key(|a| a.rx_time_us);
                } else {
                    curr_time_us += 10_000;
                }
            }
        }
    }

    let mut segments_delivered = (bytes_delivered as usize) / mss;
    if !(bytes_delivered as usize).is_multiple_of(mss) {
        segments_delivered += 1;
    }

    // ==========================================
    // 3. FOUR-STEP CONNECTION TEARDOWN
    // ==========================================
    let teardown_delay = calculate_forward_delay(&hop_links, 40);

    // Client sends FIN -> FinWait1
    connection_state = ConnectionState::FinWait1;
    let client_fin = TransportSegment {
        source_port: config.source_port,
        destination_port: config.destination_port,
        sequence_number: next_seq,
        acknowledgment_number: server_isn + 1,
        flags: vec![TcpFlag::Fin, TcpFlag::Ack],
        payload_length: 0,
        advertised_window: config.receive_window_bytes,
        timestamp_us: curr_time_us,
        is_retransmission: false,
    };

    events.push(TransportEvent {
        step_index,
        timestamp_us: curr_time_us,
        event_type: TransportEventType::ConnectionClosed,
        source_node: client_node.clone(),
        destination_node: server_node.clone(),
        segment: Some(client_fin),
        connection_state,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: "Client sends FIN. Client enters FIN-WAIT-1.".to_string(),
    });
    step_index += 1;

    // Server receives FIN -> CloseWait & responds with ACK
    let server_fin_rx_time = curr_time_us + teardown_delay;
    let server_ack = TransportSegment {
        source_port: config.destination_port,
        destination_port: config.source_port,
        sequence_number: server_isn + 1,
        acknowledgment_number: next_seq + 1,
        flags: vec![TcpFlag::Ack],
        payload_length: 0,
        advertised_window: config.receive_window_bytes,
        timestamp_us: server_fin_rx_time,
        is_retransmission: false,
    };

    events.push(TransportEvent {
        step_index,
        timestamp_us: server_fin_rx_time,
        event_type: TransportEventType::AckSent,
        source_node: server_node.clone(),
        destination_node: client_node.clone(),
        segment: Some(server_ack.clone()),
        connection_state: ConnectionState::CloseWait,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: "Server received FIN, enters CLOSE-WAIT, and replies with ACK.".to_string(),
    });
    step_index += 1;

    // Client receives ACK -> FinWait2
    let client_ack_rx_time = server_fin_rx_time + teardown_delay;
    connection_state = ConnectionState::FinWait2;
    events.push(TransportEvent {
        step_index,
        timestamp_us: client_ack_rx_time,
        event_type: TransportEventType::AckReceived,
        source_node: server_node.clone(),
        destination_node: client_node.clone(),
        segment: Some(server_ack),
        connection_state,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: "Client received ACK, transitions from FIN-WAIT-1 to FIN-WAIT-2.".to_string(),
    });
    step_index += 1;

    // Server sends FIN -> LastAck
    let server_fin_time = server_fin_rx_time + 1000;
    let server_fin = TransportSegment {
        source_port: config.destination_port,
        destination_port: config.source_port,
        sequence_number: server_isn + 1,
        acknowledgment_number: next_seq + 1,
        flags: vec![TcpFlag::Fin, TcpFlag::Ack],
        payload_length: 0,
        advertised_window: config.receive_window_bytes,
        timestamp_us: server_fin_time,
        is_retransmission: false,
    };

    events.push(TransportEvent {
        step_index,
        timestamp_us: server_fin_time,
        event_type: TransportEventType::ConnectionClosed,
        source_node: server_node.clone(),
        destination_node: client_node.clone(),
        segment: Some(server_fin),
        connection_state: ConnectionState::LastAck,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: "Server sends FIN, entering LAST-ACK state.".to_string(),
    });
    step_index += 1;

    // Client receives FIN -> TimeWait & sends final ACK
    let client_fin_rx_time = server_fin_time + teardown_delay;
    connection_state = ConnectionState::TimeWait;
    let final_ack = TransportSegment {
        source_port: config.source_port,
        destination_port: config.destination_port,
        sequence_number: next_seq + 1,
        acknowledgment_number: server_isn + 2,
        flags: vec![TcpFlag::Ack],
        payload_length: 0,
        advertised_window: config.receive_window_bytes,
        timestamp_us: client_fin_rx_time,
        is_retransmission: false,
    };

    events.push(TransportEvent {
        step_index,
        timestamp_us: client_fin_rx_time,
        event_type: TransportEventType::AckSent,
        source_node: client_node.clone(),
        destination_node: server_node.clone(),
        segment: Some(final_ack),
        connection_state,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: "Client received Server FIN, sent final ACK, entered TIME-WAIT.".to_string(),
    });
    step_index += 1;

    // Server receives final ACK -> Closed
    let server_closed_time = client_fin_rx_time + teardown_delay;
    events.push(TransportEvent {
        step_index,
        timestamp_us: server_closed_time,
        event_type: TransportEventType::ConnectionClosed,
        source_node: client_node.clone(),
        destination_node: server_node.clone(),
        segment: None,
        connection_state: ConnectionState::Closed,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description: "Server received final ACK -> CLOSED.".to_string(),
    });
    step_index += 1;

    // Client TIME-WAIT timer expires -> Closed
    curr_time_us = server_closed_time + 5000;
    connection_state = ConnectionState::Closed;
    events.push(TransportEvent {
        step_index,
        timestamp_us: curr_time_us,
        event_type: TransportEventType::ConnectionClosed,
        source_node: client_node,
        destination_node: server_node,
        segment: None,
        connection_state,
        cwnd_mss: congestion_controller.cwnd_mss,
        ssthresh_mss: congestion_controller.ssthresh_mss,
        rtt_sample_us: None,
        srtt_us: rtt_estimator.srtt_us,
        rttvar_us: rtt_estimator.rttvar_us,
        rto_us: rtt_estimator.rto_us,
        description:
            "Client 2MSL TIME-WAIT timer expired. Client state: CLOSED. Transfer complete."
                .to_string(),
    });

    // ==========================================
    // 4. METRICS & TELEMETRY
    // ==========================================
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

    let sender_window_occupancy_avg = if total_window_samples > 0 {
        cumulative_window_occupancy / total_window_samples as f64
    } else {
        0.0
    };

    let metrics = TransportMetrics {
        segments_sent,
        segments_delivered,
        retransmissions,
        segments_lost,
        duplicate_acks,
        bytes_sent,
        bytes_delivered,
        completion_time_us,
        average_rtt_us: rtt_estimator.average_rtt_us(),
        smoothed_rtt_us: rtt_estimator.srtt_us,
        final_rto_us: rtt_estimator.rto_us,
        throughput_bits_per_sec,
        throughput_bytes_per_sec,
        goodput_bits_per_sec,
        packet_loss_rate,
        sender_window_occupancy_avg,
        receiver_window_occupancy_max,
        congestion_window_final: congestion_controller.cwnd_mss,
        congestion_window_max: max_observed_cwnd,
        timeout_count,
        fast_retransmit_count,
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
        protocol: TransportProtocol::Tcp,
        config,
        derived_route,
        events,
        cwnd_timeline: congestion_controller.timeline,
        metrics,
        completed: send_base >= max_seq,
    })
}
