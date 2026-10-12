import { describe, it, expect } from 'vitest';
import { formatBps, formatTimeUs } from './lib/utils';
import { api } from './lib/api';

describe('Utility formatting functions', () => {
  it('formats bits per second correctly', () => {
    expect(formatBps(10_000_000)).toBe('10.0 Mbps');
    expect(formatBps(1_000_000_000)).toBe('1.0 Gbps');
    expect(formatBps(500_000)).toBe('500.0 Kbps');
    expect(formatBps(800)).toBe('800 bps');
  });

  it('formats virtual simulation time correctly', () => {
    expect(formatTimeUs(500)).toBe('500 µs');
    expect(formatTimeUs(15_500)).toBe('15.50 ms');
    expect(formatTimeUs(2_500_000)).toBe('2.500 s');
  });
});

describe('Tauri mock API bridge', () => {
  it('loads default project', async () => {
    const project = await api.getProject();
    expect(project).toBeDefined();
    expect(project.schemaVersion).toBe(1);
    expect(project.nodes.length).toBeGreaterThan(0);
    expect(project.links.length).toBeGreaterThan(0);
  });

  it('adds and steps simulation events', async () => {
    const stepEv = await api.stepSimulation();
    expect(stepEv).toBeDefined();
    expect(stepEv?.id).toBeGreaterThan(0);
  });

  it('performs node creation, updates, and deletion with undo/redo', async () => {
    const initialProject = await api.getProject();
    const initialNodeCount = initialProject.nodes.length;

    // Add new router node
    const newNode = await api.addNode('Branch Router', 'router', 300, 400);
    expect(newNode.id).toBeDefined();
    expect(newNode.label).toBe('Branch Router');
    expect(newNode.node_type).toBe('router');

    // Update node label and state
    const updatedNode = await api.updateNode(newNode.id, 'Branch Gateway', 'degraded');
    expect(updatedNode.label).toBe('Branch Gateway');
    expect(updatedNode.state).toBe('degraded');

    // Update interface
    const updatedIface = await api.updateInterface(
      newNode.id,
      newNode.interfaces[0]?.id || 'eth0',
      '172.16.0.1',
      '255.255.0.0'
    );
    expect(updatedIface.ipv4).toBe('172.16.0.1');
    expect(updatedIface.subnet_mask).toBe('255.255.0.0');

    // Add link to existing node
    const firstNodeId = initialProject.nodes[0].id;
    const newLink = await api.addLink(firstNodeId, newNode.id);
    expect(newLink.source.node_id).toBe(firstNodeId);
    expect(newLink.target.node_id).toBe(newNode.id);

    // Update link attributes
    const updatedLink = await api.updateLink(
      newLink.id,
      100_000_000,
      5000,
      0.02,
      0.00001,
      120,
      'degraded'
    );
    expect(updatedLink.bandwidth_bps).toBe(100_000_000);
    expect(updatedLink.propagation_delay_us).toBe(5000);
    expect(updatedLink.loss_probability).toBe(0.02);
    expect(updatedLink.queue_capacity).toBe(120);
    expect(updatedLink.status).toBe('degraded');

    // Verify history status
    const hStatus = await api.getTopologyHistoryStatus();
    expect(hStatus.can_undo).toBe(true);

    // Undo should revert previous change
    const afterUndo = await api.undoTopology();
    expect(afterUndo).toBeDefined();

    // Redo should restore change
    const afterRedo = await api.redoTopology();
    expect(afterRedo).toBeDefined();

    // Remove link and node
    await api.removeLink(newLink.id);
    await api.removeNode(newNode.id);
    const finalProject = await api.getProject();
    expect(finalProject.nodes.length).toBe(initialNodeCount);
    expect(finalProject.links.some((l) => l.id === newLink.id)).toBe(false);
  });
});

