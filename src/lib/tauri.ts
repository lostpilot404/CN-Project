import { Project } from '../types/project';
import {
  Node,
  NodeType,
  NodeState,
  Position,
  Link,
  LinkStatus,
  Interface,
  HistoryStatus,
} from '../types/topology';
import { SimulationStateSnapshot, SimEvent } from '../types/simulation';
import {
  MetricType,
  RoutingAlgorithm,
  RoutingTable,
  ConvergenceTelemetry,
} from '../types/routing';
import {
  Ipv4SubnetInfo,
  SubnetSplitResult,
  VlsmSubnetRequirement,
  VlsmAllocationResult,
  DuplicateIpConflict,
  Ipv6Info,
  NatProtocol,
  NatTable,
  NatTranslationResult,
} from '../types/addressing';
import {
  ParityMode,
  HammingEncodeResult,
  HammingVerifyResult,
  CrcCalculationResult,
  CrcVerifyResult,
  ChecksumCalculationResult,
  ChecksumVerifyResult,
} from '../types/datalink';
import {
  FlowControlConfig,
  FlowControlSimResult,
} from '../types/flowControl';
import {
  MacConfig,
  MacSimResult,
} from '../types/mac';


// Check if running inside Tauri window
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// Safe invoke wrapper
async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  }
  // In pure browser environment, fall back to mock memory store
  return mockInvoke<T>(cmd, args);
}

// In-memory mock for browser development and frontend component tests
let mockProject: Project = {
  schemaVersion: 1,
  metadata: {
    name: 'Default NetSim Topology',
    description: 'B.Tech CSE Network Simulation Studio',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    author: 'NetSim Student',
  },
  nodes: [
    {
      id: 'node-1',
      label: 'Workstation PC1',
      node_type: 'pc',
      position: { x: 120, y: 180 },
      interfaces: [
        {
          id: 'if-1',
          name: 'eth0',
          node_id: 'node-1',
          mac_address: '02:00:00:00:00:01',
          ipv4: '192.168.1.10',
          subnet_mask: '255.255.255.0',
          status: 'up',
        },
      ],
      state: 'up',
    },
    {
      id: 'node-2',
      label: 'Core Router R1',
      node_type: 'router',
      position: { x: 380, y: 180 },
      interfaces: [
        {
          id: 'if-2a',
          name: 'eth0',
          node_id: 'node-2',
          mac_address: '02:00:00:00:00:02',
          ipv4: '192.168.1.1',
          subnet_mask: '255.255.255.0',
          status: 'up',
        },
        {
          id: 'if-2b',
          name: 'eth1',
          node_id: 'node-2',
          mac_address: '02:00:00:00:00:03',
          ipv4: '10.0.0.1',
          subnet_mask: '255.255.255.0',
          status: 'up',
        },
      ],
      state: 'up',
    },
    {
      id: 'node-3',
      label: 'Web Server S1',
      node_type: 'server',
      position: { x: 640, y: 180 },
      interfaces: [
        {
          id: 'if-3',
          name: 'eth0',
          node_id: 'node-3',
          mac_address: '02:00:00:00:00:04',
          ipv4: '10.0.0.100',
          subnet_mask: '255.255.255.0',
          status: 'up',
        },
      ],
      state: 'up',
    },
    {
      id: 'node-4',
      label: 'Workgroup Switch SW1',
      node_type: 'switch',
      position: { x: 500, y: 320 },
      interfaces: [
        {
          id: 'if-4a',
          name: 'port1',
          node_id: 'node-4',
          mac_address: '02:00:00:00:00:05',
          status: 'up',
        },
      ],
      state: 'up',
    },
  ],
  links: [
    {
      id: 'link-node-1-node-2',
      source: { node_id: 'node-1', interface_id: 'eth0' },
      target: { node_id: 'node-2', interface_id: 'eth0' },
      bandwidth_bps: 100_000_000,
      propagation_delay_us: 2_000,
      loss_probability: 0.0,
      bit_error_rate: 0.0,
      queue_capacity: 50,
      status: 'up',
    },
    {
      id: 'link-node-2-node-3',
      source: { node_id: 'node-2', interface_id: 'eth1' },
      target: { node_id: 'node-3', interface_id: 'eth0' },
      bandwidth_bps: 1_000_000_000,
      propagation_delay_us: 10_000,
      loss_probability: 0.0,
      bit_error_rate: 0.0,
      queue_capacity: 100,
      status: 'up',
    },
  ],
  simulation_config: {
    seed: 42891,
    max_simulation_time_us: 10_000_000,
    default_bandwidth_bps: 10_000_000,
    default_propagation_delay_us: 10_000,
  },
};

let mockSimTimeUs = 0;
let mockEvents: SimEvent[] = [];

let mockUndoStack: Project[] = [];
let mockRedoStack: Project[] = [];

function pushMockUndo() {
  mockUndoStack.push(JSON.parse(JSON.stringify(mockProject)));
  if (mockUndoStack.length > 50) mockUndoStack.shift();
  mockRedoStack = [];
}

