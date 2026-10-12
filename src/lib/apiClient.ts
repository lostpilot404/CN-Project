/**
 * Authoritative transport layer for the NetSim frontend.
 *
 * The simulation itself lives in the Python service (`python/netsim/server.py`). Everything the
 * UI displays is produced by that service; the frontend never fabricates simulation results.
 *
 * Resolution order for the service endpoint:
 *   1. `VITE_NETSIM_API_URL` (explicit override, e.g. `http://127.0.0.1:8765`)
 *   2. `http://127.0.0.1:8765` (default desktop / local development endpoint)
 *   3. same-origin `/netsim-api` (used when the UI is served through a proxy/preview host that
 *      forwards that prefix to the Python service -- see `vite.config.ts`)
 *
 * Reachability is probed through `GET /health` and cached. When every candidate fails the call
 * rejects with `BackendUnavailableError`; the UI surfaces this instead of inventing data.
 */

export interface BackendHealth {
  status: string;
  backend: string;
  authority: string;
  version: string;
  current_time_us: number;
}

export type BackendStatus = 'connecting' | 'online' | 'offline' | 'unknown';

export class BackendUnavailableError extends Error {
  readonly candidates: string[];
  constructor(message: string, candidates: string[] = []) {
    super(message);
    this.name = 'BackendUnavailableError';
    this.candidates = candidates;
  }
}

/** A command reached the service but was rejected (HTTP 4xx/5xx with a server message). */
export class BackendCommandError extends Error {
  readonly command: string;
  readonly status: number;
  constructor(command: string, status: number, message: string) {
    super(message);
    this.name = 'BackendCommandError';
    this.command = command;
    this.status = status;
  }
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765';
const PROXY_ENDPOINT = '/netsim-api';

function configuredEndpoint(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const value = env?.VITE_NETSIM_API_URL;
  return value && value.length > 0 ? value.replace(/\/+$/, '') : null;
}

export function candidateEndpoints(): string[] {
  const configured = configuredEndpoint();
  if (configured) return [configured];
  // Same-origin first when the page is not served from loopback: that is the proxied/preview
  // deployment. Loopback is preferred for the desktop shell and local development.
  const isLoopbackPage =
    typeof window !== 'undefined' &&
    ['127.0.0.1', 'localhost', '::1', 'tauri.localhost'].includes(window.location.hostname);
  return isLoopbackPage
    ? [DEFAULT_ENDPOINT, PROXY_ENDPOINT]
    : [PROXY_ENDPOINT, DEFAULT_ENDPOINT];
}

/** True when running under the unit-test runner (`vitest`). */
export function isTestMode(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.MODE === 'test';
}

/**
 * Opt-in switch that makes the unit-test runner talk to the real Python service.
 *
 * Vite only exposes `VITE_`-prefixed variables through `import.meta.env`, so the flag is read
 * from the process environment as well. Outside a Node-based test runner `process` is undefined
 * and this always returns false.
 */
export function liveApiRequested(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (env?.NETSIM_LIVE_API === '1' || env?.VITE_NETSIM_LIVE_API === '1') return true;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.NETSIM_LIVE_API === '1';
}

let resolvedEndpoint: string | null = null;
let lastHealth: BackendHealth | null = null;
let status: BackendStatus = 'unknown';
const listeners = new Set<(status: BackendStatus, health: BackendHealth | null) => void>();

function setStatus(next: BackendStatus, health: BackendHealth | null): void {
  status = next;
  if (health) lastHealth = health;
  listeners.forEach((listener) => listener(status, lastHealth));
}

export function getBackendStatus(): BackendStatus {
  return status;
}

export function getBackendHealth(): BackendHealth | null {
  return lastHealth;
}

/** Subscribe to connectivity changes. Returns an unsubscribe function. */
export function subscribeBackendStatus(
  listener: (status: BackendStatus, health: BackendHealth | null) => void,
): () => void {
  listeners.add(listener);
  listener(status, lastHealth);
  return () => listeners.delete(listener);
}

async function probe(endpoint: string): Promise<BackendHealth | null> {
  try {
    const res = await fetch(`${endpoint}/health`, { method: 'GET' });
    if (!res.ok) return null;
    const data = (await res.json()) as BackendHealth;
    return data && data.status === 'ok' ? data : null;
  } catch {
    return null;
  }
}

/**
 * Probe the Python service. Returns the health payload when reachable, otherwise `null`.
 * Pass `notify = true` (default) to broadcast the result to status subscribers.
 */
export async function checkBackendHealth(notify = true): Promise<BackendHealth | null> {
  setStatus(notify ? 'connecting' : status, null);
  for (const endpoint of candidateEndpoints()) {
    const health = await probe(endpoint);
    if (health) {
      resolvedEndpoint = endpoint;
      setStatus('online', health);
      return health;
    }
  }
  resolvedEndpoint = null;
  setStatus('offline', null);
  return null;
}

async function endpoint(): Promise<string> {
  if (resolvedEndpoint) {
    const health = await probe(resolvedEndpoint);
    if (health) return resolvedEndpoint;
    resolvedEndpoint = null;
  }
  const candidates = candidateEndpoints();
  for (const candidate of candidates) {
    const health = await probe(candidate);
    if (health) {
      resolvedEndpoint = candidate;
      setStatus('online', health);
      return candidate;
    }
  }
  setStatus('offline', null);
  throw new BackendUnavailableError(
    `Cannot reach the NetSim simulation service. Start it with: python python/netsim/server.py 8765`,
    candidates,
  );
}

export interface CommandEnvelope<T> {
  status: string;
  result?: T;
  message?: string;
}

/**
 * Execute a simulation command against the authoritative Python service.
 * Retries once against a freshly probed endpoint, which recovers cleanly from a backend
 * restart without the UI having to reload.
 */
export async function callBackend<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  let lastError: unknown = new BackendUnavailableError('No simulation service endpoint responded.', []);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const base = await endpoint();
    try {
      const res = await fetch(`${base}/api/${cmd}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      });
      const text = await res.text();
      let payload: CommandEnvelope<T> | null = null;
      try {
        payload = text ? (JSON.parse(text) as CommandEnvelope<T>) : null;
      } catch {
        payload = null;
      }
      if (!res.ok || !payload || payload.status !== 'ok') {
        const message =
          payload?.message ??
          (text && text.length > 0 ? text : `HTTP ${res.status} from the simulation service`);
        throw new BackendCommandError(cmd, res.status, message);
      }
      return payload.result as T;
    } catch (err) {
      if (err instanceof BackendCommandError) throw err;
      lastError = err;
      resolvedEndpoint = null; // transport-level failure: re-probe before the retry
    }
  }
  if (lastError instanceof BackendUnavailableError) throw lastError;
  throw new BackendUnavailableError(
    `Cannot reach the NetSim simulation service (${
      lastError instanceof Error ? lastError.message : String(lastError)
    }). Start it with: python python/netsim/server.py 8765`,
    candidateEndpoints(),
  );
}
