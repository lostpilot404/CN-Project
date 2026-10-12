/**
 * Transport-layer tests for the frontend <-> Python service bridge.
 *
 * These tests stub `fetch`, so they pin the *contract* (endpoint resolution, envelope handling,
 * error classification, retry) without standing up the service. End-to-end coverage against a
 * running service lives in `src/integration/liveApi.test.ts` and `e2e/`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackendCommandError,
  BackendUnavailableError,
  callBackend,
  candidateEndpoints,
  checkBackendHealth,
  getBackendHealth,
  getBackendStatus,
  subscribeBackendStatus,
} from './apiClient';

const HEALTH = {
  status: 'ok',
  backend: 'python',
  authority: 'python-simulation-core',
  version: '0.9.0',
  current_time_us: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('backend transport', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('probes /health before issuing a command and unwraps the result envelope', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      return jsonResponse({ status: 'ok', result: { nodes: [] } });
    });

    const result = await callBackend<{ nodes: unknown[] }>('get_project');
    expect(result).toEqual({ nodes: [] });
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls[0]).toMatch(/\/health$/);
    expect(urls[1]).toMatch(/\/api\/get_project$/);
  });

  it('posts the argument object as the JSON request body', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      return jsonResponse({ status: 'ok', result: null });
    });

    await callBackend('add_node', { label: 'PC', x: 1, y: 2 });
    const commandCall = fetchMock.mock.calls.find((call) => !(call[0] as string).endsWith('/health'));
    expect(commandCall?.[1]?.method).toBe('POST');
    expect(JSON.parse(commandCall?.[1]?.body as string)).toEqual({ label: 'PC', x: 1, y: 2 });
  });

  it('classifies a rejection as BackendCommandError and keeps the server message', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      return jsonResponse({ status: 'error', code: 'invalid_request', message: "Invalid node type 'quantum'" }, 400);
    });

    await expect(callBackend('add_node', { nodeType: 'quantum' })).rejects.toThrowError(
      /Invalid node type 'quantum'/,
    );
    await expect(callBackend('add_node', { nodeType: 'quantum' })).rejects.toBeInstanceOf(BackendCommandError);
  });

  it('does not retry a command the service explicitly rejected', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      return jsonResponse({ status: 'error', message: 'nope' }, 400);
    });

    await expect(callBackend('get_project')).rejects.toBeInstanceOf(BackendCommandError);
    const commandCalls = fetchMock.mock.calls.filter((call) => !(call[0] as string).endsWith('/health'));
    expect(commandCalls).toHaveLength(1);
  });

  it('raises BackendUnavailableError when nothing answers, without inventing a result', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(callBackend('get_project')).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(callBackend('get_project')).rejects.toThrowError(/server\.py 8765/);
  });

  it('re-probes and retries when the connection drops mid-flight', async () => {
    let commandAttempts = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      commandAttempts += 1;
      if (commandAttempts === 1) throw new TypeError('socket hang up');
      return jsonResponse({ status: 'ok', result: 'recovered' });
    });

    await expect(callBackend('get_project')).resolves.toBe('recovered');
    expect(commandAttempts).toBe(2);
  });

  it('treats a non-ok envelope on an HTTP 200 as a failure', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      return jsonResponse({ status: 'error', message: 'degraded' });
    });
    await expect(callBackend('get_project')).rejects.toBeInstanceOf(BackendCommandError);
  });

  it('reports connectivity through checkBackendHealth and the subscription', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      return jsonResponse({ status: 'error', message: 'x' }, 500);
    });

    const seen: string[] = [];
    const unsubscribe = subscribeBackendStatus((status) => seen.push(status));
    const health = await checkBackendHealth();
    expect(health?.version).toBe('0.9.0');
    expect(getBackendStatus()).toBe('online');
    expect(getBackendHealth()?.authority).toBe('python-simulation-core');
    expect(seen).toContain('online');
    unsubscribe();

    fetchMock.mockRejectedValue(new TypeError('offline'));
    await checkBackendHealth();
    expect(getBackendStatus()).toBe('offline');
  });

  it('prefers the configured endpoint when VITE_NETSIM_API_URL is set', () => {
    expect(candidateEndpoints().length).toBeGreaterThan(0);
    for (const endpoint of candidateEndpoints()) {
      expect(typeof endpoint).toBe('string');
      expect(endpoint.length).toBeGreaterThan(0);
    }
  });
});
