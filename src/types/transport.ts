import { CwndPoint } from './congestion';

export type TransportProtocol = 'tcp' | 'udp';

export type ConnectionState =
  | 'closed'
  | 'listen'
  | 'syn_sent'
  | 'syn_received'
  | 'established'
  | 'fin_wait1'
  | 'fin_wait2'
  | 'close_wait'
  | 'closing'
  | 'last_ack'
  | 'time_wait';

export type TcpFlag = 'syn' | 'ack' | 'fin' | 'rst' | 'psh';

export interface TransportSegment {
  source_port: number;
  destination_port: number;
  sequence_number: number;
  acknowledgment_number: number;
  flags: TcpFlag[];
  payload_length: number;
  advertised_window: number;
  timestamp_us: number;
  is_retransmission: boolean;
}

export type TransportEventType =
  | 'connection_started'
  | 'syn_sent'
  | 'syn_received'
  | 'connection_established'
  | 'data_segment_sent'
  | 'data_segment_received'
  | 'ack_sent'
  | 'ack_received'
  | 'timeout'
  | 'retransmission'
  | 'segment_lost'
  | 'segment_delivered'
  | 'window_updated'
  | 'congestion_window_updated'
  | 'connection_closed';

export interface TransportEvent {
  step_index: number;
  timestamp_us: number;
  event_type: TransportEventType;
  source_node: string;
  destination_node: string;
  segment?: TransportSegment | null;
  connection_state: ConnectionState;
  cwnd_mss: number;
  ssthresh_mss: number;
  rtt_sample_us?: number | null;
  srtt_us: number;
  rttvar_us: number;
  rto_us: number;
  description: string;
}

export interface TransportMetrics {
  segments_sent: number;
  segments_delivered: number;
  retransmissions: number;
  segments_lost: number;
  duplicate_acks: number;
  bytes_sent: number;
  bytes_delivered: number;
  completion_time_us: number;
  average_rtt_us: number;
  smoothed_rtt_us: number;
  final_rto_us: number;
  throughput_bits_per_sec: number;
  throughput_bytes_per_sec: number;
  goodput_bits_per_sec: number;
  packet_loss_rate: number;
  sender_window_occupancy_avg: number;
  receiver_window_occupancy_max: number;
  congestion_window_final: number;
  congestion_window_max: number;
  timeout_count: number;
  fast_retransmit_count: number;
}

export interface TransportConfig {
  protocol: TransportProtocol;
  source_node_id: string;
  destination_node_id: string;
  source_port: number;
  destination_port: number;
  payload_bytes: number;
  segment_size_bytes: number;
  initial_sequence_number: number;
  initial_cwnd_mss: number;
  initial_ssthresh_mss: number;
  initial_rto_us: number;
  receive_window_bytes: number;
  seed: number;
  dropped_segments?: number[];
  maximum_retries: number;
}

export interface TransportSimResult {
  protocol: TransportProtocol;
  config: TransportConfig;
  derived_route: string[];
  events: TransportEvent[];
  cwnd_timeline: CwndPoint[];
  metrics: TransportMetrics;
  completed: boolean;
}
