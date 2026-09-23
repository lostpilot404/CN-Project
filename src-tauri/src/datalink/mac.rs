use crate::error::{NetSimError, Result};
use crate::simulation::DeterministicRng;
use serde::{Deserialize, Serialize};

/// Supported Medium Access Control (MAC) protocols.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MacProtocol {
    PureAloha,
    SlottedAloha,
    Csma,
    CsmaCd,
}

/// Persistence strategy for CSMA protocols.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CsmaPersistence {
    OnePersistent,
    NonPersistent,
    PPersistent { probability: f64 },
}

/// Channel state for shared medium modeling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelState {
    Idle,
    Busy,
    Collision,
}

/// Granular MAC event types for timeline inspection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MacEventType {
    CarrierSensed,
    TransmissionStarted,
    CollisionDetected,
    JamSignalSent,
    TransmissionAborted,
    BackoffScheduled,
    BackoffExpired,
    TransmissionSuccess,
}

/// Configuration for MAC layer protocols.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacConfig {
    pub protocol: MacProtocol,
    pub persistence: CsmaPersistence,
    pub num_stations: u32,
    pub total_frames_to_send: u32,
    pub frame_duration_us: u64,
    pub prop_delay_us: u64,
    pub frame_size_bits: u64,
    pub seed: u64,
    pub max_retries: u32,
    /// Offered load in arrivals per frame duration G (used for Poisson traffic generation)
    pub offered_load_g: f64,
}

impl Default for MacConfig {
    fn default() -> Self {
        Self {
            protocol: MacProtocol::CsmaCd,
            persistence: CsmaPersistence::OnePersistent,
            num_stations: 4,
            total_frames_to_send: 10,
            frame_duration_us: 10_000, // 10ms frame tx time
            prop_delay_us: 50,         // 50µs one-way propagation
            frame_size_bits: 8_000,    // 1000 bytes
            seed: 12345,
            max_retries: 16,
            offered_load_g: 1.5,
        }
    }
}

/// Recorded event in the MAC execution timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacEvent {
    pub step_index: usize,
    pub timestamp_us: u64,
    pub event_type: MacEventType,
    pub station_id: u32,
    pub frame_id: u32,
    pub channel_state: ChannelState,
    pub description: String,
}

/// Individual slot record for Slotted ALOHA and p-persistent CSMA.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotRecord {
    pub slot_index: u64,
    pub start_time_us: u64,
    pub end_time_us: u64,
    pub participating_stations: Vec<u32>,
    pub status: String, // "Idle", "Success (Station X)", "Collision (Stations ...)"
}

/// Measured performance metrics for MAC simulations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacMetrics {
    pub attempted_transmissions: usize,
    pub successful_transmissions: usize,
    pub collisions: usize,
    pub retransmissions: usize,
    pub channel_busy_time_us: u64,
    pub total_simulation_time_us: u64,
    pub throughput_frames_per_sec: f64,
    pub throughput_bits_per_sec: f64,
    pub collision_rate: f64,
    pub channel_utilization: f64,
    pub average_backoff_delay_us: f64,
}

/// Complete MAC simulation output with authoritative traces and metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacSimResult {
    pub protocol: MacProtocol,
    pub config: MacConfig,
    pub events: Vec<MacEvent>,
    pub slot_records: Vec<SlotRecord>,
    pub metrics: MacMetrics,
    pub completed_successfully: bool,
}

// =========================================================================
// Pure ALOHA Simulation
// =========================================================================

#[derive(Debug, Clone)]
struct StationQueue {
    station_id: u32,
    pending_frames: u32,
    next_attempt_us: u64,
    active_frame_id: u32,
    collision_count: u32,
}

