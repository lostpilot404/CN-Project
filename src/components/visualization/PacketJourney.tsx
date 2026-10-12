import React from 'react';
import { Route, ArrowRight, Clock, Cpu } from 'lucide-react';
import { Packet, PacketHopRecord } from '../../types/packet';
import { formatTimeUs } from '../../lib/utils';

interface PacketJourneyProps {
  packet: Packet | null;
  onSelectHop?: (hop: PacketHopRecord) => void;
  selectedHopIndex?: number;
}

export const PacketJourney: React.FC<PacketJourneyProps> = ({
  packet,
  onSelectHop,
  selectedHopIndex,
}) => {
  if (!packet) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800/80">
        <Route className="w-12 h-12 text-slate-600 mb-3 stroke-[1.5]" />
        <h4 className="text-sm font-semibold text-slate-300">No Journey Selected</h4>
        <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
          Select a packet to view its authoritative hop-by-hop traversal history across the topology.
        </p>
      </div>
    );
  }

  const hops = packet.hop_history || [];

  return (
    <div data-testid="packet-journey" className="flex flex-col h-full bg-slate-950/80 p-4 select-none overflow-y-auto space-y-4">
      {/* Journey Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center space-x-2">
            <Route className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Hop-by-Hop Packet Traversal</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
              {hops.length} actual hops recorded
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Authoritative traversal recorded by the Python simulation engine.
          </p>
        </div>

        <div className="flex items-center space-x-2 font-mono text-xs text-slate-300">
          <span className="bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 text-slate-200">
            {packet.src_node_id}
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
          <span className="bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 text-slate-200">
            {packet.dst_node_id}
          </span>
        </div>
      </div>

      {/* Planned Route Reference Banner (Reference ONLY, clearly separated from actual traversal) */}
      {packet.planned_route && packet.planned_route.length > 0 && (
        <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-2">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Planned Path (Ref):</span>
            <div className="flex items-center space-x-1 text-slate-300">
              {packet.planned_route.map((node, i) => (
                <React.Fragment key={i}>
                  <span className="text-cyan-400 font-medium">{node}</span>
                  {i < packet.planned_route.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
          <span className="text-[10px] text-slate-400 italic">
            Planned route is snapshot reference; hop history below is authoritative truth
          </span>
        </div>
      )}

      {/* Actual Traversed Hops Timeline */}
      <div className="space-y-3">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
          Actual Observed Traversal (Python Source of Truth)
        </div>

        {hops.length === 0 ? (
          <div className="text-xs text-slate-400 italic p-3 bg-slate-900/40 rounded-xl border border-slate-800">
            No physical hops recorded yet for packet {packet.id}.
          </div>
        ) : (
          <div className="relative pl-6 space-y-3 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
            {hops.map((hop) => {
              const isSelected = selectedHopIndex === hop.hop_index;
              const isDropped = hop.state.includes('dropped');
              const isDelivered = hop.state === 'delivered';
              const isTx = hop.state === 'transmitting';

              return (
                <div
                  key={hop.hop_index}
                  onClick={() => onSelectHop?.(hop)}
                  data-testid={`journey-hop-${hop.hop_index}`}
                  className={`relative p-3 rounded-xl border transition-all cursor-pointer select-none ${
                    isSelected
                      ? 'border-cyan-400/80 bg-cyan-950/20 ring-1 ring-cyan-400 shadow-md shadow-cyan-950/40'
                      : isDropped
                      ? 'border-rose-800/80 bg-rose-950/20 hover:border-rose-700'
                      : isDelivered
                      ? 'border-emerald-800/80 bg-emerald-950/20 hover:border-emerald-700'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  {/* Timeline node bullet */}
                  <div
                    className={`absolute -left-[27px] top-3.5 w-3.5 h-3.5 rounded-full border-2 bg-slate-950 ${
                      isDropped
                        ? 'border-rose-500 bg-rose-950'
                        : isDelivered
                        ? 'border-emerald-400 bg-emerald-950'
                        : isTx
                        ? 'border-cyan-400 bg-cyan-950 animate-ping'
                        : 'border-slate-600 bg-slate-900'
                    }`}
                  />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                        Hop #{hop.hop_index}
                      </span>
                      <span className="text-xs font-bold text-white flex items-center space-x-1">
                        <Cpu className="w-3.5 h-3.5 text-slate-400" />
                        <span>{hop.node_id}</span>
                      </span>
                      {hop.link_id && (
                        <span className="text-[11px] font-mono text-cyan-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          link: {hop.link_id}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-[10px] font-mono uppercase font-semibold px-2 py-0.5 rounded-full border ${
                          isDropped
                            ? 'bg-rose-950 text-rose-300 border-rose-800'
                            : isDelivered
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : isTx
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {hop.state.replace(/_/g, ' ')}
                      </span>
                      <div className="flex items-center space-x-1 text-[11px] font-mono text-slate-400">
                        <Clock className="w-3 h-3" />
                        <span>{formatTimeUs(hop.timestamp_us)}</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 mt-1 font-mono">{hop.description}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
