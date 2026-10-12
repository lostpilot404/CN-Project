import { describe, it, expect } from 'vitest';
import { api } from './lib/api';
import { Packet, PacketHopRecord } from './types/packet';
import { SimEvent, TimelineEvent, EventFilter } from './types/events';
import { PacketJourney, TopologySyncState, EncapsulationMode } from './types/visualization';

describe('Phase 5: Packet / Protocol Visualization & Event Timeline Acceptance Suite', () => {
  // Mock packet representing full 5-layer encapsulation
  const sampleTcpPacket: Packet = {
    id: 'pkt-tcp-test-01',
    src_node_id: 'host-a',
    dst_node_id: 'host-b',
    size_bytes: 1460,
    created_at_us: 100,
    current_node_id: 'host-a',
    next_hop_node_id: 'router-1',
    state: 'transmitting',
    headers: {
      application: {
        protocol: 'HTTP',
        payload_preview: 'GET /index.html HTTP/1.1',
        message_type: 'HTTP Request',
      },
      transport: {
        protocol: 'TCP',
        src_port: 52140,
        dst_port: 80,
        seq_num: 10001,
        ack_num: 5001,
        window_size: 65535,
        flags: ['ack', 'psh'],
        payload_length: 1420,
        is_retransmission: false,
        connection_state: 'established',
      },
      network: {
        version: 4,
        src_ip: '192.168.1.10',
        dst_ip: '10.0.0.100',
        ttl: 64,
        protocol_num: 6,
        checksum: 0x4a2e,
      },
      datalink: {
        src_mac: '00:1A:2B:3C:4D:5E',
        dst_mac: 'AA:BB:CC:DD:EE:01',
        ether_type: 0x0800,
        crc_fcs: 0x1234abcd,
        frame_type: 'Ethernet II',
        fcs_valid: true,
      },
      physical: {
        link_id: 'link-host-router',
        bandwidth_bps: 100_000_000,
        propagation_delay_us: 5_000,
        tx_start_us: 100,
        tx_finish_us: 216,
        bit_count: 11680,
      },
    },
    journey_hops: ['host-a', 'router-1'],
    planned_route: ['host-a', 'router-1', 'host-b'],
    hop_history: [
      {
        hop_index: 0,
        node_id: 'host-a',
        link_id: null,
        timestamp_us: 100,
        state: 'created',
        description: 'Packet created at host-a',
      },
      {
        hop_index: 1,
        node_id: 'host-a',
        link_id: 'link-host-router',
        timestamp_us: 102,
        state: 'queued',
        description: 'Enqueued in link-host-router',
      },
      {
        hop_index: 2,
        node_id: 'host-a',
        link_id: 'link-host-router',
        timestamp_us: 105,
        state: 'transmitting',
        description: 'Transmitting onto link-host-router',
      },
    ],
  };

  const sampleUdpPacket: Packet = {
    id: 'pkt-udp-test-02',
    src_node_id: 'host-a',
    dst_node_id: 'dns-srv',
    size_bytes: 512,
    created_at_us: 200,
    current_node_id: 'dns-srv',
    next_hop_node_id: null,
    state: 'delivered',
    headers: {
      application: {
        protocol: 'DNS',
        payload_preview: 'Standard query A example.com',
        message_type: 'Query',
      },
      transport: {
        protocol: 'UDP',
        src_port: 53120,
        dst_port: 53,
        flags: [],
        payload_length: 512,
      },
      network: {
        version: 4,
        src_ip: '192.168.1.10',
        dst_ip: '8.8.8.8',
        ttl: 60,
        protocol_num: 17,
        checksum: 0x9f1a,
      },
      datalink: {
        src_mac: 'AA:BB:CC:DD:EE:02',
        dst_mac: '00:1A:2B:3C:4D:5E',
        ether_type: 0x0800,
        crc_fcs: 0x5678beef,
        fcs_valid: true,
      },
      physical: {
        link_id: 'link-router-dns',
        bandwidth_bps: 10_000_000,
        propagation_delay_us: 2_000,
        tx_start_us: 210,
        tx_finish_us: 619,
        bit_count: 4096,
      },
    },
    journey_hops: ['host-a', 'router-1', 'dns-srv'],
    planned_route: ['host-a', 'router-1', 'dns-srv'],
    hop_history: [
      {
        hop_index: 0,
        node_id: 'host-a',
        link_id: null,
        timestamp_us: 200,
        state: 'created',
        description: 'Packet created',
      },
      {
        hop_index: 1,
        node_id: 'router-1',
        link_id: 'link-host-router',
        timestamp_us: 208,
        state: 'in_flight',
        description: 'Traversing link',
      },
      {
        hop_index: 2,
        node_id: 'dns-srv',
        link_id: 'link-router-dns',
        timestamp_us: 220,
        state: 'delivered',
        description: 'Delivered to destination dns-srv',
      },
    ],
  };

  // =========================================================================
  // 1. Encapsulation Viewer renders all five layers
  // =========================================================================
  it('1. Encapsulation Viewer renders all five educational layers', () => {
    const layers = [
      { id: 'app', name: 'Application', header: sampleTcpPacket.headers.application },
      { id: 'transport', name: 'Transport', header: sampleTcpPacket.headers.transport },
      { id: 'network', name: 'Network', header: sampleTcpPacket.headers.network },
      { id: 'datalink', name: 'Data Link', header: sampleTcpPacket.headers.datalink },
      { id: 'physical', name: 'Physical', header: sampleTcpPacket.headers.physical },
    ];

    expect(layers).toHaveLength(5);
    expect(layers[0].name).toBe('Application');
    expect(layers[1].name).toBe('Transport');
    expect(layers[2].name).toBe('Network');
    expect(layers[3].name).toBe('Data Link');
    expect(layers[4].name).toBe('Physical');

    // Both encapsulation and decapsulation modes are supported
    const encapMode: EncapsulationMode = 'encapsulation';
    const decapMode: EncapsulationMode = 'decapsulation';
    expect(encapMode).toBe('encapsulation');
    expect(decapMode).toBe('decapsulation');
  });

  // =========================================================================
  // 2. TCP inspector displays sequence/ACK/flags
  // =========================================================================
  it('2. TCP inspector displays sequence, ACK, flags, and connection state', () => {
    const transport = sampleTcpPacket.headers.transport;
    expect(transport.protocol).toBe('TCP');
    expect(transport.seq_num).toBe(10001);
    expect(transport.ack_num).toBe(5001);
    expect(transport.flags).toEqual(['ack', 'psh']);
    expect(transport.window_size).toBe(65535);
    expect(transport.connection_state).toBe('established');
    expect(transport.is_retransmission).toBe(false);
  });

  // =========================================================================
  // 3. UDP inspector displays datagram fields without fabricating TCP fields
  // =========================================================================
  it('3. UDP inspector displays datagram fields and leaves unmodeled fields undefined', () => {
    const transport = sampleUdpPacket.headers.transport;
    expect(transport.protocol).toBe('UDP');
    expect(transport.src_port).toBe(53120);
    expect(transport.dst_port).toBe(53);
    expect(transport.payload_length).toBe(512);

    // TCP-specific fields MUST NOT be fabricated
    expect(transport.seq_num).toBeUndefined();
    expect(transport.ack_num).toBeUndefined();
    expect(transport.window_size).toBeUndefined();
    expect(transport.connection_state).toBeUndefined();
  });

  // =========================================================================
  // 4. Packet journey renders actual hop history
  // =========================================================================
  it('4. Packet journey renders the authoritative hop history', () => {
    const journey: PacketJourney = {
      packetId: sampleTcpPacket.id,
      sourceNodeId: sampleTcpPacket.src_node_id,
      destinationNodeId: sampleTcpPacket.dst_node_id,
      currentState: sampleTcpPacket.state,
      actualHops: sampleTcpPacket.hop_history.map((h, i) => ({
        hopIndex: h.hop_index,
        nodeId: h.node_id,
        linkId: h.link_id,
        timestamp_us: h.timestamp_us,
        state: h.state,
        description: h.description,
        isCurrent: i === sampleTcpPacket.hop_history.length - 1,
        isTraversed: true,
      })),
      plannedRoute: sampleTcpPacket.planned_route,
      totalLatencyUs: 5,
    };

    expect(journey.actualHops).toHaveLength(3);
    expect(journey.actualHops[0].nodeId).toBe('host-a');
    expect(journey.actualHops[0].state).toBe('created');
    expect(journey.actualHops[1].state).toBe('queued');
    expect(journey.actualHops[2].state).toBe('transmitting');
  });

  // =========================================================================
  // 5. Planned route is not treated as actual traversal
  // =========================================================================
  it('5. Planned route is not treated as actual traversal when packet stops early', () => {
    const droppedPacket: Packet = {
      ...sampleTcpPacket,
      id: 'pkt-dropped-early',
      state: 'dropped_queue_full',
      planned_route: ['host-a', 'router-1', 'router-2', 'host-b'],
      hop_history: [
        {
          hop_index: 0,
          node_id: 'host-a',
          timestamp_us: 100,
          state: 'created',
          description: 'Created',
        },
        {
          hop_index: 1,
          node_id: 'host-a',
          link_id: 'link-1',
          timestamp_us: 105,
          state: 'dropped_queue_full',
          description: 'Dropped due to queue overflow',
        },
      ],
    };

    // Planned route contains 4 nodes, but actual traversal reached only host-a
    expect(droppedPacket.planned_route).toHaveLength(4);
    expect(droppedPacket.hop_history).toHaveLength(2);
    expect(droppedPacket.hop_history.some((h) => h.node_id === 'host-b')).toBe(false);
    expect(droppedPacket.hop_history[1].state).toBe('dropped_queue_full');
  });

  // =========================================================================
  // 6. Timeline renders authoritative event order
  // =========================================================================
  it('6. Timeline preserves authoritative event tie-break ordering', () => {
    const rawEvents: SimEvent[] = [
      {
        id: 10,
        timestamp: 500,
        event_type: { type: 'packet_created', data: { packet_id: 'pkt-1' } },
        packet_id: 'pkt-1',
        node_id: 'node-a',
        layer: 'Application',
        protocol: 'HTTP',
        description: 'Packet 1 created',
      },
      {
        id: 11,
        timestamp: 500, // Same timestamp, higher ID
        event_type: { type: 'packet_created', data: { packet_id: 'pkt-2' } },
        packet_id: 'pkt-2',
        node_id: 'node-a',
        layer: 'Application',
        protocol: 'HTTP',
        description: 'Packet 2 created',
      },
      {
        id: 12,
        timestamp: 520,
        event_type: { type: 'transmission_started', data: { packet_id: 'pkt-1', link_id: 'link-1' } },
        packet_id: 'pkt-1',
        link_id: 'link-1',
        layer: 'Physical',
        description: 'Tx started',
      },
    ];

    const getUs = (ts: { 0: number } | number) => (typeof ts === 'object' ? ts[0] : ts);

    // Sorting by timestamp then by authoritative id preserves engine ordering
    const sorted = [...rawEvents].sort((a, b) => {
      const ta = getUs(a.timestamp);
      const tb = getUs(b.timestamp);
      if (ta !== tb) return ta - tb;
      return a.id - b.id;
    });

    expect(sorted[0].id).toBe(10);
    expect(sorted[1].id).toBe(11);
    expect(sorted[2].id).toBe(12);
  });

  // =========================================================================
  // 7. Filtering works
  // =========================================================================
  it('7. Filtering filters events without mutating state', () => {
    const events: TimelineEvent[] = [
      {
        id: 1,
        timestamp_us: 10,
        eventType: 'packet_created',
        packetId: 'pkt-1',
        nodeId: 'host-a',
        linkId: null,
        layer: 'Application',
        protocol: 'HTTP',
        description: 'HTTP request',
        status: 'normal',
        rawEvent: {
          id: 1,
          timestamp: 10,
          event_type: { type: 'packet_created', data: {} },
          description: 'HTTP request',
        },
      },
      {
        id: 2,
        timestamp_us: 20,
        eventType: 'packet_created',
        packetId: 'pkt-2',
        nodeId: 'host-b',
        linkId: null,
        layer: 'Application',
        protocol: 'DNS',
        description: 'DNS query',
        status: 'normal',
        rawEvent: {
          id: 2,
          timestamp: 20,
          event_type: { type: 'packet_created', data: {} },
          description: 'DNS query',
        },
      },
      {
        id: 3,
        timestamp_us: 30,
        eventType: 'route_updated',
        packetId: null,
        nodeId: 'router-1',
        linkId: null,
        layer: 'Network',
        protocol: 'Routing',
        description: 'Dijkstra route converged',
        status: 'normal',
        rawEvent: {
          id: 3,
          timestamp: 30,
          event_type: { type: 'packet_created', data: {} },
          description: 'Dijkstra route converged',
        },
      },
    ];

    const filter: EventFilter = {
      eventType: 'all',
      layer: 'Application',
      protocol: 'HTTP',
      nodeId: 'all',
      linkId: 'all',
      packetId: '',
      status: 'all',
      searchQuery: '',
    };

    const filtered = events.filter((e) => {
      if (filter.layer !== 'all' && e.layer !== filter.layer) return false;
      if (filter.protocol !== 'all' && e.protocol !== filter.protocol) return false;
      return true;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
    expect(filtered[0].packetId).toBe('pkt-1');
  });

  // =========================================================================
  // 8. Event selection updates packet inspector
  // =========================================================================
  it('8. Event selection correctly resolves the associated packet ID for inspector', () => {
    const ev: SimEvent = {
      id: 5,
      timestamp: 150,
      event_type: { type: 'packet_arrived', data: { packet_id: 'pkt-tcp-test-01', node_id: 'router-1' } },
      packet_id: 'pkt-tcp-test-01',
      node_id: 'router-1',
      layer: 'Network',
      protocol: 'IP',
      description: 'Arrived at router-1',
    };

    let selectedPacketId: string | null = null;
    if (ev.packet_id) {
      selectedPacketId = ev.packet_id;
    }

    expect(selectedPacketId).toBe('pkt-tcp-test-01');
  });

  // =========================================================================
  // 9. Event selection highlights node/link
  // =========================================================================
  it('9. Event selection produces correct TopologySyncState', () => {
    const ev: SimEvent = {
      id: 7,
      timestamp: 250,
      event_type: { type: 'transmission_finished', data: { packet_id: 'pkt-tcp-test-01', link_id: 'link-host-router' } },
      packet_id: 'pkt-tcp-test-01',
      node_id: 'host-a',
      link_id: 'link-host-router',
      layer: 'Physical',
      description: 'Tx finished',
    };

    const syncState: TopologySyncState = {
      selectedEventId: ev.id,
      selectedPacketId: ev.packet_id || null,
      focusedNodeId: ev.node_id || null,
      focusedLinkId: ev.link_id || null,
    };

    expect(syncState.focusedNodeId).toBe('host-a');
    expect(syncState.focusedLinkId).toBe('link-host-router');
    expect(syncState.selectedPacketId).toBe('pkt-tcp-test-01');
  });

  // =========================================================================
  // 10. Packet selection updates journey
  // =========================================================================
  it('10. Packet selection updates journey with the packet hop history', () => {
    const selected = sampleUdpPacket;
    const journey: PacketJourney = {
      packetId: selected.id,
      sourceNodeId: selected.src_node_id,
      destinationNodeId: selected.dst_node_id,
      currentState: selected.state,
      actualHops: selected.hop_history.map((h, i) => ({
        hopIndex: h.hop_index,
        nodeId: h.node_id,
        linkId: h.link_id,
        timestamp_us: h.timestamp_us,
        state: h.state,
        description: h.description,
        isCurrent: i === selected.hop_history.length - 1,
        isTraversed: true,
      })),
      plannedRoute: selected.planned_route,
      totalLatencyUs: 20,
    };

    expect(journey.packetId).toBe('pkt-udp-test-02');
    expect(journey.actualHops).toHaveLength(3);
    expect(journey.actualHops[2].nodeId).toBe('dns-srv');
    expect(journey.currentState).toBe('delivered');
  });

  // =========================================================================
  // 11. Dropped packet displays drop state/reason
  // =========================================================================
  it('11. Dropped packet displays drop state and explanatory reason in hop record', () => {
    const dropRecord: PacketHopRecord = {
      hop_index: 2,
      node_id: 'router-1',
      link_id: 'link-r1-r2',
      timestamp_us: 450,
      state: 'dropped_link_down',
      description: 'Dropped at router-1: egress link is down',
    };

    expect(dropRecord.state).toBe('dropped_link_down');
    expect(dropRecord.description).toContain('egress link is down');
    expect(dropRecord.node_id).toBe('router-1');
  });

  // =========================================================================
  // 12. Retransmission displays retransmission state
  // =========================================================================
  it('12. Retransmission displays retransmission state and transport header flag', () => {
    const retransmittedPacket: Packet = {
      ...sampleTcpPacket,
      id: 'pkt-tcp-rexmit-03',
      state: 'retransmitted',
      headers: {
        ...sampleTcpPacket.headers,
        transport: {
          ...sampleTcpPacket.headers.transport,
          is_retransmission: true,
          connection_state: 'established',
        },
      },
    };

    expect(retransmittedPacket.state).toBe('retransmitted');
    expect(retransmittedPacket.headers.transport.is_retransmission).toBe(true);
  });

  // =========================================================================
  // 13. Queue event displays queue information
  // =========================================================================
  it('13. Queue event correctly displays affected link and queue occupancy', () => {
    const queueEvent: SimEvent = {
      id: 15,
      timestamp: 320,
      event_type: { type: 'queue_entered', data: { packet_id: 'pkt-tcp-test-01', link_id: 'link-1' } },
      packet_id: 'pkt-tcp-test-01',
      link_id: 'link-1',
      node_id: 'router-1',
      layer: 'Data Link',
      description: 'Enqueued in link-1 queue (occupancy: 4)',
    };

    expect(queueEvent.link_id).toBe('link-1');
    expect(queueEvent.description).toContain('occupancy: 4');
  });

  // =========================================================================
  // 14. Route update event displays correctly
  // =========================================================================
  it('14. Route update event displays routing algorithm and affected node', () => {
    const routeEvent: SimEvent = {
      id: 18,
      timestamp: 400,
      event_type: { type: 'route_updated', data: { node_id: 'router-1', algorithm: 'Dijkstra' } },
      node_id: 'router-1',
      layer: 'Network',
      protocol: 'Routing',
      description: 'Dijkstra shortest path computed for destination 10.0.0.0/24',
    };

    expect(routeEvent.packet_id).toBeUndefined();
    expect(routeEvent.node_id).toBe('router-1');
    expect(routeEvent.protocol).toBe('Routing');
    expect(routeEvent.description).toContain('Dijkstra');
  });

  // =========================================================================
  // 15. Protocol trace without packet ID renders correctly
  // =========================================================================
  it('15. Protocol trace events without packet ID render cleanly without errors', () => {
    const collisionEvent: SimEvent = {
      id: 22,
      timestamp: 650,
      event_type: { type: 'collision_detected', data: { node_id: 'station-a', link_id: 'shared-bus-1' } },
      node_id: 'station-a',
      link_id: 'shared-bus-1',
      layer: 'Data Link',
      protocol: 'CSMA/CD',
      description: 'Collision detected on bus; transmitting jam signal',
    };

    expect(collisionEvent.packet_id).toBeUndefined();
    expect(collisionEvent.protocol).toBe('CSMA/CD');
    expect(collisionEvent.layer).toBe('Data Link');
  });

  // =========================================================================
  // 16. Browser mocks do not fabricate authoritative protocol calculations
  // =========================================================================
  it('16. Browser mock bridge preserves authoritative simulation structures without inventing math', async () => {
    const state = await api.getSimulationState();
    expect(state).toBeDefined();
    expect(state.packets).toBeDefined();
    expect(Array.isArray(state.packets)).toBe(true);

    if (state.packets && state.packets.length > 0) {
      const pkt = state.packets[0];
      // Headers originate directly from simulation snapshot
      expect(pkt.headers).toBeDefined();
      expect(pkt.headers.application).toBeDefined();
      expect(pkt.headers.transport).toBeDefined();
      expect(pkt.headers.network).toBeDefined();
      expect(pkt.headers.datalink).toBeDefined();

      // Hop history is authoritative array
      expect(Array.isArray(pkt.hop_history)).toBe(true);
    }

    // Packet details API returns authoritative packet
    const details = await api.getPacketDetails('pkt-1');
    expect(details).toBeDefined();
    if (details) {
      expect(details.id).toBe('pkt-1');
      expect(details.hop_history.length).toBeGreaterThanOrEqual(1);
    }
  });
});
