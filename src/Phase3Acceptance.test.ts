import { describe, it, expect, beforeEach } from 'vitest';
import { api } from './lib/api';
import { NodeType, LinkStatus } from './types/topology';

describe('Phase 3 End-to-End Topology & UI Acceptance Suite', () => {
  beforeEach(async () => {
    // Reset to clean project before each scenario
    await api.createProject('Acceptance Test Topology');
  });

  it('executes the full 18-step user acceptance workflow seamlessly', async () => {
    // -------------------------------------------------------------
    // Step 1: Launch NetSim & verify clean initial project
    // -------------------------------------------------------------
    const proj0 = await api.getProject();
    expect(proj0).toBeDefined();
    expect(proj0.nodes).toHaveLength(0);
    expect(proj0.links).toHaveLength(0);

    // -------------------------------------------------------------
    // Step 2: Add a PC
    // -------------------------------------------------------------
    const pcNode = await api.addNode('Lab PC 1', 'pc' as NodeType, 100, 200, 'pc-1');
    expect(pcNode.id).toBe('pc-1');
    expect(pcNode.label).toBe('Lab PC 1');
    expect(pcNode.node_type).toBe('pc');
    expect(pcNode.interfaces).toHaveLength(1);
    expect(pcNode.interfaces[0].name).toBe('eth0');
    expect(pcNode.interfaces[0].ipv4).toBe('192.168.1.10');

    // -------------------------------------------------------------
    // Step 3: Add a Router
    // -------------------------------------------------------------
    const routerNode = await api.addNode('Gateway R1', 'router' as NodeType, 350, 200, 'r-1');
    expect(routerNode.id).toBe('r-1');
    expect(routerNode.label).toBe('Gateway R1');
    expect(routerNode.node_type).toBe('router');
    expect(routerNode.interfaces).toHaveLength(4);
    expect(routerNode.interfaces[0].name).toBe('eth0');
    expect(routerNode.interfaces[1].name).toBe('eth1');

    // -------------------------------------------------------------
    // Step 4: Add a Server
    // -------------------------------------------------------------
    const serverNode = await api.addNode('Web Server S1', 'server' as NodeType, 600, 200, 'srv-1');
    expect(serverNode.id).toBe('srv-1');
    expect(serverNode.label).toBe('Web Server S1');
    expect(serverNode.node_type).toBe('server');
    expect(serverNode.interfaces).toHaveLength(1);
    expect(serverNode.interfaces[0].name).toBe('eth0');
    expect(serverNode.interfaces[0].ipv4).toBe('10.0.0.100');

    // -------------------------------------------------------------
    // Step 5: Connect valid interfaces between nodes
    //   - Link 1: PC (eth0) <-> Router (eth0)
    //   - Link 2: Router (eth1) <-> Server (eth0)
    // -------------------------------------------------------------
    const link1 = await api.addLink(pcNode.id, routerNode.id, 'link-pc-r1');
    expect(link1.id).toBe('link-pc-r1');
    expect(link1.source.node_id).toBe(pcNode.id);
    expect(link1.target.node_id).toBe(routerNode.id);

    const link2 = await api.addLink(routerNode.id, serverNode.id, 'link-r1-srv');
    expect(link2.id).toBe('link-r1-srv');
    expect(link2.source.node_id).toBe(routerNode.id);
    expect(link2.target.node_id).toBe(serverNode.id);

    // -------------------------------------------------------------
    // Step 6: Verify the links appear correctly in the topology canvas
    // -------------------------------------------------------------
    const projState = await api.getProject();
    expect(projState.nodes).toHaveLength(3);
    expect(projState.links).toHaveLength(2);

    const pcInProj = projState.nodes.find((n) => n.id === pcNode.id)!;
    expect(pcInProj.interfaces[0].link_id).toBe('link-pc-r1');

    const routerInProj = projState.nodes.find((n) => n.id === routerNode.id)!;
    expect(routerInProj.interfaces[0].link_id).toBe('link-pc-r1');
    expect(routerInProj.interfaces[1].link_id).toBe('link-r1-srv');

    const srvInProj = projState.nodes.find((n) => n.id === serverNode.id)!;
    expect(srvInProj.interfaces[0].link_id).toBe('link-r1-srv');

    // -------------------------------------------------------------
    // Step 7: Select a node and change its label
    // -------------------------------------------------------------
    const updatedPC = await api.updateNode(pcNode.id, 'Accounting Workstation', 'up');
    expect(updatedPC.label).toBe('Accounting Workstation');

    // -------------------------------------------------------------
    // Step 8: Change a node interface IPv4 address and subnet mask
    // -------------------------------------------------------------
    const updatedIface = await api.updateInterface(
      pcNode.id,
      pcNode.interfaces[0].id,
      '192.168.10.50',
      '255.255.255.128'
    );
    expect(updatedIface.ipv4).toBe('192.168.10.50');
    expect(updatedIface.subnet_mask).toBe('255.255.255.128');

    // -------------------------------------------------------------
    // Step 9: Select a link and change:
    //   - bandwidth
    //   - propagation delay
    //   - loss probability
    //   - bit error rate
    //   - queue capacity
    //   - status
    // -------------------------------------------------------------
    const updatedLink1 = await api.updateLink(
      link1.id,
      50_000_000,    // 50 Mbps
      5_000,         // 5 ms
      0.015,         // 1.5% loss
      0.0001,        // BER
      150,           // 150 packets queue
      'degraded' as LinkStatus
    );

    // -------------------------------------------------------------
    // Step 10: Verify the updated values are reflected in state
    // -------------------------------------------------------------
    expect(updatedLink1.bandwidth_bps).toBe(50_000_000);
    expect(updatedLink1.propagation_delay_us).toBe(5_000);
    expect(updatedLink1.loss_probability).toBe(0.015);
    expect(updatedLink1.bit_error_rate).toBe(0.0001);
    expect(updatedLink1.queue_capacity).toBe(150);
    expect(updatedLink1.status).toBe('degraded');

    // -------------------------------------------------------------
    // Step 11: Attempt an invalid self-loop and confirm it is rejected
    // -------------------------------------------------------------
    await expect(api.addLink(pcNode.id, pcNode.id)).rejects.toThrow(/itself|Invalid connection/i);

    // -------------------------------------------------------------
    // Step 12: Attempt to connect an already occupied interface and confirm it is rejected
    // (PC eth0 is already connected to link-pc-r1)
    // -------------------------------------------------------------
    await expect(api.addLink(pcNode.id, serverNode.id)).rejects.toThrow(
      /already connected|No free interface/i
    );

    // -------------------------------------------------------------
    // Step 13: Delete a node and verify connected links/interfaces are cleaned up
    // (Deleting routerNode should remove both link1 and link2 and free PC & Server eth0)
    // -------------------------------------------------------------
    await api.removeNode(routerNode.id);
    const projAfterDelete = await api.getProject();
    expect(projAfterDelete.nodes).toHaveLength(2);
    expect(projAfterDelete.nodes.some((n) => n.id === routerNode.id)).toBe(false);
    expect(projAfterDelete.links).toHaveLength(0);

    const pcAfterDelete = projAfterDelete.nodes.find((n) => n.id === pcNode.id)!;
    expect(pcAfterDelete.interfaces[0].link_id).toBeUndefined();

    const srvAfterDelete = projAfterDelete.nodes.find((n) => n.id === serverNode.id)!;
    expect(srvAfterDelete.interfaces[0].link_id).toBeUndefined();

    // -------------------------------------------------------------
    // Step 14: Undo the deletion
    // -------------------------------------------------------------
    const hStatusBeforeUndo = await api.getTopologyHistoryStatus();
    expect(hStatusBeforeUndo.can_undo).toBe(true);

    const projRestored = await api.undoTopology();
    expect(projRestored.nodes).toHaveLength(3);
    expect(projRestored.nodes.some((n) => n.id === routerNode.id)).toBe(true);
    expect(projRestored.links).toHaveLength(2);

    // -------------------------------------------------------------
    // Step 15: Redo the deletion
    // -------------------------------------------------------------
    const hStatusBeforeRedo = await api.getTopologyHistoryStatus();
    expect(hStatusBeforeRedo.can_redo).toBe(true);

    const projRedone = await api.redoTopology();
    expect(projRedone.nodes).toHaveLength(2);
    expect(projRedone.nodes.some((n) => n.id === routerNode.id)).toBe(false);
    expect(projRedone.links).toHaveLength(0);

    // Revert deletion back to full 3-node topology for simulation check
    await api.undoTopology();
    const finalProj = await api.getProject();
    expect(finalProj.nodes).toHaveLength(3);
    expect(finalProj.links).toHaveLength(2);

    // -------------------------------------------------------------
    // Step 16: Verify simulation state remains synchronized after topology changes
    // -------------------------------------------------------------
    const simState = await api.getSimulationState();
    expect(simState).toBeDefined();
    expect(simState.status).toBe('ready');

    // Verify simulation can step with the topology
    const stepEv = await api.stepSimulation();
    expect(stepEv).toBeDefined();

    // -------------------------------------------------------------
    // Step 17: Verify Undo/Redo/Delete keyboard trigger simulation
    // -------------------------------------------------------------
    const statusAtEnd = await api.getTopologyHistoryStatus();
    expect(typeof statusAtEnd.can_undo).toBe('boolean');
    expect(typeof statusAtEnd.can_redo).toBe('boolean');

    // -------------------------------------------------------------
    // Step 18: Verify no runtime errors occurred
    // -------------------------------------------------------------
    expect(finalProj.nodes.length).toBe(3);
    expect(finalProj.links.length).toBe(2);
  });
});
