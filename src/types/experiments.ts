export interface LossCategoryBreakdown {
  queue_overflow: number;
  link_down: number;
  bit_error: number;
  stochastic_loss: number;
  ttl_expired: number;
  no_route: number;
}

export interface LinkUtilizationRecord {
  link_id: string;
  busy_time_us: number;
  measurement_time_us: number;
  utilization: number;
}

export interface QosMetrics {
  measurement_interval_us: number;
  /** Gross wire rate at the model's documented boundary (headers + payload, incl. retransmissions). */
  throughput_bits_per_sec: number;
  throughput_bytes_per_sec: number;
  /** Net useful payload rate: unique delivered payload, headers and retransmissions excluded. */
  goodput_bits_per_sec: number;
  /** Byte totals behind the two rates (wire bytes vs unique delivered payload bytes). */
  throughput_bytes_counted: number;
  goodput_payload_bytes: number;
  end_to_end_latencies_us: number[];
  average_latency_us: number;
  min_latency_us: number | null;
  max_latency_us: number | null;
  jitter_us: number;
  jitter_samples: number[];
  packets_sent: number;
  packets_delivered: number;
  packets_lost: number;
  packet_loss_rate: number;
  loss_by_category: LossCategoryBreakdown;
  retransmissions: number;
  link_utilization: LinkUtilizationRecord[];
  queue_occupancy_average: number;
  queue_occupancy_max: number;
  queue_drops: number;
  average_rtt_us: number | null;
}

export interface AggregatedQos {
  run_count: number;
  mean_throughput_bps: number;
  mean_goodput_bps: number;
  mean_latency_us: number;
  min_latency_us: number | null;
  max_latency_us: number | null;
  mean_jitter_us: number;
  mean_loss_rate: number;
  mean_retransmissions: number;
  stddev_latency_us: number;
  stddev_throughput_bps: number;
}

export type FaultType =
  | { type: 'link_down'; link_id: string }
  | { type: 'link_restore'; link_id: string }
  | { type: 'bandwidth_degradation'; link_id: string; new_bandwidth_bps: number }
  | { type: 'queue_capacity_change'; link_id: string; new_capacity: number }
  | { type: 'node_failure'; node_id: string }
  | { type: 'node_recovery'; node_id: string }
  | { type: 'packet_drop'; packet_id: string }
  | { type: 'bit_error'; link_id: string; error_rate: number };

export interface FaultScheduleEntry {
  fault_id: string;
  timestamp_us: number;
  fault_type: FaultType;
  description: string;
}

export interface FaultSchedule {
  entries: FaultScheduleEntry[];
}

export interface RouteChangeRecord {
  source_node_id: string;
  destination_node_id: string;
  before_path: string[] | null;
  after_path: string[] | null;
  reachable_before: boolean;
  reachable_after: boolean;
  affected_links: string[];
  fault_id: string;
  timestamp_us: number;
}

export type ExperimentTarget = 'tcp' | 'udp' | 'application' | 'flow_control' | 'mac';

export type SweepParameter =
  | { type: 'link_bandwidth'; link_id?: string | null }
  | { type: 'propagation_delay'; link_id?: string | null }
  | { type: 'queue_capacity'; link_id?: string | null }
  | { type: 'bit_error_rate'; link_id?: string | null }
  | { type: 'packet_size_bytes' }
  | { type: 'traffic_interval_us' }
  | { type: 'packet_count' }
  | { type: 'window_size' }
  | { type: 'timeout_us' }
  | { type: 'mac_persistence' };

export interface SweepConfig {
  experiment_name: string;
  target?: ExperimentTarget;
  parameter: SweepParameter;
  parameter_values: number[];
  seeds: number[];
  simulation_duration_us: number;
  base_project?: unknown | null;
  traffic_src_id?: string | null;
  traffic_dst_id?: string | null;
  packet_size_bytes?: number | null;
  traffic_interval_us?: number | null;
  packet_count?: number | null;
  fault_schedule?: FaultSchedule | null;
}

export interface SweepRunResult {
  parameter_value: number;
  seed: number;
  qos: QosMetrics;
  route_changes: RouteChangeRecord[];
}

export interface SweepPointResult {
  parameter_value: number;
  aggregated_qos: AggregatedQos;
  runs: SweepRunResult[];
}

export interface SweepExperimentResult {
  experiment_name: string;
  parameter_name: string;
  points: SweepPointResult[];
  total_runs: number;
  seeds: number[];
  execution_time_ms: number;
}

export interface MetricDelta {
  metric_name: string;
  val_a: number;
  val_b: number;
  diff: number;
  percent_change: number | null;
}

export interface ComparativeScenarioConfig {
  name: string;
  description: string;
  project_override?: unknown | null;
  fault_schedule?: FaultSchedule | null;
  parameter_overrides?: [SweepParameter, number][] | null;
}

export interface ComparativeExperimentConfig {
  experiment_name: string;
  target?: ExperimentTarget;
  scenario_a: ComparativeScenarioConfig;
  scenario_b: ComparativeScenarioConfig;
  seeds: number[];
  simulation_duration_us: number;
  base_project?: unknown | null;
  traffic_src_id?: string | null;
  traffic_dst_id?: string | null;
  packet_size_bytes?: number | null;
  traffic_interval_us?: number | null;
  packet_count?: number | null;
}

export interface ComparativeExperimentResult {
  experiment_name: string;
  scenario_a_name: string;
  scenario_b_name: string;
  qos_a: AggregatedQos;
  qos_b: AggregatedQos;
  deltas: MetricDelta[];
  route_changes_a: RouteChangeRecord[];
  route_changes_b: RouteChangeRecord[];
  runs_count_per_scenario: number;
  execution_time_ms: number;
}
