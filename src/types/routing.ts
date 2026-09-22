export type MetricType = 'hop_count' | 'propagation_delay' | 'inverse_bandwidth';
export type RoutingAlgorithm = 'dijkstra' | 'bellman_ford';

export interface RouteTableEntry {
  destination: string;
  destination_label: string;
  next_hop: string | null;
  interface_id: string | null;
  metric: number;
  path: string[];
  is_reachable: boolean;
  protocol: string;
}

export interface RoutingTable {
  node_id: string;
  node_label: string;
  algorithm: string;
  metric_type: string;
  entries: RouteTableEntry[];
}

export interface ConvergenceRound {
  round_number: number;
  source_distances: Record<string, number>;
  changes: string[];
  changed: boolean;
}

export interface ConvergenceTelemetry {
  algorithm: string;
  source_node_id: string;
  total_rounds: number;
  converged: boolean;
  rounds: ConvergenceRound[];
  final_routing_table: RoutingTable;
}