pub fn simulate_pure_aloha(config: MacConfig) -> Result<MacSimResult> {
    if config.num_stations == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "num_stations must be >= 1".to_string(),
        ));
    }
    if config.frame_duration_us == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "frame_duration_us must be > 0".to_string(),
        ));
    }

    let mut rng = DeterministicRng::new(config.seed);
    let mut current_time_us: u64 = 0;
    let mut step_index: usize = 0;

    // Distribute total_frames_to_send across stations
    let frames_per_station = config.total_frames_to_send.div_ceil(config.num_stations);
    let mut stations: Vec<StationQueue> = (0..config.num_stations)
        .map(|id| {
            let offset_factor = rng.gen_range_f64(0.0, 2.0);
            let initial_time = (offset_factor * config.frame_duration_us as f64) as u64;
            StationQueue {
                station_id: id,
                pending_frames: frames_per_station,
                next_attempt_us: initial_time,
                active_frame_id: 1,
                collision_count: 0,
            }
        })
        .collect();

    let mut events: Vec<MacEvent> = Vec::new();
    let mut total_attempts = 0usize;
    let mut successful_tx = 0usize;
    let mut collision_count = 0usize;
    let mut retransmission_count = 0usize;
    let mut total_backoff_delay_us = 0u64;
    let mut channel_busy_us = 0u64;

    let target_successful = config.total_frames_to_send as usize;
    let max_steps = 15_000;

    while successful_tx < target_successful && step_index < max_steps {
        // Find next stations ready to transmit
        let min_time = stations
            .iter()
            .filter(|s| s.pending_frames > 0)
            .map(|s| s.next_attempt_us)
            .min();

        if min_time.is_none() {
            break;
        }

        let next_event_time = min_time.unwrap();
        current_time_us = current_time_us.max(next_event_time);

        // In Pure ALOHA, vulnerable period is 2 * frame_duration_us.
        // Identify all stations that attempt transmission within [current_time_us, current_time_us + frame_duration_us)
        let transmitting_indices: Vec<usize> = stations
            .iter()
            .enumerate()
            .filter(|(_, s)| {
                s.pending_frames > 0
                    && s.next_attempt_us < current_time_us + config.frame_duration_us
            })
            .map(|(i, _)| i)
            .collect();

        if transmitting_indices.len() == 1 {
            // Success! Single station transmitting without overlapping interval
            let idx = transmitting_indices[0];
            let st = &mut stations[idx];
            total_attempts += 1;
            successful_tx += 1;
            channel_busy_us += config.frame_duration_us;

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: current_time_us,
                event_type: MacEventType::TransmissionStarted,
                station_id: st.station_id,
                frame_id: st.active_frame_id,
                channel_state: ChannelState::Busy,
                description: format!(
                    "Station {} started transmission of frame {}",
                    st.station_id, st.active_frame_id
                ),
            });

            current_time_us += config.frame_duration_us;

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: current_time_us,
                event_type: MacEventType::TransmissionSuccess,
                station_id: st.station_id,
                frame_id: st.active_frame_id,
                channel_state: ChannelState::Idle,
                description: format!(
                    "Station {} completed successful transmission of frame {}",
                    st.station_id, st.active_frame_id
                ),
            });

            st.pending_frames -= 1;
            st.active_frame_id += 1;
            st.collision_count = 0;
            // Schedule next frame with Poisson-like arrival delay
            let arrival_delay =
                (rng.gen_range_f64(1.0, 3.0) * config.frame_duration_us as f64) as u64;
            st.next_attempt_us = current_time_us + arrival_delay;
        } else {
            // Collision! Two or more stations overlapped in the vulnerable window
            collision_count += transmitting_indices.len();
            total_attempts += transmitting_indices.len();
            retransmission_count += transmitting_indices.len();
            channel_busy_us += config.frame_duration_us;

            let colliding_ids: Vec<u32> = transmitting_indices
                .iter()
                .map(|&i| stations[i].station_id)
                .collect();

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: current_time_us,
                event_type: MacEventType::CollisionDetected,
                station_id: colliding_ids[0],
                frame_id: 0,
                channel_state: ChannelState::Collision,
                description: format!(
                    "Collision detected in Pure ALOHA between stations {:?}",
                    colliding_ids
                ),
            });

            current_time_us += config.frame_duration_us;

            // Apply randomized backoff for each colliding station
            for &idx in &transmitting_indices {
                let st = &mut stations[idx];
                st.collision_count += 1;
                // Backoff interval in Pure ALOHA: k * T_fr where k in [1, 2^(min(c, 6))]
                let max_k = 1 << st.collision_count.min(6);
                let k = rng.gen_range_u32(1, max_k);
                let backoff_us = (k as u64) * config.frame_duration_us;
                total_backoff_delay_us += backoff_us;
                st.next_attempt_us = current_time_us + backoff_us;

                step_index += 1;
                events.push(MacEvent {
                    step_index,
                    timestamp_us: current_time_us,
                    event_type: MacEventType::BackoffScheduled,
                    station_id: st.station_id,
                    frame_id: st.active_frame_id,
                    channel_state: ChannelState::Idle,
                    description: format!(
                        "Station {} scheduled backoff of {} µs (k={}) after collision #{}",
                        st.station_id, backoff_us, k, st.collision_count
                    ),
                });
            }
        }
    }

    let total_time_sec = current_time_us as f64 / 1_000_000.0;
    let throughput_frames_sec = if total_time_sec > 0.0 {
        successful_tx as f64 / total_time_sec
    } else {
        0.0
    };
    let throughput_bits_sec = throughput_frames_sec * config.frame_size_bits as f64;
    let col_rate = if total_attempts > 0 {
        collision_count as f64 / total_attempts as f64
    } else {
        0.0
    };
    let util = if current_time_us > 0 {
        channel_busy_us as f64 / current_time_us as f64
    } else {
        0.0
    };
    let avg_backoff = if collision_count > 0 {
        total_backoff_delay_us as f64 / collision_count as f64
    } else {
        0.0
    };

    let metrics = MacMetrics {
        attempted_transmissions: total_attempts,
        successful_transmissions: successful_tx,
        collisions: collision_count,
        retransmissions: retransmission_count,
        channel_busy_time_us: channel_busy_us,
        total_simulation_time_us: current_time_us,
        throughput_frames_per_sec: throughput_frames_sec,
        throughput_bits_per_sec: throughput_bits_sec,
        collision_rate: col_rate,
        channel_utilization: util,
        average_backoff_delay_us: avg_backoff,
    };

    Ok(MacSimResult {
        protocol: MacProtocol::PureAloha,
        config,
        events,
        slot_records: Vec::new(),
        metrics,
        completed_successfully: successful_tx >= target_successful,
    })
}

