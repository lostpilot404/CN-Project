// Authoritative 5-Layer Packet and Header representations mirroring Rust domain DTOs

export type PacketState =
  | 'created'
  | 'queued'
  | 'transmitting'
  | 'in_flight'
  | 'delivered'
  | 'dropped_queue_full'
  | 'dropped_bit_error'
  | 'dropped_link_down'
  | 'dropped_ttl_expired'
  | 'retransmitted';

export interface AppHeader {
  protocol: string; // "HTTP", "DNS", "FTP", "SMTP", "SNMP", "RAW"
  payload_preview: string;
  message_type?: string | null;
  session_id?: string | null;
  transaction_id?: number | null;
  resource_or_command?: string | null;
  status_code?: string | null;
}

export interface TransportHeader {
  protocol: string; // "TCP", "UDP"
  src_port: number;
  dst_port: number;
  seq_num?: number | null;
  ack_num?: number | null;
  window_size?: number | null;
  flags: string[]; // ["SYN"], ["ACK"], etc.
  payload_length?: number | null;
  is_retransmission?: boolean | null;
  connection_state?: string | null;
}

export interface NetworkHeader {
  version: number; // 4 or 6
  src_ip: string;
  dst_ip: string;
  ttl: number;
  protocol_num: number;
  checksum: number;
}

export interface DataLinkHeader {
  src_mac: string;
  dst_mac: string;
  ether_type: number;
  crc_fcs: number;
  frame_type?: string | null;
  fcs_valid?: boolean | null;
}

export interface PhysicalLayerInfo {
  link_id?: string | null;
  bandwidth_bps?: number | null;
  propagation_delay_us?: number | null;
  tx_start_us?: number | null;
  tx_finish_us?: number | null;
  bit_count: number;
  preamble_bits?: string | null;
  signal_encoding?: string | null;
}

export interface EncapsulationStack {
  application: AppHeader;
  transport: TransportHeader;
  network: NetworkHeader;
  datalink: DataLinkHeader;
  physical?: PhysicalLayerInfo | null;
}

export interface PacketHopRecord {
  hop_index: number;
  node_id: string;
  link_id?: string | null;
  timestamp_us: number;
  state: PacketState;
  description: string;
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
  headers: EncapsulationStack;
  journey_hops: string[];
  planned_route: string[];
  hop_history: PacketHopRecord[];
}

export interface LayerView {
  layerIndex: 1 | 2 | 3 | 4 | 5;
  layerName: 'Physical' | 'Data Link' | 'Network' | 'Transport' | 'Application';
  title: string;
  protocol: string;
  headerFields: { label: string; value: string | number; hex?: string; isModeled?: boolean }[];
  payloadSummary: string;
  statusBadge?: string;
  isModeled: boolean;
}
