use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};

/// Supported Data Link layer flow control protocols.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowControlProtocol {
    SlidingWindow,
    GoBackN,
    SelectiveRepeat,
}

/// Status of an individual frame in the transmission buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameStatus {
    Pending,
    Transmitted,
    Acknowledged,
    Lost,
    Corrupted,
    TimedOut,
    Buffered,
    Delivered,
}

/// Flow control event types for step-by-step educational trace visualization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowEventType {
    FrameSent,
    FrameReceived,
    AckSent,
    AckReceived,
    FrameLost,
    FrameCorrupted,
    TimeoutTriggered,
    Retransmission,
    WindowAdvanced,
    DeliveredToNetwork,
}

/// Configuration for Flow Control simulations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowControlConfig {
    pub protocol: FlowControlProtocol,
    pub window_size: u32,
    pub sequence_space: u32,
    pub total_frames_to_send: u32,
    pub frame_tx_time_us: u64,
    pub prop_delay_us: u64,
    pub ack_tx_time_us: u64,
    pub timeout_us: u64,
    pub seed: u64,
    /// Explicit list of frame indices (0-based) to simulate as dropped in transit
    #[serde(default)]
    pub dropped_frame_indices: Vec<u32>,
    /// Explicit list of frame indices (0-based) to simulate as corrupted
    #[serde(default)]
    pub corrupted_frame_indices: Vec<u32>,
    /// Explicit list of ACK sequence numbers to drop in reverse transit
    #[serde(default)]
    pub dropped_ack_seqs: Vec<u32>,
}

impl Default for FlowControlConfig {
    fn default() -> Self {
        Self {
            protocol: FlowControlProtocol::GoBackN,
            window_size: 4,
            sequence_space: 8,
            total_frames_to_send: 8,
            frame_tx_time_us: 10_000,
            prop_delay_us: 40_000,
            ack_tx_time_us: 2_000,
            timeout_us: 150_000,
            seed: 42,
            dropped_frame_indices: Vec::new(),
            corrupted_frame_indices: Vec::new(),
            dropped_ack_seqs: Vec::new(),
        }
    }
}

/// Snapshot of the sender sliding window state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderWindowState {
    pub send_base: u32,
    pub next_seq_num: u32,
    pub window_size: u32,
    pub sequence_space: u32,
    pub active_window_seqs: Vec<u32>,
    pub unacknowledged_count: usize,
    pub is_window_full: bool,
}

/// Snapshot of the receiver sliding window state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiverWindowState {
    pub rcv_base: u32,
    pub window_size: u32,
    pub sequence_space: u32,
    pub active_window_seqs: Vec<u32>,
    pub buffered_seqs: Vec<u32>,
    pub delivered_count: usize,
}

/// Individual frame metadata in the simulation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlidingFrame {
    pub frame_index: u32,
    pub seq_num: u32,
    pub status: FrameStatus,
    pub is_retransmission: bool,
    pub tx_count: u32,
    pub sent_at_us: Option<u64>,
    pub acked_at_us: Option<u64>,
}

/// Step event recorded during execution for UI timeline inspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowControlEvent {
    pub step_index: usize,
    pub timestamp_us: u64,
    pub event_type: FlowEventType,
    pub frame_index: Option<u32>,
    pub seq_num: u32,
    pub ack_seq: Option<u32>,
    pub sender_window: SenderWindowState,
    pub receiver_window: ReceiverWindowState,
    pub description: String,
}

/// Measured performance metrics of the flow control simulation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowControlMetrics {
    pub total_frames_sent: usize,
    pub original_frames: usize,
    pub retransmissions: usize,
    pub ack_count: usize,
    pub duplicate_frames: usize,
    pub dropped_or_corrupted_frames: usize,
    pub completed_frames: usize,
    pub completion_time_us: u64,
    pub utilization: f64,
    pub protocol_overhead: f64,
    pub sender_window_occupancy_avg: f64,
    pub receiver_buffer_occupancy_max: usize,
}

/// Complete result of a flow control protocol simulation run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowControlSimResult {
    pub protocol: FlowControlProtocol,
    pub config: FlowControlConfig,
    pub events: Vec<FlowControlEvent>,
    pub frames: Vec<SlidingFrame>,
    pub metrics: FlowControlMetrics,
    pub final_sender: SenderWindowState,
    pub final_receiver: ReceiverWindowState,
    pub is_completed: bool,
}

