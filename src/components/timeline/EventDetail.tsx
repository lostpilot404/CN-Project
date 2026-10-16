import React from 'react';
import { Clock, Info, Package, Network, Cpu, Layers } from 'lucide-react';
import { TimelineEvent } from '../../types/events';
import { formatTimeUs } from '../../lib/utils';

interface EventDetailProps {
  event: TimelineEvent | null;
  onSelectPacket?: (packetId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  onSelectLink?: (linkId: string) => void;
}

export const EventDetail: React.FC<EventDetailProps> = ({
  event,
  onSelectPacket,
  onSelectNode,
  onSelectLink,
}) => {
  if (!event) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-center text-slate-400 bg-slate-900/60 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-2 text-xs">
          <Info className="w-4 h-4 text-slate-400" />
          <span>Select an event from the timeline to inspect protocol details.</span>
        </div>
      </div>
    );
  }

  // Extract raw payload data if present (`{ type, data }` envelope from the Python core)
  const envelope = (event.rawEvent.event_type ?? {}) as unknown as Record<string, unknown>;
  const rawData = (
    typeof envelope.type === 'string' ? envelope.data : Object.values(envelope)[0]
  ) as Record<string, unknown> | undefined;

  return (
    <div
      data-testid="event-detail"
      className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-3 font-mono text-xs select-none"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center space-x-2">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
            Event #{event.id}
          </span>
          <span className="text-sm font-bold text-white capitalize">
            {event.eventType.replace(/_/g, ' ')}
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
            {event.layer || 'Simulation Engine'}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 text-cyan-400 font-bold">
          <Clock className="w-3.5 h-3.5" />
          <span>{formatTimeUs(event.timestamp_us)}</span>
        </div>
      </div>

      {/* Description */}
      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 text-slate-200">
        <span className="text-[10px] text-slate-400 font-semibold block mb-0.5">
          Simulation description:
        </span>
        <p className="text-xs leading-relaxed">{event.description}</p>
      </div>

      {/* Associated Elements */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        {event.packetId && (
          <div
            onClick={() => onSelectPacket?.(event.packetId!)}
            className="bg-slate-950/80 p-2 rounded-lg border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition-colors"
          >
            <span className="text-[10px] text-slate-400 flex items-center space-x-1">
              <Package className="w-3 h-3 text-cyan-400" />
              <span>Packet ID</span>
            </span>
            <span className="font-bold text-cyan-300 block mt-0.5 truncate">{event.packetId}</span>
          </div>
        )}

        {event.nodeId && (
          <div
            onClick={() => onSelectNode?.(event.nodeId!)}
            className="bg-slate-950/80 p-2 rounded-lg border border-slate-800 hover:border-emerald-500/50 cursor-pointer transition-colors"
          >
            <span className="text-[10px] text-slate-400 flex items-center space-x-1">
              <Cpu className="w-3 h-3 text-emerald-400" />
              <span>Node</span>
            </span>
            <span className="font-bold text-emerald-300 block mt-0.5 truncate">{event.nodeId}</span>
          </div>
        )}

        {event.linkId && (
          <div
            onClick={() => onSelectLink?.(event.linkId!)}
            className="bg-slate-950/80 p-2 rounded-lg border border-slate-800 hover:border-brand-500/50 cursor-pointer transition-colors"
          >
            <span className="text-[10px] text-slate-400 flex items-center space-x-1">
              <Network className="w-3 h-3 text-brand-400" />
              <span>Link</span>
            </span>
            <span className="font-bold text-brand-300 block mt-0.5 truncate">{event.linkId}</span>
          </div>
        )}

        {event.protocol && (
          <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 flex items-center space-x-1">
              <Layers className="w-3 h-3 text-amber-400" />
              <span>Protocol</span>
            </span>
            <span className="font-bold text-amber-300 block mt-0.5 truncate">{event.protocol}</span>
          </div>
        )}
      </div>

      {/* Raw Event Data Attributes if available */}
      {rawData && Object.keys(rawData).length > 0 && (
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-400 font-semibold block mb-1">
            Event fields:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
            {Object.entries(rawData).map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <span className="text-slate-400">{k}:</span>
                <span className="text-slate-200 font-semibold truncate">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