// =========================================================================
// Slotted ALOHA Simulation
// =========================================================================

pub fn simulate_slotted_aloha(config: MacConfig) -> Result<MacSimResult> {
    if config.num_stations == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "num_stations must be >= 1".to_string(),
        ));
    }
    if config.frame_duration_us == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "frame_duration_us must be > 0".to_string(),
        ));
    }

    let mut rng = DeterministicRng::new(config.seed);
    let slot_duration = config.frame_duration_us;
    let mut current_slot = 0u64;
    let mut step_index = 0usize;

    let frames_per_station = config.total_frames_to_send.div_ceil(config.num_stations);
    let mut stations: Vec<StationQueue> = (0..config.num_stations)
        .map(|id| {
            let initial_slot = rng.gen_range_u32(0, 2) as u64;
            StationQueue {
                station_id: id,
                pending_frames: frames_per_station,
                next_attempt_us: initial_slot * slot_duration,
                active_frame_id: 1,
                collision_count: 0,
            }
        })
        .collect();

    let mut events: Vec<MacEvent> = Vec::new();
    let mut slot_records: Vec<SlotRecord> = Vec::new();
    let mut total_attempts = 0usize;
    let mut successful_tx = 0usize;
    let mut collision_count = 0usize;
    let mut retransmission_count = 0usize;
    let mut total_backoff_delay_us = 0u64;
    let mut channel_busy_us = 0u64;

    let target_successful = config.total_frames_to_send as usize;
    let max_slots = 5_000;

    while successful_tx < target_successful && current_slot < max_slots {
        let slot_start_us = current_slot * slot_duration;
        let slot_end_us = slot_start_us + slot_duration;

        // Stations that attempt transmission in this exact slot
        let ready_indices: Vec<usize> = stations
            .iter()
            .enumerate()
            .filter(|(_, s)| s.pending_frames > 0 && s.next_attempt_us <= slot_start_us)
            .map(|(i, _)| i)
            .collect();

        if ready_indices.is_empty() {
            // Idle slot
            slot_records.push(SlotRecord {
                slot_index: current_slot,
                start_time_us: slot_start_us,
                end_time_us: slot_end_us,
                participating_stations: Vec::new(),
                status: "Idle".to_string(),
            });
        } else if ready_indices.len() == 1 {
            // Successful slot
            let idx = ready_indices[0];
            let st = &mut stations[idx];
            total_attempts += 1;
            successful_tx += 1;
            channel_busy_us += slot_duration;

            slot_records.push(SlotRecord {
                slot_index: current_slot,
                start_time_us: slot_start_us,
                end_time_us: slot_end_us,
                participating_stations: vec![st.station_id],
                status: format!("Success (Station {})", st.station_id),
            });

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: slot_start_us,
                event_type: MacEventType::TransmissionStarted,
                station_id: st.station_id,
                frame_id: st.active_frame_id,
                channel_state: ChannelState::Busy,
                description: format!(
                    "Station {} transmitting frame in slot {}",
                    st.station_id, current_slot
                ),
            });

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: slot_end_us,
                event_type: MacEventType::TransmissionSuccess,
                station_id: st.station_id,
                frame_id: st.active_frame_id,
                channel_state: ChannelState::Idle,
                description: format!(
                    "Station {} completed slot transmission of frame {}",
                    st.station_id, st.active_frame_id
                ),
            });

            st.pending_frames -= 1;
            st.active_frame_id += 1;
            st.collision_count = 0;
            let next_slot_delta = rng.gen_range_u32(1, 3) as u64;
            st.next_attempt_us = (current_slot + next_slot_delta) * slot_duration;
        } else {
            // Collided slot
            let colliding_ids: Vec<u32> = ready_indices
                .iter()
                .map(|&i| stations[i].station_id)
                .collect();
            collision_count += ready_indices.len();
            total_attempts += ready_indices.len();
            retransmission_count += ready_indices.len();
            channel_busy_us += slot_duration;

            slot_records.push(SlotRecord {
                slot_index: current_slot,
                start_time_us: slot_start_us,
                end_time_us: slot_end_us,
                participating_stations: colliding_ids.clone(),
                status: format!("Collision (Stations {:?})", colliding_ids),
            });

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: slot_start_us,
                event_type: MacEventType::CollisionDetected,
                station_id: colliding_ids[0],
                frame_id: 0,
                channel_state: ChannelState::Collision,
                description: format!(
                    "Simultaneous transmission collision in slot {} among stations {:?}",
                    current_slot, colliding_ids
                ),
            });

            for &idx in &ready_indices {
                let st = &mut stations[idx];
                st.collision_count += 1;
                let max_k = 1 << st.collision_count.min(5);
                let k = rng.gen_range_u32(1, max_k) as u64;
                st.next_attempt_us = (current_slot + 1 + k) * slot_duration;
                total_backoff_delay_us += k * slot_duration;
            }
        }

        current_slot += 1;
    }

    let total_time_us = current_slot * slot_duration;
    let total_time_sec = total_time_us as f64 / 1_000_000.0;
    let throughput_frames_sec = if total_time_sec > 0.0 {
        successful_tx as f64 / total_time_sec
    } else {
        0.0
    };
    let throughput_bits_sec = throughput_frames_sec * config.frame_size_bits as f64;
    let col_rate = if total_attempts > 0 {
        collision_count as f64 / total_attempts as f64
    } else {
        0.0
    };
    let util = if total_time_us > 0 {
        channel_busy_us as f64 / total_time_us as f64
    } else {
        0.0
    };
    let avg_backoff = if collision_count > 0 {
        total_backoff_delay_us as f64 / collision_count as f64
    } else {
        0.0
    };

    let metrics = MacMetrics {
        attempted_transmissions: total_attempts,
        successful_transmissions: successful_tx,
        collisions: collision_count,
        retransmissions: retransmission_count,
        channel_busy_time_us: channel_busy_us,
        total_simulation_time_us: total_time_us,
        throughput_frames_per_sec: throughput_frames_sec,
        throughput_bits_per_sec: throughput_bits_sec,
        collision_rate: col_rate,
        channel_utilization: util,
        average_backoff_delay_us: avg_backoff,
    };

    Ok(MacSimResult {
        protocol: MacProtocol::SlottedAloha,
        config,
        events,
        slot_records,
        metrics,
        completed_successfully: successful_tx >= target_successful,
    })
}

