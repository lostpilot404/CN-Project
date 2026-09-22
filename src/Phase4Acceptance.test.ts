import { describe, it, expect } from 'vitest';
import { api } from './lib/tauri';

describe('Phase 4A: Routing & Addressing Frontend Integration Tests', () => {
  it('computes authoritative routing table for router nodes', async () => {
    const table = await api.calculateRoutingTable('node-2', 'dijkstra', 'hop_count');
    expect(table).toBeDefined();
    expect(table.node_id).toBe('node-2');
    expect(table.entries.length).toBeGreaterThan(0);
    const selfEntry = table.entries.find((e) => e.destination === 'node-2');
    expect(selfEntry).toBeDefined();
    expect(selfEntry?.metric).toBe(0);
  });

  it('rejects L3 routing table generation for non-router devices (Switch, PC, Server)', async () => {
    // Switch node cannot receive L3 routing table
    await expect(api.calculateRoutingTable('node-4', 'dijkstra', 'hop_count')).rejects.toThrow(
      'not an L3 routing device'
    );
    // PC node cannot receive L3 routing table
    await expect(api.calculateRoutingTable('node-1', 'dijkstra', 'hop_count')).rejects.toThrow(
      'not an L3 routing device'
    );
    // Server node cannot receive L3 routing table
    await expect(api.calculateRoutingTable('node-3', 'dijkstra', 'hop_count')).rejects.toThrow(
      'not an L3 routing device'
    );
  });

  it('simulates distance vector convergence with telemetry rounds', async () => {
    const telemetry = await api.simulateRoutingConvergence('node-2', 'hop_count');
    expect(telemetry).toBeDefined();
    expect(telemetry.source_node_id).toBe('node-2');
    expect(telemetry.converged).toBe(true);
    expect(telemetry.rounds.length).toBeGreaterThanOrEqual(1);
    expect(telemetry.final_routing_table).toBeDefined();
  });

  it('calculates IPv4 subnet information with CIDR and masks', async () => {
    const sub = await api.calculateIpv4Subnet('192.168.1.10/24');
    expect(sub).toBeDefined();
    expect(sub.prefix_length).toBe(24);
    expect(sub.total_hosts).toBe(256);
    expect(sub.usable_hosts).toBe(254);
    expect(sub.ip_class).toBe('Class C');
    expect(sub.scope).toContain('Private');
  });

  it('splits IPv4 subnet into equal-prefix blocks', async () => {
    const split = await api.splitIpv4Subnet('192.168.1.0/24', 26);
    expect(split).toBeDefined();
    expect(split.new_prefix).toBe(26);
    expect(split.subnets_count).toBe(4);
  });

  it('allocates true VLSM subnets with power-of-two alignment', async () => {
    const reqs = [
      { name: 'Engineering', needed_hosts: 100 },
      { name: 'Sales', needed_hosts: 50 },
      { name: 'WAN Link', needed_hosts: 2 },
    ];
    const vlsm = await api.allocateVlsmSubnets('10.0.0.0/24', reqs);
    expect(vlsm).toBeDefined();
    expect(vlsm.base_prefix).toBe(24);
    expect(vlsm.total_needed_hosts).toBe(152);
    expect(vlsm.total_allocated_hosts).toBeGreaterThanOrEqual(152);
    expect(vlsm.utilization_percent).toBeGreaterThan(0);
  });

  it('audits topology interfaces for duplicate IPv4 conflicts', async () => {
    const conflicts = await api.detectDuplicateIps();
    expect(Array.isArray(conflicts)).toBe(true);
  });

  it('validates and formats IPv6 addresses according to RFC 5952', async () => {
    const v6 = await api.validateIpv6Address('2001:0db8:0000:0000:0000:0000:0000:0001/64');
    expect(v6).toBeDefined();
    expect(v6.canonical_address).toBe('2001:db8::1');
    expect(v6.scope).toContain('Global Unicast');
    expect(v6.is_valid).toBe(true);
  });

  it('manages stateful NAT table, static DNAT, and translation simulation', async () => {
    const table = await api.getOrCreateNatTable('node-2', '203.0.113.1');
    expect(table).toBeDefined();
    expect(table.router_node_id).toBe('node-2');
    expect(table.public_ip).toBe('203.0.113.1');

    // Add static DNAT rule
    const updated = await api.addStaticDnatRule(
      'node-2',
      '203.0.113.1',
      'TCP',
      80,
      '192.168.1.10',
      8080,
      'Web Server'
    );
    expect(updated.static_rules.length).toBeGreaterThan(0);

    // Test outbound SNAT
    const outRes = await api.simulateNatOutbound(
      'node-2',
      '203.0.113.1',
      '192.168.1.10',
      50000,
      '93.184.216.34',
      443,
      'TCP'
    );
    expect(outRes).toBeDefined();
    expect(outRes.translated_src_ip).toBe('203.0.113.1');
    expect(outRes.translated_src_port).toBe(49152);

    // Test inbound reverse translation
    const inRes = await api.simulateNatInbound(
      'node-2',
      '203.0.113.1',
      '93.184.216.34',
      443,
      '203.0.113.1',
      49152,
      'TCP'
    );
    expect(inRes).toBeDefined();
    expect(inRes.translated_dst_ip).toBe('192.168.1.10');
    expect(inRes.translated_dst_port).toBe(50000);
  });
});
