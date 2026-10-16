import { useState } from 'react';
import {
  FlaskConical,
  Play,
  Sparkles,
  GitCompare,
  TrendingUp,
  Activity,
  AlertCircle,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { api } from '../../lib/api';
import { ExportButtons } from './ExportButtons';
import { Project } from '../../types/project';
import {
  SweepConfig,
  SweepExperimentResult,
  ComparativeExperimentConfig,
  ComparativeExperimentResult,
  SweepParameter,
  ExperimentTarget,
} from '../../types/experiments';

interface ExperimentsWorkspaceProps {
  project: Project | null;
}

export function ExperimentsWorkspace({ project }: ExperimentsWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'sweep' | 'comparative'>('sweep');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // -- Sweep State --
  const [sweepName, setSweepName] = useState<string>('Bandwidth Sweep Analysis');
  const [sweepTarget, setSweepTarget] = useState<ExperimentTarget>('tcp');
  const [sweepParamType, setSweepParamType] = useState<string>('link_bandwidth');
  const [sweepValuesStr, setSweepValuesStr] = useState<string>('1000000, 5000000, 10000000, 50000000, 100000000');
  const [sweepSeedsStr, setSweepSeedsStr] = useState<string>('42, 101, 202');
  const [sweepDurationUs, setSweepDurationUs] = useState<number>(50000);
  const [sweepPacketCount, setSweepPacketCount] = useState<number>(10);
  const [sweepResult, setSweepResult] = useState<SweepExperimentResult | null>(null);

  // -- Comparative State --
  const [compName, setCompName] = useState<string>('Capacity & Congestion A/B Test');
  const [compTarget, setCompTarget] = useState<ExperimentTarget>('tcp');
  const [scenarioAName, setScenarioAName] = useState<string>('High Bandwidth Baseline');
  const [scenarioBName, setScenarioBName] = useState<string>('Constrained Bandwidth Link');
  const [scenarioABw, setScenarioABw] = useState<number>(100000000); // 100M
  const [scenarioBBw, setScenarioBBw] = useState<number>(1000000); // 1M
  const [compSeedsStr, setCompSeedsStr] = useState<string>('42, 99');
  const [compDurationUs, setCompDurationUs] = useState<number>(60000);
  const [compResult, setCompResult] = useState<ComparativeExperimentResult | null>(null);

  // Quick Presets for Sweeps
  const handleSweepPreset = (type: string) => {
    setSweepParamType(type);
    if (type === 'link_bandwidth') {
      setSweepName('Bandwidth Impact Sweep');
      setSweepValuesStr('1000000, 10000000, 50000000, 100000000');
    } else if (type === 'propagation_delay') {
      setSweepName('Latency & Distance Sweep');
      setSweepValuesStr('1000, 5000, 10000, 25000, 50000');
    } else if (type === 'queue_capacity') {
      setSweepName('Buffer Sizing Sweep');
      setSweepValuesStr('2, 5, 10, 25, 50');
    } else if (type === 'packet_size_bytes') {
      setSweepName('MTU & Payload Size Sweep');
      setSweepValuesStr('64, 256, 512, 1024, 1500');
    } else if (type === 'traffic_interval_us') {
      setSweepName('Load & Injection Rate Sweep');
      setSweepValuesStr('1000, 2500, 5000, 10000');
    }
  };

  const handleRunSweep = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const rawValues = sweepValuesStr
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n));
      const rawSeeds = sweepSeedsStr
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));

      if (rawValues.length === 0) {
        throw new Error('Please enter at least one valid parameter value');
      }
      if (rawSeeds.length === 0) {
        throw new Error('Please enter at least one seed number');
      }

      let param: SweepParameter;
      switch (sweepParamType) {
        case 'link_bandwidth':
          param = { type: 'link_bandwidth', link_id: null };
          break;
        case 'propagation_delay':
          param = { type: 'propagation_delay', link_id: null };
          break;
        case 'queue_capacity':
          param = { type: 'queue_capacity', link_id: null };
          break;
        case 'bit_error_rate':
          param = { type: 'bit_error_rate', link_id: null };
          break;
        case 'packet_size_bytes':
          param = { type: 'packet_size_bytes' };
          break;
        case 'traffic_interval_us':
          param = { type: 'traffic_interval_us' };
          break;
        case 'packet_count':
          param = { type: 'packet_count' };
          break;
        case 'window_size':
          param = { type: 'window_size' };
          break;
        case 'timeout_us':
          param = { type: 'timeout_us' };
          break;
        case 'mac_persistence':
          param = { type: 'mac_persistence' };
          break;
        default:
          param = { type: 'link_bandwidth', link_id: null };
      }

      const cfg: SweepConfig = {
        experiment_name: sweepName,
        target: sweepTarget,
        parameter: param,
        parameter_values: rawValues,
        seeds: rawSeeds,
        simulation_duration_us: sweepDurationUs,
        packet_count: sweepPacketCount,
      };

      const res = await api.runParameterSweep(cfg);
      setSweepResult(res);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunComparative = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const rawSeeds = compSeedsStr
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));

      if (rawSeeds.length === 0) {
        throw new Error('Please enter at least one seed');
      }

      const cfg: ComparativeExperimentConfig = {
        experiment_name: compName,
        target: compTarget,
        scenario_a: {
          name: scenarioAName,
          description: `Bandwidth configured to ${(scenarioABw / 1_000_000).toFixed(1)} Mbps`,
          parameter_overrides: [
            [{ type: 'link_bandwidth', link_id: null }, scenarioABw],
          ],
        },
        scenario_b: {
          name: scenarioBName,
          description: `Bandwidth constrained to ${(scenarioBBw / 1_000_000).toFixed(1)} Mbps`,
          parameter_overrides: [
            [{ type: 'link_bandwidth', link_id: null }, scenarioBBw],
          ],
        },
        seeds: rawSeeds,
        simulation_duration_us: compDurationUs,
      };

      const res = await api.runComparativeExperiment(cfg);
      setCompResult(res);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const formatBps = (bps: number) => {
    if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
    if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} Kbps`;
    return `${bps.toFixed(0)} bps`;
  };

  const formatMicro = (us: number) => {
    if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(2)} s`;
    if (us >= 1_000) return `${(us / 1_000).toFixed(2)} ms`;
    return `${us.toFixed(1)} µs`;
  };

  // Prepare chart data for Sweep
  const chartData = sweepResult?.points.map((pt) => ({
    value: pt.parameter_value,
    throughput_mbps: +(pt.aggregated_qos.mean_throughput_bps / 1_000_000).toFixed(2),
    goodput_mbps: +(pt.aggregated_qos.mean_goodput_bps / 1_000_000).toFixed(2),
    latency_ms: +(pt.aggregated_qos.mean_latency_us / 1000).toFixed(2),
    loss_percent: +(pt.aggregated_qos.mean_loss_rate * 100).toFixed(2),
  }));

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Top Header */}
      <div className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FlaskConical className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">Experimentation & Sweeps Lab</h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Deterministic Monte Carlo
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Execute deterministic parameter sweeps and comparative A/B studies across multiple pseudorandom seeds.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1 bg-slate-950 border border-slate-800 rounded-xl space-x-1 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('sweep')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center space-x-1.5 ${
              activeTab === 'sweep'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Parameter Sweep</span>
          </button>
          <button
            onClick={() => setActiveTab('comparative')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center space-x-1.5 ${
              activeTab === 'comparative'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>Comparative A/B</span>
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-7xl w-full mx-auto">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-xs text-rose-200 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 1: PARAMETER SWEEP */}
        {/* =================================================================== */}
        {activeTab === 'sweep' && (
          <div className="space-y-6">
            {/* Sweep Configuration Card */}
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-semibold text-slate-200">Sweep Design Configuration</h3>
                </div>
                <div className="flex items-center space-x-1.5 text-[11px] text-slate-400">
                  <span>Presets:</span>
                  <button
                    onClick={() => handleSweepPreset('link_bandwidth')}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    Bandwidth
                  </button>
                  <button
                    onClick={() => handleSweepPreset('propagation_delay')}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    Delay
                  </button>
                  <button
                    onClick={() => handleSweepPreset('queue_capacity')}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    Queue
                  </button>
                  <button
                    onClick={() => handleSweepPreset('packet_size_bytes')}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    Packet Size
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Experiment Label</label>
                  <input aria-label="Experiment Label"
                    type="text"
                    value={sweepName}
                    onChange={(e) => setSweepName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Experiment Target</label>
                  <select aria-label="Experiment Target"
                    value={sweepTarget}
                    onChange={(e) => setSweepTarget(e.target.value as ExperimentTarget)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="tcp">TCP (Transport & Flow Control)</option>
                    <option value="udp">UDP (Connectionless Datagram)</option>
                    <option value="application">Application (HTTP / DNS / FTP / SNMP)</option>
                    <option value="flow_control">Flow Control (Sliding Window)</option>
                    <option value="mac">MAC (Medium Access Contention)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Variable Parameter</label>
                  <select aria-label="Variable Parameter"
                    value={sweepParamType}
                    onChange={(e) => handleSweepPreset(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="link_bandwidth">Link Bandwidth (bps)</option>
                    <option value="propagation_delay">Link Propagation Delay (µs)</option>
                    <option value="queue_capacity">Buffer Queue Capacity (pkts)</option>
                    <option value="bit_error_rate">Bit Error Rate (BER)</option>
                    <option value="packet_size_bytes">Packet Size (bytes)</option>
                    <option value="traffic_interval_us">Injection Interval (µs)</option>
                    <option value="packet_count">Total Packet Count</option>
                    <option value="window_size">Window Size (pkts/bytes)</option>
                    <option value="timeout_us">Timeout Duration (µs)</option>
                    <option value="mac_persistence">MAC Persistence Probability</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Simulation Time per Run (µs)</label>
                  <input aria-label="Simulation Time per Run (µs)"
                    type="number"
                    min="1000"
                    step="5000"
                    value={sweepDurationUs}
                    onChange={(e) => setSweepDurationUs(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-medium mb-1">
                    Sweep Values List (comma-separated numbers)
                  </label>
                  <input aria-label="Sweep Values List (comma-separated numbers)"
                    type="text"
                    value={sweepValuesStr}
                    onChange={(e) => setSweepValuesStr(e.target.value)}
                    placeholder="e.g. 1000000, 10000000, 100000000"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    PRNG Seeds (comma-separated)
                  </label>
                  <input aria-label="PRNG Seeds (comma-separated)"
                    type="text"
                    value={sweepSeedsStr}
                    onChange={(e) => setSweepSeedsStr(e.target.value)}
                    placeholder="e.g. 42, 101, 202"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Packets per Run
                  </label>
                  <input aria-label="Packets per Run"
                    type="number"
                    min="1"
                    value={sweepPacketCount}
                    onChange={(e) => setSweepPacketCount(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                <div className="text-[11px] text-slate-400">
                  Topology: <strong>{project?.nodes.length || 0} nodes</strong>, <strong>{project?.links.length || 0} links</strong>
                </div>
                <button
                  onClick={handleRunSweep}
                  disabled={isRunning}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 transition flex items-center space-x-2 disabled:bg-slate-700 disabled:text-slate-300"
                >
                  <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
                  <span>{isRunning ? 'Simulating Sweep Points...' : 'Execute Parameter Sweep'}</span>
                </button>
              </div>
            </div>

            {/* Sweep Results Visualizer */}
            {sweepResult && (
              <div className="space-y-6 animate-in fade-in">
                {/* Export: JSON is the verbatim backend result for python-tools; CSV is tidy data */}
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200">Result Export</h4>
                  <ExportButtons kind="sweep" result={sweepResult} />
                </div>

                {/* Result Highlights */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 text-xs">Total Simulated Runs</span>
                    <div className="text-xl font-bold text-slate-100 mt-0.5">
                      {sweepResult.total_runs} runs
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {sweepResult.points.length} points × {sweepResult.seeds.length} seeds
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 text-xs">Sweep Variable</span>
                    <div className="text-xl font-bold text-indigo-400 mt-0.5 capitalize">
                      {sweepResult.parameter_name.replace(/_/g, ' ')}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {sweepResult.points.length} discrete test samples
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 text-xs">Execution Duration</span>
                    <div className="text-xl font-bold text-emerald-400 mt-0.5">
                      {sweepResult.execution_time_ms} ms
                    </div>
                    <span className="text-[11px] text-slate-400">Deterministic Python execution</span>
                  </div>
                </div>

                {/* Recharts Chart */}
                {chartData && chartData.length > 0 && (
                  <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center space-x-2">
                        <TrendingUp className="w-4 h-4 text-indigo-400" />
                        <h4 className="text-xs font-semibold text-slate-200">
                          Performance Curve: Throughput & Latency vs {sweepResult.parameter_name}
                        </h4>
                      </div>
                    </div>
                    <div className="h-64 w-full pt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="value" stroke="#64748b" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="left" stroke="#818cf8" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="right" orientation="right" stroke="#38bdf8" tick={{ fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                            itemStyle={{ fontSize: '11px' }}
                          />
                          <Legend wrapperStyle={{ fontSize: '11px' }} />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="throughput_mbps"
                            name="Mean Throughput (Mbps)"
                            stroke="#818cf8"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="latency_ms"
                            name="Mean Latency (ms)"
                            stroke="#38bdf8"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Summary Table */}
                <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-200">Aggregated Metrics Table</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 font-medium">
                          <th className="py-2.5 px-3">Parameter Value</th>
                          <th className="py-2.5 px-3">Mean Throughput</th>
                          <th className="py-2.5 px-3">StdDev (Throughput)</th>
                          <th className="py-2.5 px-3">Mean Latency</th>
                          <th className="py-2.5 px-3">Latency Range (Min / Max)</th>
                          <th className="py-2.5 px-3">Mean Jitter</th>
                          <th className="py-2.5 px-3">Loss Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {sweepResult.points.map((pt, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/30 transition">
                            <td className="py-2.5 px-3 font-mono font-bold text-indigo-300">
                              {pt.parameter_value}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-200">
                              {formatBps(pt.aggregated_qos.mean_throughput_bps)}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-400">
                              ±{formatBps(pt.aggregated_qos.stddev_throughput_bps)}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-200">
                              {formatMicro(pt.aggregated_qos.mean_latency_us)}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-400">
                              {pt.aggregated_qos.min_latency_us != null ? formatMicro(pt.aggregated_qos.min_latency_us) : '—'} /{' '}
                              {pt.aggregated_qos.max_latency_us != null ? formatMicro(pt.aggregated_qos.max_latency_us) : '—'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-200">
                              {formatMicro(pt.aggregated_qos.mean_jitter_us)}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold text-slate-200">
                              {(pt.aggregated_qos.mean_loss_rate * 100).toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: COMPARATIVE A/B EXPERIMENTS */}
        {/* =================================================================== */}
        {activeTab === 'comparative' && (
          <div className="space-y-6">
            {/* Comparative Setup Card */}
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <GitCompare className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-200">Comparative A/B Experiment Setup</h3>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  Multi-seed deterministic comparison
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-medium text-xs mb-1">
                    Comparative Experiment Label
                  </label>
                  <input aria-label="Comparative Experiment Label"
                    type="text"
                    value={compName}
                    onChange={(e) => setCompName(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium text-xs mb-1">
                    Experiment Target
                  </label>
                  <select aria-label="Experiment Target"
                    value={compTarget}
                    onChange={(e) => setCompTarget(e.target.value as ExperimentTarget)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                  >
                    <option value="tcp">TCP (Transport & Flow Control)</option>
                    <option value="udp">UDP (Connectionless Datagram)</option>
                    <option value="application">Application (HTTP / DNS / FTP / SNMP)</option>
                    <option value="flow_control">Flow Control (Sliding Window)</option>
                    <option value="mac">MAC (Medium Access Contention)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                {/* Scenario A */}
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-400 text-sm">Scenario A (Baseline)</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                      Standard
                    </span>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Scenario Label</label>
                    <input aria-label="Scenario Label"
                      type="text"
                      value={scenarioAName}
                      onChange={(e) => setScenarioAName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Link Bandwidth (bps)</label>
                    <input aria-label="Link Bandwidth (bps)"
                      type="number"
                      step="1000000"
                      value={scenarioABw}
                      onChange={(e) => setScenarioABw(Number(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Scenario B */}
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-cyan-400 text-sm">Scenario B (Alternative)</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                      Variant
                    </span>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Scenario Label</label>
                    <input aria-label="Scenario Label"
                      type="text"
                      value={scenarioBName}
                      onChange={(e) => setScenarioBName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Link Bandwidth (bps)</label>
                    <input aria-label="Link Bandwidth (bps)"
                      type="number"
                      step="1000000"
                      value={scenarioBBw}
                      onChange={(e) => setScenarioBBw(Number(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Seeds (comma-separated)</label>
                  <input aria-label="Seeds (comma-separated)"
                    type="text"
                    value={compSeedsStr}
                    onChange={(e) => setCompSeedsStr(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Duration per run (µs)</label>
                  <input aria-label="Duration per run (µs)"
                    type="number"
                    value={compDurationUs}
                    onChange={(e) => setCompDurationUs(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleRunComparative}
                  disabled={isRunning}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white shadow-lg shadow-emerald-600/20 transition flex items-center space-x-2 disabled:bg-slate-700 disabled:text-slate-300"
                >
                  <GitCompare className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
                  <span>{isRunning ? 'Running Comparative Analysis...' : 'Run Comparative A/B Test'}</span>
                </button>
              </div>
            </div>

            {/* Comparative Results */}
            {compResult && (
              <div className="space-y-6 animate-in fade-in">
                {/* Export: JSON is the verbatim backend result; CSV holds one row per metric */}
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200">Result Export</h4>
                  <ExportButtons kind="comparison" result={compResult} />
                </div>

                {/* Deltas Table */}
                <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h4 className="text-xs font-semibold text-slate-200">
                      Comparative Metric Deltas: {compResult.scenario_a_name} vs {compResult.scenario_b_name}
                    </h4>
                    <span className="text-[11px] text-slate-400">
                      Simulated across {compResult.runs_count_per_scenario} seeds in {compResult.execution_time_ms} ms
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 font-medium">
                          <th className="py-2.5 px-3">Metric</th>
                          <th className="py-2.5 px-3 text-emerald-400">{compResult.scenario_a_name}</th>
                          <th className="py-2.5 px-3 text-cyan-400">{compResult.scenario_b_name}</th>
                          <th className="py-2.5 px-3">Absolute Delta (B - A)</th>
                          <th className="py-2.5 px-3">Relative Shift (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {compResult.deltas.map((d) => (
                          <tr key={d.metric_name} className="hover:bg-slate-800/30 transition">
                            <td className="py-2.5 px-3 font-semibold text-slate-200 capitalize">
                              {d.metric_name.replace(/_/g, ' ')}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-300">
                              {d.metric_name.includes('bps')
                                ? formatBps(d.val_a)
                                : d.metric_name.includes('us')
                                ? formatMicro(d.val_a)
                                : d.val_a.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-300">
                              {d.metric_name.includes('bps')
                                ? formatBps(d.val_b)
                                : d.metric_name.includes('us')
                                ? formatMicro(d.val_b)
                                : d.val_b.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-400">
                              {d.diff > 0 ? `+${d.diff.toFixed(2)}` : d.diff.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold">
                              {d.percent_change != null ? (
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] ${
                                    d.percent_change > 0
                                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}
                                >
                                  {d.percent_change > 0 ? `+${d.percent_change.toFixed(1)}%` : `${d.percent_change.toFixed(1)}%`}
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
