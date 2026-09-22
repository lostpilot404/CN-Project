import { Clock, Layers, ChevronUp, ChevronDown } from 'lucide-react';
import { SimEvent } from '../../types/simulation';
import { formatTimeUs } from '../../lib/utils';

interface TimelineDrawerProps {
  events: SimEvent[];
  isOpen: boolean;
  onToggle: () => void;
}

export const TimelineDrawer = ({ events, isOpen, onToggle }: TimelineDrawerProps) => {
  return (
    <div
      className={`border-t border-slate-800 bg-slate-900/95 backdrop-blur-md transition-all duration-300 flex flex-col ${
        isOpen ? 'h-52' : 'h-8'
      }`}
    >
      {/* Header bar */}
      <div
        onClick={onToggle}
        className="h-8 px-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 select-none"
      >
        <div className="flex items-center space-x-2 text-xs font-medium text-slate-300">
          <Layers className="w-3.5 h-3.5 text-brand-400" />
          <span>Discrete Event Timeline</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-slate-800 text-slate-400 rounded-full">
            {events.length} events logged
          </span>
        </div>
        <button className="text-slate-400 hover:text-white">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Events table */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs">
          {events.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-xs">
              No events simulated yet. Click "Step Event" or "Inject Test Packet" to begin.
            </div>
          ) : (
            <div className="space-y-1.5">
              {events.map((ev) => {
                const timeMicros = typeof ev.timestamp === 'number' ? ev.timestamp : ev.timestamp[0];
                return (
                  <div
                    key={ev.id}
                    className="flex items-center space-x-3 px-2.5 py-1.5 rounded bg-slate-850 border border-slate-800/80 hover:border-slate-700 transition-colors"
                  >
                    <span className="text-slate-400 text-[10px]">#{ev.id}</span>
                    <div className="flex items-center space-x-1 text-cyan-400 text-[11px] min-w-[70px]">
                      <Clock className="w-3 h-3" />
                      <span>{formatTimeUs(timeMicros)}</span>
                    </div>
                    <span className="text-slate-200 text-xs flex-1 truncate">{ev.description}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
