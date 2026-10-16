/**
 * In-memory simulation double.
 *
 * NEVER reachable from a browser or desktop build. This module is aliased away in every build
 * that is not the unit-test runner (see `vite.config.ts`), and `src/lib/testDouble.stub.ts`
 * takes its place there, so a production bundle cannot fabricate simulation results.
 */
import { Project } from '../types/project';
import {
  Node,
  NodeType,
  Link,
  Interface,
} from '../types/topology';
import { SimulationStateSnapshot, SimEvent, Packet } from '../types/simulation';
import { Circuit } from '../types/switching';
import {
} from '../types/routing';
import {
  VlsmSubnetRequirement,
  DuplicateIpConflict,
  NatProtocol,
} from '../types/addressing';
import {
  ParityMode,
} from '../types/datalink';
import {
  FlowControlConfig,
} from '../types/flowControl';
import {
  MacConfig,
} from '../types/mac';
import {
  TransportConfig,
} from '../types/transport';
import {
  DnsConfig,
  HttpConfig,
  FtpConfig,
  SmtpConfig,
  SnmpConfig,
} from '../types/application';
import {
  SweepConfig,
  ComparativeExperimentConfig,
} from '../types/experiments';

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

function createDefaultMockPackets(): Packet[] {
  return [
    {
      id: 'pkt-1',
      src_node_id: 'node-1',
      dst_node_id: 'node-2',
      size_bytes: 1000,
      created_at_us: 0,
      current_node_id: 'node-1',
      next_hop_node_id: 'node-2',
      state: 'created',
      headers: {
        application: {
          protocol: 'HTTP',
          payload_preview: 'GET /index.html HTTP/1.1 (1000 bytes)',
          message_type: 'HTTP Request',
        },
        transport: {
          protocol: 'TCP',
          src_port: 49152,
          dst_port: 80,
          seq_num: 1000,
          ack_num: 1,
          window_size: 65535,
          flags: ['SYN', 'ACK'],
          payload_length: 1000,
          is_retransmission: false,
          connection_state: 'ESTABLISHED',
        },
        network: {
          version: 4,
          src_ip: '192.168.1.10',
          dst_ip: '10.0.0.100',
          ttl: 64,
          protocol_num: 6,
          checksum: 0xa4f2,
        },
        datalink: {
          src_mac: '02:00:00:01:01:01',
          dst_mac: '02:00:00:02:01:01',
          ether_type: 0x0800,
          crc_fcs: 0x3bc1a920,
          frame_type: 'Ethernet II (DIX)',
          fcs_valid: true,
        },
        physical: {
          link_id: 'link-1',
          bandwidth_bps: 100_000_000,
          propagation_delay_us: 10_000,
          tx_start_us: 5,
          tx_finish_us: 85,
          bit_count: 8000,
          preamble_bits: '10101010...',
          signal_encoding: 'Manchester',
        },
      },
      journey_hops: ['node-1'],
      planned_route: ['node-1', 'node-2'],
      hop_history: [
        {
          hop_index: 0,
          node_id: 'node-1',
          link_id: null,
          timestamp_us: 0,
          state: 'created',
          description: 'Packet pkt-1 created at node node-1',
        },
        {
          hop_index: 1,
          node_id: 'node-1',
          link_id: 'link-1',
          timestamp_us: 5,
          state: 'queued',
          description: 'Packet pkt-1 entered queue for link-1',
        },
        {
          hop_index: 2,
          node_id: 'node-1',
          link_id: 'link-1',
          timestamp_us: 5,
          state: 'transmitting',
          description: 'Packet pkt-1 began transmission on link-1',
        },
        {
          hop_index: 3,
          node_id: 'node-2',
          link_id: 'link-1',
          timestamp_us: 10085,
          state: 'delivered',
          description: 'Packet pkt-1 delivered to destination node-2',
        },
      ],
    },
  ];
}

let mockPackets: Packet[] = createDefaultMockPackets();

let mockUndoStack: Project[] = [];
let mockRedoStack: Project[] = [];
let mockCircuits: Circuit[] = [];
let mockCircuitCount = 0;
const mockCircuitMetrics = {
  requests_total: 0,
  requests_accepted: 0,
  requests_blocked: 0,
  circuits_released: 0,
  circuits_active: 0,
  acceptance_rate: 0,
  blocking_rate: 0,
};
function circuitMetricsWithRates() {
  const total = mockCircuitMetrics.requests_total || 0;
  return {
    ...mockCircuitMetrics,
    acceptance_rate: total ? mockCircuitMetrics.requests_accepted / total : 0,
    blocking_rate: total ? mockCircuitMetrics.requests_blocked / total : 0,
  };
}

function pushMockUndo() {
  mockUndoStack.push(JSON.parse(JSON.stringify(mockProject)));
  if (mockUndoStack.length > 50) mockUndoStack.shift();
  mockRedoStack = [];
}

