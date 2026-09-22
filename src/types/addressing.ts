export interface Ipv4SubnetInfo {
  input: string;
  ip_address: string;
  prefix_length: number;
  subnet_mask: string;
  wildcard_mask: string;
  network_address: string;
  broadcast_address: string;
  first_usable_ip: string;
  last_usable_ip: string;
  total_hosts: number;
  usable_hosts: number;
  ip_binary: string;
  mask_binary: string;
  ip_class: string;
  scope: string;
}

export interface SubnetSplitResult {
  base_cidr: string;
  original_prefix: number;
  new_prefix: number;
  subnets_count: number;
  subnets: Ipv4SubnetInfo[];
}

export interface VlsmSubnetRequirement {
  name: string;
  needed_hosts: number;
}

export interface VlsmAllocatedSubnet {
  name: string;
  needed_hosts: number;
  allocated_prefix: number;
  subnet_info: Ipv4SubnetInfo;
  wasted_hosts: number;
}

export interface VlsmAllocationResult {
  base_cidr: string;
  base_network: string;
  base_prefix: number;
  total_base_hosts: number;
  total_needed_hosts: number;
  total_allocated_hosts: number;
  total_wasted_hosts: number;
  utilization_percent: number;
  subnets: VlsmAllocatedSubnet[];
  free_address_space: string[];
}

export interface DuplicateIpOccurrence {
  node_id: string;
  node_label: string;
  interface_id: string;
  interface_name: string;
}

export interface DuplicateIpConflict {
  ip: string;
  occurrences: DuplicateIpOccurrence[];
}

export interface Ipv6Info {
  input: string;
  canonical_address: string;
  expanded_address: string;
  prefix_length: number;
  scope: string;
  is_valid: boolean;
  network_prefix: string;
  interface_identifier: string;
}

export type NatProtocol = 'TCP' | 'UDP' | 'ICMP';
export type NatMappingType = 'dynamic_snat' | 'static_dnat';

export interface NatEntry {
  id: string;
  protocol: NatProtocol;
  private_ip: string;
  private_port: number;
  public_ip: string;
  public_port: number;
  mapping_type: NatMappingType;
  created_at_us: number;
  last_used_at_us: number;
  timeout_us: number;
}

export interface StaticDnatRule {
  id: string;
  protocol: NatProtocol;
  public_port: number;
  private_ip: string;
  private_port: number;
  description: string;
}

export interface NatTranslationResult {
  original_src_ip: string;
  original_src_port: number;
  original_dst_ip: string;
  original_dst_port: number;
  translated_src_ip: string;
  translated_src_port: number;
  translated_dst_ip: string;
  translated_dst_port: number;
  entry: NatEntry;
  created_new_mapping: boolean;
  direction: string;
}

export interface NatTable {
  router_node_id: string;
  public_ip: string;
  port_range_start: number;
  port_range_end: number;
  next_dynamic_port: number;
  entries: NatEntry[];
  static_rules: StaticDnatRule[];
  next_entry_id: number;
}
