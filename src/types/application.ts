// Authoritative Application-Layer Protocol DTOs produced by the Python simulation core
import { Packet } from './packet';
import { SimEvent } from './events';
import { TransportEvent } from './transport';

export type ApplicationProtocol = 'DNS' | 'HTTP' | 'FTP' | 'SMTP' | 'SNMP';

export type AppProtocolState =
  | 'idle'
  | 'query_sent'
  | 'lookup_processing'
  | 'response_received'
  | 'connecting'
  | 'connected'
  | 'request_sent'
  | 'data_transferring'
  | 'completed'
  | 'failed'
  | 'terminated';

export interface AppProtocolEvent {
  step_index: number;
  timestamp_us: number;
  node_id: string;
  protocol: string;
  event_type: string;
  description: string;
  packet_id?: string | null;
  session_id?: string | null;
  details?: string | null;
}

export interface AppProtocolMetrics {
  transaction_duration_us: number;
  requests_sent: number;
  responses_received: number;
  payload_bytes_sent: number;
  payload_bytes_received: number;
  success: boolean;
  error_message?: string | null;
}

// ---------------- DNS ----------------
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX';

export interface DnsRecord {
  name: string;
  record_type: DnsRecordType;
  value: string;
  ttl: number;
  priority?: number | null;
}

export type DnsQueryMode = 'recursive' | 'iterative';
export type DnsResponseCode = 'NOERROR' | 'NXDOMAIN';

export interface DnsConfig {
  client_node_id: string;
  server_node_id: string;
  auth_server_node_id?: string | null;
  query_name: string;
  query_type: DnsRecordType;
  query_mode: DnsQueryMode;
  query_id: number;
  custom_records?: DnsRecord[];
  seed?: number;
}

export interface DnsSimResult {
  config: DnsConfig;
  state: AppProtocolState;
  response_code: DnsResponseCode;
  answers: DnsRecord[];
  events: AppProtocolEvent[];
  sim_events: SimEvent[];
  packets: Packet[];
  metrics: AppProtocolMetrics;
}

// ---------------- HTTP ----------------
export type HttpMethod = 'GET' | 'POST';

export interface HttpRequest {
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  body?: string | null;
}

export interface HttpResponse {
  status_code: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpConfig {
  client_node_id: string;
  server_node_id: string;
  request: HttpRequest;
  port?: number;
  seed?: number;
}

export interface HttpSimResult {
  config: HttpConfig;
  state: AppProtocolState;
  response: HttpResponse;
  events: AppProtocolEvent[];
  sim_events: SimEvent[];
  tcp_events: TransportEvent[];
  packets: Packet[];
  metrics: AppProtocolMetrics;
}

// ---------------- FTP ----------------
export type FtpCommand = 'USER' | 'PASS' | 'LIST' | 'RETR' | 'STOR' | 'QUIT';
export type FtpChannelType = 'control' | 'data';

export interface FtpConfig {
  client_node_id: string;
  server_node_id: string;
  username: string;
  password?: string | null;
  transfer_command: FtpCommand;
  filename?: string | null;
  file_size_bytes: number;
  control_port?: number;
  data_port?: number;
  seed?: number;
}

export interface FtpSimResult {
  config: FtpConfig;
  state: AppProtocolState;
  control_session_id: string;
  data_session_id: string;
  events: AppProtocolEvent[];
  sim_events: SimEvent[];
  packets: Packet[];
  metrics: AppProtocolMetrics;
}

// ---------------- SMTP ----------------
export interface SmtpConfig {
  client_node_id: string;
  server_node_id: string;
  mail_from: string;
  rcpt_to: string;
  subject: string;
  body: string;
  reject_recipient?: boolean;
  port?: number;
  seed?: number;
}

export interface SmtpSimResult {
  config: SmtpConfig;
  state: AppProtocolState;
  is_accepted: boolean;
  events: AppProtocolEvent[];
  sim_events: SimEvent[];
  packets: Packet[];
  metrics: AppProtocolMetrics;
}

// ---------------- SNMP ----------------
export interface MibObject {
  oid: string;
  name: string;
  syntax: string;
  value: string;
  description: string;
}

export interface SnmpConfig {
  manager_node_id: string;
  agent_node_id: string;
  community: string;
  requested_oid: string;
  port?: number;
  seed?: number;
}

export interface SnmpSimResult {
  config: SnmpConfig;
  state: AppProtocolState;
  found_object?: MibObject | null;
  events: AppProtocolEvent[];
  sim_events: SimEvent[];
  packets: Packet[];
  metrics: AppProtocolMetrics;
}