// =========================================================================
// Mathematical Sequence-Space Validation and Modulo Arithmetic
// =========================================================================

/// Validates sequence space constraints for the selected protocol:
/// - Go-Back-N: sequence_space >= window_size + 1
/// - Selective Repeat: sequence_space >= 2 * window_size
pub fn validate_flow_control_config(config: &FlowControlConfig) -> Result<()> {
    if config.window_size == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "Window size must be at least 1".to_string(),
        ));
    }
    if config.sequence_space == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "Sequence space must be greater than 0".to_string(),
        ));
    }
    if config.total_frames_to_send == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "Total frames to send must be at least 1".to_string(),
        ));
    }

    match config.protocol {
        FlowControlProtocol::SlidingWindow | FlowControlProtocol::GoBackN => {
            if config.sequence_space < config.window_size + 1 {
                return Err(NetSimError::InvalidConfiguration(format!(
                    "Invalid Go-Back-N configuration: sequence space ({}) must be >= window size + 1 ({}).",
                    config.sequence_space,
                    config.window_size + 1
                )));
            }
        }
        FlowControlProtocol::SelectiveRepeat => {
            if config.sequence_space < 2 * config.window_size {
                return Err(NetSimError::InvalidConfiguration(format!(
                    "Invalid Selective Repeat configuration: sequence space ({}) must be >= 2 * window size ({}).",
                    config.sequence_space,
                    2 * config.window_size
                )));
            }
        }
    }

    Ok(())
}

/// Computes the forward circular distance from `from_seq` to `to_seq` modulo `seq_space`.
#[inline]
pub fn circular_distance(from_seq: u32, to_seq: u32, seq_space: u32) -> u32 {
    (to_seq + seq_space - from_seq) % seq_space
}

/// Checks whether `seq` lies inside the half-open circular window `[base, base + size)` modulo `seq_space`.
#[inline]
pub fn is_in_circular_window(seq: u32, base: u32, size: u32, seq_space: u32) -> bool {
    if size == 0 {
        return false;
    }
    let dist = circular_distance(base, seq, seq_space);
    dist < size
}

/// Returns the vector of sequence numbers in the window `[base, base + size)`.
pub fn get_window_sequences(base: u32, size: u32, seq_space: u32) -> Vec<u32> {
    (0..size).map(|i| (base + i) % seq_space).collect()
}

