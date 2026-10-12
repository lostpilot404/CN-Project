/**
 * Live integration tests: the frontend API layer against the real Python service.
 *
 * These are the only tests in `src/` that reach a real simulation backend; they exercise the same
 * code path the browser uses (`api.*` -> `callBackend` -> HTTP -> Python core) and assert on
 * engine-produced values rather than fixtures.
 *
 * Run with the service started and the opt-in flag set:
 *   python python/netsim/server.py 8765
 *   NETSIM_LIVE_API=1 npx vitest run src/integration
 *
 * Without `NETSIM_LIVE_API` the suite is skipped so the default `npm test` stays hermetic.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, getSimulationAuthority } from '../lib/api';
import { checkBackendHealth, getBackendStatus } from '../lib/apiClient';

const live = process.env.NETSIM_LIVE_API === '1';

describe.skipIf(!live)('live Python service integration', () => {
  beforeAll(async () => {
    const health = await checkBackendHealth();
    if (!health) {
      throw new Error(
        'NETSIM_LIVE_API=1 but no simulation service is reachable. ' +
          'Start it with: python python/netsim/server.py 8765',
      );
    }
  });

  it('reports the running service as the simulation authority', async () => {
    await api.getProject();
    expect(getSimulationAuthority()).toBe('python');
    expect(getBackendStatus()).toBe('online');
  });

  it('creates the default project and returns its three-node topology', async () => {
    const project = await api.createProject('live-integration');
    expect(project.metadata.name).toBe('live-integration');
    expect(project.nodes.map((node) => node.id)).toEqual(['node-1', 'node-2', 'node-3']);
    expect(project.links.map((link) => link.id)).toEqual(['link-1', 'link-2']);
    // Interfaces carry the snake_case keys the UI reads (regression: raw dict access)
    expect(project.nodes[0].interfaces[0].mac_address).toMatch(/^02:00:00/);
    expect(project.nodes[0].interfaces[0].link_id).toBe('link-1');
  });

  it('runs a packet end to end and reports the engine-measured timing', async () => {
    await api.createProject('live-integration');
    await api.updateLink('link-1', 1_000_000, 1000);
    await api.updateLink('link-2', 1_000_000, 1000);

    const packetId = await api.injectPacket('node-1', 'node-3', 1000, 'HTTP', 'TCP');
    await api.runSimulationUntilEmpty();
    const packet = await api.getPacketDetails(packetId);
    expect(packet).not.toBeNull();

    expect(packet!.state).toBe('delivered');
    // 5 us ingress + 2 x (8000 us serialisation + 1000 us propagation) + 1 us forwarding
    expect(packet!.hop_history[packet!.hop_history.length - 1].timestamp_us).toBe(18006);
  });

  it('computes a routing table through the service', async () => {
    await api.createProject('live-integration');
    const table = await api.calculateRoutingTable('node-2', 'dijkstra', 'hop_count');
    const routes = Object.fromEntries(table.entries.map((entry) => [entry.destination, entry.metric]));
    expect(routes['node-1']).toBe(1);
    expect(routes['node-3']).toBe(1);
  });

  it('rejects invalid input with a server message rather than a fabricated result', async () => {
    await api.createProject('live-integration');
    await expect(api.addNode('Broken', 'quantum' as never, 10, 10)).rejects.toThrowError(/Invalid node type/);
    await expect(api.simulateDns({ query_name: '' } as never)).rejects.toThrowError(/must not be empty/);
  });

  it('produces identical results for identical protocol configurations', async () => {
    await api.createProject('live-integration');
    const config = {
      protocol: 'go_back_n' as const,
      window_size: 4,
      sequence_space: 8,
      total_frames_to_send: 6,
      dropped_frame_indices: [2],
      seed: 42,
    };
    const first = await api.simulateGoBackN(config as never);
    const second = await api.simulateGoBackN(config as never);
    expect(second.metrics).toEqual(first.metrics);
    expect(first.metrics.retransmissions).toBe(4);
  });

  it('runs a MAC simulation through the service for every protocol', async () => {
    await api.createProject('live-integration');
    const protocols = [
      api.simulatePureAloha,
      api.simulateSlottedAloha,
      api.simulateCsma,
      api.simulateCsmaCd,
    ];
    for (const simulate of protocols) {
      const result = await simulate({ protocol: 'csma_cd', num_stations: 6, total_frames_to_send: 20, seed: 3 } as never);
      expect(result.completed_successfully).toBe(true);
      expect(result.metrics.successful_transmissions).toBeGreaterThan(0);
    }
  });
});