// =========================================================================
// CSMA Simulation (1-persistent, Non-persistent, p-persistent)
// =========================================================================

pub fn simulate_csma(config: MacConfig) -> Result<MacSimResult> {
    if config.num_stations == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "num_stations must be >= 1".to_string(),
        ));
    }

    let mut rng = DeterministicRng::new(config.seed);
    let mut current_time_us: u64 = 0;
    let mut step_index = 0usize;
    let mut channel_busy_until_us: u64 = 0;

    let frames_per_station = config.total_frames_to_send.div_ceil(config.num_stations);
    let mut stations: Vec<StationQueue> = (0..config.num_stations)
        .map(|id| {
            let offset = rng.gen_range_f64(0.0, 1.5) * config.frame_duration_us as f64;
            StationQueue {
                station_id: id,
                pending_frames: frames_per_station,
                next_attempt_us: offset as u64,
                active_frame_id: 1,
                collision_count: 0,
            }
        })
        .collect();

    let mut events: Vec<MacEvent> = Vec::new();
    let mut total_attempts = 0usize;
    let mut successful_tx = 0usize;
    let mut collision_count = 0usize;
    let mut retransmission_count = 0usize;
    let mut total_backoff_delay_us = 0u64;
    let mut channel_busy_us = 0u64;

    let target_successful = config.total_frames_to_send as usize;
    let max_steps = 15_000;

    while successful_tx < target_successful && step_index < max_steps {
        let min_time = stations
            .iter()
            .filter(|s| s.pending_frames > 0)
            .map(|s| s.next_attempt_us)
            .min();

        if min_time.is_none() {
            break;
        }

        let next_time = min_time.unwrap();
        current_time_us = current_time_us.max(next_time);

        // Check channel state at carrier sensing
        let channel_state = if current_time_us < channel_busy_until_us {
            ChannelState::Busy
        } else {
            ChannelState::Idle
        };

        // Ready stations at current_time_us
        let ready_indices: Vec<usize> = stations
            .iter()
            .enumerate()
            .filter(|(_, s)| s.pending_frames > 0 && s.next_attempt_us <= current_time_us)
            .map(|(i, _)| i)
            .collect();

        if ready_indices.is_empty() {
            continue;
        }

        if channel_state == ChannelState::Busy {
            // Channel is busy: apply persistence rule
            match config.persistence {
                CsmaPersistence::OnePersistent => {
                    // Continuously senses channel; defers until channel becomes idle
                    let defer_until = channel_busy_until_us;
                    for &idx in &ready_indices {
                        stations[idx].next_attempt_us = defer_until;
                        step_index += 1;
                        events.push(MacEvent {
                            step_index,
                            timestamp_us: current_time_us,
                            event_type: MacEventType::CarrierSensed,
                            station_id: stations[idx].station_id,
                            frame_id: stations[idx].active_frame_id,
                            channel_state: ChannelState::Busy,
                            description: format!("Station {} sensed channel BUSY; 1-persistent mode defers to idle time ({} µs)", stations[idx].station_id, defer_until),
                        });
                    }
                    current_time_us = defer_until;
                }
                CsmaPersistence::NonPersistent => {
                    // Senses busy; immediately chooses a random backoff interval before resensing
                    for &idx in &ready_indices {
                        let backoff = (rng.gen_range_u32(1, 10) as u64) * config.frame_duration_us;
                        stations[idx].next_attempt_us = current_time_us + backoff;
                        total_backoff_delay_us += backoff;
                        step_index += 1;
                        events.push(MacEvent {
                            step_index,
                            timestamp_us: current_time_us,
                            event_type: MacEventType::BackoffScheduled,
                            station_id: stations[idx].station_id,
                            frame_id: stations[idx].active_frame_id,
                            channel_state: ChannelState::Busy,
                            description: format!(
                                "Station {} sensed BUSY; non-persistent mode backed off {} µs",
                                stations[idx].station_id, backoff
                            ),
                        });
                    }
                }
                CsmaPersistence::PPersistent { .. } => {
                    // Defers to next slot
                    let next_slot = current_time_us + config.frame_duration_us;
                    for &idx in &ready_indices {
                        stations[idx].next_attempt_us = next_slot;
                    }
                }
            }
            continue;
        }

        // Channel is IDLE!
        match config.persistence {
            CsmaPersistence::OnePersistent | CsmaPersistence::NonPersistent => {
                // If single station: success
                // If multiple stations sensed idle at the same time: collision
                if ready_indices.len() == 1 {
                    let idx = ready_indices[0];
                    let st = &mut stations[idx];
                    total_attempts += 1;
                    successful_tx += 1;
                    channel_busy_us += config.frame_duration_us;
                    channel_busy_until_us = current_time_us + config.frame_duration_us;

                    step_index += 1;
                    events.push(MacEvent {
                        step_index,
                        timestamp_us: current_time_us,
                        event_type: MacEventType::TransmissionStarted,
                        station_id: st.station_id,
                        frame_id: st.active_frame_id,
                        channel_state: ChannelState::Busy,
                        description: format!(
                            "Station {} sensed IDLE and transmitted frame {}",
                            st.station_id, st.active_frame_id
                        ),
                    });

                    current_time_us += config.frame_duration_us;

                    step_index += 1;
                    events.push(MacEvent {
                        step_index,
                        timestamp_us: current_time_us,
                        event_type: MacEventType::TransmissionSuccess,
                        station_id: st.station_id,
                        frame_id: st.active_frame_id,
                        channel_state: ChannelState::Idle,
                        description: format!(
                            "Station {} completed transmission of frame {}",
                            st.station_id, st.active_frame_id
                        ),
                    });

                    st.pending_frames -= 1;
                    st.active_frame_id += 1;
                    st.next_attempt_us = current_time_us
                        + (rng.gen_range_f64(1.0, 3.0) * config.frame_duration_us as f64) as u64;
                } else {
                    // Collision
                    collision_count += ready_indices.len();
                    total_attempts += ready_indices.len();
                    retransmission_count += ready_indices.len();
                    channel_busy_us += config.frame_duration_us;
                    channel_busy_until_us = current_time_us + config.frame_duration_us;

                    let colliding: Vec<u32> = ready_indices
                        .iter()
                        .map(|&i| stations[i].station_id)
                        .collect();

                    step_index += 1;
                    events.push(MacEvent {
                        step_index,
                        timestamp_us: current_time_us,
                        event_type: MacEventType::CollisionDetected,
                        station_id: colliding[0],
                        frame_id: 0,
                        channel_state: ChannelState::Collision,
                        description: format!(
                            "CSMA Collision! Multiple stations {:?} sensed idle simultaneously",
                            colliding
                        ),
                    });

                    current_time_us += config.frame_duration_us;

                    for &idx in &ready_indices {
                        let st = &mut stations[idx];
                        st.collision_count += 1;
                        let k = rng.gen_range_u32(1, 1 << st.collision_count.min(5));
                        let backoff = (k as u64) * config.frame_duration_us;
                        st.next_attempt_us = current_time_us + backoff;
                        total_backoff_delay_us += backoff;
                    }
                }
            }
            CsmaPersistence::PPersistent { probability } => {
                // Each ready station rolls random bool with probability p
                let mut transmitting = Vec::new();
                let mut deferring = Vec::new();

                for &idx in &ready_indices {
                    if rng.gen_bool(probability) {
                        transmitting.push(idx);
                    } else {
                        deferring.push(idx);
                    }
                }

                for &idx in &deferring {
                    stations[idx].next_attempt_us = current_time_us + config.frame_duration_us;
                }

                if transmitting.len() == 1 {
                    let idx = transmitting[0];
                    let st = &mut stations[idx];
                    total_attempts += 1;
                    successful_tx += 1;
                    channel_busy_us += config.frame_duration_us;
                    channel_busy_until_us = current_time_us + config.frame_duration_us;
                    current_time_us += config.frame_duration_us;
                    st.pending_frames -= 1;
                    st.active_frame_id += 1;
                    st.next_attempt_us = current_time_us + config.frame_duration_us;
                } else if transmitting.len() > 1 {
                    collision_count += transmitting.len();
                    total_attempts += transmitting.len();
                    retransmission_count += transmitting.len();
                    channel_busy_us += config.frame_duration_us;
                    channel_busy_until_us = current_time_us + config.frame_duration_us;
                    current_time_us += config.frame_duration_us;
                    for &idx in &transmitting {
                        let k = rng.gen_range_u32(1, 4);
                        stations[idx].next_attempt_us =
                            current_time_us + (k as u64) * config.frame_duration_us;
                    }
                } else {
                    current_time_us += config.frame_duration_us;
                }
            }
        }
    }

    let total_time_sec = current_time_us as f64 / 1_000_000.0;
    let throughput_frames_sec = if total_time_sec > 0.0 {
        successful_tx as f64 / total_time_sec
    } else {
        0.0
    };
    let throughput_bits_sec = throughput_frames_sec * config.frame_size_bits as f64;
    let col_rate = if total_attempts > 0 {
        collision_count as f64 / total_attempts as f64
    } else {
        0.0
    };
    let util = if current_time_us > 0 {
        channel_busy_us as f64 / current_time_us as f64
    } else {
        0.0
    };
    let avg_backoff = if collision_count > 0 {
        total_backoff_delay_us as f64 / collision_count as f64
    } else {
        0.0
    };

    let metrics = MacMetrics {
        attempted_transmissions: total_attempts,
        successful_transmissions: successful_tx,
        collisions: collision_count,
        retransmissions: retransmission_count,
        channel_busy_time_us: channel_busy_us,
        total_simulation_time_us: current_time_us,
        throughput_frames_per_sec: throughput_frames_sec,
        throughput_bits_per_sec: throughput_bits_sec,
        collision_rate: col_rate,
        channel_utilization: util,
        average_backoff_delay_us: avg_backoff,
    };

    Ok(MacSimResult {
        protocol: MacProtocol::Csma,
        config,
        events,
        slot_records: Vec::new(),
        metrics,
        completed_successfully: successful_tx >= target_successful,
    })
}

