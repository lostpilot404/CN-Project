export type NodeType = 'pc' | 'server' | 'router' | 'switch' | 'access_point' | 'generic';

export type NodeState = 'up' | 'down' | 'degraded';

export type LinkStatus = 'up' | 'down' | 'degraded';

export interface Position {
  x: number;
  y: number;
}

export interface Interface {
  id: string;
  name: string;
  node_id: string;
  mac_address: string;
  ipv4?: string;
  subnet_mask?: string;
  ipv6?: string;
  link_id?: string;
  status: 'up' | 'down';
}

export interface Node {
  id: string;
  label: string;
  node_type: NodeType;
  position: Position;
  interfaces: Interface[];
  state: NodeState;
}

export interface LinkEndpoint {
  node_id: string;
  interface_id: string;
}

export interface Link {
  id: string;
  source: LinkEndpoint;
  target: LinkEndpoint;
  bandwidth_bps: number;
  propagation_delay_us: number;
  loss_probability: number;
  bit_error_rate: number;
  queue_capacity: number;
  status: LinkStatus;
}

export interface HistoryStatus {
  can_undo: boolean;
  can_redo: boolean;
}

