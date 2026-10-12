// Authoritative Simulation and Protocol Event DTOs

export interface SimEventEnvelope {
  /** Authoritative event name emitted by the Python simulation core. */
  type: string;
  /** Event payload (packet/link/node identifiers and layer-specific detail). */
  data?: Record<string, unknown>;
}

export interface SimEvent {
  id: number;
  timestamp: { 0: number } | number; // SimTime micros
  event_type: SimEventEnvelope;
  description: string;
  packet_id?: string | null;
  node_id?: string | null;
  link_id?: string | null;
  layer?: string | null;
  protocol?: string | null;
}

export interface TimelineEvent {
  id: number;
  timestamp_us: number;
  eventType: string;
  description: string;
  packetId?: string | null;
  nodeId?: string | null;
  linkId?: string | null;
  layer?: 'Application' | 'Transport' | 'Network' | 'Data Link' | 'Physical' | 'Other';
  protocol?: string | null;
  status: 'normal' | 'success' | 'dropped' | 'error' | 'retransmission' | 'queued' | 'transmitting';
  rawEvent: SimEvent;
}

export interface EventFilter {
  eventType: string; // 'all' or specific type like 'packet_created'
  layer: string; // 'all' | 'Application' | 'Transport' | 'Network' | 'Data Link' | 'Physical'
  protocol: string; // 'all' | 'TCP' | 'UDP' | 'IPv4' | 'Ethernet' | 'Routing'
  nodeId: string; // 'all' or specific node
  linkId: string; // 'all' or specific link
  packetId: string; // text filter
  status: 'all' | 'success' | 'dropped' | 'error' | 'retransmission';
  searchQuery: string;
}

export interface EventDetail {
  id: number;
  timestamp_us: number;
  eventType: string;
  description: string;
  packetId?: string | null;
  nodeId?: string | null;
  linkId?: string | null;
  layer?: string | null;
  protocol?: string | null;
  queueOccupancy?: number | null;
  queueCapacity?: number | null;
  explanation: string;
}
