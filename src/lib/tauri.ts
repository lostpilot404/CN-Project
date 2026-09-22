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
};
