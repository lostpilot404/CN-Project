import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Play,
  RotateCcw,
  SkipForward,
  SkipBack,
  Sliders,
  AlertTriangle,
  Layers,
  TrendingUp,
  Radio,
  FileCheck,
} from 'lucide-react';
import { api } from '../../lib/api';
import {
  FlowControlConfig,
  FlowControlProtocol,
  FlowControlSimResult,
  FlowControlEvent,
} from '../../types/flowControl';


type SubMode = 'sliding_window' | 'go_back_n' | 'selective_repeat' | 'comparison';

export const FlowControlStudio: React.FC = () => {
  const [subMode, setSubMode] = useState<SubMode>('go_back_n');

  // Configuration parameters
  const [windowSize, setWindowSize] = useState<number>(4);
  const [sequenceSpace, setSequenceSpace] = useState<number>(8);
  const [totalFrames, setTotalFrames] = useState<number>(8);
  const [frameTxUs, setFrameTxUs] = useState<number>(1000);
  const [propDelayUs, setPropDelayUs] = useState<number>(2000);
  const [ackTxUs, setAckTxUs] = useState<number>(100);
  const [timeoutUs, setTimeoutUs] = useState<number>(10000);
  const [seed, setSeed] = useState<number>(42);
  const [droppedFramesStr, setDroppedFramesStr] = useState<string>('2');
  const [droppedAcksStr, setDroppedAcksStr] = useState<string>('');

  // Simulation outputs
  const [simResult, setSimResult] = useState<FlowControlSimResult | null>(null);
  const [comparisonGbnResult, setComparisonGbnResult] = useState<FlowControlSimResult | null>(null);
  const [comparisonSrResult, setComparisonSrResult] = useState<FlowControlSimResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stepping / Playback state
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Parse dropped frames and acks
  const droppedFrames = useMemo(() => {
    return droppedFramesStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !isNaN(Number(s)))
      .map(Number);
  }, [droppedFramesStr]);

  const droppedAcks = useMemo(() => {
    return droppedAcksStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !isNaN(Number(s)))
      .map(Number);
  }, [droppedAcksStr]);

  // Validation feedback
  const validationError = useMemo(() => {
    if (windowSize <= 0) return 'Window size must be at least 1';
    if (sequenceSpace <= 0) return 'Sequence space must be greater than 0';
    if (subMode === 'sliding_window' || subMode === 'go_back_n') {
      if (sequenceSpace < windowSize + 1) {
        return `Go-Back-N sequence space (${sequenceSpace}) must be >= window size + 1 (${windowSize + 1})`;
      }
    }
    if (subMode === 'selective_repeat' || subMode === 'comparison') {
      if (sequenceSpace < 2 * windowSize) {
        return `Selective Repeat sequence space (${sequenceSpace}) must be >= 2 × window size (${2 * windowSize})`;
      }
    }
    return null;
  }, [subMode, windowSize, sequenceSpace]);

  // Execute simulation
  const runSimulation = async () => {
    if (validationError) return;
    setLoading(true);
    setErrorMsg(null);
    setIsPlaying(false);

    try {
      if (subMode === 'comparison') {
        const baseConfig: FlowControlConfig = {
          protocol: 'go_back_n',
          window_size: windowSize,
          sequence_space: sequenceSpace,
          total_frames_to_send: totalFrames,
          frame_tx_time_us: frameTxUs,
          prop_delay_us: propDelayUs,
          ack_tx_time_us: ackTxUs,
          timeout_us: timeoutUs,
          seed,
          dropped_frame_indices: droppedFrames,
          corrupted_frame_indices: [],
          dropped_ack_seqs: droppedAcks,
        };

        const gbnRes = await api.simulateGoBackN(baseConfig);
        const srRes = await api.simulateSelectiveRepeat({
          ...baseConfig,
          protocol: 'selective_repeat',
        });

        setComparisonGbnResult(gbnRes);
        setComparisonSrResult(srRes);
        setSimResult(gbnRes);
        setCurrentStep(0);
      } else {
        const config: FlowControlConfig = {
          protocol: subMode as FlowControlProtocol,
          window_size: windowSize,
          sequence_space: sequenceSpace,
          total_frames_to_send: totalFrames,
          frame_tx_time_us: frameTxUs,
          prop_delay_us: propDelayUs,
          ack_tx_time_us: ackTxUs,
          timeout_us: timeoutUs,
          seed,
          dropped_frame_indices: droppedFrames,
          corrupted_frame_indices: [],
          dropped_ack_seqs: droppedAcks,
        };

        let res: FlowControlSimResult;
        if (subMode === 'sliding_window') {
          res = await api.simulateSlidingWindow(config);
        } else if (subMode === 'go_back_n') {
          res = await api.simulateGoBackN(config);
        } else {
          res = await api.simulateSelectiveRepeat(config);
        }

        setSimResult(res);
        setCurrentStep(0);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSimulation();
  }, [subMode]);

  // Stepping playback
  useEffect(() => {
    if (!isPlaying || !simResult || simResult.events.length === 0) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }

    playTimerRef.current = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= simResult.events.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 400);

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, simResult]);

  const activeEvent: FlowControlEvent | null = useMemo(() => {
    if (!simResult || simResult.events.length === 0) return null;
    return simResult.events[Math.min(currentStep, simResult.events.length - 1)];
  }, [simResult, currentStep]);

  return (
    <div className="space-y-6">
      {/* Sub-mode selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-2 rounded-2xl border border-slate-800">
        <div className="flex space-x-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800/80">
          {(
            [
              { id: 'sliding_window', label: 'Sliding Window (Base)' },
              { id: 'go_back_n', label: 'Go-Back-N ARQ' },
              { id: 'selective_repeat', label: 'Selective Repeat ARQ' },
              { id: 'comparison', label: 'GBN vs SR Comparison' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSubMode(m.id);
                // Ensure valid sequence space for SR if switching
                if ((m.id === 'selective_repeat' || m.id === 'comparison') && sequenceSpace < 2 * windowSize) {
                  setSequenceSpace(2 * windowSize);
                }
              }}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center space-x-2 ${
                subMode === m.id
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={runSimulation}
          disabled={loading || !!validationError}
          className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow-lg shadow-emerald-600/20 transition flex items-center space-x-2"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>{loading ? 'Simulating...' : 'Run Simulation'}</span>
        </button>
      </div>

      {/* Validation or Error Message */}
      {validationError && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 flex items-center space-x-3 text-xs">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <div>
            <span className="font-semibold block uppercase tracking-wider">Sequence Space Invariant Violation</span>
            <p className="mt-0.5">{validationError}</p>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 flex items-center space-x-3 text-xs">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <div>
            <span className="font-semibold block uppercase tracking-wider">Simulation Error</span>
            <p className="mt-0.5 font-mono">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Parameter Control Deck */}
      <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5">
        <div className="flex items-center space-x-2 mb-4 text-xs font-semibold text-slate-300 uppercase tracking-wider">
          <Sliders className="w-4 h-4 text-indigo-400" />
          <span>Protocol Configuration & Virtual Timing</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Window Size (N)</label>
            <input
              type="number"
              min={1}
              max={16}
              value={windowSize}
              onChange={(e) => setWindowSize(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Seq Space (M)</label>
            <input
              type="number"
              min={2}
              max={64}
              value={sequenceSpace}
              onChange={(e) => setSequenceSpace(Math.max(2, parseInt(e.target.value) || 2))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Total Frames</label>
            <input
              type="number"
              min={1}
              max={32}
              value={totalFrames}
              onChange={(e) => setTotalFrames(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Frame Tx (µs)</label>
            <input
              type="number"
              min={100}
              step={500}
              value={frameTxUs}
              onChange={(e) => setFrameTxUs(Math.max(100, parseInt(e.target.value) || 100))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Prop Delay (µs)</label>
            <input
              type="number"
              min={100}
              step={500}
              value={propDelayUs}
              onChange={(e) => setPropDelayUs(Math.max(100, parseInt(e.target.value) || 100))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">ACK Tx (µs)</label>
            <input
              type="number"
              min={10}
              step={50}
              value={ackTxUs}
              onChange={(e) => setAckTxUs(Math.max(10, parseInt(e.target.value) || 10))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Timeout (µs)</label>
            <input
              type="number"
              min={1000}
              step={1000}
              value={timeoutUs}
              onChange={(e) => setTimeoutUs(Math.max(1000, parseInt(e.target.value) || 1000))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>

        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-800/80">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Drop Frames (0-based indices, comma-separated)</label>
            <input
              type="text"
              value={droppedFramesStr}
              placeholder="e.g. 2, 5"
              onChange={(e) => setDroppedFramesStr(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-rose-300 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Drop ACKs (seq numbers, comma-separated)</label>
            <input
              type="text"
              value={droppedAcksStr}
              placeholder="e.g. 1"
              onChange={(e) => setDroppedAcksStr(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-amber-300 font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">RNG Seed (Authoritative Determinism)</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Comparison View or Normal Studio View */}
      {subMode === 'comparison' && comparisonGbnResult && comparisonSrResult ? (
        <div className="space-y-6">
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center space-x-2 mb-4">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                Measured Protocol Metrics: Go-Back-N vs Selective Repeat
              </h3>
            </div>
            <p className="text-xs text-slate-400 mb-6">
              Both protocols simulated under identical conditions: {totalFrames} frames, window size {windowSize}, sequence space {sequenceSpace}, dropped frames [{droppedFrames.join(', ')}], and seed {seed}. All values are measured by the authoritative Python discrete-event state machines. No winner or ranking is hardcoded.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Metric</th>
                    <th className="py-3 px-4 text-indigo-300 font-bold">Go-Back-N (GBN)</th>
                    <th className="py-3 px-4 text-emerald-300 font-bold">Selective Repeat (SR)</th>
                    <th className="py-3 px-4 text-slate-400">Measured Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  <tr>
                    <td className="py-2.5 px-4 font-sans text-slate-300">Total Frames Sent (including re-tx)</td>
                    <td className="py-2.5 px-4 text-indigo-200">{comparisonGbnResult.metrics.total_frames_sent}</td>
                    <td className="py-2.5 px-4 text-emerald-200">{comparisonSrResult.metrics.total_frames_sent}</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {comparisonSrResult.metrics.total_frames_sent - comparisonGbnResult.metrics.total_frames_sent > 0
                        ? `+${comparisonSrResult.metrics.total_frames_sent - comparisonGbnResult.metrics.total_frames_sent}`
                        : `${comparisonSrResult.metrics.total_frames_sent - comparisonGbnResult.metrics.total_frames_sent}`}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-sans text-slate-300">Retransmissions</td>
                    <td className="py-2.5 px-4 text-indigo-200">{comparisonGbnResult.metrics.retransmissions}</td>
                    <td className="py-2.5 px-4 text-emerald-200">{comparisonSrResult.metrics.retransmissions}</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {comparisonSrResult.metrics.retransmissions - comparisonGbnResult.metrics.retransmissions}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-sans text-slate-300">ACK Count</td>
                    <td className="py-2.5 px-4 text-indigo-200">{comparisonGbnResult.metrics.ack_count}</td>
                    <td className="py-2.5 px-4 text-emerald-200">{comparisonSrResult.metrics.ack_count}</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {comparisonSrResult.metrics.ack_count - comparisonGbnResult.metrics.ack_count}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-sans text-slate-300">Total Completion Time (µs)</td>
                    <td className="py-2.5 px-4 text-indigo-200">{comparisonGbnResult.metrics.completion_time_us}</td>
                    <td className="py-2.5 px-4 text-emerald-200">{comparisonSrResult.metrics.completion_time_us}</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {comparisonSrResult.metrics.completion_time_us - comparisonGbnResult.metrics.completion_time_us} µs
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-sans text-slate-300">Channel Utilization</td>
                    <td className="py-2.5 px-4 text-indigo-200">{(comparisonGbnResult.metrics.utilization * 100).toFixed(2)}%</td>
                    <td className="py-2.5 px-4 text-emerald-200">{(comparisonSrResult.metrics.utilization * 100).toFixed(2)}%</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {((comparisonSrResult.metrics.utilization - comparisonGbnResult.metrics.utilization) * 100).toFixed(2)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-sans text-slate-300">Protocol Overhead</td>
                    <td className="py-2.5 px-4 text-indigo-200">{(comparisonGbnResult.metrics.protocol_overhead * 100).toFixed(2)}%</td>
                    <td className="py-2.5 px-4 text-emerald-200">{(comparisonSrResult.metrics.protocol_overhead * 100).toFixed(2)}%</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {((comparisonSrResult.metrics.protocol_overhead - comparisonGbnResult.metrics.protocol_overhead) * 100).toFixed(2)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-sans text-slate-300">Max Receiver Buffer Occupancy</td>
                    <td className="py-2.5 px-4 text-indigo-200">{comparisonGbnResult.metrics.receiver_buffer_occupancy_max} frames (rejects out-of-order)</td>
                    <td className="py-2.5 px-4 text-emerald-200">{comparisonSrResult.metrics.receiver_buffer_occupancy_max} frames (buffers out-of-order)</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      +{comparisonSrResult.metrics.receiver_buffer_occupancy_max - comparisonGbnResult.metrics.receiver_buffer_occupancy_max} frames
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : simResult ? (
        <div className="space-y-6">
          {/* Step Timeline Controls */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentStep(0)}
                disabled={currentStep === 0}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
                title="First Step"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentStep((p) => Math.max(0, p - 1))}
                disabled={currentStep === 0}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs text-slate-200"
              >
                Prev
              </button>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 ${
                  isPlaying ? 'bg-amber-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                }`}
              >
                <span>{isPlaying ? 'Pause' : 'Auto Play'}</span>
              </button>
              <button
                onClick={() => setCurrentStep((p) => Math.min(simResult.events.length - 1, p + 1))}
                disabled={currentStep >= simResult.events.length - 1}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs text-slate-200"
              >
                Next
              </button>
              <button
                onClick={() => setCurrentStep(simResult.events.length - 1)}
                disabled={currentStep >= simResult.events.length - 1}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
                title="Last Step"
              >
                <SkipForward className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  setCurrentStep(0);
                  setIsPlaying(false);
                }}
                className="p-2 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-slate-400"
                title="Reset Scrubber"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center space-x-4 flex-1 max-w-md mx-4">
              <span className="text-xs text-slate-400 whitespace-nowrap font-mono">
                Step {currentStep + 1} / {simResult.events.length}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, simResult.events.length - 1)}
                value={currentStep}
                onChange={(e) => setCurrentStep(parseInt(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            <div className="font-mono text-xs text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-3 py-1.5 rounded-xl">
              Sim Time: {activeEvent?.timestamp_us.toLocaleString()} µs
            </div>
          </div>

          {/* Active Step Description */}
          {activeEvent && (
            <div className="p-4 rounded-xl bg-slate-900 border border-indigo-800/40 text-slate-200 flex items-start space-x-3 text-xs">
              <Radio className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-mono text-[10px] uppercase font-semibold border border-indigo-800/60">
                    {activeEvent.event_type.replace('_', ' ')}
                  </span>
                  <span className="text-slate-400 font-mono">
                    Seq: {activeEvent.seq_num} {activeEvent.ack_seq !== null ? `| ACK: ${activeEvent.ack_seq}` : ''}
                  </span>
                </div>
                <p className="text-slate-200 font-medium">{activeEvent.description}</p>
              </div>
            </div>
          )}

          {/* Dynamic Window Track Visualization */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sender Window Track */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Sender Window (Size: {windowSize})
                  </span>
                </div>
                {activeEvent && (
                  <span className="text-xs font-mono text-indigo-300">
                    Base: {activeEvent.sender_window.send_base} | NextSeq: {activeEvent.sender_window.next_seq_num}
                  </span>
                )}
              </div>

              {/* Circular Sequence Space Track */}
              <div className="space-y-2">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Sequence Number Space [0 .. {sequenceSpace - 1}]
                </span>
                <div className="grid grid-cols-8 gap-2">
                  {Array.from({ length: sequenceSpace }, (_, seq) => {
                    const isInWindow = activeEvent?.sender_window.active_window_seqs.includes(seq);
                    const isBase = activeEvent?.sender_window.send_base === seq;
                    const isNext = activeEvent?.sender_window.next_seq_num === seq;

                    return (
                      <div
                        key={seq}
                        className={`p-2.5 rounded-xl text-center border font-mono text-xs transition ${
                          isInWindow
                            ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-900/30'
                            : 'bg-slate-950/60 border-slate-800 text-slate-500'
                        }`}
                      >
                        <div className="font-bold text-sm">{seq}</div>
                        <div className="text-[9px] uppercase tracking-tighter mt-1">
                          {isBase ? 'BASE' : isNext ? 'NEXT' : isInWindow ? 'WIN' : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Receiver Window & Buffer Track */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileCheck className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Receiver State (Delivered: {activeEvent?.receiver_window.delivered_count || 0})
                  </span>
                </div>
                {activeEvent && (
                  <span className="text-xs font-mono text-emerald-300">
                    RcvBase: {activeEvent.receiver_window.rcv_base}
                  </span>
                )}
              </div>

              {/* Receiver Slots */}
              <div className="space-y-2">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Receiver Sequence Window & Buffering
                </span>
                <div className="grid grid-cols-8 gap-2">
                  {Array.from({ length: sequenceSpace }, (_, seq) => {
                    const isRcvBase = activeEvent?.receiver_window.rcv_base === seq;
                    const isBuffered = activeEvent?.receiver_window.buffered_seqs.includes(seq);
                    const isInRcvWin = activeEvent?.receiver_window.active_window_seqs.includes(seq);

                    return (
                      <div
                        key={seq}
                        className={`p-2.5 rounded-xl text-center border font-mono text-xs transition ${
                          isBuffered
                            ? 'bg-amber-950/80 border-amber-500 text-amber-200'
                            : isRcvBase
                            ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-900/30'
                            : isInRcvWin
                            ? 'bg-slate-900 border-slate-700 text-slate-300'
                            : 'bg-slate-950/60 border-slate-800 text-slate-600'
                        }`}
                      >
                        <div className="font-bold text-sm">{seq}</div>
                        <div className="text-[9px] uppercase tracking-tighter mt-1">
                          {isBuffered ? 'BUFFER' : isRcvBase ? 'EXPECT' : isInRcvWin ? 'WIN' : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Frame List State */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4 block">
              Individual Frame Progress & Status
            </span>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              {simResult.frames.map((fr) => {
                const isDelivered = fr.status === 'delivered';
                const isDropped = droppedFrames.includes(fr.frame_index);

                return (
                  <div
                    key={fr.frame_index}
                    className={`p-3 rounded-xl border text-xs font-mono space-y-1 ${
                      isDelivered
                        ? 'bg-emerald-950/30 border-emerald-800 text-emerald-200'
                        : isDropped
                        ? 'bg-rose-950/30 border-rose-800 text-rose-200'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200">F[{fr.frame_index}]</span>
                      <span className="text-[10px] text-slate-400">Seq {fr.seq_num}</span>
                    </div>
                    <div className="text-[10px] uppercase font-semibold">
                      {isDelivered ? 'DELIVERED' : isDropped ? 'DROPPED/RE-TX' : fr.status}
                    </div>
                    <div className="text-[9px] text-slate-500">
                      Tx: {fr.tx_count} {fr.is_retransmission ? '(Re-tx)' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Measured Metrics Card Deck */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Frames Sent</span>
              <div className="text-lg font-bold font-mono text-indigo-300">
                {simResult.metrics.total_frames_sent}
              </div>
              <span className="text-[10px] text-slate-500">Original: {simResult.metrics.original_frames}</span>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Retransmissions</span>
              <div className="text-lg font-bold font-mono text-amber-300">
                {simResult.metrics.retransmissions}
              </div>
              <span className="text-[10px] text-slate-500">Dropped: {simResult.metrics.dropped_or_corrupted_frames}</span>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">ACK Count</span>
              <div className="text-lg font-bold font-mono text-emerald-300">
                {simResult.metrics.ack_count}
              </div>
              <span className="text-[10px] text-slate-500">Completed: {simResult.metrics.completed_frames}</span>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Completion Time</span>
              <div className="text-lg font-bold font-mono text-slate-200">
                {simResult.metrics.completion_time_us.toLocaleString()} µs
              </div>
              <span className="text-[10px] text-slate-500">Discrete-Event</span>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Utilization</span>
              <div className="text-lg font-bold font-mono text-sky-300">
                {(simResult.metrics.utilization * 100).toFixed(2)}%
              </div>
              <span className="text-[10px] text-slate-500">Channel Busy Ratio</span>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Overhead</span>
              <div className="text-lg font-bold font-mono text-slate-300">
                {(simResult.metrics.protocol_overhead * 100).toFixed(2)}%
              </div>
              <span className="text-[10px] text-slate-500">
                Max RcvBuf: {simResult.metrics.receiver_buffer_occupancy_max}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
