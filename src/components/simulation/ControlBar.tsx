import { Play, Pause, StepForward, FastForward, RotateCcw, Send, Activity } from 'lucide-react';
import { SimulationStatus, SimulationMetrics } from '../../types/simulation';

interface ControlBarProps {
  status: SimulationStatus;
  onStep: () => void;
  onRunBurst: () => void;
  onRunAll: () => void;
  onPause: () => void;
  onReset: () => void;
  onSendDemoPacket: () => void;
  eventsCount: number;
  pendingCount?: number;
  metrics?: SimulationMetrics;
}

export const ControlBar = ({
  status,
  onStep,
  onRunBurst,
  onRunAll,
  onPause,
  onReset,
  onSendDemoPacket,
  eventsCount,
  pendingCount = 0,
  metrics,
}: ControlBarProps) => {
  const isRunning = status === 'running';
  const totalDropped =
    (metrics?.packets_dropped_overflow ?? 0) +
    (metrics?.packets_dropped_loss ?? 0) +
    (metrics?.packets_dropped_error ?? 0) +
    (metrics?.packets_dropped_link_down ?? 0);

  return (
    <div className="min-h-12 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-2 sm:px-4 py-1.5 select-none z-10">
      {/* Playback Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {isRunning ? (
          <button
            onClick={onPause}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors shadow-sm cursor-pointer"
          >
            <Pause className="w-3.5 h-3.5 fill-current" />
            <span>Pause</span>
          </button>
        ) : (
          <button
            onClick={onRunBurst}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white transition-colors shadow-sm cursor-pointer"
            title="Advance 50ms virtual simulation time"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run 50ms</span>
          </button>
        )}

        <button
          onClick={onRunAll}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
          title="Run until event queue is empty"
        >
          <FastForward className="w-3.5 h-3.5" />
          <span>Run All</span>
        </button>

        <button
          onClick={onStep}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
          title="Step Next Discrete Event"
        >
          <StepForward className="w-3.5 h-3.5" />
          <span>Step Event</span>
        </button>

        <button
          onClick={onReset}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
          title="Reset Simulation Engine"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>

        <div className="hidden lg:block h-4 w-px bg-slate-800 mx-1" />

        <button
          onClick={onSendDemoPacket}
          className="flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white transition-colors shadow-sm cursor-pointer"
          title="Inject packet into topology"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Inject Packet</span>
        </button>
      </div>

      {/* Authoritative Metrics & Stats */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        <div className="flex items-center space-x-1.5">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span>Delivered:</span>
          <span className="font-mono text-emerald-400 font-semibold">
            {metrics?.packets_delivered ?? 0}
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          <span>Dropped:</span>
          <span
            className={`font-mono font-semibold ${
              totalDropped > 0 ? 'text-rose-400' : 'text-slate-400'
            }`}
          >
            {totalDropped}
          </span>
        </div>

        <div className="h-3 w-px bg-slate-800" />

        <div>
          <span>Queue: </span>
          <span className="font-mono text-amber-300 font-semibold">{pendingCount}</span>
          <span className="text-slate-500"> / </span>
          <span className="font-mono text-cyan-300 font-semibold">{eventsCount} done</span>
        </div>

        <div className="h-3 w-px bg-slate-800" />

        <div className="flex items-center space-x-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'running'
                ? 'bg-brand-400 animate-ping'
                : status === 'paused'
                ? 'bg-amber-400'
                : 'bg-emerald-400'
            }`}
          />
          <span className="uppercase text-[10px] font-bold text-slate-300">{status}</span>
        </div>
      </div>
    </div>
  );
};
