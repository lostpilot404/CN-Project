import { useCallback, useEffect, useState } from 'react';
import { Cable, CircleSlash2, Loader2, Unplug } from 'lucide-react';
import { api } from '../../lib/api';
import { cn, formatBps } from '../../lib/utils';
import { Project } from '../../types/project';
import { Circuit, CircuitRequestResult, CircuitState } from '../../types/switching';

interface SwitchingWorkspaceProps {
  project: Project | null;
}

const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/60';

/**
 * Circuit Switching studio — the educational counterpart to packet switching.
 *
 * A circuit reserves its bandwidth on every link of a routed path before any data
 * moves; requests that cannot get the full rate on every hop are blocked. All
 * state lives in the Python service (netsim/switching/circuit.py).
 */
export const SwitchingWorkspace = ({ project }: SwitchingWorkspaceProps) => {
  const [sourceNodeId, setSourceNodeId] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [bandwidthMbps, setBandwidthMbps] = useState('1');
  const [circuitId, setCircuitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CircuitRequestResult | null>(null);
  const [state, setState] = useState<CircuitState | null>(null);

  const nodes = project?.nodes ?? [];

  const refresh = useCallback(async () => {
    try {
      setState(await api.getCircuitState());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load circuit state');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, project]);

  // Sensible defaults: first and last node of the current topology.
  useEffect(() => {
    if (nodes.length >= 2) {
      setSourceNodeId((prev) => (prev && nodes.some((n) => n.id === prev) ? prev : nodes[0].id));
      setTargetNodeId((prev) =>
        prev && nodes.some((n) => n.id === prev) ? prev : nodes[nodes.length - 1].id
      );
    }
  }, [nodes]);

  const submitRequest = async () => {
    const mbps = Number(bandwidthMbps);
    if (!sourceNodeId || !targetNodeId) return;
    if (!Number.isFinite(mbps) || mbps <= 0) {
      setError('Circuit capacity must be a positive number of Mbps.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.requestCircuit(
        sourceNodeId,
        targetNodeId,
        Math.round(mbps * 1_000_000),
        circuitId.trim() || undefined
      );
      setLastResult(result);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Circuit request failed');
    } finally {
      setBusy(false);
    }
  };

  const teardown = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.teardownCircuit(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teardown failed');
    } finally {
      setBusy(false);
    }
  };

  const metrics = state?.metrics;
  const activeCircuits = (state?.circuits ?? []).filter((c) => c.state === 'active');
  const releasedCircuits = (state?.circuits ?? []).filter((c) => c.state === 'released');
  const reservedLinks = (state?.links ?? []).filter((l) => l.reserved_bps > 0);

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-5" data-testid="switching-workspace">
      {/* Workspace header */}
      <header className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Cable className="w-5 h-5 text-brand-400" aria-hidden="true" />
            Circuit Switching
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Connection-oriented switching: setup reserves a dedicated data rate on{' '}
            <em>every</em> link of the routed path, admission control blocks requests that cannot
            be fully satisfied, and teardown releases the capacity. Distinct from the packet
            engine, where each packet is forwarded independently.
          </p>
        </div>
        <div className="text-[11px] text-slate-500 text-right shrink-0">
          <div>Model: hop-count shortest path</div>
          <div>Reservations: shared per link</div>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-rose-700/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200"
        >
          {error}
        </div>
      )}

      {/* Setup form */}
      <section
        aria-label="Circuit setup"
        className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3"
      >
        <h2 className="text-sm font-semibold text-slate-200">Connection Setup</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label htmlFor="circuit-src" className="block text-[11px] text-slate-400 mb-1">
              Source node
            </label>
            <select
              id="circuit-src"
              className={inputClass}
              value={sourceNodeId}
              onChange={(e) => setSourceNodeId(e.target.value)}
              disabled={busy || nodes.length < 2}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="circuit-dst" className="block text-[11px] text-slate-400 mb-1">
              Destination node
            </label>
            <select
              id="circuit-dst"
              className={inputClass}
              value={targetNodeId}
              onChange={(e) => setTargetNodeId(e.target.value)}
              disabled={busy || nodes.length < 2}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="circuit-bw" className="block text-[11px] text-slate-400 mb-1">
              Reserved capacity (Mbps)
            </label>
            <input
              id="circuit-bw"
              type="number"
              min="0.1"
              step="0.1"
              className={inputClass}
              value={bandwidthMbps}
              onChange={(e) => setBandwidthMbps(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="circuit-id" className="block text-[11px] text-slate-400 mb-1">
              Circuit ID (optional)
            </label>
            <input
              id="circuit-id"
              type="text"
              className={inputClass}
              placeholder="auto"
              value={circuitId}
              onChange={(e) => setCircuitId(e.target.value)}
              disabled={busy}
            />
          </div>
          <button
            type="button"
            onClick={() => void submitRequest()}
            disabled={busy || nodes.length < 2}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors',
              busy || nodes.length < 2
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                : 'bg-brand-600 hover:bg-brand-500 text-white'
            )}
            data-testid="request-circuit"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
            Establish Circuit
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          A request is admitted only when every link on the path can carry the full reserved rate.
          Requests that cannot be satisfied are blocked without side effects.
        </p>
      </section>

      {/* Last result */}
      <section aria-label="Setup result" aria-live="polite">
        {lastResult === null ? (
          <div className="rounded-xl border border-dashed border-slate-800 px-4 py-3 text-xs text-slate-500">
            No circuit request submitted yet. Configure a connection above and press
            “Establish Circuit”.
          </div>
        ) : lastResult.accepted ? (
          <div
            className="rounded-xl border border-emerald-700/50 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200"
            data-testid="circuit-accepted"
          >
            <div className="font-semibold">
              Circuit “{lastResult.circuit_id}” established — {formatBps(lastResult.bandwidth_bps)}{' '}
              reserved on every hop.
            </div>
            <div className="mt-1 font-mono text-emerald-300/90">
              {lastResult.path.join(' → ')}
            </div>
            <div className="mt-1 text-emerald-300/70">
              Reserved links: {lastResult.link_ids.join(', ')}
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-200"
            data-testid="circuit-blocked"
          >
            <div className="font-semibold flex items-center gap-1.5">
              <CircleSlash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Request blocked — admission control rejected this circuit.
            </div>
            <div className="mt-1">{lastResult.reason}</div>
          </div>
        )}
      </section>

      {/* Circuits + reservations + metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Circuits table */}
        <section
          aria-label="Circuits"
          className="lg:col-span-2 rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3"
        >
          <h2 className="text-sm font-semibold text-slate-200">
            Circuits <span className="text-slate-500 font-normal">({activeCircuits.length} active)</span>
          </h2>
          {activeCircuits.length === 0 && releasedCircuits.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">No circuits yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-800">
                    <th className="py-1.5 pr-3 font-medium">Circuit</th>
                    <th className="py-1.5 pr-3 font-medium">Endpoints</th>
                    <th className="py-1.5 pr-3 font-medium">Path</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Reserved</th>
                    <th className="py-1.5 pr-3 font-medium">State</th>
                    <th className="py-1.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...activeCircuits, ...releasedCircuits].map((c: Circuit) => (
                    <tr key={c.circuit_id} className="border-b border-slate-800/60 text-slate-300">
                      <td className="py-1.5 pr-3 font-mono">{c.circuit_id}</td>
                      <td className="py-1.5 pr-3 font-mono">
                        {c.source_node_id} → {c.target_node_id}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-slate-400">{c.path.join(' → ')}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatBps(c.bandwidth_bps)}</td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                            c.state === 'active'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-slate-700/40 text-slate-400'
                          )}
                        >
                          {c.state}
                        </span>
                      </td>
                      <td className="py-1.5 text-right">
                        {c.state === 'active' ? (
                          <button
                            type="button"
                            onClick={() => void teardown(c.circuit_id)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-rose-500/60 hover:text-rose-300 disabled:opacity-50"
                            aria-label={`Tear down circuit ${c.circuit_id}`}
                          >
                            <Unplug className="w-3 h-3" aria-hidden="true" />
                            Teardown
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-500" title={c.released_reason ?? ''}>
                            released
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Metrics + link utilisation */}
        <section
          aria-label="Admission metrics"
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-4"
        >
          <h2 className="text-sm font-semibold text-slate-200">Admission Metrics</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-slate-400">Requests</dt>
              <dd className="text-slate-100 font-mono text-sm">{metrics?.requests_total ?? 0}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Accepted</dt>
              <dd className="text-emerald-300 font-mono text-sm">{metrics?.requests_accepted ?? 0}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Blocked</dt>
              <dd className="text-amber-300 font-mono text-sm">{metrics?.requests_blocked ?? 0}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Released</dt>
              <dd className="text-slate-300 font-mono text-sm">{metrics?.circuits_released ?? 0}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Acceptance rate</dt>
              <dd className="text-slate-100 font-mono text-sm">
                {((metrics?.acceptance_rate ?? 0) * 100).toFixed(1)}%
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Blocking rate</dt>
              <dd className="text-slate-100 font-mono text-sm">
                {((metrics?.blocking_rate ?? 0) * 100).toFixed(1)}%
              </dd>
            </div>
          </dl>

          <h2 className="text-sm font-semibold text-slate-200 pt-2 border-t border-slate-800">
            Link Reservations
          </h2>
          {reservedLinks.length === 0 ? (
            <div className="text-xs text-slate-500">No capacity reserved.</div>
          ) : (
            <ul className="space-y-2.5">
              {reservedLinks.map((l) => (
                <li key={l.link_id}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="font-mono text-slate-300">{l.link_id}</span>
                    <span className="text-slate-400 font-mono">
                      {formatBps(l.reserved_bps)} / {formatBps(l.capacity_bps)}
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
                    role="meter"
                    aria-valuenow={Math.round(l.utilization * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Reservation utilisation of ${l.link_id}`}
                  >
                    <div
                      className="h-full bg-brand-500"
                      style={{ width: `${Math.min(100, l.utilization * 100).toFixed(1)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
