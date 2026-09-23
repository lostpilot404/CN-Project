import { Packet, PacketState } from './packet';
import { SimEvent } from './events';

export type { Packet, PacketState, SimEvent };

export type SimulationStatus = 'ready' | 'running' | 'paused' | 'completed';

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
  packets?: Packet[];
}