function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case 'get_project':
      return Promise.resolve(mockProject as unknown as T);

    case 'create_project': {
      pushMockUndo();
      const name = (args?.name as string) || 'New Project';
      mockProject = {
        ...mockProject,
        metadata: { ...mockProject.metadata, name },
        nodes: [],
        links: [],
      };
      return Promise.resolve(mockProject as unknown as T);
    }

    case 'add_node': {
      pushMockUndo();
      const label = args?.label as string;
      const nodeType = args?.nodeType as NodeType;
      const x = (args?.x as number) || 100;
      const y = (args?.y as number) || 100;
      const id = (args?.id as string) || `node-${mockProject.nodes.length + 1}`;
      let ifaces: Interface[] = [];
      if (nodeType === 'pc') {
        ifaces = [
          {
            id: `${id}-eth0`,
            name: 'eth0',
            node_id: id,
            mac_address: `02:00:00:01:${id.slice(-2)}:01`,
            ipv4: '192.168.1.10',
            subnet_mask: '255.255.255.0',
            status: 'up',
          },
        ];
      } else if (nodeType === 'server') {
        ifaces = [
          {
            id: `${id}-eth0`,
            name: 'eth0',
            node_id: id,
            mac_address: `02:00:00:02:${id.slice(-2)}:01`,
            ipv4: '10.0.0.100',
            subnet_mask: '255.255.255.0',
            status: 'up',
          },
        ];
      } else if (nodeType === 'router') {
        ifaces = [0, 1, 2, 3].map((i) => ({
          id: `${id}-eth${i}`,
          name: `eth${i}`,
          node_id: id,
          mac_address: `02:00:00:03:${id.slice(-2)}:0${i}`,
          ipv4: `10.${i}.1.1`,
          subnet_mask: '255.255.255.0',
          status: 'up',
        }));
      } else if (nodeType === 'switch') {
        ifaces = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
          id: `${id}-port${i}`,
          name: `port${i}`,
          node_id: id,
          mac_address: `02:00:00:04:${id.slice(-2)}:0${i}`,
          status: 'up',
        }));
      } else if (nodeType === 'access_point') {
        ifaces = [
          {
            id: `${id}-eth0`,
            name: 'eth0',
            node_id: id,
            mac_address: `02:00:00:05:${id.slice(-2)}:01`,
            status: 'up',
          },
          {
            id: `${id}-wlan0`,
            name: 'wlan0',
            node_id: id,
            mac_address: `02:00:00:05:${id.slice(-2)}:02`,
            status: 'up',
          },
        ];
      } else {
        ifaces = [
          {
            id: `${id}-eth0`,
            name: 'eth0',
            node_id: id,
            mac_address: `02:00:00:06:${id.slice(-2)}:01`,
            status: 'up',
          },
          {
            id: `${id}-eth1`,
            name: 'eth1',
            node_id: id,
            mac_address: `02:00:00:06:${id.slice(-2)}:02`,
            status: 'up',
          },
        ];
      }
      const newNode: Node = {
        id,
        label: label || `${nodeType} ${id}`,
        node_type: nodeType,
        position: { x, y },
        interfaces: ifaces,
        state: 'up',
      };
      mockProject.nodes.push(newNode);
      return Promise.resolve(newNode as unknown as T);
    }

    case 'update_node': {
      pushMockUndo();
      const nodeId = args?.nodeId as string;
      const node = mockProject.nodes.find((n) => n.id === nodeId);
      if (!node) return Promise.reject(new Error(`Node ${nodeId} not found`));
      if (args?.label !== undefined) node.label = args.label as string;
      if (args?.nodeState !== undefined) node.state = args.nodeState as any;
      if (args?.position !== undefined) node.position = args.position as any;
      return Promise.resolve(node as unknown as T);
    }

    case 'remove_node': {
      pushMockUndo();
      const nodeId = args?.nodeId as string;
      const linksToRemove = mockProject.links.filter(
        (l) => l.source.node_id === nodeId || l.target.node_id === nodeId
      );
      for (const link of linksToRemove) {
        for (const node of mockProject.nodes) {
          for (const iface of node.interfaces) {
            if (iface.link_id === link.id) iface.link_id = undefined;
          }
        }
      }
      mockProject.links = mockProject.links.filter(
        (l) => l.source.node_id !== nodeId && l.target.node_id !== nodeId
      );
      mockProject.nodes = mockProject.nodes.filter((n) => n.id !== nodeId);
      return Promise.resolve(undefined as unknown as T);
    }

    case 'add_link': {
      const src = args?.sourceNodeId as string;
      const dst = args?.targetNodeId as string;
      if (src === dst) {
        return Promise.reject(new Error('Invalid connection: Cannot connect a node to itself'));
      }
      const srcNode = mockProject.nodes.find((n) => n.id === src);
      const dstNode = mockProject.nodes.find((n) => n.id === dst);
      if (!srcNode || !dstNode) {
        return Promise.reject(new Error('Node not found'));
      }
      const srcIfaceId =
        (args?.sourceInterfaceId as string) ||
        srcNode.interfaces.find((i) => !i.link_id)?.id;
      const dstIfaceId =
        (args?.targetInterfaceId as string) ||
        dstNode.interfaces.find((i) => !i.link_id)?.id;
      if (!srcIfaceId) {
        return Promise.reject(
          new Error(`No free interface available on source node '${src}'`)
        );
      }
      if (!dstIfaceId) {
        return Promise.reject(
          new Error(`No free interface available on target node '${dst}'`)
        );
      }
      const srcIface = srcNode.interfaces.find(
        (i) => i.id === srcIfaceId || i.name === srcIfaceId
      );
      const dstIface = dstNode.interfaces.find(
        (i) => i.id === dstIfaceId || i.name === dstIfaceId
      );
      if (srcIface?.link_id) {
        return Promise.reject(
          new Error(
            `Interface '${srcIfaceId}' on node '${src}' is already connected to link '${srcIface.link_id}'`
          )
        );
      }
      if (dstIface?.link_id) {
        return Promise.reject(
          new Error(
            `Interface '${dstIfaceId}' on node '${dst}' is already connected to link '${dstIface.link_id}'`
          )
        );
      }
      pushMockUndo();
      const id = (args?.id as string) || `link-${src}-${dst}`;
      const newLink: Link = {
        id,
        source: {
          node_id: src,
          interface_id: srcIface?.id || srcIfaceId,
        },
        target: {
          node_id: dst,
          interface_id: dstIface?.id || dstIfaceId,
        },
        bandwidth_bps: (args?.bandwidthBps as number) || 10_000_000,
        propagation_delay_us: (args?.propagationDelayUs as number) || 10_000,
        loss_probability: (args?.lossProbability as number) || 0.0,
        bit_error_rate: (args?.bitErrorRate as number) || 0.0,
        queue_capacity: (args?.queueCapacity as number) || 50,
        status: 'up',
      };
      if (srcIface) srcIface.link_id = id;
      if (dstIface) dstIface.link_id = id;
      mockProject.links.push(newLink);
      return Promise.resolve(newLink as unknown as T);
    }

    case 'update_link': {
      pushMockUndo();
      const linkId = args?.linkId as string;
      const link = mockProject.links.find((l) => l.id === linkId);
      if (!link) return Promise.reject(new Error(`Link ${linkId} not found`));
      if (args?.bandwidthBps !== undefined) link.bandwidth_bps = args.bandwidthBps as number;
      if (args?.propagationDelayUs !== undefined) link.propagation_delay_us = args.propagationDelayUs as number;
      if (args?.lossProbability !== undefined) link.loss_probability = args.lossProbability as number;
      if (args?.bitErrorRate !== undefined) link.bit_error_rate = args.bitErrorRate as number;
      if (args?.queueCapacity !== undefined) link.queue_capacity = args.queueCapacity as number;
      if (args?.status !== undefined) link.status = args.status as any;
      return Promise.resolve(link as unknown as T);
    }

    case 'remove_link': {
      pushMockUndo();
      const linkId = args?.linkId as string;
      mockProject.links = mockProject.links.filter((l) => l.id !== linkId);
      return Promise.resolve(undefined as unknown as T);
    }

    case 'update_interface': {
      pushMockUndo();
      const nodeId = args?.nodeId as string;
      const interfaceId = args?.interfaceId as string;
      const node = mockProject.nodes.find((n) => n.id === nodeId);
      if (!node) return Promise.reject(new Error(`Node ${nodeId} not found`));
      const iface = node.interfaces.find((i) => i.id === interfaceId || i.name === interfaceId);
      if (!iface) return Promise.reject(new Error(`Interface ${interfaceId} not found`));
      if (args?.ipv4 !== undefined) iface.ipv4 = args.ipv4 as string;
      if (args?.subnetMask !== undefined) iface.subnet_mask = args.subnetMask as string;
      if (args?.ipv6 !== undefined) iface.ipv6 = args.ipv6 as string;
      if (args?.macAddress !== undefined) iface.mac_address = args.macAddress as string;
      if (args?.status !== undefined) iface.status = args.status as any;
      return Promise.resolve(iface as unknown as T);
    }

    case 'undo_topology': {
      if (mockUndoStack.length === 0) return Promise.reject(new Error('Nothing to undo'));
      const prev = mockUndoStack.pop()!;
      mockRedoStack.push(JSON.parse(JSON.stringify(mockProject)));
      mockProject = prev;
      return Promise.resolve(mockProject as unknown as T);
    }

    case 'redo_topology': {
      if (mockRedoStack.length === 0) return Promise.reject(new Error('Nothing to redo'));
      const next = mockRedoStack.pop()!;
      mockUndoStack.push(JSON.parse(JSON.stringify(mockProject)));
      mockProject = next;
      return Promise.resolve(mockProject as unknown as T);
    }

    case 'get_topology_history_status': {
      return Promise.resolve({
        can_undo: mockUndoStack.length > 0,
        can_redo: mockRedoStack.length > 0,
      } as unknown as T);
    }

    case 'get_simulation_state': {
      const snapshot: SimulationStateSnapshot = {
        current_time_us: mockSimTimeUs,
        status: 'ready',
        pending_events_count: 0,
        processed_events_count: mockEvents.length,
        recent_events: mockEvents.slice(-10).reverse(),
        metrics: {
          packets_created: mockEvents.length,
          packets_delivered: Math.max(0, mockEvents.length - 1),
          packets_dropped_overflow: 0,
          packets_dropped_loss: 0,
          packets_dropped_error: 0,
          packets_dropped_link_down: 0,
          bytes_transmitted: mockEvents.length * 1000,
          bytes_delivered: Math.max(0, mockEvents.length - 1) * 1000,
          total_latency_us: 5800,
          min_latency_us: 5800,
          max_latency_us: 5800,
        },
        queues: mockProject.links.map((l) => ({
          link_id: l.id,
          occupancy: 0,
          capacity: l.queue_capacity,
          is_transmitting: false,
          total_enqueued: 1,
          total_dropped_overflow: 0,
        })),
      };
      return Promise.resolve(snapshot as unknown as T);
    }

    case 'step_simulation': {
      mockSimTimeUs += 1000;
      const ev: SimEvent = {
        id: mockEvents.length + 1,
        timestamp: mockSimTimeUs,
        event_type: { packet_created: { packet_id: `pkt-${mockEvents.length + 1}`, node_id: 'node-1' } },
        description: `Simulated step event at ${mockSimTimeUs} us`,
      };
      mockEvents.push(ev);
      return Promise.resolve(ev as unknown as T);
    }

    case 'run_simulation_micros': {
      const dur = (args?.durationUs as number) || 50000;
      mockSimTimeUs += dur;
      return Promise.resolve(5 as unknown as T);
    }

    case 'run_simulation_until_empty': {
      mockSimTimeUs += 10000;
      return Promise.resolve(10 as unknown as T);
    }

    case 'pause_simulation': {
      const snap: SimulationStateSnapshot = {
        current_time_us: mockSimTimeUs,
        status: 'paused',
        pending_events_count: 0,
        processed_events_count: mockEvents.length,
        recent_events: mockEvents.slice(-10).reverse(),
        metrics: {
          packets_created: mockEvents.length,
          packets_delivered: mockEvents.length,
          packets_dropped_overflow: 0,
          packets_dropped_loss: 0,
          packets_dropped_error: 0,
          packets_dropped_link_down: 0,
          bytes_transmitted: mockEvents.length * 1000,
          bytes_delivered: mockEvents.length * 1000,
          total_latency_us: 0,
          min_latency_us: null,
          max_latency_us: null,
        },
        queues: [],
      };
      return Promise.resolve(snap as unknown as T);
    }

    case 'reset_simulation': {
      mockSimTimeUs = 0;
      mockEvents = [];
      const snapshot: SimulationStateSnapshot = {
        current_time_us: 0,
        status: 'ready',
        pending_events_count: 0,
        processed_events_count: 0,
        recent_events: [],
        metrics: {
          packets_created: 0,
          packets_delivered: 0,
          packets_dropped_overflow: 0,
          packets_dropped_loss: 0,
          packets_dropped_error: 0,
          packets_dropped_link_down: 0,
          bytes_transmitted: 0,
          bytes_delivered: 0,
          total_latency_us: 0,
          min_latency_us: null,
          max_latency_us: null,
        },
        queues: [],
      };
      return Promise.resolve(snapshot as unknown as T);
    }

    case 'inject_packet': {
      const src = (args?.srcNodeId as string) || 'node-1';
      const dst = (args?.dstNodeId as string) || 'node-2';
      const pktId = `pkt-${mockEvents.length + 1}`;
      const ev: SimEvent = {
        id: mockEvents.length + 1,
        timestamp: mockSimTimeUs,
        event_type: { PacketCreated: { packet_id: pktId, node_id: src, size_bytes: 1000 } },
        description: `Injected packet ${pktId} (${src} -> ${dst})`,
      };
      mockEvents.push(ev);
      return Promise.resolve(pktId as unknown as T);
    }

    case 'get_packet_details': {
      return Promise.resolve(null as unknown as T);
    }

    case 'schedule_demo_packet': {
      const ev: SimEvent = {
        id: mockEvents.length + 1,
        timestamp: mockSimTimeUs + 500,
        event_type: { packet_created: { packet_id: `pkt-demo`, node_id: 'node-1' } },
        description: 'Scheduled demo packet between PC1 and Server S1',
      };
      mockEvents.push(ev);
      return Promise.resolve(mockSimTimeUs as unknown as T);
    }

    case 'calculate_routing_table': {
      const nodeId = args?.nodeId as string;
      const algorithm = (args?.algorithm as string) || 'dijkstra';
      const metricType = (args?.metricType as string) || 'hop_count';
      const node = mockProject.nodes.find((n) => n.id === nodeId);
      if (node && node.node_type !== 'router') {
        return Promise.reject(
          new Error(
            `Node '${node.label}' (${node.node_type}) is not an L3 routing device. Routing tables are only generated for Routers.`
          )
        );
      }
      const entries = mockProject.nodes.map((n) => ({
        destination: n.id,
        destination_label: n.label,
        next_hop: n.id === nodeId ? null : n.id,
        interface_id: n.id === nodeId ? null : 'eth0',
        metric: n.id === nodeId ? 0 : 1,
        path: n.id === nodeId ? [nodeId] : [nodeId, n.id],
        is_reachable: true,
        protocol: algorithm === 'dijkstra' ? 'Dijkstra' : 'Bellman-Ford',
      }));
      return Promise.resolve({
        node_id: nodeId,
        node_label: node?.label || nodeId,
        algorithm: algorithm === 'dijkstra' ? 'Dijkstra (Link-State)' : 'Bellman-Ford (Distance-Vector)',
        metric_type: metricType,
        entries,
      } as unknown as T);
    }

    case 'simulate_routing_convergence': {
      const sourceNodeId = args?.sourceNodeId as string;
      const node = mockProject.nodes.find((n) => n.id === sourceNodeId);
      if (node && node.node_type !== 'router') {
        return Promise.reject(
          new Error(
            `Node '${node.label}' (${node.node_type}) is not an L3 routing device. Routing tables are only generated for Routers.`
          )
        );
      }
      const distances: Record<string, number> = {};
      mockProject.nodes.forEach((n) => {
        distances[n.id] = n.id === sourceNodeId ? 0 : 1;
      });
      return Promise.resolve({
        algorithm: 'Bellman-Ford (Distance-Vector)',
        source_node_id: sourceNodeId,
        total_rounds: 2,
        converged: true,
        rounds: [
          {
            round_number: 0,
            source_distances: distances,
            changes: ['Initial neighbor discovery'],
            changed: true,
          },
          {
            round_number: 1,
            source_distances: distances,
            changes: [],
            changed: false,
          },
        ],
        final_routing_table: {
          node_id: sourceNodeId,
          node_label: node?.label || sourceNodeId,
          algorithm: 'Bellman-Ford (Distance-Vector)',
          metric_type: 'hop_count',
          entries: mockProject.nodes.map((n) => ({
            destination: n.id,
            destination_label: n.label,
            next_hop: n.id === sourceNodeId ? null : n.id,
            interface_id: n.id === sourceNodeId ? null : 'eth0',
            metric: n.id === sourceNodeId ? 0 : 1,
            path: n.id === sourceNodeId ? [sourceNodeId] : [sourceNodeId, n.id],
            is_reachable: true,
            protocol: 'Bellman-Ford',
          })),
        },
      } as unknown as T);
    }

    case 'calculate_ipv4_subnet': {
      const input = (args?.input as string) || '192.168.1.0/24';
      const [ipPart, prefixPart] = input.split('/');
      const prefix = prefixPart ? parseInt(prefixPart, 10) : 24;
      const totalHosts = prefix === 0 ? 4294967296 : Math.pow(2, 32 - prefix);
      const usableHosts = prefix >= 31 ? (prefix === 31 ? 2 : 1) : Math.max(0, totalHosts - 2);
      return Promise.resolve({
        input,
        ip_address: ipPart,
        prefix_length: prefix,
        subnet_mask: '255.255.255.0',
        wildcard_mask: '0.0.0.255',
        network_address: ipPart,
        broadcast_address: ipPart,
        first_usable_ip: ipPart,
        last_usable_ip: ipPart,
        total_hosts: totalHosts,
        usable_hosts: usableHosts,
        ip_binary: '11000000.10101000.00000001.00000000',
        mask_binary: '11111111.11111111.11111111.00000000',
        ip_class: 'Class C',
        scope: 'Private (RFC 1918 192.168.0.0/16)',
      } as unknown as T);
    }

    case 'split_ipv4_subnet': {
      const baseCidr = (args?.baseCidr as string) || '192.168.1.0/24';
      const newPrefix = (args?.newPrefix as number) || 26;
      return Promise.resolve({
        base_cidr: baseCidr,
        original_prefix: 24,
        new_prefix: newPrefix,
        subnets_count: 4,
        subnets: [],
      } as unknown as T);
    }

    case 'allocate_vlsm_subnets': {
      const baseCidr = (args?.baseCidr as string) || '10.0.0.0/24';
      const reqs = (args?.requirements as VlsmSubnetRequirement[]) || [];
      return Promise.resolve({
        base_cidr: baseCidr,
        base_network: '10.0.0.0',
        base_prefix: 24,
        total_base_hosts: 256,
        total_needed_hosts: reqs.reduce((acc, r) => acc + r.needed_hosts, 0),
        total_allocated_hosts: 200,
        total_wasted_hosts: 20,
        utilization_percent: 78.12,
        subnets: [],
        free_address_space: [],
      } as unknown as T);
    }

    case 'detect_duplicate_ips_command': {
      const ipCounts: Record<string, { node_id: string; node_label: string; interface_id: string; interface_name: string }[]> = {};
      mockProject.nodes.forEach((n) => {
        n.interfaces.forEach((iface) => {
          if (iface.ipv4) {
            const ip = iface.ipv4.split('/')[0];
            if (!ipCounts[ip]) ipCounts[ip] = [];
            ipCounts[ip].push({
              node_id: n.id,
              node_label: n.label,
              interface_id: iface.id,
              interface_name: iface.name,
            });
          }
        });
      });
      const conflicts: DuplicateIpConflict[] = [];
      Object.entries(ipCounts).forEach(([ip, occurrences]) => {
        if (occurrences.length > 1) {
          conflicts.push({ ip, occurrences });
        }
      });
      return Promise.resolve(conflicts as unknown as T);
    }

    case 'validate_ipv6_address': {
      const input = (args?.input as string) || '2001:db8::1';
      return Promise.resolve({
        input,
        canonical_address: '2001:db8::1',
        expanded_address: '2001:0db8:0000:0000:0000:0000:0000:0001',
        prefix_length: 64,
        scope: 'Global Unicast (2000::/3)',
        is_valid: true,
        network_prefix: '2001:0db8:0000:0000::/64',
        interface_identifier: '0000:0000:0000:0001',
      } as unknown as T);
    }

    case 'get_or_create_nat_table': {
      const routerNodeId = (args?.routerNodeId as string) || 'node-2';
      const publicIp = (args?.publicIp as string) || '203.0.113.1';
      return Promise.resolve({
        router_node_id: routerNodeId,
        public_ip: publicIp,
        port_range_start: 49152,
        port_range_end: 65535,
        next_dynamic_port: 49152,
        entries: [],
        static_rules: [],
        next_entry_id: 1,
      } as unknown as T);
    }

    case 'add_static_dnat_rule': {
      const routerNodeId = (args?.routerNodeId as string) || 'node-2';
      const publicIp = (args?.publicIp as string) || '203.0.113.1';
      const protocol = (args?.protocol as NatProtocol) || 'TCP';
      const publicPort = (args?.publicPort as number) || 80;
      const privateIp = (args?.privateIp as string) || '192.168.1.10';
      const privatePort = (args?.privatePort as number) || 8080;
      const description = (args?.description as string) || 'Web Server';
      return Promise.resolve({
        router_node_id: routerNodeId,
        public_ip: publicIp,
        port_range_start: 49152,
        port_range_end: 65535,
        next_dynamic_port: 49152,
        entries: [],
        static_rules: [
          {
            id: 'dnat-1',
            protocol,
            public_port: publicPort,
            private_ip: privateIp,
            private_port: privatePort,
            description,
          },
        ],
        next_entry_id: 1,
      } as unknown as T);
    }

    case 'simulate_nat_outbound': {
      const srcIp = (args?.srcIp as string) || '192.168.1.10';
      const srcPort = (args?.srcPort as number) || 50000;
      const dstIp = (args?.dstIp as string) || '93.184.216.34';
      const dstPort = (args?.dstPort as number) || 443;
      const protocol = (args?.protocol as NatProtocol) || 'TCP';
      const publicIp = (args?.publicIp as string) || '203.0.113.1';
      return Promise.resolve({
        original_src_ip: srcIp,
        original_src_port: srcPort,
        original_dst_ip: dstIp,
        original_dst_port: dstPort,
        translated_src_ip: publicIp,
        translated_src_port: 49152,
        translated_dst_ip: dstIp,
        translated_dst_port: dstPort,
        entry: {
          id: 'nat-1',
          protocol,
          private_ip: srcIp,
          private_port: srcPort,
          public_ip: publicIp,
          public_port: 49152,
          mapping_type: 'dynamic_snat',
          created_at_us: 1000,
          last_used_at_us: 1000,
          timeout_us: 7200000000,
        },
        created_new_mapping: true,
        direction: 'outbound (SNAT)',
      } as unknown as T);
    }

    case 'simulate_nat_inbound': {
      const srcIp = (args?.srcIp as string) || '93.184.216.34';
      const srcPort = (args?.srcPort as number) || 443;
      const dstIp = (args?.dstIp as string) || '203.0.113.1';
      const dstPort = (args?.dstPort as number) || 49152;
      return Promise.resolve({
        original_src_ip: srcIp,
        original_src_port: srcPort,
        original_dst_ip: dstIp,
        original_dst_port: dstPort,
        translated_src_ip: srcIp,
        translated_src_port: srcPort,
        translated_dst_ip: '192.168.1.10',
        translated_dst_port: 50000,
        entry: {
          id: 'nat-1',
          protocol: 'TCP',
          private_ip: '192.168.1.10',
          private_port: 50000,
          public_ip: dstIp,
          public_port: dstPort,
          mapping_type: 'dynamic_snat',
          created_at_us: 1000,
          last_used_at_us: 1000,
          timeout_us: 7200000000,
        },
        created_new_mapping: false,
        direction: 'inbound (Dynamic Reverse NAPT)',
      } as unknown as T);
    }

    case 'calculate_hamming_encode': {
      const dataBits = (args?.dataBits as string) || '1011';
      const parityMode = (args?.parityMode as ParityMode) || 'Even';
      // Deterministic mock for "1011"
      return Promise.resolve({
        raw_data_bits: dataBits,
        data_bit_count: 4,
        parity_bit_count: 3,
        total_bit_count: 7,
        parity_mode: parityMode,
        encoded_bits: parityMode === 'Even' ? '0110011' : '1011011',
        bit_positions: [
          { position: 1, is_parity: true, bit_value: parityMode === 'Even' ? 0 : 1, label: 'p1' },
          { position: 2, is_parity: true, bit_value: parityMode === 'Even' ? 1 : 0, label: 'p2' },
          { position: 3, is_parity: false, bit_value: 1, label: 'd1' },
          { position: 4, is_parity: true, bit_value: parityMode === 'Even' ? 0 : 1, label: 'p4' },
          { position: 5, is_parity: false, bit_value: 0, label: 'd2' },
          { position: 6, is_parity: false, bit_value: 1, label: 'd3' },
          { position: 7, is_parity: false, bit_value: 1, label: 'd4' },
        ],
        parity_details: [
          { parity_index: 1, label: 'p1', covered_indices: [1, 3, 5, 7], covered_bits: [parityMode === 'Even' ? 0 : 1, 1, 0, 1], parity_value: parityMode === 'Even' ? 0 : 1, formula: 'p1 = XOR(positions [3, 5, 7])' },
          { parity_index: 2, label: 'p2', covered_indices: [2, 3, 6, 7], covered_bits: [parityMode === 'Even' ? 1 : 0, 1, 1, 1], parity_value: parityMode === 'Even' ? 1 : 0, formula: 'p2 = XOR(positions [3, 6, 7])' },
          { parity_index: 4, label: 'p4', covered_indices: [4, 5, 6, 7], covered_bits: [parityMode === 'Even' ? 0 : 1, 0, 1, 1], parity_value: parityMode === 'Even' ? 0 : 1, formula: 'p4 = XOR(positions [5, 6, 7])' },
        ],
        overall_parity: parityMode === 'Even' ? 0 : 1,
        encoded_bits_secded: parityMode === 'Even' ? '00110011' : '11011011',
      } as unknown as T);
    }

    case 'verify_and_correct_hamming': {
      const codeword = (args?.codeword as string) || '0110011';
      const parityMode = (args?.parityMode as ParityMode) || 'Even';
      const isClean = codeword === '0110011';
      return Promise.resolve({
        received_bits: codeword,
        parity_mode: parityMode,
        syndrome_bits: isClean ? '000' : '001',
        syndrome_value: isClean ? 0 : 1,
        has_error: !isClean,
        is_correctable: true,
        error_type: isClean ? 'none' : 'single_bit',
        error_position: isClean ? null : 1,
        corrected_bits: '0110011',
        extracted_data_bits: '1011',
        syndrome_details: [],
        status_message: isClean ? 'Codeword is valid. No bit errors detected.' : 'Single-bit error detected and corrected at position 1.',
      } as unknown as T);
    }

    case 'calculate_crc': {
      const dataBits = (args?.dataBits as string) || '11010011101100';
      const polynomial = (args?.polynomial as string) || '1011';
      const polyName = (args?.polyName as string) || 'Custom';
      return Promise.resolve({
        input_bits: dataBits,
        generator_polynomial: polynomial,
        polynomial_name: polyName,
        degree: polynomial.length - 1,
        augmented_bits: dataBits + '000',
        remainder: '100',
        transmitted_codeword: dataBits + '100',
        division_steps: [
          { step_index: 1, bit_position: 3, current_window: '1101', divisor_applied: polynomial, xor_result: '0110', next_bit_brought_down: '0', explanation: 'Step 1' },
        ],
      } as unknown as T);
    }

    case 'verify_crc': {
      const codeword = (args?.codeword as string) || '11010011101100100';
      const polynomial = (args?.polynomial as string) || '1011';
      const isValid = codeword.endsWith('100');
      return Promise.resolve({
        received_bits: codeword,
        generator_polynomial: polynomial,
        polynomial_name: 'CRC',
        remainder: isValid ? '000' : '011',
        is_valid: isValid,
        error_detected: !isValid,
        division_steps: [],
        status_message: isValid ? 'Frame verified successfully. Remainder is 0.' : 'CRC Error Detected! Frame corrupted.',
      } as unknown as T);
    }

    case 'calculate_internet_checksum': {
      const inputHex = (args?.inputHex as string) || '0001 F203 F4F5 F6F7';
      return Promise.resolve({
        input_hex: inputHex,
        words: [0x0001, 0xF203, 0xF4F5, 0xF6F7],
        word_hex_list: ['0001', 'F203', 'F4F5', 'F6F7'],
        total_words: 4,
        addition_steps: [
          { step_index: 1, word_hex: '0001', word_value: 1, sum_before_addition: 0, sum_after_addition: 1, carry_detected: 0, sum_after_carry_fold: 1, explanation: 'Step 1' },
          { step_index: 2, word_hex: 'F203', word_value: 0xF203, sum_before_addition: 1, sum_after_addition: 0xF204, carry_detected: 0, sum_after_carry_fold: 0xF204, explanation: 'Step 2' },
        ],
        uncomplemented_sum: 0xDDF2,
        checksum: 0x220D,
        checksum_hex: '220D',
        checksum_binary: '0010001000001101',
      } as unknown as T);
    }

    case 'verify_internet_checksum': {
      const payloadHex = (args?.payloadHex as string) || '0001 F203 F4F5 F6F7';
      const checksumHex = (args?.checksumHex as string) || '220D';
      const isClean = payloadHex.length > 0 && checksumHex.toUpperCase().includes('220D');
      return Promise.resolve({
        payload_words: [0x0001, 0xF203, 0xF4F5, 0xF6F7],
        checksum_tested: 0x220D,
        words_with_checksum: [0x0001, 0xF203, 0xF4F5, 0xF6F7, 0x220D],
        total_accumulated_sum: isClean ? 0xFFFF : 0xFFFE,
        inverted_result: isClean ? 0x0000 : 0x0001,
        is_valid: isClean,
        error_detected: !isClean,
        verification_steps: [],
        status_message: isClean ? 'Checksum verified successfully. No corruption.' : 'Checksum verification FAILED! Corruption detected.',
      } as unknown as T);
    }

    case 'simulate_sliding_window':
    case 'simulate_go_back_n':
    case 'simulate_selective_repeat': {
      const isGBN = cmd === 'simulate_go_back_n';
      const isSR = cmd === 'simulate_selective_repeat';
      const proto = isSR ? 'selective_repeat' : isGBN ? 'go_back_n' : 'sliding_window';
      const cfg = (args?.config as FlowControlConfig) || {
        protocol: proto,
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 6,
        frame_tx_time_us: 10000,
        prop_delay_us: 40000,
        ack_tx_time_us: 2000,
        timeout_us: 120000,
        seed: 42,
        dropped_frame_indices: [],
        corrupted_frame_indices: [],
        dropped_ack_seqs: [],
      };
      const hasDrop = (cfg.dropped_frame_indices && cfg.dropped_frame_indices.length > 0) || false;
      return Promise.resolve({
        protocol: proto,
        config: cfg,
        events: [
          {
            step_index: 1,
            timestamp_us: 0,
            event_type: 'frame_sent',
            frame_index: 0,
            seq_num: 0,
            ack_seq: null,
            sender_window: { send_base: 0, next_seq_num: 1, window_size: cfg.window_size, sequence_space: cfg.sequence_space, active_window_seqs: [0, 1, 2, 3], outstanding_count: 1 },
            receiver_window: { rcv_base: 0, window_size: isSR ? cfg.window_size : 1, sequence_space: cfg.sequence_space, active_window_seqs: [0], buffered_seqs: [], delivered_count: 0 },
            description: 'Sender transmitted frame [0] (seq 0)',
          },
          ...(hasDrop ? [
            {
              step_index: 2,
              timestamp_us: 45000,
              event_type: 'frame_lost',
              frame_index: cfg.dropped_frame_indices![0],
              seq_num: cfg.dropped_frame_indices![0] % cfg.sequence_space,
              ack_seq: null,
              sender_window: { send_base: 0, next_seq_num: 3, window_size: cfg.window_size, sequence_space: cfg.sequence_space, active_window_seqs: [0, 1, 2, 3], outstanding_count: 3 },
              receiver_window: { rcv_base: 0, window_size: isSR ? cfg.window_size : 1, sequence_space: cfg.sequence_space, active_window_seqs: [0], buffered_seqs: isSR ? [3] : [], delivered_count: 0 },
              description: `Frame [${cfg.dropped_frame_indices![0]}] dropped in transit`,
            },
            {
              step_index: 3,
              timestamp_us: 120000,
              event_type: 'timeout_triggered',
              frame_index: cfg.dropped_frame_indices![0],
              seq_num: cfg.dropped_frame_indices![0] % cfg.sequence_space,
              ack_seq: null,
              sender_window: { send_base: cfg.dropped_frame_indices![0] % cfg.sequence_space, next_seq_num: 3, window_size: cfg.window_size, sequence_space: cfg.sequence_space, active_window_seqs: [0, 1, 2, 3], outstanding_count: 3 },
              receiver_window: { rcv_base: 0, window_size: isSR ? cfg.window_size : 1, sequence_space: cfg.sequence_space, active_window_seqs: [0], buffered_seqs: isSR ? [3] : [], delivered_count: 0 },
              description: isSR ? `Selective Repeat timeout on frame [${cfg.dropped_frame_indices![0]}]; retransmitting ONLY this frame` : `GBN timeout; retransmitting all outstanding frames from base`,
            },
            {
              step_index: 4,
              timestamp_us: 121000,
              event_type: 'retransmission',
              frame_index: cfg.dropped_frame_indices![0],
              seq_num: cfg.dropped_frame_indices![0] % cfg.sequence_space,
              ack_seq: null,
              sender_window: { send_base: cfg.dropped_frame_indices![0] % cfg.sequence_space, next_seq_num: 3, window_size: cfg.window_size, sequence_space: cfg.sequence_space, active_window_seqs: [0, 1, 2, 3], outstanding_count: 3 },
              receiver_window: { rcv_base: 0, window_size: isSR ? cfg.window_size : 1, sequence_space: cfg.sequence_space, active_window_seqs: [0], buffered_seqs: isSR ? [3] : [], delivered_count: 0 },
              description: `Retransmission of frame [${cfg.dropped_frame_indices![0]}]`,
            },
          ] : [
            {
              step_index: 2,
              timestamp_us: 50000,
              event_type: 'ack_received',
              frame_index: 0,
              seq_num: 0,
              ack_seq: 1,
              sender_window: { send_base: 1, next_seq_num: 1, window_size: cfg.window_size, sequence_space: cfg.sequence_space, active_window_seqs: [1, 2, 3, 4], outstanding_count: 0 },
              receiver_window: { rcv_base: 1, window_size: isSR ? cfg.window_size : 1, sequence_space: cfg.sequence_space, active_window_seqs: [1], buffered_seqs: [], delivered_count: 1 },
              description: 'ACK received; window advanced',
            },
          ]),
        ],
        frames: Array.from({ length: cfg.total_frames_to_send }, (_, i) => ({
          frame_index: i,
          seq_num: i % cfg.sequence_space,
          status: 'delivered' as const,
          is_retransmission: hasDrop && i === cfg.dropped_frame_indices![0],
          tx_count: hasDrop && i === cfg.dropped_frame_indices![0] ? 2 : 1,
          sent_at_us: i * 10000,
          acked_at_us: (i + 1) * 50000,
        })),
        metrics: {
          total_frames_sent: cfg.total_frames_to_send + (hasDrop ? 1 : 0),
          original_frames: cfg.total_frames_to_send,
          retransmissions: hasDrop ? 1 : 0,
          ack_count: cfg.total_frames_to_send,
          duplicate_frames: 0,
          dropped_or_corrupted_frames: hasDrop ? 1 : 0,
          completed_frames: cfg.total_frames_to_send,
          completion_time_us: hasDrop ? 250000 : 180000,
          utilization: hasDrop ? 0.48 : 0.65,
          protocol_overhead: hasDrop ? 0.25 : 0.18,
          sender_window_occupancy_avg: 2.4,
          receiver_buffer_occupancy_max: isSR && hasDrop ? 1 : 0,
        },
        final_sender: { send_base: cfg.total_frames_to_send % cfg.sequence_space, next_seq_num: cfg.total_frames_to_send % cfg.sequence_space, window_size: cfg.window_size, sequence_space: cfg.sequence_space, active_window_seqs: [], outstanding_count: 0 },
        final_receiver: { rcv_base: cfg.total_frames_to_send % cfg.sequence_space, window_size: isSR ? cfg.window_size : 1, sequence_space: cfg.sequence_space, active_window_seqs: [], buffered_seqs: [], delivered_count: cfg.total_frames_to_send },
        is_completed: true,
      } as unknown as T);
    }

    case 'simulate_pure_aloha': {
      const cfg = (args?.config as MacConfig) || {
        protocol: 'pure_aloha',
        persistence: 'one_persistent',
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 42,
        max_retries: 16,
        offered_load_g: 1.0,
      };
      return Promise.resolve({
        protocol: 'pure_aloha',
        config: cfg,
        events: [
          { step_index: 1, timestamp_us: 0, event_type: 'transmission_started', station_id: 0, frame_id: 1, channel_state: 'busy', description: 'Station 0 started transmitting' },
          { step_index: 2, timestamp_us: 5000, event_type: 'collision_detected', station_id: 1, frame_id: 1, channel_state: 'collision', description: 'Station 1 overlapping transmission detected (collision)' },
          { step_index: 3, timestamp_us: 15000, event_type: 'backoff_scheduled', station_id: 0, frame_id: 1, channel_state: 'idle', description: 'Station 0 scheduled random backoff delay' },
        ],
        slot_records: [],
        metrics: {
          attempted_transmissions: 12,
          successful_transmissions: cfg.total_frames_to_send,
          collisions: 4,
          retransmissions: 4,
          channel_busy_time_us: 80000,
          total_simulation_time_us: 150000,
          throughput_frames_per_sec: 53.33,
          throughput_bits_per_sec: 426666.67,
          collision_rate: 0.33,
          channel_utilization: 0.53,
          average_backoff_delay_us: 12500,
        },
        completed_successfully: true,
      } as unknown as T);
    }

    case 'simulate_slotted_aloha': {
      const cfg = (args?.config as MacConfig) || {
        protocol: 'slotted_aloha',
        persistence: 'one_persistent',
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 42,
        max_retries: 16,
        offered_load_g: 1.0,
      };
      return Promise.resolve({
        protocol: 'slotted_aloha',
        config: cfg,
        events: [
          { step_index: 1, timestamp_us: 0, event_type: 'transmission_started', station_id: 0, frame_id: 1, channel_state: 'busy', description: 'Station 0 transmitted in slot 0' },
          { step_index: 2, timestamp_us: 10000, event_type: 'transmission_success', station_id: 0, frame_id: 1, channel_state: 'idle', description: 'Station 0 successfully completed slot transmission' },
        ],
        slot_records: [
          { slot_index: 0, start_time_us: 0, end_time_us: 10000, participating_stations: [0], status: 'Success (Station 0)' },
          { slot_index: 1, start_time_us: 10000, end_time_us: 20000, participating_stations: [1, 2], status: 'Collision (Stations [1, 2])' },
          { slot_index: 2, start_time_us: 20000, end_time_us: 30000, participating_stations: [], status: 'Idle' },
        ],
        metrics: {
          attempted_transmissions: 10,
          successful_transmissions: cfg.total_frames_to_send,
          collisions: 2,
          retransmissions: 2,
          channel_busy_time_us: 80000,
          total_simulation_time_us: 120000,
          throughput_frames_per_sec: 66.67,
          throughput_bits_per_sec: 533333.33,
          collision_rate: 0.20,
          channel_utilization: 0.67,
          average_backoff_delay_us: 15000,
        },
        completed_successfully: true,
      } as unknown as T);
    }

    case 'simulate_csma': {
      const cfg = (args?.config as MacConfig) || {
        protocol: 'csma',
        persistence: 'one_persistent',
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 42,
        max_retries: 16,
        offered_load_g: 1.0,
      };
      return Promise.resolve({
        protocol: 'csma',
        config: cfg,
        events: [
          { step_index: 1, timestamp_us: 0, event_type: 'carrier_sensed', station_id: 0, frame_id: 1, channel_state: 'idle', description: 'Station 0 sensed channel: IDLE' },
          { step_index: 2, timestamp_us: 0, event_type: 'transmission_started', station_id: 0, frame_id: 1, channel_state: 'busy', description: 'Station 0 initiated transmission immediately (1-persistent)' },
          { step_index: 3, timestamp_us: 10000, event_type: 'transmission_success', station_id: 0, frame_id: 1, channel_state: 'idle', description: 'Station 0 transmission completed' },
        ],
        slot_records: [],
        metrics: {
          attempted_transmissions: 9,
          successful_transmissions: cfg.total_frames_to_send,
          collisions: 1,
          retransmissions: 1,
          channel_busy_time_us: 80000,
          total_simulation_time_us: 105000,
          throughput_frames_per_sec: 76.19,
          throughput_bits_per_sec: 609523.81,
          collision_rate: 0.11,
          channel_utilization: 0.76,
          average_backoff_delay_us: 8000,
        },
        completed_successfully: true,
      } as unknown as T);
    }

    case 'simulate_csma_cd': {
      const cfg = (args?.config as MacConfig) || {
        protocol: 'csma_cd',
        persistence: 'one_persistent',
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 42,
        max_retries: 16,
        offered_load_g: 1.5,
      };
      return Promise.resolve({
        protocol: 'csma_cd',
        config: cfg,
        events: [
          { step_index: 1, timestamp_us: 0, event_type: 'carrier_sensed', station_id: 0, frame_id: 1, channel_state: 'idle', description: 'Station 0 sensed channel: IDLE' },
          { step_index: 2, timestamp_us: 0, event_type: 'transmission_started', station_id: 0, frame_id: 1, channel_state: 'busy', description: 'Station 0 began transmitting frame 1' },
          { step_index: 3, timestamp_us: 40, event_type: 'collision_detected', station_id: 0, frame_id: 1, channel_state: 'collision', description: 'Collision detected within 2τ interval at 40 µs' },
          { step_index: 4, timestamp_us: 45, event_type: 'jam_signal_sent', station_id: 0, frame_id: 1, channel_state: 'collision', description: 'Transmitting 32-bit jam signal to enforce collision on wire' },
          { step_index: 5, timestamp_us: 95, event_type: 'transmission_aborted', station_id: 0, frame_id: 1, channel_state: 'idle', description: 'Transmission aborted after collision and jam signal' },
          { step_index: 6, timestamp_us: 95, event_type: 'backoff_scheduled', station_id: 0, frame_id: 1, channel_state: 'idle', description: 'Station 0 collision #1 (k=1); picked slot 1 -> backoff 100 µs (BEB)' },
        ],
        slot_records: [],
        metrics: {
          attempted_transmissions: 10,
          successful_transmissions: cfg.total_frames_to_send,
          collisions: 2,
          retransmissions: 2,
          channel_busy_time_us: 81000,
          total_simulation_time_us: 95000,
          throughput_frames_per_sec: 84.21,
          throughput_bits_per_sec: 673684.21,
          collision_rate: 0.20,
          channel_utilization: 0.85,
          average_backoff_delay_us: 250,
        },
        completed_successfully: true,
      } as unknown as T);
    }

    default:
      return Promise.reject(new Error(`Command ${cmd} not implemented in mock mode`));

  }
}

