import { Clock, Server, Package } from 'lucide-react';
import { AppProtocolEvent } from '../../types/application';
import { Packet } from '../../types/packet';

interface ApplicationProtocolTimelineProps {
  events: AppProtocolEvent[];
  selectedStepIndex?: number;
  onSelectStep?: (index: number) => void;
  packets?: Packet[];
  selectedPacketId?: string | null;
  onSelectPacket?: (packetId: string) => void;
}

export const ApplicationProtocolTimeline: React.FC<ApplicationProtocolTimelineProps> = ({
  events,
  selectedStepIndex,
  onSelectStep,
  selectedPacketId,
  onSelectPacket,
}) => {
  if (events.length === 0) {
    return (
      <div className="p-6 text-center text-slate-500 text-xs bg-slate-900/30 rounded-xl border border-slate-800/60">
        No protocol events recorded yet. Run a simulation to view the step-by-step transaction flow.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-brand-400" />
          Protocol Transaction Sequence ({events.length} Steps)
        </span>
        <span className="text-[10px] text-slate-500">Click step or packet badge to inspect</span>
      </div>

      <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1 select-none">
        {events.map((ev) => {
          const isSelected = selectedStepIndex === ev.step_index;
          const isPacketSelected = ev.packet_id && ev.packet_id === selectedPacketId;
          const isError =
            ev.event_type.includes('NXDOMAIN') ||
            ev.event_type.includes('NOT_FOUND') ||
            ev.event_type.includes('REJECTED') ||
            ev.event_type.includes('UNKNOWN') ||
            ev.event_type.includes('FAILED');

          return (
            <div
              key={ev.step_index}
              onClick={() => {
                onSelectStep?.(ev.step_index);
                if (ev.packet_id) {
                  onSelectPacket?.(ev.packet_id);
                }
              }}
              className={`p-2.5 rounded-lg border text-xs transition-all cursor-pointer ${
                isSelected || isPacketSelected
                  ? 'bg-brand-950/40 border-brand-500/60 shadow-sm shadow-brand-950/40'
                  : 'bg-slate-900/50 hover:bg-slate-800/60 border-slate-800/80 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
                    #{ev.step_index + 1}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {ev.timestamp_us.toLocaleString()} µs
                  </span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
                    <Server className="w-2.5 h-2.5 text-brand-400" />
                    {ev.node_id}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                      isError
                        ? 'bg-rose-950/70 text-rose-300 border border-rose-800/60'
                        : 'bg-brand-950/70 text-brand-300 border border-brand-800/60'
                    }`}
                  >
                    {ev.event_type}
                  </span>
                </div>

                {ev.packet_id ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPacket?.(ev.packet_id!);
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      isPacketSelected
                        ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-500 shadow-sm'
                        : 'bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60 border border-emerald-800/60'
                    }`}
                    title="Click to view 5-layer encapsulation in Packet Inspector"
                  >
                    <Package className="w-3 h-3" />
                    {ev.packet_id}
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-500 italic bg-slate-800/40 px-1.5 py-0.5 rounded">
                    Pure App Event (Local)
                  </span>
                )}
              </div>

              <div className="text-slate-200 text-xs pl-0.5">{ev.description}</div>

              {ev.details && (
                <div className="text-[11px] text-slate-400 mt-1 font-mono bg-slate-950/50 p-1 rounded border border-slate-800/40">
                  {ev.details}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
