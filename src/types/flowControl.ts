export type FlowControlProtocol = 'sliding_window' | 'go_back_n' | 'selective_repeat';

export type FrameStatus =
  | 'pending'
  | 'transmitted'
  | 'acknowledged'
  | 'lost'
  | 'corrupted'
  | 'timed_out'
  | 'buffered'
  | 'delivered';

export type FlowEventType =
  | 'frame_sent'
  | 'frame_received'
  | 'ack_sent'
  | 'ack_received'
  | 'frame_lost'
  | 'frame_corrupted'
  | 'timeout_triggered'
  | 'retransmission'
  | 'window_advanced'
  | 'delivered_to_network';

export interface FlowControlConfig {
  protocol: FlowControlProtocol;
  window_size: number;
  sequence_space: number;
  total_frames_to_send: number;
  frame_tx_time_us: number;
  prop_delay_us: number;
  ack_tx_time_us: number;
  timeout_us: number;
  seed: number;
  dropped_frame_indices?: number[];
  corrupted_frame_indices?: number[];
  dropped_ack_seqs?: number[];
}

export interface SenderWindowState {
  send_base: number;
  next_seq_num: number;
  window_size: number;
  sequence_space: number;
  active_window_seqs: number[];
  outstanding_count: number;
}

export interface ReceiverWindowState {
  rcv_base: number;
  window_size: number;
  sequence_space: number;
  active_window_seqs: number[];
  buffered_seqs: number[];
  delivered_count: number;
}

export interface SlidingFrame {
  frame_index: number;
  seq_num: number;
  status: FrameStatus;
  is_retransmission: boolean;
  tx_count: number;
  sent_at_us: number | null;
  acked_at_us: number | null;
}

export interface FlowControlEvent {
  step_index: number;
  timestamp_us: number;
  event_type: FlowEventType;
  frame_index: number | null;
  seq_num: number;
  ack_seq: number | null;
  sender_window: SenderWindowState;
  receiver_window: ReceiverWindowState;
  description: string;
}

export interface FlowControlMetrics {
  total_frames_sent: number;
  original_frames: number;
  retransmissions: number;
  ack_count: number;
  duplicate_frames: number;
  dropped_or_corrupted_frames: number;
  completed_frames: number;
  completion_time_us: number;
  utilization: number;
  protocol_overhead: number;
  sender_window_occupancy_avg: number;
  receiver_buffer_occupancy_max: number;
}

export interface FlowControlSimResult {
  protocol: FlowControlProtocol;
  config: FlowControlConfig;
  events: FlowControlEvent[];
  frames: SlidingFrame[];
  metrics: FlowControlMetrics;
  final_sender: SenderWindowState;
  final_receiver: ReceiverWindowState;
  is_completed: boolean;
}