// =========================================================================
// CSMA/CD Simulation (Carrier Sense Multiple Access with Collision Detection)
// =========================================================================

pub fn simulate_csma_cd(config: MacConfig) -> Result<MacSimResult> {
    if config.num_stations == 0 {
        return Err(NetSimError::InvalidConfiguration(
            "num_stations must be >= 1".to_string(),
        ));
    }

    let mut rng = DeterministicRng::new(config.seed);
    let mut current_time_us: u64 = 0;
    let mut step_index = 0usize;
    let mut channel_busy_until_us: u64 = 0;

    // Slot time in CSMA/CD is 2 * tau (round-trip propagation delay)
    let slot_time_us = (2 * config.prop_delay_us).max(10);
    // Jam signal transmission time (e.g. 32 to 48 bits, ~3.2µs to 50µs)
    let jam_signal_duration_us = (config.prop_delay_us).max(10);

    let frames_per_station = config.total_frames_to_send.div_ceil(config.num_stations);
    let mut stations: Vec<StationQueue> = (0..config.num_stations)
        .map(|id| {
            let offset = rng.gen_range_f64(0.0, 1.2) * config.frame_duration_us as f64;
            StationQueue {
                station_id: id,
                pending_frames: frames_per_station,
                next_attempt_us: offset as u64,
                active_frame_id: 1,
                collision_count: 0,
            }
        })
        .collect();

    let mut events: Vec<MacEvent> = Vec::new();
    let mut total_attempts = 0usize;
    let mut successful_tx = 0usize;
    let mut collision_count = 0usize;
    let mut retransmission_count = 0usize;
    let mut total_backoff_delay_us = 0u64;
    let mut channel_busy_us = 0u64;

    let target_successful = config.total_frames_to_send as usize;
    let max_steps = 15_000;

    while successful_tx < target_successful && step_index < max_steps {
        let min_time = stations
            .iter()
            .filter(|s| s.pending_frames > 0)
            .map(|s| s.next_attempt_us)
            .min();

        if min_time.is_none() {
            break;
        }

        let next_time = min_time.unwrap();
        current_time_us = current_time_us.max(next_time);

        // Ready stations within propagation vulnerability window 2*tau
        let ready_indices: Vec<usize> = stations
            .iter()
            .enumerate()
            .filter(|(_, s)| {
                s.pending_frames > 0 && s.next_attempt_us <= current_time_us + slot_time_us
            })
            .map(|(i, _)| i)
            .collect();

        if ready_indices.is_empty() {
            current_time_us += slot_time_us;
            continue;
        }

        // Check if channel is currently busy
        if current_time_us < channel_busy_until_us {
            // Defer until channel becomes idle
            let defer_time = channel_busy_until_us;
            for &idx in &ready_indices {
                stations[idx].next_attempt_us = defer_time;
            }
            current_time_us = defer_time;
            continue;
        }

        if ready_indices.len() == 1 {
            // SUCCESSFUL CSMA/CD TRANSMISSION
            let idx = ready_indices[0];
            let st = &mut stations[idx];
            total_attempts += 1;
            successful_tx += 1;
            channel_busy_us += config.frame_duration_us;
            channel_busy_until_us = current_time_us + config.frame_duration_us;

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: current_time_us,
                event_type: MacEventType::CarrierSensed,
                station_id: st.station_id,
                frame_id: st.active_frame_id,
                channel_state: ChannelState::Idle,
                description: format!("Station {} sensed carrier IDLE", st.station_id),
            });

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: current_time_us,
                event_type: MacEventType::TransmissionStarted,
                station_id: st.station_id,
                frame_id: st.active_frame_id,
                channel_state: ChannelState::Busy,
                description: format!(
                    "Station {} began transmitting frame {}",
                    st.station_id, st.active_frame_id
                ),
            });

            current_time_us += config.frame_duration_us;

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: current_time_us,
                event_type: MacEventType::TransmissionSuccess,
                station_id: st.station_id,
                frame_id: st.active_frame_id,
                channel_state: ChannelState::Idle,
                description: format!("Station {} successfully finished transmitting frame {} (No collision detected within 2τ)", st.station_id, st.active_frame_id),
            });

            st.pending_frames -= 1;
            st.active_frame_id += 1;
            st.collision_count = 0;
            st.next_attempt_us = current_time_us
                + (rng.gen_range_f64(1.0, 2.5) * config.frame_duration_us as f64) as u64;
        } else {
            // COLLISION DETECTED DURING TRANSMISSION
            let colliding_ids: Vec<u32> = ready_indices
                .iter()
                .map(|&i| stations[i].station_id)
                .collect();
            collision_count += ready_indices.len();
            total_attempts += ready_indices.len();
            retransmission_count += ready_indices.len();

            // Collision is detected within round-trip time 2*tau
            let collision_detect_time = current_time_us + slot_time_us;
            channel_busy_us += slot_time_us + jam_signal_duration_us;
            channel_busy_until_us = collision_detect_time + jam_signal_duration_us;

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: current_time_us,
                event_type: MacEventType::TransmissionStarted,
                station_id: colliding_ids[0],
                frame_id: 0,
                channel_state: ChannelState::Busy,
                description: format!(
                    "Stations {:?} started transmitting simultaneously",
                    colliding_ids
                ),
            });

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: collision_detect_time,
                event_type: MacEventType::CollisionDetected,
                station_id: colliding_ids[0],
                frame_id: 0,
                channel_state: ChannelState::Collision,
                description: format!(
                    "Collision detected within 2τ interval at {} µs among stations {:?}",
                    collision_detect_time, colliding_ids
                ),
            });

            // Emit Jam Signal and Abort
            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: collision_detect_time,
                event_type: MacEventType::JamSignalSent,
                station_id: colliding_ids[0],
                frame_id: 0,
                channel_state: ChannelState::Collision,
                description:
                    "Stations broadcast 32-bit Jam Signal to notify all network participants"
                        .to_string(),
            });

            step_index += 1;
            events.push(MacEvent {
                step_index,
                timestamp_us: collision_detect_time + jam_signal_duration_us,
                event_type: MacEventType::TransmissionAborted,
                station_id: colliding_ids[0],
                frame_id: 0,
                channel_state: ChannelState::Idle,
                description: "Transmission aborted immediately after jam signal. Applying Truncated Binary Exponential Backoff (BEB)".to_string(),
            });

            current_time_us = collision_detect_time + jam_signal_duration_us;

            // Apply Truncated Binary Exponential Backoff:
            // k = min(c, 10), random slot in [0, 2^k - 1]
            for &idx in &ready_indices {
                let st = &mut stations[idx];
                st.collision_count += 1;

                if st.collision_count > config.max_retries {
                    // Maximum retry attempts reached: abort frame
                    st.pending_frames -= 1;
                    st.active_frame_id += 1;
                    st.collision_count = 0;
                    continue;
                }

                let k_exponent = st.collision_count.min(10);
                let max_slot_choice = (1 << k_exponent) - 1;
                let chosen_slot = rng.gen_range_u32(0, max_slot_choice);
                let backoff_us = (chosen_slot as u64) * slot_time_us;
                total_backoff_delay_us += backoff_us;
                st.next_attempt_us = current_time_us + backoff_us;

                step_index += 1;
                events.push(MacEvent {
                    step_index,
                    timestamp_us: current_time_us,
                    event_type: MacEventType::BackoffScheduled,
                    station_id: st.station_id,
                    frame_id: st.active_frame_id,
                    channel_state: ChannelState::Idle,
                    description: format!(
                        "Station {} collision #{} (k={}); picked slot {} in [0..{}] -> backoff {} µs",
                        st.station_id, st.collision_count, k_exponent, chosen_slot, max_slot_choice, backoff_us
                    ),
                });
            }
        }
    }

    let total_time_sec = current_time_us as f64 / 1_000_000.0;
    let throughput_frames_sec = if total_time_sec > 0.0 {
        successful_tx as f64 / total_time_sec
    } else {
        0.0
    };
    let throughput_bits_sec = throughput_frames_sec * config.frame_size_bits as f64;
    let col_rate = if total_attempts > 0 {
        collision_count as f64 / total_attempts as f64
    } else {
        0.0
    };
    let util = if current_time_us > 0 {
        channel_busy_us as f64 / current_time_us as f64
    } else {
        0.0
    };
    let avg_backoff = if collision_count > 0 {
        total_backoff_delay_us as f64 / collision_count as f64
    } else {
        0.0
    };

    let metrics = MacMetrics {
        attempted_transmissions: total_attempts,
        successful_transmissions: successful_tx,
        collisions: collision_count,
        retransmissions: retransmission_count,
        channel_busy_time_us: channel_busy_us,
        total_simulation_time_us: current_time_us,
        throughput_frames_per_sec: throughput_frames_sec,
        throughput_bits_per_sec: throughput_bits_sec,
        collision_rate: col_rate,
        channel_utilization: util,
        average_backoff_delay_us: avg_backoff,
    };

    Ok(MacSimResult {
        protocol: MacProtocol::CsmaCd,
        config,
        events,
        slot_records: Vec::new(),
        metrics,
        completed_successfully: successful_tx >= target_successful,
    })
}
