export type SimulationStatus = 'ready' | 'running' | 'paused' | 'completed';

export type PacketState =
  | 'created'
  | 'queued'
  | 'transmitting'
  | 'in_transit'
  | 'delivered'
  | 'dropped_queue_full'
  | 'dropped_link_down'
  | 'dropped_bit_error'
  | 'dropped_ttl_expired'
  | 'retransmitted';

export interface SimEvent {
  id: number;
  timestamp: { 0: number } | number; // SimTime (micros)
  event_type: Record<string, unknown>;
  description: string;
}

export interface SimulationMetrics {
  packets_created: number;
  packets_delivered: number;
  packets_dropped_overflow: number;
  packets_dropped_loss: number;
  packets_dropped_error: number;
  packets_dropped_link_down: number;
  bytes_transmitted: number;
  bytes_delivered: number;
  total_latency_us: number;
  min_latency_us?: number | null;
  max_latency_us?: number | null;
}

export interface QueueSnapshot {
  link_id: string;
  occupancy: number;
  capacity: number;
  is_transmitting: boolean;
  total_enqueued: number;
  total_dropped_overflow: number;
}

export interface SimulationStateSnapshot {
  current_time_us: number;
  status: SimulationStatus;
  pending_events_count: number;
  processed_events_count: number;
  recent_events: SimEvent[];
  metrics: SimulationMetrics;
  queues: QueueSnapshot[];
}

export interface Packet {
  id: string;
  src_node_id: string;
  dst_node_id: string;
  size_bytes: number;
  created_at_us: number;
  current_node_id: string;
  next_hop_node_id?: string | null;
  state: PacketState;
  journey_hops: string[];
}
