import React, { useState, useEffect } from 'react';
import {
  Play,
  Sliders,
  Activity,
  Layers,
  TrendingUp,
} from 'lucide-react';
import { api } from '../../lib/api';
import {
  MacConfig,
  MacSimResult,
  CsmaPersistence,
} from '../../types/mac';


type MacTab = 'pure_aloha' | 'slotted_aloha' | 'csma' | 'csma_cd';
type PersistenceType = 'one_persistent' | 'non_persistent' | 'p_persistent';

interface SweepPoint {
  g: number;
  throughput_frames: number;
  throughput_bits: number;
  collision_rate: number;
}

export const MacStudio: React.FC = () => {
  const [activeProto, setActiveProto] = useState<MacTab>('csma_cd');

  // Parameters
  const [numStations, setNumStations] = useState<number>(4);
  const [totalFrames, setTotalFrames] = useState<number>(10);
  const [frameDurationUs, setFrameDurationUs] = useState<number>(10000);
  const [propDelayUs, setPropDelayUs] = useState<number>(50);
  const [frameSizeBits, setFrameSizeBits] = useState<number>(8000);
  const [seed, setSeed] = useState<number>(12345);
  const [maxRetries, setMaxRetries] = useState<number>(16);
  const [offeredLoadG, setOfferedLoadG] = useState<number>(1.5);

  // CSMA Persistence configuration
  const [persistenceMode, setPersistenceMode] = useState<PersistenceType>('one_persistent');
  const [pProbability, setPProbability] = useState<number>(0.5);

  // Simulation Results
  const [simResult, setSimResult] = useState<MacSimResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Parameter sweep state
  const [sweepPoints, setSweepPoints] = useState<SweepPoint[]>([]);
  const [sweeping, setSweeping] = useState<boolean>(false);

  // Format persistence object for Tauri DTO
  const getPersistenceDto = (): CsmaPersistence => {
    if (persistenceMode === 'one_persistent') return 'one_persistent';
    if (persistenceMode === 'non_persistent') return 'non_persistent';
    return { p_persistent: { probability: pProbability } };
  };

  const runSimulation = async () => {
    setLoading(true);
    setErrorMsg(null);

    const config: MacConfig = {
      protocol: activeProto,
      persistence: getPersistenceDto(),
      num_stations: numStations,
      total_frames_to_send: totalFrames,
      frame_duration_us: frameDurationUs,
      prop_delay_us: propDelayUs,
      frame_size_bits: frameSizeBits,
      seed,
      max_retries: maxRetries,
      offered_load_g: offeredLoadG,
    };

    try {
      let res: MacSimResult;
      if (activeProto === 'pure_aloha') {
        res = await api.simulatePureAloha(config);
      } else if (activeProto === 'slotted_aloha') {
        res = await api.simulateSlottedAloha(config);
      } else if (activeProto === 'csma') {
        res = await api.simulateCsma(config);
      } else {
        res = await api.simulateCsmaCd(config);
      }
      setSimResult(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Parameter sweep over offered load G
  const runParameterSweep = async () => {
    setSweeping(true);
    const gValues = [0.2, 0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0];
    const results: SweepPoint[] = [];

    for (const g of gValues) {
      const config: MacConfig = {
        protocol: activeProto,
        persistence: getPersistenceDto(),
        num_stations: numStations,
        total_frames_to_send: totalFrames,
        frame_duration_us: frameDurationUs,
        prop_delay_us: propDelayUs,
        frame_size_bits: frameSizeBits,
        seed,
        max_retries: maxRetries,
        offered_load_g: g,
      };

      try {
        let res: MacSimResult;
        if (activeProto === 'pure_aloha') res = await api.simulatePureAloha(config);
        else if (activeProto === 'slotted_aloha') res = await api.simulateSlottedAloha(config);
        else if (activeProto === 'csma') res = await api.simulateCsma(config);
        else res = await api.simulateCsmaCd(config);

        results.push({
          g,
          throughput_frames: res.metrics.throughput_frames_per_sec,
          throughput_bits: res.metrics.throughput_bits_per_sec,
          collision_rate: res.metrics.collision_rate,
        });
      } catch (e) {
        console.error('Sweep point error', e);
      }
    }

    setSweepPoints(results);
    setSweeping(false);
  };

  useEffect(() => {
    runSimulation();
  }, [activeProto, persistenceMode]);

  return (
    <div className="space-y-6">
      {/* MAC Protocol Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-2 rounded-2xl border border-slate-800">
        <div className="flex space-x-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800/80">
          {(
            [
              { id: 'pure_aloha', label: 'Pure ALOHA' },
              { id: 'slotted_aloha', label: 'Slotted ALOHA' },
              { id: 'csma', label: 'CSMA' },
              { id: 'csma_cd', label: 'CSMA/CD (Ethernet)' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveProto(p.id)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center space-x-2 ${
                activeProto === p.id
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={runParameterSweep}
            disabled={sweeping}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-brand-300 border border-brand-700/40 transition flex items-center space-x-1.5"
            title="Measure throughput across offered load G range"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{sweeping ? 'Sweeping G...' : 'Parameter Sweep'}</span>
          </button>
          <button
            onClick={runSimulation}
            disabled={loading}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-300 text-white shadow-lg shadow-brand-600/20 transition flex items-center space-x-2"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>{loading ? 'Simulating...' : 'Run Simulation'}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs">
          <span className="font-semibold block">Simulation Error</span>
          <p className="mt-1 font-mono">{errorMsg}</p>
        </div>
      )}

      {/* Control Deck */}
      <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 space-y-4">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 tracking-wider">
          <Sliders className="w-4 h-4 text-brand-400" />
          <span>Shared Channel & Contention Parameters</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Stations</label>
            <input aria-label="Stations"
              type="number"
              min={1}
              max={16}
              value={numStations}
              onChange={(e) => setNumStations(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Total Frames</label>
            <input aria-label="Total Frames"
              type="number"
              min={1}
              max={50}
              value={totalFrames}
              onChange={(e) => setTotalFrames(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Frame Tx (µs)</label>
            <input aria-label="Frame Tx (µs)"
              type="number"
              min={100}
              step={1000}
              value={frameDurationUs}
              onChange={(e) => setFrameDurationUs(Math.max(100, parseInt(e.target.value) || 100))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Prop Delay τ (µs)</label>
            <input aria-label="Prop Delay τ (µs)"
              type="number"
              min={1}
              step={10}
              value={propDelayUs}
              onChange={(e) => setPropDelayUs(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Offered Load (G)</label>
            <input aria-label="Offered Load (G)"
              type="number"
              min={0.1}
              max={5.0}
              step={0.1}
              value={offeredLoadG}
              onChange={(e) => setOfferedLoadG(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Frame Bits</label>
            <input aria-label="Frame Bits"
              type="number"
              min={64}
              step={1000}
              value={frameSizeBits}
              onChange={(e) => setFrameSizeBits(Math.max(64, parseInt(e.target.value) || 64))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Max Retries</label>
            <input aria-label="Max Retries"
              type="number"
              min={1}
              max={32}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">RNG Seed</label>
            <input aria-label="RNG Seed"
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>
        </div>


        {/* Protocol-Specific options: CSMA Persistence */}
        {(activeProto === 'csma' || activeProto === 'csma_cd') && (
          <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-6 text-xs">
            <span className="text-slate-400 font-medium">CSMA Persistence Mode:</span>
            <div className="flex items-center space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer text-slate-300">
                <input
                  type="radio"
                  name="persistence"
                  value="one_persistent"
                  checked={persistenceMode === 'one_persistent'}
                  onChange={() => setPersistenceMode('one_persistent')}
                  className="accent-brand-500"
                />
                <span>1-Persistent (Continuously sense, transmit when idle)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer text-slate-300">
                <input
                  type="radio"
                  name="persistence"
                  value="non_persistent"
                  checked={persistenceMode === 'non_persistent'}
                  onChange={() => setPersistenceMode('non_persistent')}
                  className="accent-brand-500"
                />
                <span>Non-Persistent (Defer random backoff if busy)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer text-slate-300">
                <input
                  type="radio"
                  name="persistence"
                  value="p_persistent"
                  checked={persistenceMode === 'p_persistent'}
                  onChange={() => setPersistenceMode('p_persistent')}
                  className="accent-brand-500"
                />
                <span>p-Persistent (Slot-based probability p)</span>
              </label>
            </div>

            {persistenceMode === 'p_persistent' && (
              <div className="flex items-center space-x-3 ml-4">
                <label className="text-slate-400">p = {pProbability.toFixed(2)}</label>
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.05}
                  value={pProbability}
                  onChange={(e) => setPProbability(parseFloat(e.target.value))}
                  className="accent-brand-500 w-28 cursor-pointer"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Parameter Sweep Results if available */}
      {sweepPoints.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-slate-200 tracking-wider">
              Measured Throughput Curve (Offered Load G Sweep)
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {sweepPoints.map((pt) => (
              <div key={pt.g} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-center space-y-1">
                <div className="text-[10px] text-slate-400 font-mono">G = {pt.g.toFixed(1)}</div>
                <div className="text-sm font-bold font-mono text-emerald-300">
                  {pt.throughput_frames.toFixed(1)} <span className="text-[9px] text-slate-400 font-sans">fps</span>
                </div>
                <div className="text-[10px] text-rose-400 font-mono">
                  {(pt.collision_rate * 100).toFixed(0)}% col
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Measured Metrics Bar */}
      {simResult && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] text-slate-400 tracking-wider">Attempted Tx</span>
            <div className="text-lg font-bold font-mono text-brand-300">
              {simResult.metrics.attempted_transmissions}
            </div>
            <span className="text-[10px] text-slate-400">
              Success: {simResult.metrics.successful_transmissions}
            </span>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] text-slate-400 tracking-wider">Collisions</span>
            <div className="text-lg font-bold font-mono text-rose-300">
              {simResult.metrics.collisions}
            </div>
            <span className="text-[10px] text-slate-400">
              Rate: {(simResult.metrics.collision_rate * 100).toFixed(1)}%
            </span>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] text-slate-400 tracking-wider">Throughput (fps)</span>
            <div className="text-lg font-bold font-mono text-emerald-300">
              {simResult.metrics.throughput_frames_per_sec.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-400">Frames / sec</span>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] text-slate-400 tracking-wider">Throughput (bps)</span>
            <div className="text-lg font-bold font-mono text-sky-300">
              {(simResult.metrics.throughput_bits_per_sec / 1000).toFixed(1)} kbps
            </div>
            <span className="text-[10px] text-slate-400">Bits / sec</span>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] text-slate-400 tracking-wider">Channel Utilization</span>
            <div className="text-lg font-bold font-mono text-amber-300">
              {(simResult.metrics.channel_utilization * 100).toFixed(1)}%
            </div>
            <span className="text-[10px] text-slate-400">Busy / Total Time</span>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] text-slate-400 tracking-wider">Avg Backoff Delay</span>
            <div className="text-lg font-bold font-mono text-slate-200">
              {simResult.metrics.average_backoff_delay_us.toFixed(0)} µs
            </div>
            <span className="text-[10px] text-slate-400">BEB Delay</span>
          </div>
        </div>
      )}

      {/* Slotted ALOHA Slot Records or Timeline */}
      {simResult && simResult.slot_records.length > 0 ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-semibold text-slate-200 tracking-wider">
              Slotted ALOHA Slot-by-Slot Discrete Trace ({simResult.slot_records.length} Slots)
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-72 overflow-y-auto pr-1">
            {simResult.slot_records.slice(0, 48).map((slot) => {
              const isCol = slot.status.startsWith('Collision');
              const isSucc = slot.status.startsWith('Success');

              return (
                <div
                  key={slot.slot_index}
                  className={`p-3 rounded-xl border text-xs font-mono space-y-1 ${
                    isSucc
                      ? 'bg-emerald-950/40 border-emerald-700 text-emerald-200'
                      : isCol
                      ? 'bg-rose-950/40 border-rose-700 text-rose-200'
                      : 'bg-slate-950/60 border-slate-800 text-slate-500'
                  }`}
                >
                  <div className="flex justify-between items-center text-[10px] text-slate-400">
                    <span>Slot #{slot.slot_index}</span>
                    <span>{slot.start_time_us} µs</span>
                  </div>
                  <div className="font-bold text-xs">
                    {isSucc ? 'SUCCESS' : isCol ? 'COLLISION' : 'IDLE'}
                  </div>
                  <div className="text-[10px] truncate opacity-90">{slot.status}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Granular Event Log Trace */}
      {simResult && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-brand-400" />
              <span className="text-xs font-semibold text-slate-200 tracking-wider">
                Event trace ({simResult.events.length} Events Recorded)
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              Total Duration: {simResult.metrics.total_simulation_time_us.toLocaleString()} µs
            </div>
          </div>

          <div aria-label="Simulation Event Log" role="log" tabIndex={0} className="space-y-2 max-h-80 overflow-y-auto pr-2">
            {simResult.events.slice(0, 100).map((ev) => {
              const isCol = ev.event_type === 'collision_detected' || ev.event_type === 'jam_signal_sent';
              const isSucc = ev.event_type === 'transmission_success';
              const isAbort = ev.event_type === 'transmission_aborted';

              return (
                <div
                  key={ev.step_index}
                  className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                    isCol
                      ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
                      : isSucc
                      ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-200'
                      : isAbort
                      ? 'bg-amber-950/30 border-amber-800/80 text-amber-200'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <span className="font-mono text-[10px] text-slate-500">#{ev.step_index}</span>
                    <span className="font-mono text-[11px] font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      {ev.timestamp_us.toLocaleString()} µs
                    </span>
                    <span className="font-bold text-[10px] tracking-wider px-2 py-0.5 rounded bg-black/40 border border-white/10">
                      {ev.event_type.replace('_', ' ')}
                    </span>
                    <span className="font-medium text-xs">{ev.description}</span>
                  </div>

                  <span className="font-mono text-[10px] text-slate-400">
                    Channel: {ev.channel_state}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
