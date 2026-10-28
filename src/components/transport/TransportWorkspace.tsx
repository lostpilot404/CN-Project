import React, { useState, useEffect } from 'react';
import {
  ArrowLeftRight,
  Activity,
  BarChart3,
  Play,
  RotateCcw,
  StepForward,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Zap,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Project } from '../../types/project';
import {
  TransportConfig,
  TransportSimResult,
  TransportEvent,
} from '../../types/transport';
import { CwndPoint } from '../../types/congestion';

interface TransportWorkspaceProps {
  project?: Project | null;
}

type SubStudio = 'tcp' | 'udp' | 'congestion' | 'comparison';

export const TransportWorkspace: React.FC<TransportWorkspaceProps> = ({ project }) => {
  const [activeStudio, setActiveStudio] = useState<SubStudio>('tcp');

  // TCP Configuration State
  const [srcNode, setSrcNode] = useState<string>('');
  const [dstNode, setDstNode] = useState<string>('');
  const [srcPort, setSrcPort] = useState<number>(49152);
  const [dstPort, setDstPort] = useState<number>(80);
  const [payloadBytes, setPayloadBytes] = useState<number>(4000);
  const [mssBytes, setMssBytes] = useState<number>(1000);
  const [initialSeq, setInitialSeq] = useState<number>(1000);
  const [initialCwnd, setInitialCwnd] = useState<number>(1.0);
  const [initialSsthresh, setInitialSsthresh] = useState<number>(16.0);
  const [initialRtoUs, setInitialRtoUs] = useState<number>(100000);
  const [rwndBytes, setRwndBytes] = useState<number>(32000);
  const [droppedSegsInput, setDroppedSegsInput] = useState<string>('');
  const [seed, setSeed] = useState<number>(42);

  // Simulation execution results
  const [tcpResult, setTcpResult] = useState<TransportSimResult | null>(null);
  const [udpResult, setUdpResult] = useState<TransportSimResult | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step-by-step playback state
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);

  // Sync available node options from project
  useEffect(() => {
    if (project?.nodes && project.nodes.length >= 2) {
      setSrcNode(project.nodes[0].id);
      setDstNode(project.nodes[project.nodes.length - 1].id);
    }
  }, [project]);

  const parseDroppedSegments = (input: string): number[] => {
    return input
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !isNaN(Number(s)))
      .map(Number);
  };

  const runTcpSimulation = async () => {
    if (!srcNode || !dstNode) {
      setErrorMsg('Add at least two devices to the topology before running a simulation.');
      return;
    }
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const config: TransportConfig = {
        protocol: 'tcp',
        source_node_id: srcNode,
        destination_node_id: dstNode,
        source_port: srcPort,
        destination_port: dstPort,
        payload_bytes: payloadBytes,
        segment_size_bytes: mssBytes,
        initial_sequence_number: initialSeq,
        initial_cwnd_mss: initialCwnd,
        initial_ssthresh_mss: initialSsthresh,
        initial_rto_us: initialRtoUs,
        receive_window_bytes: rwndBytes,
        seed,
        dropped_segments: parseDroppedSegments(droppedSegsInput),
        maximum_retries: 5,
      };
      const res = await api.simulateTcp(config);
      setTcpResult(res);
      setCurrentStepIndex(res.events.length);
    } catch (err) {
      // A failed run must not leave the previous successful result on screen as if it
      // belonged to the current parameters.
      setTcpResult(null);
      setCurrentStepIndex(0);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const runUdpSimulation = async () => {
    if (!srcNode || !dstNode) {
      setErrorMsg('Add at least two devices to the topology before running a simulation.');
      return;
    }
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const config: TransportConfig = {
        protocol: 'udp',
        source_node_id: srcNode,
        destination_node_id: dstNode,
        source_port: srcPort,
        destination_port: dstPort,
        payload_bytes: payloadBytes,
        segment_size_bytes: mssBytes,
        initial_sequence_number: initialSeq,
        initial_cwnd_mss: 0,
        initial_ssthresh_mss: 0,
        initial_rto_us: 0,
        receive_window_bytes: 0,
        seed,
        dropped_segments: parseDroppedSegments(droppedSegsInput),
        maximum_retries: 0,
      };
      const res = await api.simulateUdp(config);
      setUdpResult(res);
    } catch (err) {
      setUdpResult(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const runBothSimulations = async () => {
    await runTcpSimulation();
    await runUdpSimulation();
  };

  const visibleEvents: TransportEvent[] = tcpResult
    ? tcpResult.events.slice(0, currentStepIndex)
    : [];

  return (
    <div
      data-testid="transport-workspace"
      className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden select-none"
    >
      {/* Workspace Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 px-4 sm:px-6 py-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-slate-100">
              Transport Layer
            </h2>
            <p className="text-[11px] text-slate-400">
              TCP/UDP end-to-end simulation with Jacobson/Karn RTT estimation and Reno congestion control
            </p>
          </div>
        </div>
      </header>

      {/* Sub-studio tabs */}
      <div className="border-b border-slate-800/80 px-4 sm:px-6 py-2.5">
        <div className="flex flex-wrap bg-slate-950 border border-slate-800 rounded-lg p-1 space-x-1 w-fit max-w-full">
          <button
            data-testid="tab-tcp-studio"
            onClick={() => setActiveStudio('tcp')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              activeStudio === 'tcp'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>TCP Studio</span>
          </button>

          <button
            data-testid="tab-udp-studio"
            onClick={() => setActiveStudio('udp')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              activeStudio === 'udp'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>UDP Studio</span>
          </button>

          <button
            data-testid="tab-congestion-studio"
            onClick={() => setActiveStudio('congestion')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              activeStudio === 'congestion'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>Congestion Control</span>
          </button>

          <button
            data-testid="tab-comparison-studio"
            onClick={() => {
              setActiveStudio('comparison');
              if (!tcpResult || !udpResult) {
                runBothSimulations();
              }
            }}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              activeStudio === 'comparison'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>TCP vs UDP Comparison</span>
          </button>
        </div>
      </div>

      {/* Main Studio Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Config Panel */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/30 p-4 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-300">
              Simulation parameters
            </span>
            <span className="text-[10px] text-slate-400 font-mono">L4 Endpoints</span>
          </div>

          {/* Endpoints */}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Source Endpoint (Host A)
              </label>
              <select aria-label="Source Endpoint (Host A)"
                data-testid="input-src-node"
                value={srcNode}
                onChange={(e) => setSrcNode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-brand-500"
              >
                {(project?.nodes ?? []).length > 0 ? (
                  (project?.nodes ?? []).map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} ({n.id})
                    </option>
                  ))
                ) : (
                  <option value={srcNode}>{srcNode}</option>
                )}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Destination Endpoint (Host B)
              </label>
              <select aria-label="Destination Endpoint (Host B)"
                data-testid="input-dst-node"
                value={dstNode}
                onChange={(e) => setDstNode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-brand-500"
              >
                {(project?.nodes ?? []).length > 0 ? (
                  (project?.nodes ?? []).map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} ({n.id})
                    </option>
                  ))
                ) : (
                  <option value={dstNode}>{dstNode}</option>
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">
                  Src Port
                </label>
                <input aria-label="Src Port"
                  type="number"
                  value={srcPort}
                  onChange={(e) => setSrcPort(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">
                  Dst Port
                </label>
                <input aria-label="Dst Port"
                  type="number"
                  value={dstPort}
                  onChange={(e) => setDstPort(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Transfer & Window Config */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Payload Size (Bytes)
              </label>
              <input aria-label="Payload Size (Bytes)"
                data-testid="input-payload-bytes"
                type="number"
                value={payloadBytes}
                onChange={(e) => setPayloadBytes(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">
                  MSS (Bytes)
                </label>
                <input aria-label="MSS (Bytes)"
                  type="number"
                  value={mssBytes}
                  onChange={(e) => setMssBytes(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">
                  Initial Seq
                </label>
                <input aria-label="Initial Seq"
                  type="number"
                  value={initialSeq}
                  onChange={(e) => setInitialSeq(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>
            </div>

            {activeStudio !== 'udp' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">
                      Initial cwnd (MSS)
                    </label>
                    <input aria-label="Initial cwnd (MSS)"
                      type="number"
                      step="0.5"
                      value={initialCwnd}
                      onChange={(e) => setInitialCwnd(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">
                      ssthresh (MSS)
                    </label>
                    <input aria-label="ssthresh (MSS)"
                      type="number"
                      step="1"
                      value={initialSsthresh}
                      onChange={(e) => setInitialSsthresh(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">
                    Receive Window (rwnd Bytes)
                  </label>
                  <input aria-label="Receive Window (rwnd Bytes)"
                    type="number"
                    value={rwndBytes}
                    onChange={(e) => setRwndBytes(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">
                      Initial RTO (µs)
                    </label>
                    <input aria-label="Initial RTO (µs)"
                      type="number"
                      step="10000"
                      value={initialRtoUs}
                      onChange={(e) => setInitialRtoUs(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">
                      Seed
                    </label>
                    <input aria-label="Seed"
                      type="number"
                      value={seed}
                      onChange={(e) => setSeed(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Controlled Drops (0-indexed)
              </label>
              <input aria-label="Controlled Drops (0-indexed)"
                data-testid="input-dropped-segments"
                type="text"
                placeholder="e.g. 0, 2 (or empty)"
                value={droppedSegsInput}
                onChange={(e) => setDroppedSegsInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200"
              />
              <span className="text-[10px] text-slate-400">Injects loss to trigger timeout/fast-retransmit</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-800 space-y-2">
            {activeStudio === 'tcp' || activeStudio === 'congestion' ? (
              <button
                data-testid="btn-simulate-tcp"
                onClick={runTcpSimulation}
                disabled={isRunning}
                className="w-full py-2 px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs flex items-center justify-center space-x-2 transition-all shadow-md disabled:bg-slate-700 disabled:text-slate-300"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>{isRunning ? 'Simulating...' : 'Simulate TCP Transfer'}</span>
              </button>
            ) : activeStudio === 'udp' ? (
              <button
                data-testid="btn-simulate-udp"
                onClick={runUdpSimulation}
                disabled={isRunning}
                className="w-full py-2 px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs flex items-center justify-center space-x-2 transition-all shadow-md disabled:bg-slate-700 disabled:text-slate-300"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>{isRunning ? 'Transmitting...' : 'Simulate UDP Datagrams'}</span>
              </button>
            ) : (
              <button
                data-testid="btn-simulate-both"
                onClick={runBothSimulations}
                disabled={isRunning}
                className="w-full py-2 px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs flex items-center justify-center space-x-2 transition-all shadow-md disabled:bg-slate-700 disabled:text-slate-300"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Run TCP vs UDP Comparison</span>
              </button>
            )}

            {activeStudio === 'tcp' && tcpResult && (
              <div className="flex space-x-1 pt-1">
                <button
                  data-testid="btn-step-forward"
                  onClick={() => setCurrentStepIndex((idx) => Math.min(idx + 1, tcpResult.events.length))}
                  disabled={currentStepIndex >= tcpResult.events.length}
                  className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded flex items-center justify-center space-x-1 disabled:opacity-40"
                >
                  <StepForward className="w-3 h-3" />
                  <span>Step</span>
                </button>
                <button
                  data-testid="btn-reset-steps"
                  onClick={() => setCurrentStepIndex(tcpResult.events.length)}
                  className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded flex items-center justify-center"
                  title="Show All Steps"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}
        </aside>

        {/* Center / Right Content Panel */}
        <section className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6">
          {/* Active Studio Rendering */}
          {activeStudio === 'tcp' && (
            <TcpStudioView
              result={tcpResult}
              visibleEvents={visibleEvents}
              currentStepIndex={currentStepIndex}
              onRun={runTcpSimulation}
            />
          )}

          {activeStudio === 'udp' && (
            <UdpStudioView result={udpResult} onRun={runUdpSimulation} />
          )}

          {activeStudio === 'congestion' && (
            <CongestionStudioView result={tcpResult} onRun={runTcpSimulation} />
          )}

          {activeStudio === 'comparison' && (
            <ComparisonStudioView
              tcpResult={tcpResult}
              udpResult={udpResult}
              onRunBoth={runBothSimulations}
            />
          )}
        </section>
      </div>
    </div>
  );
};

// ==========================================
// SUB-STUDIO 1: TCP STUDIO VIEW
// ==========================================
const TcpStudioView: React.FC<{
  result: TransportSimResult | null;
  visibleEvents: TransportEvent[];
  currentStepIndex: number;
  onRun: () => void;
}> = ({ result, visibleEvents, onRun }) => {
  if (!result) {
    return (
      <div data-testid="tcp-studio-container" data-state="empty" className="flex-1 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl p-12 text-center text-slate-500">
        <Activity className="w-12 h-12 text-slate-700 mb-3" />
        <h3 className="text-sm font-semibold text-slate-300">TCP Studio Ready</h3>
        <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4">
          Configure initial window sizes and click "Simulate TCP Transfer" to inspect the byte-oriented state machine.
        </p>
        <button
          onClick={onRun}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg"
        >
          Run Default TCP Simulation
        </button>
      </div>
    );
  }

  const { metrics, derived_route } = result;

  return (
    <div className="space-y-6" data-testid="tcp-studio-container" data-state="populated">
      {/* Route & Status Banner */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold tracking-wider text-slate-400 block mb-1">
            Derived route
          </span>
          <div className="flex items-center space-x-2 text-xs font-mono text-brand-300">
            {derived_route.map((hop, i) => (
              <React.Fragment key={i}>
                <span className="bg-slate-950 border border-slate-800 px-2.5 py-1 rounded">
                  {hop}
                </span>
                {i < derived_route.length - 1 && <span className="text-slate-600">→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] font-bold tracking-wider text-slate-400 block mb-1">
            Handshake & Connection
          </span>
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>ESTABLISHED & DELIVERED</span>
          </span>
        </div>
      </div>

      {/* Jacobson / Karn RTT Panel */}
      <div className="grid grid-cols-4 gap-3" data-testid="rtt-telemetry-panel">
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-semibold">Average RTT</span>
          <div className="text-lg font-bold text-slate-100 font-mono mt-0.5">
            {metrics.average_rtt_us.toLocaleString()} <span className="text-xs text-slate-400">µs</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-semibold">Smoothed RTT (SRTT)</span>
          <div className="text-lg font-bold text-brand-400 font-mono mt-0.5">
            {metrics.smoothed_rtt_us.toLocaleString()} <span className="text-xs text-slate-400">µs</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-semibold">Final RTO (Jacobson)</span>
          <div className="text-lg font-bold text-amber-400 font-mono mt-0.5">
            {metrics.final_rto_us.toLocaleString()} <span className="text-xs text-slate-400">µs</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-semibold">Karn's Rule Status</span>
          <div className="text-xs text-emerald-400 font-medium mt-1.5 flex items-center space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Retransmissions Excluded</span>
          </div>
        </div>
      </div>

      {/* Discrete Event Timeline */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <h3 className="text-xs font-bold text-slate-300 tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-brand-400" />
            Event trace ({visibleEvents.length}/{result.events.length} Steps)
          </h3>
          <span className="text-[10px] text-slate-400 font-mono">Virtual SimTime</span>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {visibleEvents.map((evt) => (
            <div
              key={evt.step_index}
              data-testid={`event-step-${evt.step_index}`}
              className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/90 flex items-start justify-between text-xs font-mono"
            >
              <div className="flex items-start space-x-2.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 shrink-0">
                  {evt.timestamp_us.toLocaleString()} µs
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                    evt.event_type.includes('retransmission') || evt.event_type.includes('timeout')
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : evt.event_type.includes('lost')
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : evt.event_type.includes('ack')
                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                      : evt.event_type.includes('established') || evt.event_type.includes('syn')
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-brand-950 text-brand-300 border border-brand-800'
                  }`}
                >
                  {evt.event_type.replace(/_/g, ' ')}
                </span>
                <span className="text-slate-300 text-xs font-sans">{evt.description}</span>
              </div>

              <div className="flex items-center space-x-2 shrink-0 pl-2">
                <span className="text-[10px] text-brand-400">
                  cwnd: {evt.cwnd_mss.toFixed(1)} MSS
                </span>
                <span className="text-[10px] text-slate-400">
                  State: {evt.connection_state}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Measured Performance Metrics */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-300 tracking-wider">
          Measured Performance Telemetry
        </h3>

        <div className="grid grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-400">Delivered Data</span>
            <div className="text-sm font-bold text-slate-200 font-mono mt-0.5">
              {metrics.bytes_delivered.toLocaleString()} / {metrics.bytes_sent.toLocaleString()} B
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-400" title="All wire bits transmitted: payload + per-segment headers, including retransmissions">Throughput (Wire)</span>
            <div className="text-sm font-bold text-brand-400 font-mono mt-0.5">
              {(metrics.throughput_bits_per_sec / 1_000_000).toFixed(2)} Mbps
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-400" title="Unique application payload delivered: headers and retransmitted data excluded">Goodput (Application)</span>
            <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
              {(metrics.goodput_bits_per_sec / 1_000_000).toFixed(2)} Mbps
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-400">Retransmissions / Timeouts</span>
            <div className="text-sm font-bold text-amber-400 font-mono mt-0.5">
              {metrics.retransmissions} ({metrics.fast_retransmit_count} Fast / {metrics.timeout_count} RTO)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// SUB-STUDIO 2: UDP STUDIO VIEW
// ==========================================
const UdpStudioView: React.FC<{
  result: TransportSimResult | null;
  onRun: () => void;
}> = ({ result, onRun }) => {
  if (!result) {
    return (
      <div data-testid="udp-studio-container" data-state="empty" className="flex-1 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl p-12 text-center text-slate-500">
        <Zap className="w-12 h-12 text-slate-700 mb-3" />
        <h3 className="text-sm font-semibold text-slate-300">UDP Studio Ready</h3>
        <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4">
          Experience connectionless transmission. Lost datagrams are never retransmitted and generate no ACKs.
        </p>
        <button
          onClick={onRun}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg"
        >
          Run UDP Simulation
        </button>
      </div>
    );
  }

  const { metrics, events } = result;

  return (
    <div className="space-y-6" data-testid="udp-studio-container" data-state="populated">
      {/* Educational Notice Banner */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-200">Connectionless Datagram Delivery</h4>
            <p className="text-[11px] text-slate-400">
              Zero handshake overhead, no cumulative ACKs, no transport retransmissions.
            </p>
          </div>
        </div>
        <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-950 text-slate-400 border border-slate-800">
          Loss Rate: {(metrics.packet_loss_rate * 100).toFixed(1)}%
        </span>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-semibold">Datagrams Delivered</span>
          <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
            {metrics.segments_delivered} / {metrics.segments_sent}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-semibold">Throughput</span>
          <div className="text-lg font-bold text-brand-400 font-mono mt-0.5">
            {(metrics.throughput_bits_per_sec / 1_000_000).toFixed(2)} Mbps
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-semibold">Goodput</span>
          <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
            {(metrics.goodput_bits_per_sec / 1_000_000).toFixed(2)} Mbps
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-semibold">Completion Time</span>
          <div className="text-lg font-bold text-slate-200 font-mono mt-0.5">
            {metrics.completion_time_us.toLocaleString()} µs
          </div>
        </div>
      </div>

      {/* Datagram Delivery Timeline */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-300 tracking-wider">
          UDP Datagram Trace
        </h3>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {events.map((evt) => (
            <div
              key={evt.step_index}
              className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/90 flex items-center justify-between text-xs font-mono"
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                  {evt.timestamp_us.toLocaleString()} µs
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    evt.event_type.includes('lost')
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}
                >
                  {evt.event_type.replace(/_/g, ' ')}
                </span>
                <span className="text-slate-300 font-sans">{evt.description}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// SUB-STUDIO 3: CONGESTION CONTROL STUDIO
// ==========================================
const CongestionStudioView: React.FC<{
  result: TransportSimResult | null;
  onRun: () => void;
}> = ({ result, onRun }) => {
  if (!result || result.cwnd_timeline.length === 0) {
    return (
      <div data-testid="congestion-studio-container" data-state="empty" className="flex-1 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl p-12 text-center text-slate-500">
        <Gauge className="w-12 h-12 text-slate-700 mb-3" />
        <h3 className="text-sm font-semibold text-slate-300">Congestion Timeline</h3>
        <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4">
          Simulate TCP transfer to observe Slow Start exponential increase, Congestion Avoidance additive increase, and loss response.
        </p>
        <button
          onClick={onRun}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg"
        >
          Run Simulation
        </button>
      </div>
    );
  }

  const { cwnd_timeline } = result;
  const maxCwnd = Math.max(...cwnd_timeline.map((p) => Math.max(p.cwnd_mss, p.ssthresh_mss)), 8.0);
  const maxTime = Math.max(...cwnd_timeline.map((p) => p.timestamp_us), 1);

  return (
    <div className="space-y-6" data-testid="congestion-studio-container" data-state="populated">
      {/* SVG Chart of cwnd vs Virtual SimTime */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-brand-400" />
            Congestion Window (cwnd) & ssthresh vs Virtual Time
          </h3>
          <div className="flex items-center space-x-3 text-xs">
            <span className="flex items-center space-x-1 text-brand-400">
              <span className="w-3 h-0.5 bg-brand-400 inline-block" />
              <span>cwnd</span>
            </span>
            <span className="flex items-center space-x-1 text-amber-400">
              <span className="w-3 h-0.5 bg-amber-400 inline-block border-t border-dashed" />
              <span>ssthresh</span>
            </span>
          </div>
        </div>

        <div className="h-64 w-full bg-slate-950 rounded-lg border border-slate-800 p-2 relative flex items-end">
          <svg className="w-full h-full overflow-visible" viewBox="0 0 800 240" preserveAspectRatio="none">
            {/* Grid lines */}
            <line x1="0" y1="60" x2="800" y2="60" stroke="#1e293b" strokeDasharray="3 3" />
            <line x1="0" y1="120" x2="800" y2="120" stroke="#1e293b" strokeDasharray="3 3" />
            <line x1="0" y1="180" x2="800" y2="180" stroke="#1e293b" strokeDasharray="3 3" />

            {/* ssthresh step-line */}
            <polyline
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              points={cwnd_timeline
                .map((pt) => {
                  const x = (pt.timestamp_us / maxTime) * 780 + 10;
                  const y = 230 - (pt.ssthresh_mss / maxCwnd) * 210;
                  return `${x},${y}`;
                })
                .join(' ')}
            />

            {/* cwnd curve */}
            <polyline
              fill="none"
              stroke="#818cf8"
              strokeWidth="2.5"
              points={cwnd_timeline
                .map((pt) => {
                  const x = (pt.timestamp_us / maxTime) * 780 + 10;
                  const y = 230 - (pt.cwnd_mss / maxCwnd) * 210;
                  return `${x},${y}`;
                })
                .join(' ')}
            />

            {/* Data points */}
            {cwnd_timeline.map((pt, i) => {
              const x = (pt.timestamp_us / maxTime) * 780 + 10;
              const y = 230 - (pt.cwnd_mss / maxCwnd) * 210;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="3.5"
                  className={
                    pt.phase === 'fast_recovery'
                      ? 'fill-amber-400 stroke-slate-950'
                      : pt.phase === 'timeout_recovery'
                      ? 'fill-rose-400 stroke-slate-950'
                      : 'fill-brand-400 stroke-slate-950'
                  }
                  strokeWidth="1"
                />
              );
            })}
          </svg>
        </div>
      </div>

      {/* Chronological Cwnd Transition Timeline */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-300 tracking-wider">
          Congestion Phase Transitions
        </h3>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {cwnd_timeline.map((pt: CwndPoint, i: number) => (
            <div
              key={i}
              className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs font-mono"
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                  {pt.timestamp_us.toLocaleString()} µs
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    pt.phase === 'slow_start'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : pt.phase === 'congestion_avoidance'
                      ? 'bg-brand-950 text-brand-300 border border-brand-800'
                      : pt.phase === 'fast_recovery'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {pt.phase.replace(/_/g, ' ')}
                </span>
                <span className="text-slate-300 font-sans">{pt.reason}</span>
              </div>

              <div className="flex items-center space-x-3 shrink-0">
                <span className="text-brand-400 font-bold">cwnd: {pt.cwnd_mss.toFixed(2)} MSS</span>
                <span className="text-amber-400 font-bold">ssthresh: {pt.ssthresh_mss.toFixed(1)} MSS</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// SUB-STUDIO 4: TCP VS UDP COMPARISON VIEW
// ==========================================
const ComparisonStudioView: React.FC<{
  tcpResult: TransportSimResult | null;
  udpResult: TransportSimResult | null;
  onRunBoth: () => void;
}> = ({ tcpResult, udpResult, onRunBoth }) => {
  if (!tcpResult || !udpResult) {
    return (
      <div data-testid="comparison-studio-container" data-state="empty" className="flex-1 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl p-12 text-center text-slate-500">
        <BarChart3 className="w-12 h-12 text-slate-700 mb-3" />
        <h3 className="text-sm font-semibold text-slate-300">Measured Comparison</h3>
        <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4">
          Runs both TCP and UDP across the simulated topology to measure real throughput, goodput, and overhead.
        </p>
        <button
          onClick={onRunBoth}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg"
        >
          Execute Dual Benchmark
        </button>
      </div>
    );
  }

  const tcp = tcpResult.metrics;
  const udp = udpResult.metrics;

  return (
    <div className="space-y-6" data-testid="comparison-studio-container" data-state="populated">
      {/* Side-by-Side Comparison Table */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h3 className="text-xs font-bold text-slate-300 tracking-wider">
            Measured metrics
          </h3>
          <span className="text-[10px] text-slate-400 font-mono">Real Measured Values Only</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                <th className="pb-2 font-medium">Metric</th>
                <th className="pb-2 font-medium text-brand-400">TCP (Reliable)</th>
                <th className="pb-2 font-medium text-emerald-400">UDP (Datagram)</th>
                <th className="pb-2 font-medium text-slate-500">Trade-Off Analysis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              <tr>
                <td className="py-2.5 text-slate-300 font-sans">Delivered Bytes</td>
                <td className="py-2.5 text-brand-300">{tcp.bytes_delivered.toLocaleString()} B</td>
                <td className="py-2.5 text-emerald-300">{udp.bytes_delivered.toLocaleString()} B</td>
                <td className="py-2.5 text-slate-400 font-sans text-[11px]">
                  {tcp.bytes_delivered >= udp.bytes_delivered
                    ? 'TCP guarantees 100% in-order delivery via retransmission'
                    : 'UDP may experience unrecovered packet losses'}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-slate-300 font-sans">Raw Throughput</td>
                <td className="py-2.5 text-brand-300">
                  {(tcp.throughput_bits_per_sec / 1_000_000).toFixed(2)} Mbps
                </td>
                <td className="py-2.5 text-emerald-300">
                  {(udp.throughput_bits_per_sec / 1_000_000).toFixed(2)} Mbps
                </td>
                <td className="py-2.5 text-slate-400 font-sans text-[11px]">
                  UDP transmits immediately with zero handshake or ACK delay
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-slate-300 font-sans">Effective Goodput</td>
                <td className="py-2.5 text-brand-300">
                  {(tcp.goodput_bits_per_sec / 1_000_000).toFixed(2)} Mbps
                </td>
                <td className="py-2.5 text-emerald-300">
                  {(udp.goodput_bits_per_sec / 1_000_000).toFixed(2)} Mbps
                </td>
                <td className="py-2.5 text-slate-400 font-sans text-[11px]">
                  Application-level useful data transferred per unit time
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-slate-300 font-sans">Packet Loss Rate</td>
                <td className="py-2.5 text-brand-300">{(tcp.packet_loss_rate * 100).toFixed(1)}%</td>
                <td className="py-2.5 text-emerald-300">{(udp.packet_loss_rate * 100).toFixed(1)}%</td>
                <td className="py-2.5 text-slate-400 font-sans text-[11px]">
                  TCP detects losses and retransmits; UDP accepts drop-tail losses
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-slate-300 font-sans">Retransmissions</td>
                <td className="py-2.5 text-brand-300">{tcp.retransmissions}</td>
                <td className="py-2.5 text-emerald-300">0 (N/A)</td>
                <td className="py-2.5 text-slate-400 font-sans text-[11px]">
                  UDP lacks sequence numbers and ACK mechanisms
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-slate-300 font-sans">Completion Time</td>
                <td className="py-2.5 text-brand-300">{tcp.completion_time_us.toLocaleString()} µs</td>
                <td className="py-2.5 text-emerald-300">{udp.completion_time_us.toLocaleString()} µs</td>
                <td className="py-2.5 text-slate-400 font-sans text-[11px]">
                  TCP overhead includes 3-way handshake and 4-way teardown
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
