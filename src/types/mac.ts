export type MacProtocol = 'pure_aloha' | 'slotted_aloha' | 'csma' | 'csma_cd';

export type CsmaPersistence =
  | 'one_persistent'
  | 'non_persistent'
  | { p_persistent: { probability: number } };

export type ChannelState = 'idle' | 'busy' | 'collision';

export type MacEventType =
  | 'carrier_sensed'
  | 'transmission_started'
  | 'collision_detected'
  | 'jam_signal_sent'
  | 'transmission_aborted'
  | 'backoff_scheduled'
  | 'backoff_expired'
  | 'transmission_success';

export interface MacConfig {
  protocol: MacProtocol;
  persistence: CsmaPersistence;
  num_stations: number;
  total_frames_to_send: number;
  frame_duration_us: number;
  prop_delay_us: number;
  frame_size_bits: number;
  seed: number;
  max_retries: number;
  offered_load_g: number;
}

export interface MacEvent {
  step_index: number;
  timestamp_us: number;
  event_type: MacEventType;
  station_id: number;
  frame_id: number;
  channel_state: ChannelState;
  description: string;
}

export interface SlotRecord {
  slot_index: number;
  start_time_us: number;
  end_time_us: number;
  participating_stations: number[];
  status: string;
}

export interface MacMetrics {
  attempted_transmissions: number;
  successful_transmissions: number;
  collisions: number;
  retransmissions: number;
  channel_busy_time_us: number;
  total_simulation_time_us: number;
  throughput_frames_per_sec: number;
  throughput_bits_per_sec: number;
  collision_rate: number;
  channel_utilization: number;
  average_backoff_delay_us: number;
}

export interface MacSimResult {
  protocol: MacProtocol;
  config: MacConfig;
  events: MacEvent[];
  slot_records: SlotRecord[];
  metrics: MacMetrics;
  completed_successfully: boolean;
}
