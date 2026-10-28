// Circuit-switching educational model DTOs (python/netsim/switching/circuit.py)

export interface Circuit {
  circuit_id: string;
  source_node_id: string;
  target_node_id: string;
  path: string[];
  link_ids: string[];
  bandwidth_bps: number;
  state: 'active' | 'released';
  request_index: number;
  released_reason: string | null;
}

export interface LinkReservationView {
  link_id: string;
  capacity_bps: number;
  reserved_bps: number;
  available_bps: number;
  utilization: number;
}

export interface CircuitAdmissionMetrics {
  requests_total: number;
  requests_accepted: number;
  requests_blocked: number;
  circuits_released: number;
  circuits_active: number;
  acceptance_rate: number;
  blocking_rate: number;
}

export interface CircuitRequestResult {
  accepted: boolean;
  circuit_id: string | null;
  source_node_id: string;
  target_node_id: string;
  bandwidth_bps: number;
  path: string[];
  link_ids: string[];
  /** Why the request was blocked (empty string when accepted). */
  reason: string;
  metrics: CircuitAdmissionMetrics;
}

export interface CircuitState {
  circuits: Circuit[];
  links: LinkReservationView[];
  metrics: CircuitAdmissionMetrics;
}
