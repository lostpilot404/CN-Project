import React, { useMemo } from 'react';
import { Clock, Cpu, Network } from 'lucide-react';
import { SimEvent, TimelineEvent, EventFilter } from '../../types/events';
import { formatTimeUs } from '../../lib/utils';

interface EventTimelineProps {
  events: SimEvent[];
  selectedEventId?: number | null;
  onSelectEvent: (event: TimelineEvent) => void;
  filter?: EventFilter;
  maxHeight?: string;
}

export const EventTimeline: React.FC<EventTimelineProps> = ({
  events,
  selectedEventId,
  onSelectEvent,
  filter,
  maxHeight = '100%',
}) => {
  // Map SimEvents to TimelineEvents preserving authoritative ordering
  const mappedEvents: TimelineEvent[] = useMemo(() => {
    return events.map((ev) => {
      const timeMicros = typeof ev.timestamp === 'number' ? ev.timestamp : ev.timestamp[0];
      // The Python core emits `event_type: { type, data }`. Older fixtures may still use the
      // `{ <event_name>: data }` shape, which is handled by the fallback below.
      const envelope = (ev.event_type ?? {}) as unknown as Record<string, unknown>;
      const eventKey =
        typeof envelope.type === 'string'
          ? envelope.type
          : Object.keys(envelope)[0] || 'unknown';
      const eventData = (
        typeof envelope.type === 'string'
          ? envelope.data
          : envelope[eventKey]
      ) as Record<string, unknown> | undefined;

      const packetId = ev.packet_id || (eventData?.packet_id as string) || null;
      const nodeId = ev.node_id || (eventData?.node_id as string) || null;
      const linkId = ev.link_id || (eventData?.link_id as string) || (eventData?.location_id as string) || null;

      // Determine layer
      let layer: TimelineEvent['layer'] = 'Other';
      if (ev.layer) {
        layer = ev.layer as TimelineEvent['layer'];
      } else if (eventKey.includes('packet_created')) {
        layer = 'Application';
      } else if (eventKey.includes('queue') || eventKey.includes('transmission')) {
        layer = 'Physical';
      } else if (eventKey.includes('arrived') || eventKey.includes('route')) {
        layer = 'Network';
      } else if (eventKey.includes('ack') || eventKey.includes('timeout') || eventKey.includes('retransmission')) {
        layer = 'Transport';
      }

      // Determine status
      let status: TimelineEvent['status'] = 'normal';
      if (eventKey.includes('dropped')) {
        status = 'dropped';
      } else if (eventKey.includes('error') || eventKey.includes('corrupt')) {
        status = 'error';
      } else if (eventKey.includes('retransmission')) {
        status = 'retransmission';
      } else if (eventKey.includes('arrived') || eventKey.includes('delivered')) {
        status = 'success';
      } else if (eventKey.includes('queue')) {
        status = 'queued';
      } else if (eventKey.includes('transmission')) {
        status = 'transmitting';
      }

      return {
        id: ev.id,
        timestamp_us: timeMicros,
        eventType: eventKey,
        description: ev.description,
        packetId,
        nodeId,
        linkId,
        layer,
        protocol: ev.protocol || (packetId ? 'Packet' : 'Protocol Trace'),
        status,
        rawEvent: ev,
      };
    });
  }, [events]);

  // Apply filters if provided
  const filteredEvents = useMemo(() => {
    if (!filter) return mappedEvents;

    return mappedEvents.filter((ev) => {
      // Event Type
      if (filter.eventType !== 'all' && ev.eventType.toLowerCase() !== filter.eventType.toLowerCase()) {
        return false;
      }
      // Layer
      if (filter.layer !== 'all' && ev.layer !== filter.layer) {
        return false;
      }
      // Protocol
      if (filter.protocol !== 'all' && ev.protocol && !ev.protocol.toLowerCase().includes(filter.protocol.toLowerCase())) {
        return false;
      }
      // Node
      if (filter.nodeId !== 'all' && ev.nodeId !== filter.nodeId) {
        return false;
      }
      // Link
      if (filter.linkId !== 'all' && ev.linkId !== filter.linkId) {
        return false;
      }
      // Packet ID
      if (filter.packetId && (!ev.packetId || !ev.packetId.toLowerCase().includes(filter.packetId.toLowerCase()))) {
        return false;
      }
      // Status
      if (filter.status !== 'all') {
        if (filter.status === 'success' && ev.status !== 'success') return false;
        if (filter.status === 'dropped' && ev.status !== 'dropped') return false;
        if (filter.status === 'error' && ev.status !== 'error') return false;
        if (filter.status === 'retransmission' && ev.status !== 'retransmission') return false;
      }
      // Search query
      if (filter.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        const matchesDesc = ev.description.toLowerCase().includes(query);
        const matchesPkt = ev.packetId?.toLowerCase().includes(query);
        const matchesType = ev.eventType.toLowerCase().includes(query);
        if (!matchesDesc && !matchesPkt && !matchesType) return false;
      }

      return true;
    });
  }, [mappedEvents, filter]);

  const layerColorBadge: Record<string, string> = {
    Application: 'bg-amber-950/70 text-amber-300 border-amber-800',
    Transport: 'bg-cyan-950/70 text-cyan-300 border-cyan-800',
    Network: 'bg-brand-950/70 text-brand-300 border-brand-800',
    'Data Link': 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
    Physical: 'bg-slate-800 text-slate-300 border-slate-700',
    Other: 'bg-slate-900 text-slate-400 border-slate-800',
  };

  const statusMarker: Record<string, { border: string; bg: string; text: string }> = {
    normal: { border: 'border-slate-800', bg: 'bg-slate-900/60', text: 'text-slate-300' },
    success: { border: 'border-emerald-800/80', bg: 'bg-emerald-950/30', text: 'text-emerald-300' },
    dropped: { border: 'border-rose-800/80', bg: 'bg-rose-950/30', text: 'text-rose-300' },
    error: { border: 'border-rose-800/80', bg: 'bg-rose-950/30', text: 'text-rose-300' },
    retransmission: { border: 'border-amber-800/80', bg: 'bg-amber-950/30', text: 'text-amber-300' },
    queued: { border: 'border-amber-800/60', bg: 'bg-amber-950/20', text: 'text-amber-300' },
    transmitting: { border: 'border-cyan-800/60', bg: 'bg-cyan-950/20', text: 'text-cyan-300' },
  };

  return (
    <div
      data-testid="event-timeline"
      style={{ maxHeight }}
      className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs select-none space-y-1.5"
    >
      {filteredEvents.length === 0 ? (
        <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-xs">
          <span>No events matching the active filter criteria.</span>
          <span className="text-[10px] mt-1">Run a simulation burst or adjust filters.</span>
        </div>
      ) : (
        filteredEvents.map((ev) => {
          const isSelected = selectedEventId === ev.id;
          const statusStyle = statusMarker[ev.status] || statusMarker.normal;

          return (
            <div
              key={ev.id}
              onClick={() => onSelectEvent(ev)}
              data-testid={`timeline-event-${ev.id}`}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 rounded-xl border transition-all cursor-pointer ${
                statusStyle.bg
              } ${statusStyle.border} ${
                isSelected
                  ? 'ring-2 ring-cyan-400 shadow-md shadow-cyan-950/50 bg-slate-850'
                  : 'hover:border-slate-700 hover:bg-slate-850/80'
              }`}
            >
              {/* Event ID and SimTime */}
              <span className="text-slate-400 text-[10px] min-w-[28px] shrink-0">#{ev.id}</span>

              <div className="flex items-center space-x-1 text-cyan-400 text-[11px] min-w-[75px] shrink-0">
                <Clock className="w-3 h-3 shrink-0" />
                <span className="whitespace-nowrap">{formatTimeUs(ev.timestamp_us)}</span>
              </div>

              {/* Layer Badge */}
              <span
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                  layerColorBadge[ev.layer || 'Other'] || layerColorBadge.Other
                }`}
              >
                {ev.layer}
              </span>

              {/* Packet or Protocol identifier */}
              {ev.packetId ? (
                <span className="text-[10px] font-semibold text-cyan-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 whitespace-nowrap shrink-0">
                  {ev.packetId}
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/80 whitespace-nowrap shrink-0">
                  Trace
                </span>
              )}

              {/* Location: Node / Link */}
              {ev.nodeId && (
                <span className="text-[10px] text-emerald-400 flex items-center space-x-0.5 whitespace-nowrap shrink-0">
                  <Cpu className="w-2.5 h-2.5 shrink-0" />
                  <span>{ev.nodeId}</span>
                </span>
              )}
              {ev.linkId && (
                <span className="text-[10px] text-brand-400 flex items-center space-x-0.5 whitespace-nowrap shrink-0">
                  <Network className="w-2.5 h-2.5 shrink-0" />
                  <span>{ev.linkId}</span>
                </span>
              )}

              {/* Description (drops below the badges when the column is too narrow). */}
              <span className={`text-xs flex-1 min-w-0 basis-40 truncate ${statusStyle.text}`}>
                {ev.description}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
};