// Exported typed API
export const api = {
  getProject: () => invokeTauri<Project>('get_project'),
  createProject: (name: string) => invokeTauri<Project>('create_project', { name }),
  saveProjectJson: () => invokeTauri<string>('save_project_json'),
  loadProjectJson: (jsonContent: string) => invokeTauri<Project>('load_project_json', { jsonContent }),
  addNode: (label: string, nodeType: NodeType, x: number, y: number, id?: string) =>
    invokeTauri<Node>('add_node', { label, nodeType, x, y, id }),
  updateNode: (
    nodeId: string,
    label?: string,
    nodeState?: NodeState,
    position?: Position
  ) => invokeTauri<Node>('update_node', { nodeId, label, nodeState, position }),
  removeNode: (nodeId: string) => invokeTauri<void>('remove_node', { nodeId }),
  addLink: (
    sourceNodeId: string,
    targetNodeId: string,
    id?: string,
    sourceInterfaceId?: string,
    targetInterfaceId?: string,
    bandwidthBps?: number,
    propagationDelayUs?: number,
    lossProbability?: number,
    bitErrorRate?: number,
    queueCapacity?: number
  ) =>
    invokeTauri<Link>('add_link', {
      sourceNodeId,
      targetNodeId,
      id,
      sourceInterfaceId,
      targetInterfaceId,
      bandwidthBps,
      propagationDelayUs,
      lossProbability,
      bitErrorRate,
      queueCapacity,
    }),
  updateLink: (
    linkId: string,
    bandwidthBps?: number,
    propagationDelayUs?: number,
    lossProbability?: number,
    bitErrorRate?: number,
    queueCapacity?: number,
    status?: LinkStatus
  ) =>
    invokeTauri<Link>('update_link', {
      linkId,
      bandwidthBps,
      propagationDelayUs,
      lossProbability,
      bitErrorRate,
      queueCapacity,
      status,
    }),
  removeLink: (linkId: string) => invokeTauri<void>('remove_link', { linkId }),
  updateInterface: (
    nodeId: string,
    interfaceId: string,
    ipv4?: string,
    subnetMask?: string,
    ipv6?: string,
    macAddress?: string,
    status?: 'up' | 'down'
  ) =>
    invokeTauri<Interface>('update_interface', {
      nodeId,
      interfaceId,
      ipv4,
      subnetMask,
      ipv6,
      macAddress,
      status,
    }),
  undoTopology: () => invokeTauri<Project>('undo_topology'),
  redoTopology: () => invokeTauri<Project>('redo_topology'),
  getTopologyHistoryStatus: () => invokeTauri<HistoryStatus>('get_topology_history_status'),
  getSimulationState: () => invokeTauri<SimulationStateSnapshot>('get_simulation_state'),
  stepSimulation: () => invokeTauri<SimEvent | null>('step_simulation'),
  runSimulationMicros: (durationUs: number) =>
    invokeTauri<number>('run_simulation_micros', { durationUs }),
  runSimulationUntilEmpty: () => invokeTauri<number>('run_simulation_until_empty'),
  pauseSimulation: () => invokeTauri<SimulationStateSnapshot>('pause_simulation'),
  resetSimulation: () => invokeTauri<SimulationStateSnapshot>('reset_simulation'),
  injectPacket: (
    srcNodeId: string,
    dstNodeId: string,
    sizeBytes?: number,
    appProtocol?: string,
    transportProtocol?: string
  ) =>
    invokeTauri<string>('inject_packet', {
      srcNodeId,
      dstNodeId,
      sizeBytes,
      appProtocol,
      transportProtocol,
    }),
  getPacketDetails: (packetId: string) =>
    invokeTauri<unknown>('get_packet_details', { packetId }),
  scheduleDemoPacket: (srcNodeId: string, dstNodeId: string) =>
    invokeTauri<number>('schedule_demo_packet', { srcNodeId, dstNodeId }),
  // Phase 4A: Routing & Addressing Authoritative APIs
  calculateRoutingTable: (nodeId: string, algorithm: RoutingAlgorithm, metricType: MetricType) =>
    invokeTauri<RoutingTable>('calculate_routing_table', { nodeId, algorithm, metricType }),
  simulateRoutingConvergence: (sourceNodeId: string, metricType: MetricType) =>
    invokeTauri<ConvergenceTelemetry>('simulate_routing_convergence', { sourceNodeId, metricType }),
  calculateIpv4Subnet: (input: string) =>
    invokeTauri<Ipv4SubnetInfo>('calculate_ipv4_subnet', { input }),
  splitIpv4Subnet: (baseCidr: string, newPrefix: number) =>
    invokeTauri<SubnetSplitResult>('split_ipv4_subnet', { baseCidr, newPrefix }),
  allocateVlsmSubnets: (baseCidr: string, requirements: VlsmSubnetRequirement[]) =>
    invokeTauri<VlsmAllocationResult>('allocate_vlsm_subnets', { baseCidr, requirements }),
  detectDuplicateIps: () =>
    invokeTauri<DuplicateIpConflict[]>('detect_duplicate_ips_command'),
  validateIpv6Address: (input: string) =>
    invokeTauri<Ipv6Info>('validate_ipv6_address', { input }),
  getOrCreateNatTable: (routerNodeId: string, publicIp: string) =>
    invokeTauri<NatTable>('get_or_create_nat_table', { routerNodeId, publicIp }),
  addStaticDnatRule: (
    routerNodeId: string,
    publicIp: string,
    protocol: NatProtocol,
    publicPort: number,
    privateIp: string,
    privatePort: number,
    description: string
  ) =>
    invokeTauri<NatTable>('add_static_dnat_rule', {
      routerNodeId,
      publicIp,
      protocol,
      publicPort,
      privateIp,
      privatePort,
      description,
    }),
  simulateNatOutbound: (
    routerNodeId: string,
    publicIp: string,
    srcIp: string,
    srcPort: number,
    dstIp: string,
    dstPort: number,
    protocol: NatProtocol
  ) =>
    invokeTauri<NatTranslationResult>('simulate_nat_outbound', {
      routerNodeId,
      publicIp,
      srcIp,
      srcPort,
      dstIp,
      dstPort,
      protocol,
    }),
  simulateNatInbound: (
    routerNodeId: string,
    publicIp: string,
    srcIp: string,
    srcPort: number,
    dstIp: string,
    dstPort: number,
    protocol: NatProtocol
  ) =>
    invokeTauri<NatTranslationResult>('simulate_nat_inbound', {
      routerNodeId,
      publicIp,
      srcIp,
      srcPort,
      dstIp,
      dstPort,
      protocol,
    }),
  calculateHammingEncode: (dataBits: string, parityMode: ParityMode) =>
    invokeTauri<HammingEncodeResult>('calculate_hamming_encode', { dataBits, parityMode }),
  verifyAndCorrectHamming: (codeword: string, parityMode: ParityMode) =>
    invokeTauri<HammingVerifyResult>('verify_and_correct_hamming', { codeword, parityMode }),
  calculateCrc: (dataBits: string, polynomial: string, polyName?: string) =>
    invokeTauri<CrcCalculationResult>('calculate_crc', { dataBits, polynomial, polyName }),
  verifyCrc: (codeword: string, polynomial: string, polyName?: string) =>
    invokeTauri<CrcVerifyResult>('verify_crc', { codeword, polynomial, polyName }),
  calculateInternetChecksum: (inputHex: string) =>
    invokeTauri<ChecksumCalculationResult>('calculate_internet_checksum', { inputHex }),
  verifyInternetChecksum: (payloadHex: string, checksumHex: string) =>
    invokeTauri<ChecksumVerifyResult>('verify_internet_checksum', { payloadHex, checksumHex }),
  // Phase 4C: Flow Control and Multiple Access
  simulateSlidingWindow: (config: FlowControlConfig) =>
    invokeTauri<FlowControlSimResult>('simulate_sliding_window', { config }),
  simulateGoBackN: (config: FlowControlConfig) =>
    invokeTauri<FlowControlSimResult>('simulate_go_back_n', { config }),
  simulateSelectiveRepeat: (config: FlowControlConfig) =>
    invokeTauri<FlowControlSimResult>('simulate_selective_repeat', { config }),
  simulatePureAloha: (config: MacConfig) =>
    invokeTauri<MacSimResult>('simulate_pure_aloha', { config }),
  simulateSlottedAloha: (config: MacConfig) =>
    invokeTauri<MacSimResult>('simulate_slotted_aloha', { config }),
  simulateCsma: (config: MacConfig) =>
    invokeTauri<MacSimResult>('simulate_csma', { config }),
  simulateCsmaCd: (config: MacConfig) =>
    invokeTauri<MacSimResult>('simulate_csma_cd', { config }),
};