export function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
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
      // Project-level state is isolated per project (matches the Python service).
      mockCircuits = [];
      mockCircuitCount = 0;
      Object.assign(mockCircuitMetrics, {
        requests_total: 0,
        requests_accepted: 0,
        requests_blocked: 0,
        circuits_released: 0,
        circuits_active: 0,
        acceptance_rate: 0,
        blocking_rate: 0,
      });
      return Promise.resolve(mockProject as unknown as T);
    }

    case 'save_project_json': {
      return Promise.resolve(JSON.stringify(mockProject, null, 2) as unknown as T);
    }

    case 'load_project_json': {
      const raw = args?.jsonContent as string | undefined;
      if (raw === undefined || raw === null || raw === '') {
        return Promise.reject(new Error('No project JSON supplied'));
      }
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return Promise.reject(new Error('Project JSON is not valid JSON'));
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return Promise.reject(new Error('Project JSON must decode to an object'));
      }
      const candidate = data as Partial<Project> & { schemaVersion?: number; schema_version?: number };
      const version = candidate.schemaVersion ?? candidate.schema_version ?? 1;
      if (version !== 1) {
        return Promise.reject(
          new Error(`Unsupported project schema version ${version}: this build supports version 1`)
        );
      }
      if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.links)) {
        return Promise.reject(new Error("Project JSON is not a valid NetSim project: missing 'nodes' or 'links'"));
      }
      const nodeIds = candidate.nodes.map((n) => n.id);
      if (new Set(nodeIds).size !== nodeIds.length) {
        return Promise.reject(new Error('Project contains duplicate node identifiers'));
      }
      pushMockUndo();
      mockProject = {
        ...mockProject,
        metadata: candidate.metadata ?? mockProject.metadata,
        nodes: candidate.nodes as Project['nodes'],
        links: candidate.links as Project['links'],
      };
      // Imported projects carry their own state: engine and per-project registries reset.
      mockSimTimeUs = 0;
      mockEvents = [];
      mockCircuits = [];
      mockCircuitCount = 0;
      Object.assign(mockCircuitMetrics, {
        requests_total: 0,
        requests_accepted: 0,
        requests_blocked: 0,
        circuits_released: 0,
        circuits_active: 0,
        acceptance_rate: 0,
        blocking_rate: 0,
      });
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
          packets_dropped_ttl: 0,
          packets_dropped_no_route: 0,
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
        packets: mockPackets,
        forwarding_policy: { algorithm: 'dijkstra', metric_type: 'hop_count', default_ttl: 64 },
      };
      return Promise.resolve(snapshot as unknown as T);
    }

    case 'step_simulation': {
      mockSimTimeUs += 1000;
      const ev: SimEvent = {
        id: mockEvents.length + 1,
        timestamp: mockSimTimeUs,
        event_type: { type: 'packet_created', data: { packet_id: `pkt-${mockEvents.length + 1}`, node_id: 'node-1' } },
        description: `Simulated step event at ${mockSimTimeUs} us`,
        packet_id: `pkt-${mockEvents.length + 1}`,
        node_id: 'node-1',
        layer: 'Application',
        protocol: 'HTTP',
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
          packets_dropped_ttl: 0,
          packets_dropped_no_route: 0,
          bytes_transmitted: mockEvents.length * 1000,
          bytes_delivered: mockEvents.length * 1000,
          total_latency_us: 0,
          min_latency_us: null,
          max_latency_us: null,
        },
        queues: [],
        packets: mockPackets,
        forwarding_policy: { algorithm: 'dijkstra', metric_type: 'hop_count', default_ttl: 64 },
      };
      return Promise.resolve(snap as unknown as T);
    }

    case 'reset_simulation': {
      mockSimTimeUs = 0;
      mockEvents = [];
      mockPackets = createDefaultMockPackets();
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
          packets_dropped_ttl: 0,
          packets_dropped_no_route: 0,
          bytes_transmitted: 0,
          bytes_delivered: 0,
          total_latency_us: 0,
          min_latency_us: null,
          max_latency_us: null,
        },
        queues: [],
        packets: mockPackets,
        forwarding_policy: { algorithm: 'dijkstra', metric_type: 'hop_count', default_ttl: 64 },
      };
      return Promise.resolve(snapshot as unknown as T);
    }

    case 'inject_packet': {
      const src = (args?.srcNodeId as string) || 'node-1';
      const dst = (args?.dstNodeId as string) || 'node-2';
      const sizeBytes = (args?.sizeBytes as number) || 1000;
      const appProtocol = (args?.appProtocol as string) || 'HTTP';
      const transportProtocol = (args?.transportProtocol as string) || 'TCP';
      const pktId = `pkt-${mockPackets.length + 1}`;

      const newPkt: Packet = {
        id: pktId,
        src_node_id: src,
        dst_node_id: dst,
        size_bytes: sizeBytes,
        created_at_us: mockSimTimeUs,
        current_node_id: src,
        next_hop_node_id: dst,
        state: 'created',
        headers: {
          application: {
            protocol: appProtocol,
            payload_preview: `Payload (${sizeBytes} bytes)`,
            message_type: `${appProtocol} Data`,
          },
          transport: {
            protocol: transportProtocol,
            src_port: 49152,
            dst_port: appProtocol === 'HTTP' ? 80 : 53,
            seq_num: 100,
            ack_num: null,
            window_size: 65535,
            flags: transportProtocol === 'TCP' ? ['ACK'] : [],
            payload_length: sizeBytes,
            is_retransmission: false,
            connection_state: transportProtocol === 'TCP' ? 'ESTABLISHED' : null,
          },
          network: {
            version: 4,
            src_ip: '192.168.1.10',
            dst_ip: '10.0.0.100',
            ttl: 64,
            protocol_num: transportProtocol === 'TCP' ? 6 : 17,
            checksum: 0xa4f2,
          },
          datalink: {
            src_mac: '02:00:00:01:01:01',
            dst_mac: '02:00:00:02:01:01',
            ether_type: 0x0800,
            crc_fcs: 0x3bc1a920,
            frame_type: 'Ethernet II (DIX)',
            fcs_valid: true,
          },
          physical: {
            link_id: 'link-1',
            bandwidth_bps: 10_000_000,
            propagation_delay_us: 10_000,
            tx_start_us: mockSimTimeUs,
            tx_finish_us: mockSimTimeUs + 800,
            bit_count: sizeBytes * 8,
            preamble_bits: '10101010...',
            signal_encoding: 'Manchester',
          },
        },
        journey_hops: [src],
        planned_route: [src, dst],
        hop_history: [
          {
            hop_index: 0,
            node_id: src,
            link_id: null,
            timestamp_us: mockSimTimeUs,
            state: 'created',
            description: `Packet ${pktId} created at node ${src}`,
          },
        ],
      };
      mockPackets.push(newPkt);

      const ev: SimEvent = {
        id: mockEvents.length + 1,
        timestamp: mockSimTimeUs,
        event_type: { type: 'packet_created', data: { packet_id: pktId, node_id: src, size_bytes: sizeBytes } },
        description: `Injected packet ${pktId} (${src} -> ${dst})`,
        packet_id: pktId,
        node_id: src,
        layer: 'Application',
        protocol: appProtocol,
      };
      mockEvents.push(ev);
      return Promise.resolve(pktId as unknown as T);
    }

    case 'get_packet_details': {
      const pktId = args?.packetId as string;
      const found = mockPackets.find((p) => p.id === pktId) || mockPackets[0] || null;
      return Promise.resolve(found as unknown as T);
    }

    case 'schedule_demo_packet': {
      const ev: SimEvent = {
        id: mockEvents.length + 1,
        timestamp: mockSimTimeUs + 500,
        event_type: { type: 'packet_created', data: { packet_id: `pkt-demo`, node_id: 'node-1' } },
        description: 'Scheduled demo packet between PC1 and Server S1',
        packet_id: 'pkt-demo',
        node_id: 'node-1',
        layer: 'Application',
        protocol: 'HTTP',
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

    case 'simulate_tcp':
    case 'simulate_tcp_congestion': {
      const cfg = (args?.config as TransportConfig) || {
        protocol: 'tcp',
        source_node_id: 'host-a',
        destination_node_id: 'host-b',
        source_port: 49152,
        destination_port: 80,
        payload_bytes: 4000,
        segment_size_bytes: 1000,
        initial_sequence_number: 1000,
        initial_cwnd_mss: 1.0,
        initial_ssthresh_mss: 16.0,
        initial_rto_us: 100000,
        receive_window_bytes: 32000,
        seed: 42,
        maximum_retries: 5,
      };
      return Promise.resolve({
        protocol: 'tcp',
        config: cfg,
        derived_route: [cfg.source_node_id, 'router-1', cfg.destination_node_id],
        events: [
          {
            step_index: 0,
            timestamp_us: 0,
            event_type: 'syn_sent',
            source_node: cfg.source_node_id,
            destination_node: cfg.destination_node_id,
            segment: {
              source_port: cfg.source_port,
              destination_port: cfg.destination_port,
              sequence_number: cfg.initial_sequence_number,
              acknowledgment_number: 0,
              flags: ['syn'],
              payload_length: 0,
              advertised_window: cfg.receive_window_bytes,
              timestamp_us: 0,
              is_retransmission: false,
            },
            connection_state: 'syn_sent',
            cwnd_mss: 1.0,
            ssthresh_mss: 16.0,
            srtt_us: 100000,
            rttvar_us: 50000,
            rto_us: 100000,
            description: 'Client sent SYN [seq=1000]',
          },
          {
            step_index: 1,
            timestamp_us: 20000,
            event_type: 'syn_received',
            source_node: cfg.source_node_id,
            destination_node: cfg.destination_node_id,
            segment: null,
            connection_state: 'syn_received',
            cwnd_mss: 1.0,
            ssthresh_mss: 16.0,
            srtt_us: 100000,
            rttvar_us: 50000,
            rto_us: 100000,
            description: 'Server received SYN, transitioning to SYN-RECEIVED',
          },
          {
            step_index: 2,
            timestamp_us: 40000,
            event_type: 'connection_established',
            source_node: cfg.destination_node_id,
            destination_node: cfg.source_node_id,
            segment: null,
            connection_state: 'established',
            cwnd_mss: 1.0,
            ssthresh_mss: 16.0,
            rtt_sample_us: 40000,
            srtt_us: 40000,
            rttvar_us: 20000,
            rto_us: 120000,
            description: 'Client received SYN-ACK. State: ESTABLISHED',
          },
          {
            step_index: 3,
            timestamp_us: 40000,
            event_type: 'data_segment_sent',
            source_node: cfg.source_node_id,
            destination_node: cfg.destination_node_id,
            segment: {
              source_port: cfg.source_port,
              destination_port: cfg.destination_port,
              sequence_number: cfg.initial_sequence_number + 1,
              acknowledgment_number: 5001,
              flags: ['ack', 'psh'],
              payload_length: 1000,
              advertised_window: cfg.receive_window_bytes,
              timestamp_us: 40000,
              is_retransmission: false,
            },
            connection_state: 'established',
            cwnd_mss: 1.0,
            ssthresh_mss: 16.0,
            srtt_us: 40000,
            rttvar_us: 20000,
            rto_us: 120000,
            description: 'Sent data segment [seq=1001, len=1000]',
          },
          {
            step_index: 4,
            timestamp_us: 80000,
            event_type: 'ack_received',
            source_node: cfg.destination_node_id,
            destination_node: cfg.source_node_id,
            segment: null,
            connection_state: 'established',
            cwnd_mss: 2.0,
            ssthresh_mss: 16.0,
            rtt_sample_us: 40000,
            srtt_us: 40000,
            rttvar_us: 20000,
            rto_us: 120000,
            description: 'Received ACK [ack=2001], cwnd increased to 2.0 MSS',
          },
          {
            step_index: 5,
            timestamp_us: 120000,
            event_type: 'connection_closed',
            source_node: cfg.source_node_id,
            destination_node: cfg.destination_node_id,
            segment: null,
            connection_state: 'closed',
            cwnd_mss: 2.0,
            ssthresh_mss: 16.0,
            srtt_us: 40000,
            rttvar_us: 20000,
            rto_us: 120000,
            description: 'Connection closed gracefully',
          },
        ],
        cwnd_timeline: [
          { timestamp_us: 0, cwnd_mss: 1.0, cwnd_bytes: 1000, ssthresh_mss: 16.0, phase: 'slow_start', reason: 'Initial cwnd' },
          { timestamp_us: 80000, cwnd_mss: 2.0, cwnd_bytes: 2000, ssthresh_mss: 16.0, phase: 'slow_start', reason: 'New ACK received in Slow Start' },
        ],
        metrics: {
          segments_sent: 4,
          segments_delivered: 4,
          retransmissions: 0,
          segments_lost: 0,
          duplicate_acks: 0,
          bytes_sent: cfg.payload_bytes,
          bytes_delivered: cfg.payload_bytes,
          completion_time_us: 120000,
          average_rtt_us: 40000,
          smoothed_rtt_us: 40000,
          final_rto_us: 120000,
          throughput_bits_per_sec: ((cfg.payload_bytes + 160) * 8 * 1000000) / 120000,
          throughput_bytes_per_sec: ((cfg.payload_bytes + 160) * 1000000) / 120000,
          goodput_bits_per_sec: (cfg.payload_bytes * 8 * 1000000) / 120000,
          retransmitted_payload_bytes: 0,
          header_bytes_sent: 160,
          wire_bytes_sent: cfg.payload_bytes + 160,
          packet_loss_rate: 0.0,
          sender_window_occupancy_avg: 0.5,
          receiver_window_occupancy_max: 0,
          congestion_window_final: 2.0,
          congestion_window_max: 2.0,
          timeout_count: 0,
          fast_retransmit_count: 0,
        },
        completed: true,
      } as unknown as T);
    }

    case 'simulate_udp': {
      const cfg = (args?.config as TransportConfig) || {
        protocol: 'udp',
        source_node_id: 'host-a',
        destination_node_id: 'host-b',
        source_port: 49152,
        destination_port: 80,
        payload_bytes: 4000,
        segment_size_bytes: 1000,
        initial_sequence_number: 1000,
        initial_cwnd_mss: 1.0,
        initial_ssthresh_mss: 16.0,
        initial_rto_us: 100000,
        receive_window_bytes: 32000,
        seed: 42,
        maximum_retries: 5,
      };
      return Promise.resolve({
        protocol: 'udp',
        config: cfg,
        derived_route: [cfg.source_node_id, 'router-1', cfg.destination_node_id],
        events: [
          {
            step_index: 0,
            timestamp_us: 0,
            event_type: 'data_segment_sent',
            source_node: cfg.source_node_id,
            destination_node: cfg.destination_node_id,
            segment: null,
            connection_state: 'closed',
            cwnd_mss: 0,
            ssthresh_mss: 0,
            srtt_us: 0,
            rttvar_us: 0,
            rto_us: 0,
            description: 'Sent UDP datagram #1',
          },
          {
            step_index: 1,
            timestamp_us: 20000,
            event_type: 'segment_delivered',
            source_node: cfg.source_node_id,
            destination_node: cfg.destination_node_id,
            segment: null,
            connection_state: 'closed',
            cwnd_mss: 0,
            ssthresh_mss: 0,
            srtt_us: 0,
            rttvar_us: 0,
            rto_us: 0,
            description: 'UDP datagram #1 delivered',
          },
        ],
        cwnd_timeline: [],
        metrics: {
          segments_sent: 4,
          segments_delivered: 4,
          retransmissions: 0,
          segments_lost: 0,
          duplicate_acks: 0,
          bytes_sent: cfg.payload_bytes,
          bytes_delivered: cfg.payload_bytes,
          completion_time_us: 35000,
          average_rtt_us: 0,
          smoothed_rtt_us: 0,
          final_rto_us: 0,
          throughput_bits_per_sec: ((cfg.payload_bytes + 112) * 8 * 1000000) / 35000,
          throughput_bytes_per_sec: ((cfg.payload_bytes + 112) * 1000000) / 35000,
          goodput_bits_per_sec: (cfg.payload_bytes * 8 * 1000000) / 35000,
          retransmitted_payload_bytes: 0,
          header_bytes_sent: 112,
          wire_bytes_sent: cfg.payload_bytes + 112,
          packet_loss_rate: 0.0,
          sender_window_occupancy_avg: 0.0,
          receiver_window_occupancy_max: 0,
          congestion_window_final: 0.0,
          congestion_window_max: 0.0,
          timeout_count: 0,
          fast_retransmit_count: 0,
        },
        completed: true,
      } as unknown as T);
    }

    case 'simulate_dns': {
      const cfg = (args?.config as DnsConfig) || {
        client_node_id: 'host-a',
        server_node_id: 'dns-resolver',
        auth_server_node_id: 'dns-auth',
        query_name: 'www.example.com',
        query_type: 'A',
        query_mode: 'recursive',
        query_id: 1001,
        seed: 42,
      };
      const isNx = cfg.query_name === 'nxdomain.example.com';
      const responseCode = isNx ? 'NXDOMAIN' : 'NOERROR';
      const answers = isNx
        ? []
        : [
            {
              name: cfg.query_name,
              record_type: cfg.query_type,
              value: cfg.query_type === 'AAAA' ? '2606:2800:220:1:248:1893:25c8:1946' : '93.184.216.34',
              ttl: 300,
              priority: null,
            },
          ];
      const queryPktId = `dns-query-${cfg.query_id}`;
      const respPktId = `dns-resp-${cfg.query_id}`;
      const events = [
        {
          step_index: 0,
          timestamp_us: 0,
          node_id: cfg.client_node_id,
          protocol: 'DNS',
          event_type: 'DNS_QUERY_SENT',
          description: `Client sent DNS query #${cfg.query_id} for ${cfg.query_name} [${cfg.query_type}]`,
          packet_id: queryPktId,
          session_id: `dns-sess-${cfg.query_id}`,
          details: `Target: ${cfg.server_node_id}:53`,
        },
        {
          step_index: 1,
          timestamp_us: 15000,
          node_id: cfg.server_node_id,
          protocol: 'DNS',
          event_type: 'DNS_LOOKUP',
          description: `Resolver received query #${cfg.query_id}, consulting local cache/zone`,
          packet_id: null,
          session_id: `dns-sess-${cfg.query_id}`,
          details: `Mode: ${cfg.query_mode}`,
        },
        {
          step_index: 2,
          timestamp_us: 30000,
          node_id: cfg.server_node_id,
          protocol: 'DNS',
          event_type: isNx ? 'DNS_NXDOMAIN' : 'DNS_RESPONSE_SENT',
          description: isNx
            ? `Resolver produced NXDOMAIN response for ${cfg.query_name}`
            : `Resolver sent response with ${answers.length} answer(s)`,
          packet_id: respPktId,
          session_id: `dns-sess-${cfg.query_id}`,
          details: `Status: ${responseCode}`,
        },
      ];
      const packets = [
        {
          id: queryPktId,
          src_node_id: cfg.client_node_id,
          dst_node_id: cfg.server_node_id,
          size_bytes: 64,
          created_at_us: 0,
          current_node_id: cfg.server_node_id,
          next_hop_node_id: null,
          state: 'delivered' as const,
          headers: {
            application: {
              protocol: 'DNS',
              payload_preview: `DNS Query: ${cfg.query_name} [${cfg.query_type}]`,
              message_type: 'DNS_QUERY',
              session_id: `dns-sess-${cfg.query_id}`,
              transaction_id: cfg.query_id,
              resource_or_command: cfg.query_name,
              status_code: null,
            },
            transport: {
              protocol: 'UDP',
              src_port: 5353,
              dst_port: 53,
              flags: [],
              payload_length: 32,
              is_retransmission: false,
              connection_state: 'closed',
            },
            network: {
              version: 4,
              src_ip: '192.168.1.10',
              dst_ip: '192.168.1.53',
              ttl: 64,
              protocol_num: 17,
              checksum: 0x4a12,
            },
            datalink: {
              src_mac: '02:00:00:00:00:01',
              dst_mac: '02:00:00:00:00:02',
              ether_type: 0x0800,
              crc_fcs: 0x12345678,
              frame_type: 'Ethernet II',
              fcs_valid: true,
            },
            physical: {
              bit_count: 512,
              signal_encoding: 'Manchester',
            },
          },
          journey_hops: [cfg.client_node_id, cfg.server_node_id],
          planned_route: [cfg.client_node_id, cfg.server_node_id],
          hop_history: [
            {
              hop_index: 0,
              node_id: cfg.client_node_id,
              link_id: null,
              timestamp_us: 0,
              state: 'created' as const,
              description: `DNS Query packet created at ${cfg.client_node_id}`,
            },
            {
              hop_index: 1,
              node_id: cfg.server_node_id,
              link_id: 'link-1',
              timestamp_us: 15000,
              state: 'delivered' as const,
              description: `DNS Query packet delivered to ${cfg.server_node_id}`,
            },
          ],
        },
        {
          id: respPktId,
          src_node_id: cfg.server_node_id,
          dst_node_id: cfg.client_node_id,
          size_bytes: 96,
          created_at_us: 30000,
          current_node_id: cfg.client_node_id,
          next_hop_node_id: null,
          state: 'delivered' as const,
          headers: {
            application: {
              protocol: 'DNS',
              payload_preview: `DNS Response: ${responseCode} (${answers.length} answers)`,
              message_type: 'DNS_RESPONSE',
              session_id: `dns-sess-${cfg.query_id}`,
              transaction_id: cfg.query_id,
              resource_or_command: cfg.query_name,
              status_code: responseCode,
            },
            transport: {
              protocol: 'UDP',
              src_port: 53,
              dst_port: 5353,
              flags: [],
              payload_length: 64,
              is_retransmission: false,
              connection_state: 'closed',
            },
            network: {
              version: 4,
              src_ip: '192.168.1.53',
              dst_ip: '192.168.1.10',
              ttl: 64,
              protocol_num: 17,
              checksum: 0x4a13,
            },
            datalink: {
              src_mac: '02:00:00:00:00:02',
              dst_mac: '02:00:00:00:00:01',
              ether_type: 0x0800,
              crc_fcs: 0x87654321,
              frame_type: 'Ethernet II',
              fcs_valid: true,
            },
            physical: {
              bit_count: 768,
              signal_encoding: 'Manchester',
            },
          },
          journey_hops: [cfg.server_node_id, cfg.client_node_id],
          planned_route: [cfg.server_node_id, cfg.client_node_id],
          hop_history: [
            {
              hop_index: 0,
              node_id: cfg.server_node_id,
              link_id: null,
              timestamp_us: 30000,
              state: 'created' as const,
              description: `DNS Response packet created at ${cfg.server_node_id}`,
            },
            {
              hop_index: 1,
              node_id: cfg.client_node_id,
              link_id: 'link-1',
              timestamp_us: 45000,
              state: 'delivered' as const,
              description: `DNS Response packet delivered to ${cfg.client_node_id}`,
            },
          ],
        },
      ];
      return Promise.resolve({
        config: cfg,
        state: isNx ? 'failed' : 'completed',
        response_code: responseCode,
        answers,
        events,
        sim_events: events.map((e, idx) => ({
          id: idx + 1,
          timestamp: e.timestamp_us,
          event_type: { type: 'application_event', data: { protocol: 'DNS', event_name: e.event_type } },
          description: e.description,
          packet_id: e.packet_id,
          node_id: e.node_id,
          layer: 'Application',
          protocol: 'DNS',
        })),
        packets,
        metrics: {
          transaction_duration_us: 45000,
          requests_sent: 1,
          responses_received: 1,
          payload_bytes_sent: 64,
          payload_bytes_received: 96,
          success: !isNx,
          error_message: isNx ? 'NXDOMAIN: Domain name not found' : null,
        },
      } as unknown as T);
    }

    case 'simulate_http': {
      const cfg = (args?.config as HttpConfig) || {
        client_node_id: 'host-a',
        server_node_id: 'web-server',
        request: {
          method: 'GET',
          path: '/index.html',
          headers: { Host: 'example.com' },
          body: null,
        },
        port: 80,
        seed: 42,
      };
      const is404 = cfg.request.path === '/not-found';
      const statusCode = is404 ? 404 : 200;
      const statusText = is404 ? 'Not Found' : 'OK';
      const body = is404
        ? '<html><body><h1>404 Not Found</h1></body></html>'
        : '<html><body><h1>Welcome to NetSim</h1></body></html>';
      const reqPktId = 'http-req-1';
      const respPktId = 'http-resp-1';
      const events = [
        {
          step_index: 0,
          timestamp_us: 50000,
          node_id: cfg.client_node_id,
          protocol: 'HTTP',
          event_type: 'HTTP_REQUEST_SENT',
          description: `HTTP ${cfg.request.method} ${cfg.request.path} sent to ${cfg.server_node_id}:80`,
          packet_id: reqPktId,
          session_id: 'http-sess-80',
          details: `Headers: ${Object.keys(cfg.request.headers).length}`,
        },
        {
          step_index: 1,
          timestamp_us: 70000,
          node_id: cfg.server_node_id,
          protocol: 'HTTP',
          event_type: 'HTTP_SERVER_PROCESSING',
          description: `Server processing ${cfg.request.method} ${cfg.request.path}`,
          packet_id: null,
          session_id: 'http-sess-80',
          details: `Endpoint matched status ${statusCode}`,
        },
        {
          step_index: 2,
          timestamp_us: 80000,
          node_id: cfg.server_node_id,
          protocol: 'HTTP',
          event_type: is404 ? 'HTTP_NOT_FOUND' : 'HTTP_RESPONSE_SENT',
          description: `HTTP/1.1 ${statusCode} ${statusText} response sent`,
          packet_id: respPktId,
          session_id: 'http-sess-80',
          details: `Content-Length: ${body.length}`,
        },
        {
          step_index: 3,
          timestamp_us: 100000,
          node_id: cfg.client_node_id,
          protocol: 'HTTP',
          event_type: 'HTTP_COMPLETED',
          description: `HTTP transaction finished with status ${statusCode}`,
          packet_id: null,
          session_id: 'http-sess-80',
          details: `Bytes: ${body.length}`,
        },
      ];
      return Promise.resolve({
        config: cfg,
        state: is404 ? 'failed' : 'completed',
        response: {
          status_code: statusCode,
          status_text: statusText,
          headers: {
            'Content-Type': 'text/html',
            'Content-Length': `${body.length}`,
            Server: 'NetSim-HTTPd/2.4',
          },
          body,
        },
        events,
        sim_events: events.map((e, idx) => ({
          id: idx + 1,
          timestamp: e.timestamp_us,
          event_type: { type: 'application_event', data: { protocol: 'HTTP', event_name: e.event_type } },
          description: e.description,
          packet_id: e.packet_id,
          node_id: e.node_id,
          layer: 'Application',
          protocol: 'HTTP',
        })),
        tcp_events: [],
        packets: [
          {
            id: reqPktId,
            src_node_id: cfg.client_node_id,
            dst_node_id: cfg.server_node_id,
            size_bytes: 180,
            created_at_us: 50000,
            current_node_id: cfg.server_node_id,
            next_hop_node_id: null,
            state: 'delivered' as const,
            headers: {
              application: {
                protocol: 'HTTP',
                payload_preview: `${cfg.request.method} ${cfg.request.path} HTTP/1.1`,
                message_type: 'HTTP_REQUEST',
                session_id: 'http-sess-80',
                transaction_id: 1,
                resource_or_command: `${cfg.request.method} ${cfg.request.path}`,
                status_code: null,
              },
              transport: {
                protocol: 'TCP',
                src_port: 49152,
                dst_port: 80,
                seq_num: 1001,
                ack_num: 5001,
                window_size: 65535,
                flags: ['ACK', 'PSH'],
                payload_length: 120,
                is_retransmission: false,
                connection_state: 'established',
              },
              network: {
                version: 4,
                src_ip: '192.168.1.10',
                dst_ip: '192.168.1.80',
                ttl: 64,
                protocol_num: 6,
                checksum: 0x3344,
              },
              datalink: {
                src_mac: '02:00:00:00:00:01',
                dst_mac: '02:00:00:00:00:02',
                ether_type: 0x0800,
                crc_fcs: 0x12345678,
                frame_type: 'Ethernet II',
                fcs_valid: true,
              },
              physical: { bit_count: 1440, signal_encoding: 'Manchester' },
            },
            journey_hops: [cfg.client_node_id, cfg.server_node_id],
            planned_route: [cfg.client_node_id, cfg.server_node_id],
            hop_history: [],
          },
          {
            id: respPktId,
            src_node_id: cfg.server_node_id,
            dst_node_id: cfg.client_node_id,
            size_bytes: 320,
            created_at_us: 80000,
            current_node_id: cfg.client_node_id,
            next_hop_node_id: null,
            state: 'delivered' as const,
            headers: {
              application: {
                protocol: 'HTTP',
                payload_preview: `HTTP/1.1 ${statusCode} ${statusText}`,
                message_type: 'HTTP_RESPONSE',
                session_id: 'http-sess-80',
                transaction_id: 1,
                resource_or_command: `${cfg.request.method} ${cfg.request.path}`,
                status_code: `${statusCode}`,
              },
              transport: {
                protocol: 'TCP',
                src_port: 80,
                dst_port: 49152,
                seq_num: 5001,
                ack_num: 1121,
                window_size: 65535,
                flags: ['ACK', 'PSH'],
                payload_length: 260,
                is_retransmission: false,
                connection_state: 'established',
              },
              network: {
                version: 4,
                src_ip: '192.168.1.80',
                dst_ip: '192.168.1.10',
                ttl: 64,
                protocol_num: 6,
                checksum: 0x3345,
              },
              datalink: {
                src_mac: '02:00:00:00:00:02',
                dst_mac: '02:00:00:00:00:01',
                ether_type: 0x0800,
                crc_fcs: 0x87654321,
                frame_type: 'Ethernet II',
                fcs_valid: true,
              },
              physical: { bit_count: 2560, signal_encoding: 'Manchester' },
            },
            journey_hops: [cfg.server_node_id, cfg.client_node_id],
            planned_route: [cfg.server_node_id, cfg.client_node_id],
            hop_history: [],
          },
        ],
        metrics: {
          transaction_duration_us: 100000,
          requests_sent: 1,
          responses_received: 1,
          payload_bytes_sent: 180,
          payload_bytes_received: 320,
          success: !is404,
          error_message: is404 ? '404 Not Found: Path does not exist' : null,
        },
      } as unknown as T);
    }

    case 'simulate_ftp': {
      const cfg = (args?.config as FtpConfig) || {
        client_node_id: 'host-a',
        server_node_id: 'ftp-server',
        username: 'anonymous',
        password: 'user@example.com',
        transfer_command: 'RETR',
        filename: 'file.txt',
        file_size_bytes: 2048,
        control_port: 21,
        data_port: 50000,
        seed: 42,
      };
      const ctrlPkt = 'ftp-ctrl-1';
      const dataPkt = 'ftp-data-1';
      const events = [
        {
          step_index: 0,
          timestamp_us: 0,
          node_id: cfg.server_node_id,
          protocol: 'FTP',
          event_type: 'FTP_GREETING',
          description: '220 NetSim Educational FTP Ready',
          packet_id: null,
          session_id: 'ftp-ctrl-sess-21',
          details: 'Port 21 Control Channel',
        },
        {
          step_index: 1,
          timestamp_us: 10000,
          node_id: cfg.client_node_id,
          protocol: 'FTP',
          event_type: 'FTP_CONTROL_COMMAND',
          description: `USER ${cfg.username}`,
          packet_id: ctrlPkt,
          session_id: 'ftp-ctrl-sess-21',
          details: 'Code 331 Password required',
        },
        {
          step_index: 2,
          timestamp_us: 20000,
          node_id: cfg.client_node_id,
          protocol: 'FTP',
          event_type: 'FTP_LOGIN_SUCCESS',
          description: 'PASS ****** -> 230 User logged in, proceed',
          packet_id: null,
          session_id: 'ftp-ctrl-sess-21',
          details: 'Authentication successful',
        },
        {
          step_index: 3,
          timestamp_us: 30000,
          node_id: cfg.client_node_id,
          protocol: 'FTP',
          event_type: 'FTP_DATA_OPEN',
          description: `${cfg.transfer_command} ${cfg.filename || ''} -> 150 File status okay; opening data channel`,
          packet_id: null,
          session_id: 'ftp-data-sess-50000',
          details: `Port ${cfg.data_port}`,
        },
        {
          step_index: 4,
          timestamp_us: 45000,
          node_id: cfg.server_node_id,
          protocol: 'FTP',
          event_type: 'FTP_DATA_TRANSFERRING',
          description: `Transferring payload over Data Channel (${cfg.file_size_bytes} bytes)`,
          packet_id: dataPkt,
          session_id: 'ftp-data-sess-50000',
          details: 'Payload delivery',
        },
        {
          step_index: 5,
          timestamp_us: 60000,
          node_id: cfg.server_node_id,
          protocol: 'FTP',
          event_type: 'FTP_DATA_COMPLETE',
          description: '226 Closing data connection, transfer complete',
          packet_id: null,
          session_id: 'ftp-ctrl-sess-21',
          details: 'Data channel closed',
        },
      ];
      return Promise.resolve({
        config: cfg,
        state: 'completed',
        control_session_id: 'ftp-ctrl-sess-21',
        data_session_id: 'ftp-data-sess-50000',
        events,
        sim_events: events.map((e, idx) => ({
          id: idx + 1,
          timestamp: e.timestamp_us,
          event_type: { type: 'application_event', data: { protocol: 'FTP', event_name: e.event_type } },
          description: e.description,
          packet_id: e.packet_id,
          node_id: e.node_id,
          layer: 'Application',
          protocol: 'FTP',
        })),
        packets: [
          {
            id: ctrlPkt,
            src_node_id: cfg.client_node_id,
            dst_node_id: cfg.server_node_id,
            size_bytes: 80,
            created_at_us: 10000,
            current_node_id: cfg.server_node_id,
            next_hop_node_id: null,
            state: 'delivered' as const,
            headers: {
              application: {
                protocol: 'FTP',
                payload_preview: `USER ${cfg.username}`,
                message_type: 'FTP_CONTROL_CMD',
                session_id: 'ftp-ctrl-sess-21',
                transaction_id: 1,
                resource_or_command: 'USER',
                status_code: '331',
              },
              transport: {
                protocol: 'TCP',
                src_port: 49152,
                dst_port: 21,
                seq_num: 100,
                ack_num: 1,
                flags: ['ACK', 'PSH'],
                payload_length: 20,
                is_retransmission: false,
                connection_state: 'established',
              },
              network: {
                version: 4,
                src_ip: '192.168.1.10',
                dst_ip: '192.168.1.21',
                ttl: 64,
                protocol_num: 6,
                checksum: 0x1111,
              },
              datalink: {
                src_mac: '02:00:00:00:00:01',
                dst_mac: '02:00:00:00:00:02',
                ether_type: 0x0800,
                crc_fcs: 0x2222,
                frame_type: 'Ethernet II',
                fcs_valid: true,
              },
              physical: { bit_count: 640, signal_encoding: 'Manchester' },
            },
            journey_hops: [cfg.client_node_id, cfg.server_node_id],
            planned_route: [cfg.client_node_id, cfg.server_node_id],
            hop_history: [],
          },
          {
            id: dataPkt,
            src_node_id: cfg.server_node_id,
            dst_node_id: cfg.client_node_id,
            size_bytes: cfg.file_size_bytes,
            created_at_us: 45000,
            current_node_id: cfg.client_node_id,
            next_hop_node_id: null,
            state: 'delivered' as const,
            headers: {
              application: {
                protocol: 'FTP',
                payload_preview: `FTP Data: ${cfg.filename || 'data'} (${cfg.file_size_bytes}B)`,
                message_type: 'FTP_DATA_PAYLOAD',
                session_id: 'ftp-data-sess-50000',
                transaction_id: 2,
                resource_or_command: cfg.transfer_command,
                status_code: '226',
              },
              transport: {
                protocol: 'TCP',
                src_port: 50000,
                dst_port: 49153,
                seq_num: 500,
                ack_num: 1,
                flags: ['ACK'],
                payload_length: cfg.file_size_bytes,
                is_retransmission: false,
                connection_state: 'established',
              },
              network: {
                version: 4,
                src_ip: '192.168.1.21',
                dst_ip: '192.168.1.10',
                ttl: 64,
                protocol_num: 6,
                checksum: 0x3333,
              },
              datalink: {
                src_mac: '02:00:00:00:00:02',
                dst_mac: '02:00:00:00:00:01',
                ether_type: 0x0800,
                crc_fcs: 0x4444,
                frame_type: 'Ethernet II',
                fcs_valid: true,
              },
              physical: { bit_count: cfg.file_size_bytes * 8, signal_encoding: 'Manchester' },
            },
            journey_hops: [cfg.server_node_id, cfg.client_node_id],
            planned_route: [cfg.server_node_id, cfg.client_node_id],
            hop_history: [],
          },
        ],
        metrics: {
          transaction_duration_us: 60000,
          requests_sent: 4,
          responses_received: 4,
          payload_bytes_sent: 120,
          payload_bytes_received: cfg.file_size_bytes,
          success: true,
          error_message: null,
        },
      } as unknown as T);
    }

    case 'simulate_smtp': {
      const cfg = (args?.config as SmtpConfig) || {
        client_node_id: 'host-a',
        server_node_id: 'mail-server',
        mail_from: 'alice@example.com',
        rcpt_to: 'bob@example.com',
        subject: 'Test Subject',
        body: 'Mail body content.',
        reject_recipient: false,
        port: 25,
        seed: 42,
      };
      const isRejected = cfg.reject_recipient;
      const smtpPkt = 'smtp-cmd-1';
      const events = [
        {
          step_index: 0,
          timestamp_us: 0,
          node_id: cfg.server_node_id,
          protocol: 'SMTP',
          event_type: 'SMTP_GREETING',
          description: '220 NetSim Mail Transfer Agent ESMTP Ready',
          packet_id: null,
          session_id: 'smtp-sess-25',
          details: 'Port 25',
        },
        {
          step_index: 1,
          timestamp_us: 10000,
          node_id: cfg.client_node_id,
          protocol: 'SMTP',
          event_type: 'SMTP_COMMAND',
          description: 'EHLO host-a.example.com -> 250 Hello',
          packet_id: null,
          session_id: 'smtp-sess-25',
          details: 'Handshake complete',
        },
        {
          step_index: 2,
          timestamp_us: 20000,
          node_id: cfg.client_node_id,
          protocol: 'SMTP',
          event_type: 'SMTP_COMMAND',
          description: `MAIL FROM:<${cfg.mail_from}> -> 250 Sender OK`,
          packet_id: null,
          session_id: 'smtp-sess-25',
          details: 'Sender envelope',
        },
        {
          step_index: 3,
          timestamp_us: 30000,
          node_id: cfg.client_node_id,
          protocol: 'SMTP',
          event_type: isRejected ? 'SMTP_RCPT_REJECTED' : 'SMTP_COMMAND',
          description: isRejected
            ? `RCPT TO:<${cfg.rcpt_to}> -> 550 User unknown`
            : `RCPT TO:<${cfg.rcpt_to}> -> 250 Recipient OK`,
          packet_id: smtpPkt,
          session_id: 'smtp-sess-25',
          details: isRejected ? 'Rejected by policy' : 'Recipient accepted',
        },
      ];
      if (!isRejected) {
        events.push(
          {
            step_index: 4,
            timestamp_us: 40000,
            node_id: cfg.client_node_id,
            protocol: 'SMTP',
            event_type: 'SMTP_COMMAND',
            description: 'DATA -> 354 Start mail input; end with <CRLF>.<CRLF>',
            packet_id: null,
            session_id: 'smtp-sess-25',
            details: 'Ready for body',
          },
          {
            step_index: 5,
            timestamp_us: 50000,
            node_id: cfg.client_node_id,
            protocol: 'SMTP',
            event_type: 'SMTP_MESSAGE_ACCEPTED',
            description: 'Message payload sent -> 250 2.0.0 Ok: queued as 48A9B1',
            packet_id: null,
            session_id: 'smtp-sess-25',
            details: `Length: ${cfg.body.length}B`,
          },
          {
            step_index: 6,
            timestamp_us: 60000,
            node_id: cfg.client_node_id,
            protocol: 'SMTP',
            event_type: 'SMTP_TERMINATED',
            description: 'QUIT -> 221 2.0.0 Bye',
            packet_id: null,
            session_id: 'smtp-sess-25',
            details: 'Session closed',
          }
        );
      }
      return Promise.resolve({
        config: cfg,
        state: isRejected ? 'failed' : 'completed',
        is_accepted: !isRejected,
        events,
        sim_events: events.map((e, idx) => ({
          id: idx + 1,
          timestamp: e.timestamp_us,
          event_type: { type: 'application_event', data: { protocol: 'SMTP', event_name: e.event_type } },
          description: e.description,
          packet_id: e.packet_id,
          node_id: e.node_id,
          layer: 'Application',
          protocol: 'SMTP',
        })),
        packets: [
          {
            id: smtpPkt,
            src_node_id: cfg.client_node_id,
            dst_node_id: cfg.server_node_id,
            size_bytes: 120,
            created_at_us: 30000,
            current_node_id: cfg.server_node_id,
            next_hop_node_id: null,
            state: 'delivered' as const,
            headers: {
              application: {
                protocol: 'SMTP',
                payload_preview: `RCPT TO:<${cfg.rcpt_to}>`,
                message_type: 'SMTP_RCPT',
                session_id: 'smtp-sess-25',
                transaction_id: 1,
                resource_or_command: 'RCPT TO',
                status_code: isRejected ? '550' : '250',
              },
              transport: {
                protocol: 'TCP',
                src_port: 49152,
                dst_port: 25,
                seq_num: 200,
                ack_num: 150,
                flags: ['ACK', 'PSH'],
                payload_length: 45,
                is_retransmission: false,
                connection_state: 'established',
              },
              network: {
                version: 4,
                src_ip: '192.168.1.10',
                dst_ip: '192.168.1.25',
                ttl: 64,
                protocol_num: 6,
                checksum: 0x5555,
              },
              datalink: {
                src_mac: '02:00:00:00:00:01',
                dst_mac: '02:00:00:00:00:02',
                ether_type: 0x0800,
                crc_fcs: 0x6666,
                frame_type: 'Ethernet II',
                fcs_valid: true,
              },
              physical: { bit_count: 960, signal_encoding: 'Manchester' },
            },
            journey_hops: [cfg.client_node_id, cfg.server_node_id],
            planned_route: [cfg.client_node_id, cfg.server_node_id],
            hop_history: [],
          },
        ],
        metrics: {
          transaction_duration_us: isRejected ? 30000 : 60000,
          requests_sent: isRejected ? 3 : 5,
          responses_received: isRejected ? 3 : 5,
          payload_bytes_sent: 350,
          payload_bytes_received: 280,
          success: !isRejected,
          error_message: isRejected ? '550 User unknown: Recipient mailbox rejected' : null,
        },
      } as unknown as T);
    }

    case 'simulate_snmp': {
      const cfg = (args?.config as SnmpConfig) || {
        manager_node_id: 'nms-manager',
        agent_node_id: 'router-core',
        community: 'public',
        requested_oid: '1.3.6.1.2.1.1.1.0',
        port: 161,
        seed: 42,
      };
      const isKnown = cfg.requested_oid === '1.3.6.1.2.1.1.1.0';
      const mibObj = isKnown
        ? {
            oid: '1.3.6.1.2.1.1.1.0',
            name: 'sysDescr.0',
            syntax: 'DisplayString',
            value: 'NetSim CoreOS Router v2.4 (x86_64, Educational Edition)',
            description: 'A textual description of the network entity.',
          }
        : null;
      const snmpReq = 'snmp-req-1';
      const snmpResp = 'snmp-resp-1';
      const events = [
        {
          step_index: 0,
          timestamp_us: 0,
          node_id: cfg.manager_node_id,
          protocol: 'SNMP',
          event_type: 'SNMP_GET_REQUEST',
          description: `Manager sent GetRequest for OID ${cfg.requested_oid}`,
          packet_id: snmpReq,
          session_id: 'snmp-sess-161',
          details: `Community: ${cfg.community}`,
        },
        {
          step_index: 1,
          timestamp_us: 15000,
          node_id: cfg.agent_node_id,
          protocol: 'SNMP',
          event_type: isKnown ? 'SNMP_MIB_LOOKUP' : 'SNMP_UNKNOWN_OID',
          description: isKnown
            ? `Agent resolved OID ${cfg.requested_oid} -> ${mibObj?.name}`
            : `Agent OID ${cfg.requested_oid} not found in MIB tree`,
          packet_id: null,
          session_id: 'snmp-sess-161',
          details: isKnown ? `Value: ${mibObj?.value}` : 'Error: noSuchName',
        },
        {
          step_index: 2,
          timestamp_us: 30000,
          node_id: cfg.agent_node_id,
          protocol: 'SNMP',
          event_type: 'SNMP_GET_RESPONSE',
          description: isKnown
            ? `Agent sent GetResponse: ${mibObj?.name} = ${mibObj?.value}`
            : 'Agent sent GetResponse with error status: noSuchName',
          packet_id: snmpResp,
          session_id: 'snmp-sess-161',
          details: isKnown ? 'Status: 0 (noError)' : 'Status: 2 (noSuchName)',
        },
      ];
      return Promise.resolve({
        config: cfg,
        state: isKnown ? 'completed' : 'failed',
        found_object: mibObj,
        events,
        sim_events: events.map((e, idx) => ({
          id: idx + 1,
          timestamp: e.timestamp_us,
          event_type: { type: 'application_event', data: { protocol: 'SNMP', event_name: e.event_type } },
          description: e.description,
          packet_id: e.packet_id,
          node_id: e.node_id,
          layer: 'Application',
          protocol: 'SNMP',
        })),
        packets: [
          {
            id: snmpReq,
            src_node_id: cfg.manager_node_id,
            dst_node_id: cfg.agent_node_id,
            size_bytes: 75,
            created_at_us: 0,
            current_node_id: cfg.agent_node_id,
            next_hop_node_id: null,
            state: 'delivered' as const,
            headers: {
              application: {
                protocol: 'SNMP',
                payload_preview: `GetRequest(${cfg.requested_oid})`,
                message_type: 'SNMP_GET_REQUEST',
                session_id: 'snmp-sess-161',
                transaction_id: 101,
                resource_or_command: cfg.requested_oid,
                status_code: null,
              },
              transport: {
                protocol: 'UDP',
                src_port: 51234,
                dst_port: 161,
                flags: [],
                payload_length: 45,
                is_retransmission: false,
                connection_state: 'closed',
              },
              network: {
                version: 4,
                src_ip: '192.168.1.10',
                dst_ip: '192.168.1.1',
                ttl: 64,
                protocol_num: 17,
                checksum: 0x7777,
              },
              datalink: {
                src_mac: '02:00:00:00:00:01',
                dst_mac: '02:00:00:00:00:02',
                ether_type: 0x0800,
                crc_fcs: 0x8888,
                frame_type: 'Ethernet II',
                fcs_valid: true,
              },
              physical: { bit_count: 600, signal_encoding: 'Manchester' },
            },
            journey_hops: [cfg.manager_node_id, cfg.agent_node_id],
            planned_route: [cfg.manager_node_id, cfg.agent_node_id],
            hop_history: [],
          },
          {
            id: snmpResp,
            src_node_id: cfg.agent_node_id,
            dst_node_id: cfg.manager_node_id,
            size_bytes: 90,
            created_at_us: 30000,
            current_node_id: cfg.manager_node_id,
            next_hop_node_id: null,
            state: 'delivered' as const,
            headers: {
              application: {
                protocol: 'SNMP',
                payload_preview: isKnown ? `GetResponse(${mibObj?.value})` : 'GetResponse(noSuchName)',
                message_type: 'SNMP_GET_RESPONSE',
                session_id: 'snmp-sess-161',
                transaction_id: 101,
                resource_or_command: cfg.requested_oid,
                status_code: isKnown ? 'noError' : 'noSuchName',
              },
              transport: {
                protocol: 'UDP',
                src_port: 161,
                dst_port: 51234,
                flags: [],
                payload_length: 60,
                is_retransmission: false,
                connection_state: 'closed',
              },
              network: {
                version: 4,
                src_ip: '192.168.1.1',
                dst_ip: '192.168.1.10',
                ttl: 64,
                protocol_num: 17,
                checksum: 0x7778,
              },
              datalink: {
                src_mac: '02:00:00:00:00:02',
                dst_mac: '02:00:00:00:00:01',
                ether_type: 0x0800,
                crc_fcs: 0x8889,
                frame_type: 'Ethernet II',
                fcs_valid: true,
              },
              physical: { bit_count: 720, signal_encoding: 'Manchester' },
            },
            journey_hops: [cfg.agent_node_id, cfg.manager_node_id],
            planned_route: [cfg.agent_node_id, cfg.manager_node_id],
            hop_history: [],
          },
        ],
        metrics: {
          transaction_duration_us: 30000,
          requests_sent: 1,
          responses_received: 1,
          payload_bytes_sent: 75,
          payload_bytes_received: 90,
          success: isKnown,
          error_message: isKnown ? null : 'noSuchName: OID not found in agent MIB tree',
        },
      } as unknown as T);
    }

    case 'get_current_qos_metrics': {
      return Promise.resolve({
        measurement_interval_us: 100000,
        throughput_bits_per_sec: 8000000,
        throughput_bytes_per_sec: 1000000,
        goodput_bits_per_sec: 7600000,
        throughput_bytes_counted: 1000000,
        goodput_payload_bytes: 950000,
        end_to_end_latencies_us: [1000, 1050, 1020, 1080],
        average_latency_us: 1037.5,
        min_latency_us: 1000,
        max_latency_us: 1080,
        jitter_us: 43.3,
        jitter_samples: [50, 30, 60],
        packets_sent: 10,
        packets_delivered: 9,
        packets_lost: 1,
        packet_loss_rate: 0.1,
        loss_by_category: {
          queue_overflow: 0,
          link_down: 1,
          bit_error: 0,
          stochastic_loss: 0,
          ttl_expired: 0,
          no_route: 0,
        },
        retransmissions: 1,
        link_utilization: [
          {
            link_id: 'link-1',
            busy_time_us: 32000,
            measurement_time_us: 100000,
            utilization: 0.32,
          },
        ],
        queue_occupancy_average: 1.2,
        queue_occupancy_max: 3,
        queue_drops: 0,
        average_rtt_us: 2100,
      } as unknown as T);
    }

    case 'request_circuit': {
      const src = (args?.sourceNodeId as string) || 'node-1';
      const dst = (args?.targetNodeId as string) || 'node-3';
      const bandwidthBps = (args?.bandwidthBps as number) || 1_000_000;
      const requestedId = args?.circuitId as string | undefined;
      mockCircuitCount += 1;
      mockCircuitMetrics.requests_total += 1;
      if (requestedId && mockCircuits.some((c) => c.circuit_id === requestedId)) {
        return Promise.reject(new Error(`Circuit identifier '${requestedId}' is already in use`));
      }
      // Simple hop-count path over the mock topology (test double only).
      const path: string[] = [src];
      const linkIds: string[] = [];
      const visited = new Set<string>([src]);
      let cursor = src;
      while (cursor !== dst && path.length < 8) {
        const link = mockProject.links.find(
          (l) =>
            (l.source.node_id === cursor && !visited.has(l.target.node_id)) ||
            (l.target.node_id === cursor && !visited.has(l.source.node_id))
        );
        if (!link) break;
        linkIds.push(link.id);
        cursor = link.source.node_id === cursor ? link.target.node_id : link.source.node_id;
        visited.add(cursor);
        path.push(cursor);
      }
      const blockedByCapacity = mockCircuits.some(
        (c) => c.state === 'active' && c.link_ids.some((id) => linkIds.includes(id)) && c.bandwidth_bps + bandwidthBps > 100_000_000
      );
      if (cursor !== dst || blockedByCapacity) {
        mockCircuitMetrics.requests_blocked += 1;
        return Promise.resolve({
          accepted: false,
          circuit_id: null,
          source_node_id: src,
          target_node_id: dst,
          bandwidth_bps: bandwidthBps,
          path: [],
          link_ids: [],
          reason: cursor !== dst ? 'No path exists between the endpoints in the current topology' : 'Insufficient capacity on the routed path',
          metrics: circuitMetricsWithRates(),
        } as unknown as T);
      }
      const circuitId = requestedId || `circuit-${mockCircuitCount}`;
      const circuit: Circuit = {
        circuit_id: circuitId,
        source_node_id: src,
        target_node_id: dst,
        path,
        link_ids: linkIds,
        bandwidth_bps: bandwidthBps,
        state: 'active',
        request_index: mockCircuitCount,
        released_reason: null,
      };
      mockCircuits.push(circuit);
      mockCircuitMetrics.requests_accepted += 1;
      mockCircuitMetrics.circuits_active += 1;
      return Promise.resolve({
        accepted: true,
        circuit_id: circuitId,
        source_node_id: src,
        target_node_id: dst,
        bandwidth_bps: bandwidthBps,
        path,
        link_ids: linkIds,
        reason: '',
        metrics: circuitMetricsWithRates(),
      } as unknown as T);
    }

    case 'teardown_circuit': {
      const circuitId = (args?.circuitId as string) || '';
      const circuit = mockCircuits.find((c) => c.circuit_id === circuitId);
      if (!circuit) return Promise.reject(new Error(`Circuit '${circuitId}' does not exist`));
      if (circuit.state !== 'active') return Promise.reject(new Error(`Circuit '${circuitId}' has already been released`));
      circuit.state = 'released';
      circuit.released_reason = 'Released by teardown';
      mockCircuitMetrics.circuits_released += 1;
      mockCircuitMetrics.circuits_active -= 1;
      return Promise.resolve(circuit as unknown as T);
    }

    case 'get_circuit_state': {
      const reserved: Record<string, number> = {};
      for (const c of mockCircuits) {
        if (c.state !== 'active') continue;
        for (const id of c.link_ids) reserved[id] = (reserved[id] || 0) + c.bandwidth_bps;
      }
      return Promise.resolve({
        circuits: [...mockCircuits],
        links: mockProject.links.map((l) => {
          const res = reserved[l.id] || 0;
          return {
            link_id: l.id,
            capacity_bps: l.bandwidth_bps,
            reserved_bps: res,
            available_bps: Math.max(0, l.bandwidth_bps - res),
            utilization: l.bandwidth_bps > 0 ? res / l.bandwidth_bps : 0,
          };
        }),
        metrics: circuitMetricsWithRates(),
      } as unknown as T);
    }

    case 'set_forwarding_policy': {
      return Promise.resolve({
        algorithm: 'dijkstra',
        metric_type: (args?.metricType as string) || 'hop_count',
        default_ttl: 64,
      } as unknown as T);
    }

    case 'schedule_fault_command': {
      return Promise.resolve(undefined as unknown as T);
    }

    case 'run_parameter_sweep_command': {
      const cfg = (args?.config || {}) as SweepConfig;
      const vals = cfg.parameter_values || [1000000, 10000000, 100000000];
      const points = vals.map((v) => ({
        parameter_value: v,
        aggregated_qos: {
          run_count: (cfg.seeds || [42]).length,
          mean_throughput_bps: Math.min(v, 8000000),
          mean_goodput_bps: Math.min(v * 0.95, 7600000),
          mean_latency_us: Math.max(200, 2000000 / v),
          min_latency_us: Math.max(150, 1800000 / v),
          max_latency_us: Math.max(250, 2200000 / v),
          mean_jitter_us: 25.0,
          mean_loss_rate: 0.0,
          mean_retransmissions: 0,
          stddev_latency_us: 12.5,
          stddev_throughput_bps: 50000,
        },
        runs: (cfg.seeds || [42]).map((s) => ({
          parameter_value: v,
          seed: s,
          qos: {
            measurement_interval_us: cfg.simulation_duration_us || 50000,
            throughput_bits_per_sec: Math.min(v, 8000000),
            throughput_bytes_per_sec: Math.min(v / 8, 1000000),
            goodput_bits_per_sec: Math.min(v * 0.95, 7600000),
            throughput_bytes_counted: Math.min(v / 8, 1000000),
            goodput_payload_bytes: Math.min(v * 0.95 / 8, 950000),
            end_to_end_latencies_us: [1000, 1020],
            average_latency_us: Math.max(200, 2000000 / v),
            min_latency_us: Math.max(150, 1800000 / v),
            max_latency_us: Math.max(250, 2200000 / v),
            jitter_us: 20.0,
            jitter_samples: [20.0],
            packets_sent: 5,
            packets_delivered: 5,
            packets_lost: 0,
            packet_loss_rate: 0.0,
            loss_by_category: { queue_overflow: 0, link_down: 0, bit_error: 0, stochastic_loss: 0, ttl_expired: 0, no_route: 0 },
            retransmissions: 0,
            link_utilization: [],
            queue_occupancy_average: 1.0,
            queue_occupancy_max: 2,
            queue_drops: 0,
            average_rtt_us: null,
          },
          route_changes: [],
        })),
      }));

      return Promise.resolve({
        experiment_name: cfg.experiment_name || 'Parameter Sweep',
        parameter_name: 'parameter',
        points,
        total_runs: points.length * (cfg.seeds?.length || 1),
        seeds: cfg.seeds || [42],
        execution_time_ms: 120,
      } as unknown as T);
    }

    case 'run_comparative_experiment_command': {
      const cfg = (args?.config || {}) as ComparativeExperimentConfig;
      return Promise.resolve({
        experiment_name: cfg.experiment_name || 'Comparative Test',
        scenario_a_name: cfg.scenario_a?.name || 'Scenario A',
        scenario_b_name: cfg.scenario_b?.name || 'Scenario B',
        qos_a: {
          run_count: 1,
          mean_throughput_bps: 10000000,
          mean_goodput_bps: 9500000,
          mean_latency_us: 800,
          min_latency_us: 750,
          max_latency_us: 850,
          mean_jitter_us: 15.0,
          mean_loss_rate: 0.0,
          mean_retransmissions: 0,
          stddev_latency_us: 0.0,
          stddev_throughput_bps: 0.0,
        },
        qos_b: {
          run_count: 1,
          mean_throughput_bps: 1000000,
          mean_goodput_bps: 950000,
          mean_latency_us: 4200,
          min_latency_us: 4000,
          max_latency_us: 4400,
          mean_jitter_us: 85.0,
          mean_loss_rate: 0.05,
          mean_retransmissions: 1,
          stddev_latency_us: 0.0,
          stddev_throughput_bps: 0.0,
        },
        deltas: [
          { metric_name: 'throughput_bps', val_a: 10000000, val_b: 1000000, diff: -9000000, percent_change: -90 },
          { metric_name: 'goodput_bps', val_a: 9500000, val_b: 950000, diff: -8550000, percent_change: -90 },
          { metric_name: 'latency_us', val_a: 800, val_b: 4200, diff: 3400, percent_change: 425 },
          { metric_name: 'jitter_us', val_a: 15.0, val_b: 85.0, diff: 70.0, percent_change: 466.6 },
          { metric_name: 'loss_rate', val_a: 0.0, val_b: 0.05, diff: 0.05, percent_change: null },
          { metric_name: 'retransmissions', val_a: 0, val_b: 1, diff: 1, percent_change: null },
        ],
        route_changes_a: [],
        route_changes_b: [],
        runs_count_per_scenario: cfg.seeds?.length || 1,
        execution_time_ms: 180,
      } as unknown as T);
    }

    default:
      return Promise.reject(new Error(`Command ${cmd} not implemented in mock mode`));

  }
}
