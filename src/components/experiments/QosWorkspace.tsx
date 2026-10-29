import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  BarChart3,
  Clock,
  Layers,
  RefreshCw,
  ShieldAlert,
  Zap,
  Radio,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Project } from '../../types/project';
import {
  QosMetrics,
  FaultType,
  FaultScheduleEntry,
} from '../../types/experiments';

interface QosWorkspaceProps {
  project: Project | null;
}

export function QosWorkspace({ project }: QosWorkspaceProps) {
  const [metrics, setMetrics] = useState<QosMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [scheduledFaults, setScheduledFaults] = useState<FaultScheduleEntry[]>([]);
  const [faultType, setFaultType] = useState<string>('link_down');
  const [targetId, setTargetId] = useState<string>('');
  const [faultTimestampUs, setFaultTimestampUs] = useState<number>(50000);
  const [faultParamValue, setFaultParamValue] = useState<number>(1000000);
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const notifyTimer = useRef<number | null>(null);

  /**
   * Show a transient notification with exactly one dismissal timer.
   *
   * The previous code scheduled a fresh `setTimeout(() => setNotification(null), 3500)` per
   * message and never cancelled the pending one, so two actions in quick succession left an
   * older timer alive that wiped the *newer* message early -- an error could vanish before the
   * user read it. Mirrors the single-timer guard App.tsx already uses for its toasts.
   */
  const notify = useCallback((msg: string, type: 'success' | 'error') => {
    setNotification({ msg, type });
    if (notifyTimer.current !== null) window.clearTimeout(notifyTimer.current);
    notifyTimer.current = window.setTimeout(() => {
      notifyTimer.current = null;
      setNotification(null);
    }, 3500);
  }, []);

  useEffect(
    () => () => {
      if (notifyTimer.current !== null) window.clearTimeout(notifyTimer.current);
    },
    [],
  );

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      const qos = await api.getCurrentQosMetrics();
      setMetrics(qos);
    } catch (err) {
      console.error('Failed to fetch QoS metrics:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Set default target ID if project changes
  useEffect(() => {
    if (project && project.links.length > 0 && !targetId) {
      setTargetId(project.links[0].id);
    }
  }, [project, targetId]);

  const handleScheduleFault = async () => {
    if (!targetId) {
      notify('Please select a valid target node or link', 'error');
      return;
    }

    // Validate the parameter instead of silently clamping it. Clamping used to rewrite an
    // out-of-range value before it left the browser (bit-error rate 5 became 1.0, -1 became 0.0,
    // queue capacity 0 or -7 became 1) and then report "scheduled successfully" -- so the user got
    // a success toast for a fault that was not the one they configured, and in the BER = 0 case a
    // fault that does nothing at all. Python stays the authority: in-range values are forwarded
    // untouched and the service re-validates them (it already answers 400 for bad bandwidth).
    const needsParam =
      faultType === 'bandwidth_degradation' ||
      faultType === 'queue_capacity_change' ||
      faultType === 'bit_error';
    const reject = (msg: string) => notify(msg, 'error');
    if (!Number.isFinite(faultTimestampUs) || faultTimestampUs < 0) {
      reject(`Execution SimTime must be a number >= 0 µs (received ${faultTimestampUs})`);
      return;
    }
    if (needsParam && !Number.isFinite(faultParamValue)) {
      reject('Fault parameter must be a finite number');
      return;
    }
    if (faultType === 'bit_error' && (faultParamValue < 0 || faultParamValue > 1)) {
      reject(`Bit error rate must be between 0.0 and 1.0 (received ${faultParamValue})`);
      return;
    }
    if (
      faultType === 'queue_capacity_change' &&
      (!Number.isInteger(faultParamValue) || faultParamValue < 1)
    ) {
      reject(`Queue capacity must be a whole number >= 1 (received ${faultParamValue})`);
      return;
    }
    if (faultType === 'bandwidth_degradation' && faultParamValue < 1) {
      reject(`New bandwidth must be >= 1 bps (received ${faultParamValue})`);
      return;
    }

    let ft: FaultType;
    const fId = `fault-${Date.now().toString().slice(-4)}`;

    switch (faultType) {
      case 'link_down':
        ft = { type: 'link_down', link_id: targetId };
        break;
      case 'link_restore':
        ft = { type: 'link_restore', link_id: targetId };
        break;
      case 'bandwidth_degradation':
        ft = { type: 'bandwidth_degradation', link_id: targetId, new_bandwidth_bps: faultParamValue };
        break;
      case 'queue_capacity_change':
        ft = { type: 'queue_capacity_change', link_id: targetId, new_capacity: faultParamValue };
        break;
      case 'node_failure':
        ft = { type: 'node_failure', node_id: targetId };
        break;
      case 'node_recovery':
        ft = { type: 'node_recovery', node_id: targetId };
        break;
      case 'bit_error':
        ft = { type: 'bit_error', link_id: targetId, error_rate: faultParamValue };
        break;
      case 'packet_drop':
        ft = { type: 'packet_drop', packet_id: targetId };
        break;
      default:
        ft = { type: 'link_down', link_id: targetId };
    }

    const entry: FaultScheduleEntry = {
      fault_id: fId,
      timestamp_us: faultTimestampUs,
      fault_type: ft,
      description: `Injected ${faultType.replace(/_/g, ' ')} on ${targetId} at ${faultTimestampUs} µs${
        needsParam ? ` (parameter ${faultParamValue})` : ''
      }`,
    };

    try {
      await api.scheduleFault(entry);
      setScheduledFaults((prev) => [...prev, entry]);
      notify(`Fault ${fId} scheduled successfully at ${faultTimestampUs} µs!`, 'success');
      fetchMetrics();
    } catch (err) {
      notify(`Failed to schedule fault: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const formatBps = (bps: number) => {
    if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
    if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} Kbps`;
    return `${bps.toFixed(0)} bps`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB/s`;
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} KB/s`;
    return `${bytes.toFixed(0)} B/s`;
  };

  const formatMicro = (us: number) => {
    if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(3)} s`;
    if (us >= 1_000) return `${(us / 1_000).toFixed(2)} ms`;
    return `${us.toFixed(1)} µs`;
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Top Header */}
      <div className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">QoS Performance</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            RFC 3393 educational IPDV jitter, throughput & goodput telemetry, category loss accounting, and runtime fault injection.
          </p>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={isLoading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-400' : ''}`} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      <div className="p-6 space-y-6 max-w-7xl w-full mx-auto">
        {/* Notification Toast */}
        {notification && (
          <div
            className={`p-3 rounded-xl border text-xs font-semibold flex items-center space-x-2 transition animate-in fade-in ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-200'
                : 'bg-rose-950/80 border-rose-700/60 text-rose-200'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>{notification.msg}</span>
          </div>
        )}

        {/* Primary Metric Highlights Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Throughput & Goodput */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition relative overflow-hidden group">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span title="Gross delivered wire rate: packet/segment headers and payload together">Throughput (wire)</span>
              <Zap className="w-4 h-4 text-brand-400" />
            </div>
            <div className="text-xl font-bold text-slate-100">
              {metrics ? formatBps(metrics.throughput_bits_per_sec) : '0 bps'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span title="Net useful payload rate: unique delivered payload only">Goodput (payload): <strong className="text-emerald-400">{metrics ? formatBps(metrics.goodput_bits_per_sec) : '0 bps'}</strong></span>
              <span>{metrics ? formatBytes(metrics.throughput_bytes_per_sec) : '0 B/s'}</span>
            </div>
          </div>

          {/* Card 2: Latency */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl group-hover:bg-cyan-500/10 transition" />
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Average Latency</span>
              <Clock className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-xl font-bold text-slate-100">
              {metrics ? formatMicro(metrics.average_latency_us) : '0 µs'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>Min: <span className="text-slate-200">{metrics?.min_latency_us != null ? formatMicro(metrics.min_latency_us) : '—'}</span></span>
              <span>Max: <span className="text-slate-200">{metrics?.max_latency_us != null ? formatMicro(metrics.max_latency_us) : '—'}</span></span>
            </div>
          </div>

          {/* Card 3: Jitter (RFC 3393 IPDV) */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition" />
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>IPDV Jitter (RFC 3393)</span>
              <Activity className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-slate-100">
              {metrics ? formatMicro(metrics.jitter_us) : '0 µs'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              <span>Samples evaluated: <strong className="text-amber-300">{metrics?.jitter_samples.length || 0}</strong></span>
            </div>
          </div>

          {/* Card 4: Packet Loss Rate */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-2xl group-hover:bg-rose-500/10 transition" />
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Packet Loss Rate</span>
              <ShieldAlert className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-xl font-bold text-slate-100">
              {metrics ? `${(metrics.packet_loss_rate * 100).toFixed(2)}%` : '0.00%'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>Lost: <strong className="text-rose-400">{metrics?.packets_lost || 0}</strong></span>
              <span>Delivered: <strong className="text-emerald-400">{metrics?.packets_delivered || 0}</strong></span>
            </div>
          </div>
        </div>

        {/* Loss Breakdown & Queue Buffers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Detailed Loss Accounting by Cause */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-semibold text-slate-200">Loss Accounting by Root Cause</h3>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Total Drops: {metrics?.packets_lost || 0}
              </span>
            </div>

            <div className="space-y-3">
              {(
                [
                  ['Queue Buffer Overflow', 'queue_overflow', 'bg-amber-500'],
                  ['Link Administratively Down', 'link_down', 'bg-rose-500'],
                  ['Physical Bit Error Corruption', 'bit_error', 'bg-purple-500'],
                  ['Stochastic Link Drop Probability', 'stochastic_loss', 'bg-blue-500'],
                  ['TTL / Hop Limit Expired', 'ttl_expired', 'bg-cyan-500'],
                  ['No Route to Destination', 'no_route', 'bg-slate-500'],
                ] as const
              ).map(([label, key, barColor]) => (
                <div key={key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{label}</span>
                    <span className="font-mono text-slate-200">{metrics?.loss_by_category[key] || 0} pkts</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full ${barColor} transition-all`}
                      style={{
                        width: `${
                          metrics && metrics.packets_lost > 0
                            ? ((metrics.loss_by_category[key] / metrics.packets_lost) * 100).toFixed(1)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Buffer Queues & Retransmissions */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">Queue Buffer & Flow Scope</h3>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Interval: {metrics ? formatMicro(metrics.measurement_interval_us) : '0 µs'}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 pt-1">
              <div>
                <dt className="text-[11px] text-slate-400">Avg queue occupancy</dt>
                <dd className="text-lg font-bold text-slate-100 mt-0.5">
                  {metrics?.queue_occupancy_average.toFixed(2) || '0.00'} pkts
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-400">Peak queue occupancy</dt>
                <dd className="text-lg font-bold text-slate-100 mt-0.5">
                  {metrics?.queue_occupancy_max || 0} pkts
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-400">Retransmissions</dt>
                <dd className="text-lg font-bold text-slate-100 mt-0.5">
                  {metrics?.retransmissions || 0}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-400">Average RTT</dt>
                <dd className="text-lg font-bold text-slate-100 mt-0.5">
                  {metrics?.average_rtt_us != null ? formatMicro(metrics.average_rtt_us) : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Link Utilization Table */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <ArrowDownUp className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-slate-200">Physical Link Utilization</h3>
            </div>
            <span className="text-[11px] text-slate-400">
              {metrics?.link_utilization.length || 0} active links recorded
            </span>
          </div>

          {metrics && metrics.link_utilization.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-medium">
                    <th className="py-2.5 px-3">Link ID</th>
                    <th className="py-2.5 px-3">Busy Time</th>
                    <th className="py-2.5 px-3">Measurement Window</th>
                    <th className="py-2.5 px-3">Utilization (%)</th>
                    <th className="py-2.5 px-3 w-40">Load Bar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {metrics.link_utilization.map((lu) => (
                    <tr key={lu.link_id} className="hover:bg-slate-800/30 transition">
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-200">{lu.link_id}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">{formatMicro(lu.busy_time_us)}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-400">{formatMicro(lu.measurement_time_us)}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-100">
                        {(lu.utilization * 100).toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              lu.utilization > 0.8
                                ? 'bg-rose-500'
                                : lu.utilization > 0.5
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${(lu.utilization * 100).toFixed(1)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs">
              No link utilization recorded yet. Run traffic packets to monitor physical bus occupancy.
            </div>
          )}
        </div>

        {/* Runtime Fault Injection Studio */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <Radio className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200">Runtime Fault Injection Panel</h3>
            </div>
            <span className="text-[11px] text-slate-400">
              Scheduled on the discrete simulation clock
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Fault Type */}
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">Fault Action</label>
              <select aria-label="Fault Action"
                value={faultType}
                onChange={(e) => setFaultType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-brand-500"
              >
                <option value="link_down">Link Down (Break link)</option>
                <option value="link_restore">Link Restore (Repair link)</option>
                <option value="bandwidth_degradation">Bandwidth Degradation</option>
                <option value="queue_capacity_change">Queue Capacity Change</option>
                <option value="node_failure">Node Failure (Crash node)</option>
                <option value="node_recovery">Node Recovery (Reboot node)</option>
                <option value="bit_error">Bit Error Rate Change</option>
              </select>
            </div>

            {/* Target Selection */}
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">Target Resource</label>
              <select aria-label="Target Resource"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-brand-500"
              >
                {faultType.startsWith('node_') ? (
                  project?.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      Node: {n.label} ({n.id})
                    </option>
                  ))
                ) : (
                  project?.links.map((l) => (
                    <option key={l.id} value={l.id}>
                      Link: {l.id} ({l.source.node_id} ↔ {l.target.node_id})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Timestamp */}
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Execution SimTime (µs)
              </label>
              <input aria-label="Execution SimTime (µs)"
                type="number"
                min="0"
                step="1000"
                value={faultTimestampUs}
                onChange={(e) => setFaultTimestampUs(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-brand-500"
              />
            </div>

            {/* Dynamic Parameter value */}
            <div>
              <label
                htmlFor="qos-fault-param-value"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                {faultType === 'bandwidth_degradation'
                  ? 'New Bandwidth (bps)'
                  : faultType === 'queue_capacity_change'
                  ? 'New Queue Capacity'
                  : faultType === 'bit_error'
                  ? 'Error Rate (0.0 – 1.0)'
                  : 'Parameter (N/A)'}
              </label>
              <input
                id="qos-fault-param-value"
                type="number"
                disabled={
                  faultType !== 'bandwidth_degradation' &&
                  faultType !== 'queue_capacity_change' &&
                  faultType !== 'bit_error'
                }
                value={faultParamValue}
                onChange={(e) => setFaultParamValue(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-brand-500 disabled:opacity-60"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleScheduleFault}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-600/20 transition flex items-center space-x-2"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Schedule Fault Event</span>
            </button>
          </div>

          {/* Scheduled Faults History */}
          {scheduledFaults.length > 0 && (
            <div className="pt-3 border-t border-slate-800">
              <h4 className="text-xs font-semibold text-slate-400 tracking-wider mb-2">
                Scheduled Fault Pipeline
              </h4>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {scheduledFaults.map((sf) => (
                  <div
                    key={sf.fault_id}
                    className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-brand-400 font-semibold">{sf.fault_id}</span>
                      <span className="text-slate-300">{sf.description}</span>
                    </div>
                    <span className="font-mono text-slate-400 text-[11px]">{sf.timestamp_us} µs</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