// =========================================================================
// Flow Control Simulation Engine
// =========================================================================

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct InFlightFrame {
    frame_index: u32,
    seq_num: u32,
    send_time_us: u64,
    arrival_time_us: u64,
    is_dropped: bool,
    is_corrupted: bool,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct InFlightAck {
    ack_seq: u32,
    is_selective: bool,
    frame_index: Option<u32>,
    send_time_us: u64,
    arrival_time_us: u64,
    is_dropped: bool,
}

/// Executes a discrete-event deterministic simulation of the configured flow control protocol.
pub fn simulate_flow_control(config: FlowControlConfig) -> Result<FlowControlSimResult> {
    validate_flow_control_config(&config)?;

    let mut current_time_us: u64 = 0;
    let mut step_counter: usize = 0;

    // Sender state
    let mut send_base: u32 = 0;
    let mut next_seq_num: u32 = 0;
    let mut next_frame_index_to_transmit: u32 = 0;

    // Frame tracking structures
    let total_frames = config.total_frames_to_send;
    let mut frames: Vec<SlidingFrame> = (0..total_frames)
        .map(|idx| SlidingFrame {
            frame_index: idx,
            seq_num: idx % config.sequence_space,
            status: FrameStatus::Pending,
            is_retransmission: false,
            tx_count: 0,
            sent_at_us: None,
            acked_at_us: None,
        })
        .collect();

    // Receiver state
    let mut rcv_base: u32 = 0;
    let rcv_window_size = match config.protocol {
        FlowControlProtocol::SelectiveRepeat => config.window_size,
        _ => 1,
    };
    let mut receiver_buffer: std::collections::BTreeMap<u32, u32> =
        std::collections::BTreeMap::new(); // seq -> frame_index
    let mut delivered_frames: Vec<u32> = Vec::new();

    // Timers:
    // GBN uses a single timer for send_base
    let mut gbn_timer_start_us: Option<u64> = None;
    // SR uses per-frame timers: frame_index -> tx_start_us
    let mut sr_frame_timers: std::collections::HashMap<u32, u64> = std::collections::HashMap::new();

    let mut in_flight_frames: Vec<InFlightFrame> = Vec::new();
    let mut in_flight_acks: Vec<InFlightAck> = Vec::new();
    let mut events: Vec<FlowControlEvent> = Vec::new();

    // Metrics tracking
    let mut total_transmissions = 0usize;
    let mut retransmissions_count = 0usize;
    let mut acks_count = 0usize;
    let mut duplicates_count = 0usize;
    let mut dropped_or_corrupted_count = 0usize;
    let mut max_receiver_buffer_occupancy = 0usize;
    let mut window_occupancy_samples: Vec<f64> = Vec::new();

    let make_sender_state = |sb: u32, ns: u32| -> SenderWindowState {
        let unack = circular_distance(sb, ns, config.sequence_space) as usize;
        let is_full = unack >= config.window_size as usize;
        let active = get_window_sequences(sb, config.window_size, config.sequence_space);
        SenderWindowState {
            send_base: sb,
            next_seq_num: ns,
            window_size: config.window_size,
            sequence_space: config.sequence_space,
            active_window_seqs: active,
            unacknowledged_count: unack,
            is_window_full: is_full,
        }
    };

    let make_receiver_state = |rb: u32,
                               buf: &std::collections::BTreeMap<u32, u32>,
                               del_len: usize|
     -> ReceiverWindowState {
        let active = get_window_sequences(rb, rcv_window_size, config.sequence_space);
        let buffered: Vec<u32> = buf.keys().cloned().collect();
        ReceiverWindowState {
            rcv_base: rb,
            window_size: rcv_window_size,
            sequence_space: config.sequence_space,
            active_window_seqs: active,
            buffered_seqs: buffered,
            delivered_count: del_len,
        }
    };

    // Main simulation event loop
    let max_sim_steps = 10_000;
    while delivered_frames.len() < total_frames as usize && step_counter < max_sim_steps {
        // Sample window occupancy
        let current_unack =
            circular_distance(send_base, next_seq_num, config.sequence_space) as usize;
        window_occupancy_samples.push(current_unack as f64 / config.window_size as f64);
        max_receiver_buffer_occupancy = max_receiver_buffer_occupancy.max(receiver_buffer.len());

        // 1. Check if sender can transmit new frames within the sliding window
        let window_used = circular_distance(send_base, next_seq_num, config.sequence_space);
        if window_used < config.window_size && next_frame_index_to_transmit < total_frames {
            let f_idx = next_frame_index_to_transmit;
            let seq = next_seq_num;
            let is_dropped = config.dropped_frame_indices.contains(&f_idx);
            let is_corrupted = config.corrupted_frame_indices.contains(&f_idx);

            total_transmissions += 1;
            frames[f_idx as usize].tx_count += 1;
            frames[f_idx as usize].sent_at_us = Some(current_time_us);
            frames[f_idx as usize].status = FrameStatus::Transmitted;

            let arr_time = current_time_us + config.frame_tx_time_us + config.prop_delay_us;
            in_flight_frames.push(InFlightFrame {
                frame_index: f_idx,
                seq_num: seq,
                send_time_us: current_time_us,
                arrival_time_us: arr_time,
                is_dropped,
                is_corrupted,
            });

            if config.protocol == FlowControlProtocol::GoBackN && gbn_timer_start_us.is_none() {
                gbn_timer_start_us = Some(current_time_us);
            }
            if config.protocol == FlowControlProtocol::SelectiveRepeat {
                sr_frame_timers.insert(f_idx, current_time_us);
            }

            step_counter += 1;
            events.push(FlowControlEvent {
                step_index: step_counter,
                timestamp_us: current_time_us,
                event_type: FlowEventType::FrameSent,
                frame_index: Some(f_idx),
                seq_num: seq,
                ack_seq: None,
                sender_window: make_sender_state(
                    send_base,
                    (next_seq_num + 1) % config.sequence_space,
                ),
                receiver_window: make_receiver_state(
                    rcv_base,
                    &receiver_buffer,
                    delivered_frames.len(),
                ),
                description: format!(
                    "Sender transmitted frame [{}] with seq {} (Window used: {}/{})",
                    f_idx,
                    seq,
                    window_used + 1,
                    config.window_size
                ),
            });

            next_seq_num = (next_seq_num + 1) % config.sequence_space;
            next_frame_index_to_transmit += 1;
            current_time_us += config.frame_tx_time_us;
            continue;
        }

        // 2. Identify the earliest pending discrete event:
        // - Frame arrival at receiver
        // - ACK arrival at sender
        // - Timeout expiration (GBN or SR)
        let next_frame_arr = in_flight_frames.iter().map(|f| f.arrival_time_us).min();
        let next_ack_arr = in_flight_acks.iter().map(|a| a.arrival_time_us).min();
        let next_gbn_timeout = if config.protocol == FlowControlProtocol::GoBackN {
            gbn_timer_start_us.map(|t| t + config.timeout_us)
        } else {
            None
        };

        let next_sr_timeout = if config.protocol == FlowControlProtocol::SelectiveRepeat {
            sr_frame_timers
                .values()
                .map(|&t| t + config.timeout_us)
                .min()
        } else {
            None
        };

        // Determine earliest event timestamp
        let mut candidates = Vec::new();
        if let Some(t) = next_frame_arr {
            candidates.push(t);
        }
        if let Some(t) = next_ack_arr {
            candidates.push(t);
        }
        if let Some(t) = next_gbn_timeout {
            candidates.push(t);
        }
        if let Some(t) = next_sr_timeout {
            candidates.push(t);
        }

        if candidates.is_empty() {
            break; // No events remaining
        }

        let earliest_time = *candidates.iter().min().unwrap();
        current_time_us = current_time_us.max(earliest_time);

        // A. Handle Frame Arrival at Receiver
        if let Some(pos) = in_flight_frames
            .iter()
            .position(|f| f.arrival_time_us <= current_time_us)
        {
            let frame = in_flight_frames.remove(pos);

            if frame.is_dropped {
                dropped_or_corrupted_count += 1;
                step_counter += 1;
                events.push(FlowControlEvent {
                    step_index: step_counter,
                    timestamp_us: current_time_us,
                    event_type: FlowEventType::FrameLost,
                    frame_index: Some(frame.frame_index),
                    seq_num: frame.seq_num,
                    ack_seq: None,
                    sender_window: make_sender_state(send_base, next_seq_num),
                    receiver_window: make_receiver_state(
                        rcv_base,
                        &receiver_buffer,
                        delivered_frames.len(),
                    ),
                    description: format!(
                        "Frame [{}] (seq {}) was lost in channel transit (Dropped)",
                        frame.frame_index, frame.seq_num
                    ),
                });
                continue;
            }

            if frame.is_corrupted {
                dropped_or_corrupted_count += 1;
                step_counter += 1;
                events.push(FlowControlEvent {
                    step_index: step_counter,
                    timestamp_us: current_time_us,
                    event_type: FlowEventType::FrameCorrupted,
                    frame_index: Some(frame.frame_index),
                    seq_num: frame.seq_num,
                    ack_seq: None,
                    sender_window: make_sender_state(send_base, next_seq_num),
                    receiver_window: make_receiver_state(rcv_base, &receiver_buffer, delivered_frames.len()),
                    description: format!(
                        "Frame [{}] (seq {}) arrived corrupted (Discarded by receiver CRC/Checksum check)",
                        frame.frame_index, frame.seq_num
                    ),
                });
                continue;
            }

            // Frame arrived intact at receiver
            step_counter += 1;
            events.push(FlowControlEvent {
                step_index: step_counter,
                timestamp_us: current_time_us,
                event_type: FlowEventType::FrameReceived,
                frame_index: Some(frame.frame_index),
                seq_num: frame.seq_num,
                ack_seq: None,
                sender_window: make_sender_state(send_base, next_seq_num),
                receiver_window: make_receiver_state(
                    rcv_base,
                    &receiver_buffer,
                    delivered_frames.len(),
                ),
                description: format!(
                    "Receiver received frame [{}] with seq {} (rcv_base is {})",
                    frame.frame_index, frame.seq_num, rcv_base
                ),
            });

            match config.protocol {
                FlowControlProtocol::SlidingWindow | FlowControlProtocol::GoBackN => {
                    // Receiver only accepts exact rcv_base
                    if frame.seq_num == rcv_base {
                        delivered_frames.push(frame.frame_index);
                        frames[frame.frame_index as usize].status = FrameStatus::Delivered;
                        rcv_base = (rcv_base + 1) % config.sequence_space;

                        // Generate Cumulative ACK for next expected frame (or current rcv_base)
                        acks_count += 1;
                        let ack_seq = rcv_base;
                        let ack_is_dropped = config.dropped_ack_seqs.contains(&ack_seq);
                        let ack_arrival =
                            current_time_us + config.ack_tx_time_us + config.prop_delay_us;

                        in_flight_acks.push(InFlightAck {
                            ack_seq,
                            is_selective: false,
                            frame_index: Some(frame.frame_index),
                            send_time_us: current_time_us,
                            arrival_time_us: ack_arrival,
                            is_dropped: ack_is_dropped,
                        });

                        step_counter += 1;
                        events.push(FlowControlEvent {
                            step_index: step_counter,
                            timestamp_us: current_time_us,
                            event_type: FlowEventType::AckSent,
                            frame_index: Some(frame.frame_index),
                            seq_num: frame.seq_num,
                            ack_seq: Some(ack_seq),
                            sender_window: make_sender_state(send_base, next_seq_num),
                            receiver_window: make_receiver_state(rcv_base, &receiver_buffer, delivered_frames.len()),
                            description: format!(
                                "Receiver accepted in-order frame [{}]; sent cumulative ACK {} (Expecting {})",
                                frame.frame_index, ack_seq, rcv_base
                            ),
                        });
                    } else {
                        // Out-of-order frame in GBN: discard and re-send ACK for rcv_base
                        duplicates_count += 1;
                        acks_count += 1;
                        let ack_seq = rcv_base;
                        let ack_is_dropped = config.dropped_ack_seqs.contains(&ack_seq);
                        let ack_arrival =
                            current_time_us + config.ack_tx_time_us + config.prop_delay_us;

                        in_flight_acks.push(InFlightAck {
                            ack_seq,
                            is_selective: false,
                            frame_index: None,
                            send_time_us: current_time_us,
                            arrival_time_us: ack_arrival,
                            is_dropped: ack_is_dropped,
                        });

                        step_counter += 1;
                        events.push(FlowControlEvent {
                            step_index: step_counter,
                            timestamp_us: current_time_us,
                            event_type: FlowEventType::AckSent,
                            frame_index: Some(frame.frame_index),
                            seq_num: frame.seq_num,
                            ack_seq: Some(ack_seq),
                            sender_window: make_sender_state(send_base, next_seq_num),
                            receiver_window: make_receiver_state(rcv_base, &receiver_buffer, delivered_frames.len()),
                            description: format!(
                                "Out-of-order frame [{}] (seq {}) discarded by GBN; resent cumulative duplicate ACK {}",
                                frame.frame_index, frame.seq_num, ack_seq
                            ),
                        });
                    }
                }
                FlowControlProtocol::SelectiveRepeat => {
                    // Receiver checks if seq_num falls within receiver window [rcv_base, rcv_base + W_r)
                    if is_in_circular_window(
                        frame.seq_num,
                        rcv_base,
                        rcv_window_size,
                        config.sequence_space,
                    ) {
                        // Send individual ACK for this frame
                        acks_count += 1;
                        let ack_seq = frame.seq_num;
                        let ack_is_dropped = config.dropped_ack_seqs.contains(&ack_seq);
                        let ack_arrival =
                            current_time_us + config.ack_tx_time_us + config.prop_delay_us;

                        in_flight_acks.push(InFlightAck {
                            ack_seq,
                            is_selective: true,
                            frame_index: Some(frame.frame_index),
                            send_time_us: current_time_us,
                            arrival_time_us: ack_arrival,
                            is_dropped: ack_is_dropped,
                        });

                        step_counter += 1;
                        events.push(FlowControlEvent {
                            step_index: step_counter,
                            timestamp_us: current_time_us,
                            event_type: FlowEventType::AckSent,
                            frame_index: Some(frame.frame_index),
                            seq_num: frame.seq_num,
                            ack_seq: Some(ack_seq),
                            sender_window: make_sender_state(send_base, next_seq_num),
                            receiver_window: make_receiver_state(rcv_base, &receiver_buffer, delivered_frames.len()),
                            description: format!(
                                "Receiver received frame [{}] within window; sent individual selective ACK {}",
                                frame.frame_index, ack_seq
                            ),
                        });

                        if frame.seq_num == rcv_base {
                            // In-order delivery
                            delivered_frames.push(frame.frame_index);
                            frames[frame.frame_index as usize].status = FrameStatus::Delivered;
                            rcv_base = (rcv_base + 1) % config.sequence_space;

                            // Cascading delivery of consecutive buffered frames
                            while let Some(&f_idx) = receiver_buffer.get(&rcv_base) {
                                receiver_buffer.remove(&rcv_base);
                                delivered_frames.push(f_idx);
                                frames[f_idx as usize].status = FrameStatus::Delivered;

                                step_counter += 1;
                                events.push(FlowControlEvent {
                                    step_index: step_counter,
                                    timestamp_us: current_time_us,
                                    event_type: FlowEventType::DeliveredToNetwork,
                                    frame_index: Some(f_idx),
                                    seq_num: rcv_base,
                                    ack_seq: None,
                                    sender_window: make_sender_state(send_base, next_seq_num),
                                    receiver_window: make_receiver_state(rcv_base, &receiver_buffer, delivered_frames.len()),
                                    description: format!(
                                        "Contiguous buffered frame [{}] delivered in-order to network layer (rcv_base advances)",
                                        f_idx
                                    ),
                                });

                                rcv_base = (rcv_base + 1) % config.sequence_space;
                            }
                        } else {
                            // Out-of-order frame within window: buffer it
                            receiver_buffer.insert(frame.seq_num, frame.frame_index);
                            frames[frame.frame_index as usize].status = FrameStatus::Buffered;
                        }
                    } else {
                        // Frame falls before rcv_base: duplicate transmission of already-delivered frame
                        duplicates_count += 1;
                        acks_count += 1;
                        let ack_seq = frame.seq_num;
                        let ack_is_dropped = config.dropped_ack_seqs.contains(&ack_seq);
                        let ack_arrival =
                            current_time_us + config.ack_tx_time_us + config.prop_delay_us;

                        in_flight_acks.push(InFlightAck {
                            ack_seq,
                            is_selective: true,
                            frame_index: Some(frame.frame_index),
                            send_time_us: current_time_us,
                            arrival_time_us: ack_arrival,
                            is_dropped: ack_is_dropped,
                        });
                    }
                }
            }
            continue;
        }

        // B. Handle ACK Arrival at Sender
        if let Some(pos) = in_flight_acks
            .iter()
            .position(|a| a.arrival_time_us <= current_time_us)
        {
            let ack = in_flight_acks.remove(pos);

            if ack.is_dropped {
                // ACK lost in reverse channel
                continue;
            }

            match config.protocol {
                FlowControlProtocol::SlidingWindow | FlowControlProtocol::GoBackN => {
                    // Cumulative ACK: ack.ack_seq is the next sequence number the receiver expects.
                    // If circular_distance(send_base, ack_seq) > 0 and <= window_size, advance send_base!
                    let advance = circular_distance(send_base, ack.ack_seq, config.sequence_space);
                    if advance > 0 && advance <= config.window_size {
                        let old_base = send_base;
                        send_base = ack.ack_seq;

                        // Mark acknowledged frames
                        for i in 0..advance {
                            let seq = (old_base + i) % config.sequence_space;
                            for f in &mut frames {
                                if f.seq_num == seq && f.status == FrameStatus::Transmitted {
                                    f.status = FrameStatus::Acknowledged;
                                    f.acked_at_us = Some(current_time_us);
                                }
                            }
                        }

                        // Reset or restart GBN timer
                        if send_base == next_seq_num {
                            gbn_timer_start_us = None; // All outstanding frames acknowledged
                        } else {
                            gbn_timer_start_us = Some(current_time_us); // Restart timer for next oldest frame
                        }

                        step_counter += 1;
                        events.push(FlowControlEvent {
                            step_index: step_counter,
                            timestamp_us: current_time_us,
                            event_type: FlowEventType::AckReceived,
                            frame_index: ack.frame_index,
                            seq_num: ack.ack_seq,
                            ack_seq: Some(ack.ack_seq),
                            sender_window: make_sender_state(send_base, next_seq_num),
                            receiver_window: make_receiver_state(
                                rcv_base,
                                &receiver_buffer,
                                delivered_frames.len(),
                            ),
                            description: format!(
                                "Sender received cumulative ACK {}; window advanced from {} to {}",
                                ack.ack_seq, old_base, send_base
                            ),
                        });
                    }
                }
                FlowControlProtocol::SelectiveRepeat => {
                    // Individual ACK: acknowledge specific frame
                    if let Some(f_idx) = ack.frame_index {
                        if (f_idx as usize) < frames.len() {
                            frames[f_idx as usize].status = FrameStatus::Acknowledged;
                            frames[f_idx as usize].acked_at_us = Some(current_time_us);
                            sr_frame_timers.remove(&f_idx);

                            // Advance send_base as long as the oldest frame is acknowledged
                            let mut advanced = false;
                            while send_base != next_seq_num {
                                // Find frame corresponding to send_base
                                let base_frame = frames.iter().find(|f| {
                                    f.seq_num == send_base
                                        && (f.status == FrameStatus::Acknowledged
                                            || f.status == FrameStatus::Delivered)
                                });
                                if base_frame.is_some() {
                                    send_base = (send_base + 1) % config.sequence_space;
                                    advanced = true;
                                } else {
                                    break;
                                }
                            }

                            step_counter += 1;
                            events.push(FlowControlEvent {
                                step_index: step_counter,
                                timestamp_us: current_time_us,
                                event_type: FlowEventType::AckReceived,
                                frame_index: Some(f_idx),
                                seq_num: ack.ack_seq,
                                ack_seq: Some(ack.ack_seq),
                                sender_window: make_sender_state(send_base, next_seq_num),
                                receiver_window: make_receiver_state(
                                    rcv_base,
                                    &receiver_buffer,
                                    delivered_frames.len(),
                                ),
                                description: format!(
                                    "Sender received selective ACK {} for frame [{}]{}",
                                    ack.ack_seq,
                                    f_idx,
                                    if advanced {
                                        format!("; send_base advanced to {}", send_base)
                                    } else {
                                        "".to_string()
                                    }
                                ),
                            });
                        }
                    }
                }
            }
            continue;
        }

        // C. Handle Timeout Expiration & Retransmission
        if config.protocol == FlowControlProtocol::GoBackN {
            if let Some(t_start) = gbn_timer_start_us {
                if current_time_us >= t_start + config.timeout_us {
                    // Go-Back-N timeout! Retransmit ALL outstanding unacknowledged frames starting from send_base
                    let unack_count =
                        circular_distance(send_base, next_seq_num, config.sequence_space);

                    step_counter += 1;
                    events.push(FlowControlEvent {
                        step_index: step_counter,
                        timestamp_us: current_time_us,
                        event_type: FlowEventType::TimeoutTriggered,
                        frame_index: None,
                        seq_num: send_base,
                        ack_seq: None,
                        sender_window: make_sender_state(send_base, next_seq_num),
                        receiver_window: make_receiver_state(rcv_base, &receiver_buffer, delivered_frames.len()),
                        description: format!(
                            "GBN Timeout on oldest unacknowledged frame (seq {}); retransmitting all {} outstanding frames in window",
                            send_base, unack_count
                        ),
                    });

                    // Restart timer
                    gbn_timer_start_us = Some(current_time_us);

                    // Re-send all outstanding frames from send_base to next_seq_num - 1
                    for offset in 0..unack_count {
                        let seq = (send_base + offset) % config.sequence_space;
                        // Find the unacknowledged frame in frames list
                        if let Some(f) = frames
                            .iter_mut()
                            .find(|f| f.seq_num == seq && f.status == FrameStatus::Transmitted)
                        {
                            f.tx_count += 1;
                            f.is_retransmission = true;
                            total_transmissions += 1;
                            retransmissions_count += 1;

                            let arr_time =
                                current_time_us + config.frame_tx_time_us + config.prop_delay_us;
                            in_flight_frames.push(InFlightFrame {
                                frame_index: f.frame_index,
                                seq_num: seq,
                                send_time_us: current_time_us,
                                arrival_time_us: arr_time,
                                is_dropped: false, // Retransmission is delivered unless explicitly dropped
                                is_corrupted: false,
                            });

                            step_counter += 1;
                            events.push(FlowControlEvent {
                                step_index: step_counter,
                                timestamp_us: current_time_us,
                                event_type: FlowEventType::Retransmission,
                                frame_index: Some(f.frame_index),
                                seq_num: seq,
                                ack_seq: None,
                                sender_window: make_sender_state(send_base, next_seq_num),
                                receiver_window: make_receiver_state(
                                    rcv_base,
                                    &receiver_buffer,
                                    delivered_frames.len(),
                                ),
                                description: format!(
                                    "GBN retransmitted outstanding frame [{}] with seq {}",
                                    f.frame_index, seq
                                ),
                            });
                        }
                    }
                    continue;
                }
            }
        } else if config.protocol == FlowControlProtocol::SelectiveRepeat {
            // Check individual frame timers
            let timed_out_frames: Vec<(u32, u64)> = sr_frame_timers
                .iter()
                .filter(|(_, &t)| current_time_us >= t + config.timeout_us)
                .map(|(&idx, &t)| (idx, t))
                .collect();

            if let Some((f_idx, _)) = timed_out_frames.first().cloned() {
                sr_frame_timers.insert(f_idx, current_time_us); // Reset timer for this specific frame
                let seq = frames[f_idx as usize].seq_num;
                frames[f_idx as usize].tx_count += 1;
                frames[f_idx as usize].is_retransmission = true;
                total_transmissions += 1;
                retransmissions_count += 1;

                let arr_time = current_time_us + config.frame_tx_time_us + config.prop_delay_us;
                in_flight_frames.push(InFlightFrame {
                    frame_index: f_idx,
                    seq_num: seq,
                    send_time_us: current_time_us,
                    arrival_time_us: arr_time,
                    is_dropped: false,
                    is_corrupted: false,
                });

                step_counter += 1;
                events.push(FlowControlEvent {
                    step_index: step_counter,
                    timestamp_us: current_time_us,
                    event_type: FlowEventType::TimeoutTriggered,
                    frame_index: Some(f_idx),
                    seq_num: seq,
                    ack_seq: None,
                    sender_window: make_sender_state(send_base, next_seq_num),
                    receiver_window: make_receiver_state(rcv_base, &receiver_buffer, delivered_frames.len()),
                    description: format!(
                        "Selective Repeat timeout on frame [{}] (seq {}); retransmitting ONLY this frame",
                        f_idx, seq
                    ),
                });
                continue;
            }
        }
    }

    let completion_time = current_time_us;
    let original_frames = total_frames as usize;
    let completed_frames = delivered_frames.len();
    let useful_time_us = (completed_frames as u64) * config.frame_tx_time_us;
    let utilization = if completion_time > 0 {
        useful_time_us as f64 / completion_time as f64
    } else {
        0.0
    };
    let protocol_overhead = if total_transmissions > 0 {
        (retransmissions_count + acks_count) as f64 / total_transmissions as f64
    } else {
        0.0
    };
    let avg_occupancy = if !window_occupancy_samples.is_empty() {
        window_occupancy_samples.iter().sum::<f64>() / window_occupancy_samples.len() as f64
    } else {
        0.0
    };

    let metrics = FlowControlMetrics {
        total_frames_sent: total_transmissions,
        original_frames,
        retransmissions: retransmissions_count,
        ack_count: acks_count,
        duplicate_frames: duplicates_count,
        dropped_or_corrupted_frames: dropped_or_corrupted_count,
        completed_frames,
        completion_time_us: completion_time,
        utilization,
        protocol_overhead,
        sender_window_occupancy_avg: avg_occupancy,
        receiver_buffer_occupancy_max: max_receiver_buffer_occupancy,
    };

    let final_sender = make_sender_state(send_base, next_seq_num);
    let final_receiver = make_receiver_state(rcv_base, &receiver_buffer, delivered_frames.len());

    Ok(FlowControlSimResult {
        protocol: config.protocol,
        config,
        events,
        frames,
        metrics,
        final_sender,
        final_receiver,
        is_completed: completed_frames == original_frames,
    })
}

/// Convenience wrapper for Sliding Window protocol simulation.
pub fn simulate_sliding_window(mut config: FlowControlConfig) -> Result<FlowControlSimResult> {
    config.protocol = FlowControlProtocol::SlidingWindow;
    simulate_flow_control(config)
}

/// Convenience wrapper for Go-Back-N protocol simulation.
pub fn simulate_go_back_n(mut config: FlowControlConfig) -> Result<FlowControlSimResult> {
    config.protocol = FlowControlProtocol::GoBackN;
    simulate_flow_control(config)
}

/// Convenience wrapper for Selective Repeat protocol simulation.
pub fn simulate_selective_repeat(mut config: FlowControlConfig) -> Result<FlowControlSimResult> {
    config.protocol = FlowControlProtocol::SelectiveRepeat;
    simulate_flow_control(config)
}
