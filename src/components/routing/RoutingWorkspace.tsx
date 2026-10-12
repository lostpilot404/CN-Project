import React, { useState, useEffect, useCallback } from 'react';
import {
  Route,
  Activity,
  Cpu,
  Layers,
  ArrowRight,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Sliders,
  HelpCircle,
} from 'lucide-react';
import { Project } from '../../types/project';
import {
  MetricType,
  RoutingAlgorithm,
  RoutingTable,
  ConvergenceTelemetry,
} from '../../types/routing';
import { api } from '../../lib/api';

interface RoutingWorkspaceProps {
  project: Project | null;
}

export const RoutingWorkspace: React.FC<RoutingWorkspaceProps> = ({ project }) => {
  const routers = project?.nodes.filter((n) => n.node_type === 'router') || [];
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [algorithm, setAlgorithm] = useState<RoutingAlgorithm>('dijkstra');
  const [metricType, setMetricType] = useState<MetricType>('hop_count');
  const [routingTable, setRoutingTable] = useState<RoutingTable | null>(null);
  const [convergence, setConvergence] = useState<ConvergenceTelemetry | null>(null);
  const [selectedRoundIndex, setSelectedRoundIndex] = useState<number>(0);
  const [selectedDestId, setSelectedDestId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Set default router selection
  useEffect(() => {
    if (routers.length > 0 && (!selectedNodeId || !routers.some((r) => r.id === selectedNodeId))) {
      setSelectedNodeId(routers[0].id);
    }
  }, [routers, selectedNodeId]);

  const handleCompute = useCallback(async () => {
    if (!selectedNodeId) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (algorithm === 'bellman_ford') {
        const telemetry = await api.simulateRoutingConvergence(selectedNodeId, metricType);
        setConvergence(telemetry);
        setRoutingTable(telemetry.final_routing_table);
        setSelectedRoundIndex(telemetry.rounds.length - 1);
      } else {
        const table = await api.calculateRoutingTable(selectedNodeId, algorithm, metricType);
        setRoutingTable(table);
        setConvergence(null);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [selectedNodeId, algorithm, metricType]);

  useEffect(() => {
    if (selectedNodeId) {
      handleCompute();
    }
  }, [selectedNodeId, algorithm, metricType, handleCompute]);

  const selectedEntry = routingTable?.entries.find((e) => e.destination === selectedDestId);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-brand-500/20 text-brand-400 rounded-lg border border-brand-500/30">
              <Route className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Routing Studio
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                  Authoritative Python Core
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Dijkstra Link-State & Bellman-Ford Distance-Vector shortest path computation with convergence rounds
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleCompute}
            disabled={isLoading || !selectedNodeId}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition shadow disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Recalculate Routes</span>
          </button>
        </div>
      </div>

      {/* Control Selector Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900/60 border border-slate-800/80 p-4 rounded-xl">
        {/* Source Router */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-brand-400" />
            Source Device (Router)
          </label>
          {routers.length > 0 ? (
            <select
              value={selectedNodeId}
              onChange={(e) => setSelectedNodeId(e.target.value)}
              className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
            >
              {routers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.id})
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-amber-400 bg-amber-950/30 border border-amber-800/50 p-2 rounded-lg">
              No router nodes in topology. Please add a Router on the canvas.
            </div>
          )}
        </div>

        {/* Algorithm */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Routing Algorithm
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAlgorithm('dijkstra')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition text-center ${
                algorithm === 'dijkstra'
                  ? 'bg-brand-600/30 border-brand-500/80 text-brand-300 font-semibold'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              Dijkstra (Link-State)
            </button>
            <button
              onClick={() => setAlgorithm('bellman_ford')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition text-center ${
                algorithm === 'bellman_ford'
                  ? 'bg-brand-600/30 border-brand-500/80 text-brand-300 font-semibold'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              Bellman-Ford (DV)
            </button>
          </div>
        </div>

        {/* Metric Type */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            Cost Metric
          </label>
          <select
            value={metricType}
            onChange={(e) => setMetricType(e.target.value as MetricType)}
            className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
          >
            <option value="hop_count">Hop Count (1 per link)</option>
            <option value="propagation_delay">Propagation Delay (µs)</option>
            <option value="inverse_bandwidth">Inverse Bandwidth (Ceil(1G / bw))</option>
          </select>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-300 flex items-center space-x-2">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Authoritative Routing Table */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="px-4 py-3 bg-slate-850/80 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-brand-400" />
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Routing Table for {routingTable?.node_label || selectedNodeId}
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">
                {routingTable?.entries.length || 0} routes computed
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-medium">
                  <tr>
                    <th className="py-2.5 px-3">Destination</th>
                    <th className="py-2.5 px-3">Next Hop</th>
                    <th className="py-2.5 px-3">Interface</th>
                    <th className="py-2.5 px-3">Metric</th>
                    <th className="py-2.5 px-3">Reachable</th>
                    <th className="py-2.5 px-3">Protocol</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {routingTable?.entries.map((entry) => {
                    const isSelected = selectedDestId === entry.destination;
                    return (
                      <tr
                        key={entry.destination}
                        onClick={() => setSelectedDestId(entry.destination)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-brand-600/20 text-brand-200'
                            : 'hover:bg-slate-800/40 text-slate-300'
                        }`}
                      >
                        <td className="py-2 px-3 font-semibold text-slate-200 font-sans">
                          {entry.destination_label}{' '}
                          <span className="text-slate-500 font-mono text-[10px]">({entry.destination})</span>
                        </td>
                        <td className="py-2 px-3 text-slate-300">
                          {entry.next_hop ? (
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                              {entry.next_hop}
                            </span>
                          ) : (
                            <span className="text-slate-500 italic">Direct / Self</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {entry.interface_id || '—'}
                        </td>
                        <td className="py-2 px-3 font-bold text-brand-300">
                          {entry.metric === 18446744073709551615 || entry.metric > 1000000000000 ? (
                            <span className="text-rose-400">∞</span>
                          ) : (
                            entry.metric
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {entry.is_reachable ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-1.5 py-0.5 rounded">
                              <CheckCircle2 className="w-3 h-3" /> Reachable
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 bg-rose-950/40 border border-rose-800/50 px-1.5 py-0.5 rounded">
                              <XCircle className="w-3 h-3" /> Unreachable
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-400 font-sans">{entry.protocol}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Path Inspector */}
          {selectedEntry && (
            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-2">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Route className="w-3.5 h-3.5 text-brand-400" />
                Path Reconstruction: {selectedEntry.destination_label}
              </h4>
              <div className="flex items-center flex-wrap gap-2 pt-1 font-mono text-xs">
                {selectedEntry.path.map((hop, idx) => (
                  <React.Fragment key={idx}>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 font-semibold shadow-sm">
                      {hop}
                    </span>
                    {idx < selectedEntry.path.length - 1 && (
                      <ArrowRight className="w-3.5 h-3.5 text-brand-400" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Bellman-Ford Convergence or Rules Box */}
        <div className="space-y-4">
          {algorithm === 'bellman_ford' && convergence ? (
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  Distance Vector Convergence
                </h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    convergence.converged
                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                      : 'bg-rose-950/60 text-rose-300 border border-rose-800/50'
                  }`}
                >
                  {convergence.converged ? `Converged in ${convergence.total_rounds} rounds` : 'Not Converged'}
                </span>
              </div>

              {/* Round Selector Tabs */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-400 font-semibold uppercase">Step-Through Rounds:</span>
                <div className="flex flex-wrap gap-1.5">
                  {convergence.rounds.map((r, i) => (
                    <button
                      key={r.round_number}
                      onClick={() => setSelectedRoundIndex(i)}
                      className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition ${
                        selectedRoundIndex === i
                          ? 'bg-brand-600 text-white shadow'
                          : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      R{r.round_number}
                    </button>
                  ))}
                </div>
              </div>

              {/* Round Distance Vector Snapshot */}
              {convergence.rounds[selectedRoundIndex] && (
                <div className="space-y-3 bg-slate-950/80 p-3 rounded-lg border border-slate-800/80">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      Round {convergence.rounds[selectedRoundIndex].round_number} Vector
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        convergence.rounds[selectedRoundIndex].changed
                          ? 'text-amber-400 bg-amber-950/30'
                          : 'text-slate-400 bg-slate-800/50'
                      }`}
                    >
                      {convergence.rounds[selectedRoundIndex].changed ? 'Vector Updated' : 'Stable (No Change)'}
                    </span>
                  </div>

                  <div className="space-y-1 font-mono text-[11px]">
                    {Object.entries(convergence.rounds[selectedRoundIndex].source_distances).map(
                      ([dest, cost]) => (
                        <div key={dest} className="flex justify-between items-center py-0.5 text-slate-300">
                          <span>{dest}</span>
                          <span className="font-bold text-brand-300">
                            {cost === 18446744073709551615 || cost > 1000000000000 ? '∞' : cost}
                          </span>
                        </div>
                      )
                    )}
                  </div>

                  {convergence.rounds[selectedRoundIndex].changes.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-1">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Round Updates:</span>
                      {convergence.rounds[selectedRoundIndex].changes.map((ch, idx) => (
                        <p key={idx} className="text-[11px] text-slate-300">
                          • {ch}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Theoretical Rules & Guidance Box */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3 text-xs text-slate-400">
            <h4 className="font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-brand-400" />
              Authoritative Algorithmic Rules
            </h4>
            <ul className="space-y-2 list-disc list-inside text-[11px] leading-relaxed">
              <li>
                <strong className="text-slate-200">Bidirectional Links:</strong> Canvas links automatically generate two directed graph edges ($A \to B$ and $B \to A$).
              </li>
              <li>
                <strong className="text-slate-200">Degraded Penalty:</strong> Degraded links apply a deterministic metric penalty: $(base \times 3).max(base + 50)$.
              </li>
              <li>
                <strong className="text-slate-200">Down Links:</strong> Down links are completely excluded from graph routing.
              </li>
              <li>
                <strong className="text-slate-200">Non-Transit End Hosts:</strong> PCs and Servers cannot act as intermediate transit routers.
              </li>
              <li>
                <strong className="text-slate-200">Inverse Bandwidth:</strong> Computed as $\lceil 1,000,000,000 / bw \rceil$, minimum 1 (never zero cost).
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
