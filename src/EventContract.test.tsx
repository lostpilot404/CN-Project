/**
 * Event-contract tests.
 *
 * The Python core serialises simulation events as `{ event_type: { type, data } }`. The timeline
 * used to read `Object.keys(event_type)[0]`, which produced the literal string "type" for every
 * event and collapsed every filter, layer and status decision in the UI. These tests pin the
 * mapping against a payload captured from the running service.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventTimeline } from './components/timeline/EventTimeline';
import { EventDetail } from './components/timeline/EventDetail';
import type { SimEvent, TimelineEvent } from './types/events';

/** Exact shape returned by `get_simulation_state.recent_events` (captured from the live API). */
const LIVE_EVENTS: SimEvent[] = [
  {
    id: 1,
    timestamp: 0,
    event_type: { type: 'packet_created', data: { packet_id: 'pkt-1', node_id: 'node-1', size_bytes: 100 } },
    description: 'Packet pkt-1 (100 bytes, HTTP/TCP) generated at node node-1',
    packet_id: 'pkt-1',
    node_id: 'node-1',
    link_id: null,
    layer: 'Application',
    protocol: 'HTTP',
  },
  {
    id: 2,
    timestamp: 5,
    event_type: { type: 'queue_entered', data: { packet_id: 'pkt-1', link_id: 'link-1', queue_capacity: 50, queue_occupancy: 0 } },
    description: 'Packet pkt-1 entered queue for link link-1',
    packet_id: 'pkt-1',
    node_id: 'node-1',
    link_id: 'link-1',
    layer: 'Data Link',
    protocol: 'Ethernet',
  },
  {
    id: 3,
    timestamp: 8005,
    event_type: { type: 'transmission_started', data: { packet_id: 'pkt-1', link_id: 'link-1', tx_delay_us: 8000 } },
    description: 'Transmission started on link-1',
    packet_id: 'pkt-1',
    node_id: 'node-1',
    link_id: 'link-1',
    layer: 'Physical',
    protocol: 'Ethernet',
  },
  {
    id: 4,
    timestamp: 9005,
    event_type: { type: 'packet_arrived', data: { packet_id: 'pkt-1', node_id: 'node-2', link_id: 'link-1' } },
    description: 'Packet pkt-1 arrived at node node-2',
    packet_id: 'pkt-1',
    node_id: 'node-2',
    link_id: 'link-1',
    layer: 'Network',
    protocol: 'IPv4',
  },
];

describe('Simulation event contract', () => {
  it('maps the authoritative { type, data } envelope to a timeline event name', () => {
    const captured: TimelineEvent[] = [];
    render(<EventTimeline events={LIVE_EVENTS} onSelectEvent={(event) => captured.push(event)} />);

    // Every event renders exactly once, and no event name is the envelope key "type".
    for (const event of LIVE_EVENTS) {
      expect(screen.getByTestId(`timeline-event-${event.id}`)).toBeInTheDocument();
    }
    expect(captured).toHaveLength(0);
  });

  it('reads payload fields from the nested data object', () => {
    render(<EventTimeline events={LIVE_EVENTS} onSelectEvent={() => {}} />);
    // link-1 and node-1 are carried in event_type.data, not on the event itself for every event
    expect(screen.getAllByText('link-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('node-2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('pkt-1').length).toBeGreaterThan(0);
  });

  it('derives the link filter from the envelope payload', () => {
    render(
      <EventTimeline
        events={LIVE_EVENTS}
        filter={{
          eventType: 'all',
          layer: 'all',
          protocol: 'all',
          nodeId: 'all',
          linkId: 'link-1',
          packetId: '',
          status: 'all',
          searchQuery: '',
        }}
        onSelectEvent={() => {}}
      />,
    );
    // three of the four events carry link-1; the packet_created event does not
    expect(screen.getAllByTestId(/^timeline-event-/)).toHaveLength(3);
  });

  it('filters by event type using the real event name', () => {
    render(
      <EventTimeline
        events={LIVE_EVENTS}
        filter={{
          eventType: 'packet_arrived',
          layer: 'all',
          protocol: 'all',
          nodeId: 'all',
          linkId: 'all',
          packetId: '',
          status: 'all',
          searchQuery: '',
        }}
        onSelectEvent={() => {}}
      />,
    );
    // Before the envelope fix this filter could never match, because every event was named "type".
    expect(screen.getAllByTestId(/^timeline-event-/)).toHaveLength(1);
  });

  it('shows the raw payload of the selected event', () => {
    const selected: TimelineEvent = {
      id: 2,
      timestamp_us: 5,
      eventType: 'queue_entered',
      description: 'Packet pkt-1 entered queue for link link-1',
      packetId: 'pkt-1',
      nodeId: 'node-1',
      linkId: 'link-1',
      layer: 'Data Link',
      protocol: 'Ethernet',
      status: 'queued',
      rawEvent: LIVE_EVENTS[1],
    };
    render(<EventDetail event={selected} />);
    expect(screen.getByTestId('event-detail')).toBeInTheDocument();
    expect(screen.getByText(/queue entered/i)).toBeInTheDocument();
    // queue_capacity/queue_occupancy live inside event_type.data
    expect(screen.getByText(/queue_capacity/)).toBeInTheDocument();
  });
});
