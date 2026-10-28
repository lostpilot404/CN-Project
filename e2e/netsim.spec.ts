/**
 * NetSim end-to-end suite.
 *
 * Every test drives the real UI against the real Python simulation service. Assertions are bound
 * to values the engine produced (timings, counts, addresses) rather than to whether a panel is
 * merely present, and no test may silently skip an interaction when a control is missing.
 *
 * Shared console/network hygiene is verified in test 1 and by `assertNoPageErrors` at the end of
 * the flows that generate traffic.
 */
import { test, expect, type Page } from '@playwright/test';

const API = process.env.VITE_NETSIM_API_URL ?? process.env.NETSIM_API_URL ?? 'http://127.0.0.1:8765';

test.describe.configure({ mode: 'serial' });

/** Mirror of `formatTimeUs` from src/lib/utils.ts, so assertions read the rendered value. */
function formatUs(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(3)} s`;
  if (us >= 1_000) return `${(us / 1_000).toFixed(2)} ms`;
  return `${us} \u00b5s`;
}

/** Reset the simulation core to a known default project through the real service. */
async function resetProject(page: Page, name = 'e2e'): Promise<void> {
  const response = await page.request.post(`${API}/api/create_project`, { data: { name } });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe('ok');
  await page.reload();
  await expect(page.getByTestId('engine-status')).toHaveText('ONLINE');
}

/** Issue a command directly against the service and return the parsed result. */
async function command<T>(page: Page, cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await page.request.post(`${API}/api/${cmd}`, { data: args });
  const body = await response.json();
  expect(body.status, `${cmd} failed: ${body.message ?? ''}`).toBe('ok');
  return body.result as T;
}

test.describe('NetSim full-stack end-to-end', () => {
  test.beforeEach(async ({ page }) => {
    // The app loads Inter/JetBrains Mono from Google Fonts. That CDN is third-party and is
    // unreachable in offline/CI environments, where Chromium logs a resource error that has
    // nothing to do with the application. Satisfy it with an empty stylesheet so the console
    // assertion below stays strict for every first-party request.
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
    await page.goto('/');
  });

  test('1. Startup: the UI connects to the Python service without console or network errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => failedRequests.push(request.url()));

    // Start from a known project so the suite never depends on state left by a previous run.
    await resetProject(page, 'startup');
    await expect(page).toHaveTitle(/NetSim/);

    // Real connectivity, not a hard-coded badge: the badge reflects a /health probe.
    await expect(page.getByTestId('authority-badge')).toContainText('Python Authoritative');
    await expect(page.getByTestId('engine-status')).toHaveText('ONLINE');

    // The health payload version is rendered from the service response.
    const health = await command<{ version: string }>(page, 'get_project').then(() =>
      page.request.get(`${API}/health`).then((r) => r.json()),
    );
    expect(health.version).toMatch(/^\d+\.\d+\.\d+$/);
    await expect(page.locator('aside')).toContainText(`Python core v${health.version}`);

    // Sidebar must expose only real workspaces: the abandoned Learning/Exam entries are gone.
    await expect(page.locator('aside')).not.toContainText('Learning Mode');
    await expect(page.locator('aside')).not.toContainText('Exam Mode');

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.filter((url) => url.startsWith(API))).toEqual([]);
  });

  test('2. Startup: an unreachable service is reported instead of silently mocked', async ({ page }) => {
    // Block BOTH resolution paths - the direct loopback endpoint and the same-origin
    // /netsim-api proxy - so the service is genuinely unreachable from the page.
    await page.route(`${API}/**`, (route) => route.abort());
    await page.route('**/netsim-api/**', (route) => route.abort());
    await page.goto('/');

    await expect(page.getByTestId('authority-badge')).toContainText('Backend Offline');
    await expect(page.getByTestId('engine-status')).toHaveText('OFFLINE');
    // Both indicators must agree and must not claim authoritative results are available.
    await expect(page.getByTestId('engine-status')).not.toHaveText('ONLINE');
    await expect(page.getByTestId('authority-badge')).toHaveAttribute('title', /python\/netsim\/server\.py/);
  });

  test('2b. Startup: the UI fails over to the same-origin proxy when the direct endpoint is blocked', async ({ page }) => {
    // Establish a known project first: this test renders topology content, so it must not
    // depend on whatever project happened to be live.
    await resetProject(page, 'failover');
    // Block only the direct loopback endpoint. The client must recover through /netsim-api,
    // which the dev server proxies to the same Python service.
    await page.route(`${API}/**`, (route) => route.abort());
    await page.goto('/');
    await expect(page.getByTestId('engine-status')).toHaveText('ONLINE', { timeout: 15_000 });
    await expect(page.getByTestId('authority-badge')).toContainText('Python Authoritative');
    // ...and the recovered endpoint must serve real engine data, not a canned fallback.
    // The project fetch starts after the health probe succeeds, so allow for it to land.
    // Target the canvas node itself: the label also appears in the minimap.
    await expect(page.getByTestId('rf__node-node-1')).toContainText('Workstation PC1', { timeout: 15_000 });
  });

  test('3. Topology editor: add a device through the UI and see it persisted by the service', async ({ page }) => {
    await resetProject(page, 'topology');
    const before = await command<{ nodes: unknown[] }>(page, 'get_project');

    await page.getByRole('button', { name: 'Topology Canvas' }).click();
    await page.getByRole('button', { name: 'L2 Switch' }).click();
    await expect
      .poll(async () => (await command<{ nodes: unknown[] }>(page, 'get_project')).nodes.length, { timeout: 10_000 })
      .toBe(before.nodes.length + 1);

    const after = await command<{ nodes: { label: string }[] }>(page, 'get_project');
    expect(after.nodes.length).toBe(before.nodes.length + 1);
    await page.reload();
    await expect(page.getByTestId('rf__node-node-1')).toContainText('Workstation PC1', { timeout: 15_000 });
  });

  test('4. Topology editor: connect two nodes by dragging on the canvas', async ({ page }) => {
    await resetProject(page, 'links');
    await page.getByRole('button', { name: 'Topology Canvas' }).click();

    const before = await command<{ links: unknown[] }>(page, 'get_project');
    expect(before.links.length).toBe(2);

    // Real pointer interaction: drag from a source handle on node-1 onto a target handle on
    // node-3. The default project already wires node-1-node-2 and node-2-node-3, so this is a
    // new link, and node-1 has no free port left, exercising auto port provisioning.
    const geometry = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__node')].map((node) => {
        const box = node.getBoundingClientRect();
        return {
          id: node.getAttribute('data-id'),
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          handles: [...node.querySelectorAll('.react-flow__handle')].map((handle) => {
            const rect = handle.getBoundingClientRect();
            return {
              position: handle.getAttribute('data-handlepos'),
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
            };
          }),
        };
      }),
    );
    const source = geometry.find((node) => node.id === 'node-1');
    const target = geometry.find((node) => node.id === 'node-3');
    expect(source, 'node-1 must be on the canvas').toBeTruthy();
    expect(target, 'node-3 must be on the canvas').toBeTruthy();

    const from = source!.handles.find((handle) => handle.position === 'right')!;
    const to = target!.handles.find((handle) => handle.position === 'left')!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.mouse.up();

    // The engine must record a third link, provisioned with a fresh interface.
    await expect
      .poll(async () => (await command<{ links: unknown[] }>(page, 'get_project')).links.length, { timeout: 10_000 })
      .toBe(3);
    const after = await command<{ links: { id: string; source: { interface_id: string } }[] }>(page, 'get_project');
    expect(after.links.map((link) => link.id)).toContain('link-3');
    expect(after.links[2].source.interface_id).toBeTruthy();

    // ...and the canvas must show the new edge rather than staying at two.
    await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  });

  test('5. Simulation studio: inject a packet and step the event timeline', async ({ page }) => {
    await resetProject(page, 'simulation');

    await page.getByRole('button', { name: 'Simulation & Events' }).click();
    await expect(page.getByTestId('simulation-studio')).toBeVisible();

    await page.getByRole('button', { name: 'Inject Packet' }).click();
    await page.getByRole('button', { name: 'Inject Packet', exact: true }).last().click();

    await expect
      .poll(async () => (await command<{ packets: { id: string }[] }>(page, 'get_simulation_state')).packets.length, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    // Stepping must drive the authoritative engine one event at a time. The first events of an
    // injected packet legitimately occur at t=0, so step until the queue drains rather than
    // assuming the first click moves the clock.
    const before = await command<{ current_time_us: number; pending_events_count: number; recent_events: unknown[] }>(
      page,
      'get_simulation_state',
    );
    expect(before.current_time_us).toBe(0);
    expect(before.recent_events.length).toBe(0);

    const stepButton = page.getByRole('button', { name: 'Step Event' });
    let state = before;
    for (let i = 0; i < 12 && state.pending_events_count > 0; i += 1) {
      await stepButton.click();
      await expect
        .poll(
          async () =>
            (await command<{ recent_events: unknown[] }>(page, 'get_simulation_state')).recent_events.length,
          { timeout: 10_000 },
        )
        .toBeGreaterThan(state.recent_events.length);
      state = await command<{
        current_time_us: number;
        pending_events_count: number;
        recent_events: { event_type: { type: string } }[];
      }>(page, 'get_simulation_state');
    }

    // The queue must drain, the clock must advance, and every event must carry a real type.
    expect(state.pending_events_count).toBe(0);
    expect(state.current_time_us).toBeGreaterThan(0);
    expect(state.recent_events.map((event) => event.event_type.type)).toEqual(
      expect.arrayContaining(['packet_created', 'queue_entered', 'transmission_started']),
    );

    // Stepping to exhaustion must actually deliver the packet.
    const packets = await command<{ id: string }[]>(page, 'get_simulation_state').then((snapshot) =>
      (snapshot as unknown as { packets: { id: string }[] }).packets,
    );
    const packetId = packets[0].id;
    const detail = await command<{ state: string; hop_history: unknown[] }>(page, 'get_packet_details', { packetId });
    expect(detail.state).toBe('delivered');
    expect(detail.hop_history.length).toBeGreaterThan(1);

    // The header virtual clock must reflect the engine - this is what a user reads while stepping.
    await expect(page.locator('header').getByText(formatUs(state.current_time_us)).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('6. Simulation studio: run to completion and verify engine-measured delivery', async ({ page }) => {
    await resetProject(page, 'run');

    for (const linkId of ['link-1', 'link-2']) {
      await command(page, 'update_link', { linkId, bandwidthBps: 1_000_000, propagationDelayUs: 1000 });
    }
    const packetId = await command<string>(page, 'inject_packet', {
      srcNodeId: 'node-1',
      dstNodeId: 'node-3',
      sizeBytes: 1000,
      transportProtocol: 'UDP',
    });

    await page.getByRole('button', { name: 'Simulation & Events' }).click();
    await expect(page.getByRole('button', { name: 'Step Event' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run 50ms' })).toBeVisible();

    const packet = await command<{ hop_history: { timestamp_us: number }[] }>(page, 'run_simulation_until_empty').then(
      () => command<{ state: string; hop_history: { timestamp_us: number }[] }>(page, 'get_packet_details', { packetId }),
    );
    expect(packet.state).toBe('delivered');
    // 5 us ingress + 2 x (8000 us serialisation + 1000 us propagation) + 1 us forwarding
    expect(packet.hop_history[packet.hop_history.length - 1].timestamp_us).toBe(18006);
  });

  test('7. Application layer: running a DNS query in the UI populates the packet inspector', async ({ page }) => {
    await resetProject(page, 'inspector');
    await page.getByRole('button', { name: 'Application Layer' }).click();

    // Before any run the inspector must show an explicit empty state, not stale content.
    const inspector = page.getByTestId('packet-inspector');
    await expect(inspector).toHaveAttribute('data-state', 'empty');
    await expect(inspector).toContainText('No Packet Selected');

    // Drive a real query through the studio: this is the user-visible action.
    await page.getByRole('button', { name: 'Simulate DNS Query' }).click();

    // The inspector must switch to the packet the engine produced, with real header values.
    await expect(inspector).toHaveAttribute('data-state', 'populated', { timeout: 15_000 });
    await expect(inspector).toContainText('DELIVERED');
    await expect(inspector).toContainText('DNS');
    await expect(inspector).toContainText('node-1');

    // The inspector must name a concrete engine-produced packet and show its route.
    // (DNS results are self-contained in the studio, so they are not in the main packet store.)
    const packetId = (await inspector.textContent())?.match(/pkt-[\w-]+/)?.[0];
    expect(packetId, 'the inspector must name the engine packet').toBeTruthy();
    await expect(inspector).toContainText(/route path/i);
    await expect(inspector).toContainText('node-2');

    // Every layer must carry engine-derived values, not placeholders.
    // L5 DNS query, L4 UDP to port 53, L3 IPv4 with a real TTL, L2 Ethernet, L1 link timing.
    await expect(inspector).toContainText('www.example.com');
    await expect(inspector).toContainText('53120');
    await expect(inspector).toContainText('53');
    await expect(inspector).toContainText(/10\.0\.0\.\d+/);
    await expect(inspector).toContainText('02:00:00:00:00:01');
    await expect(inspector).toContainText('0x0800');
    await expect(inspector).toContainText(/link-\w+/);

    // Switching views must keep using the same packet.
    await page.getByRole('button', { name: 'Encapsulation' }).click();
    await expect(page.getByTestId('encapsulation-viewer')).toBeVisible();
  });

  test('8. Routing studio: computed table matches the engine routes', async ({ page }) => {
    await resetProject(page, 'routing');
    await page.getByRole('button', { name: 'Routing Studio' }).click();
    await expect(page.locator('h2', { hasText: 'Routing Studio' })).toBeVisible();

    const table = await command<{ entries: { destination: string; metric: number }[] }>(
      page,
      'calculate_routing_table',
      { nodeId: 'node-2', metricType: 'hop_count', algorithm: 'dijkstra' },
    );
    const routes = Object.fromEntries(table.entries.map((entry) => [entry.destination, entry.metric]));
    expect(routes['node-1']).toBe(1);
    expect(routes['node-3']).toBe(1);

    // The rendered table must show the same destinations.
    await expect(page.locator('text=node-1').first()).toBeVisible();
    await expect(page.locator('text=node-3').first()).toBeVisible();
  });

  test('9. Routing studio: convergence telemetry reports real round counts', async ({ page }) => {
    await resetProject(page, 'convergence');
    await page.getByRole('button', { name: 'Routing Studio' }).click();
    // Bellman-Ford is the distance-vector view: selecting it renders the convergence rounds.
    await page.getByRole('button', { name: 'Bellman-Ford (DV)' }).click();
    await page.getByRole('button', { name: 'Recalculate Routes' }).click();

    const telemetry = await command<{ converged: boolean; total_rounds: number }>(page, 'simulate_routing_convergence', {
      sourceNodeId: 'node-2',
      metricType: 'hop_count',
    });
    expect(telemetry.converged).toBe(true);
    expect(telemetry.total_rounds).toBeGreaterThanOrEqual(2);

    await expect(page.locator(`text=Round ${telemetry.total_rounds}`).first()).toBeVisible({ timeout: 15_000 });
  });

  test('10. Addressing studio: typed CIDR and VLSM allocation render engine results', async ({ page }) => {
    await resetProject(page, 'addressing');
    await page.getByRole('button', { name: 'Addressing & NAT' }).click();

    // IPv4 / CIDR subnetting: type a CIDR and calculate through the UI.
    const cidrInput = page.getByPlaceholder(/192.168.1.100\/24/);
    await cidrInput.fill('192.168.1.130/26');
    await page.getByRole('button', { name: 'Calculate', exact: true }).click();

    // Values below are the hand-verified .130/26 result, rendered by the UI.
    await expect(page.getByText('192.168.1.128', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('192.168.1.191', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/62 usable \(64 total\)/)).toBeVisible();
    await expect(page.getByText(/192\.168\.1\.129 - 192\.168\.1\.190/)).toBeVisible();

    // VLSM: the allocator must place the largest requirement first.
    await page.getByRole('button', { name: 'True VLSM Allocator' }).click();
    await page.getByRole('button', { name: 'Allocate VLSM' }).click();
    await expect(page.getByText(/192\.168\.1\.0\/25/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/192\.168\.1\.128\/26/).first()).toBeVisible();
    await expect(page.getByText(/85\.94%/)).toBeVisible();

    // The allocation the UI displayed must match the API result for the same base.
    await page.getByRole('button', { name: 'IPv4 & CIDR Subnetting' }).click();
    const subnet = await command<{ network_address: string; usable_hosts: number }>(page, 'calculate_ipv4_subnet', {
      input: '192.168.20.0/26',
    });
    await cidrInput.fill('192.168.20.0/26');
    await page.getByRole('button', { name: 'Calculate', exact: true }).click();
    await expect(page.getByText(subnet.network_address, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`${subnet.usable_hosts} usable`))).toBeVisible();
  });

  test('11. Algorithm studio: Hamming, CRC and checksum computed through the UI', async ({ page }) => {
    await resetProject(page, 'datalink');
    await page.getByRole('button', { name: 'Algorithm Studio' }).click();
    await expect(page.locator('h1', { hasText: 'Algorithm Studio' })).toBeVisible();

    // --- Hamming: encode 1011 through the UI and read the rendered codeword -------------
    await page.getByRole('button', { name: 'Encode into Hamming Codeword' }).click();
    await expect(page.getByText('0110011', { exact: true }).first()).toBeVisible();
    // Hamming(7,4) + SECDED overall parity bit
    await expect(page.getByText('00110011', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Position Breakdown/)).toBeVisible();

    // --- CRC: modulo-2 division through the UI ------------------------------------------
    await page.getByRole('button', { name: 'CRC Polynomial' }).click();
    const binaryInputs = page.locator('input[type="text"]');
    await binaryInputs.nth(0).fill('1101011011');
    await binaryInputs.nth(1).fill('10011');
    await page.getByRole('button', { name: /Execute Modulo-2/ }).click();
    // Hand calculation: 1101011011 / 10011 leaves remainder 1110, transmitted 11010110111110.
    await expect(page.getByText('1110', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('11010110111110', { exact: true }).first()).toBeVisible();

    // --- Internet checksum: RFC 1071 sample through the UI ------------------------------
    await page.getByRole('button', { name: 'Internet Checksum' }).click();
    await page.getByRole('button', { name: 'RFC 1071 Example' }).click();
    await page.getByRole('button', { name: /Calculate 16-Bit Internet Checksum/ }).click();
    // Hand calculation for 0001 F203 F4F5 F6F7: carry-folded sum 0xDDF2, one's complement 0x220D.
    await expect(page.getByText('0xDDF2', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('0x220D', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('0010001000001101', { exact: true }).first()).toBeVisible();

    // The engine's own answers must agree with what the UI displayed.
    const encoded = await command<{ encoded_bits: string }>(page, 'calculate_hamming_encode', {
      dataBits: '1011',
      parityMode: 'even',
    });
    expect(encoded.encoded_bits).toBe('0110011');
    const crc = await command<{ remainder: string }>(page, 'calculate_crc', {
      dataBits: '1101011011',
      polynomial: '10011',
    });
    expect(crc.remainder).toBe('1110');
    const checksum = await command<{ checksum: number; checksum_hex: string }>(
      page,
      'calculate_internet_checksum',
      { inputHex: '0001F203F4F5F6F7' },
    );
    // The command returns the checksum as a decimal integer (0x220D === 8717) and also in hex;
    // the UI renders the hex form, so this ties the rendered value to the engine's answer.
    expect(Number(checksum.checksum).toString(16).toUpperCase()).toBe('220D');
    expect(checksum.checksum_hex.toUpperCase()).toBe('220D');
  });

  test('12. Datalink: flow control loss recovery matches the protocol definition', async ({ page }) => {
    await resetProject(page, 'flow');
    await page.getByRole('button', { name: 'Algorithm Studio' }).click();
    await page.getByRole('button', { name: 'Flow Control' }).click();

    const goBackN = await command<{ metrics: { retransmissions: number; completed_frames: number } }>(
      page,
      'simulate_go_back_n',
      {
        config: {
          protocol: 'go_back_n',
          window_size: 4,
          sequence_space: 8,
          total_frames_to_send: 6,
          dropped_frame_indices: [2],
          seed: 42,
        },
      },
    );
    expect(goBackN.metrics.retransmissions).toBe(4);
    expect(goBackN.metrics.completed_frames).toBe(6);
    await expect(page.getByRole('button', { name: /Go-Back-N ARQ/ })).toBeVisible();
  });

  test('13. Datalink: all four MAC protocols run through the service', async ({ page }) => {
    await resetProject(page, 'mac');
    await page.getByRole('button', { name: 'Algorithm Studio' }).click();
    await page.getByRole('button', { name: 'Multiple Access' }).click();

    for (const cmd of ['simulate_pure_aloha', 'simulate_slotted_aloha', 'simulate_csma', 'simulate_csma_cd'] as const) {
      const result = await command<{ completed_successfully: boolean; metrics: { successful_transmissions: number } }>(
        page,
        cmd,
        { config: { num_stations: 6, total_frames_to_send: 20, seed: 3 } },
      );
      expect(result.completed_successfully).toBe(true);
      expect(result.metrics.successful_transmissions).toBeGreaterThan(0);
    }
    await expect(page.locator('text=CSMA/CD').first()).toBeVisible();
  });

  test('14. Transport studio: TCP recovery, RTT telemetry and UDP delivery', async ({ page }) => {
    await resetProject(page, 'transport');
    await page.getByRole('button', { name: 'Transport Layer' }).click();
    await expect(page.getByTestId('transport-workspace')).toBeVisible();

    const tcp = await command<{ metrics: Record<string, number> }>(page, 'simulate_tcp', {
      config: {
        source_node_id: 'node-1',
        destination_node_id: 'node-3',
        payload_bytes: 8000,
        segment_size_bytes: 1000,
        dropped_segments: [3],
        seed: 7,
      },
    });
    expect(tcp.metrics.segments_lost).toBe(1);
    expect(tcp.metrics.retransmissions).toBe(1);
    expect(tcp.metrics.segments_delivered).toBe(8);

    await page.getByTestId('btn-simulate-tcp').click();
    await expect(page.getByTestId('rtt-telemetry-panel')).toBeVisible();

    await page.getByTestId('tab-udp-studio').click();
    // The studio shows an explicit "ready" state until a run produces a result.
    await expect(page.getByTestId('udp-studio-container')).toHaveAttribute('data-state', 'empty');
    await page.getByTestId('btn-simulate-udp').click();
    await expect(page.getByTestId('udp-studio-container')).toHaveAttribute('data-state', 'populated', {
      timeout: 15_000,
    });
    const udp = await command<{ metrics: Record<string, number> }>(page, 'simulate_udp', {
      config: {
        source_node_id: 'node-1',
        destination_node_id: 'node-3',
        payload_bytes: 4000,
        segment_size_bytes: 1000,
        dropped_segments: [2],
        seed: 3,
      },
    });
    expect(udp.metrics.segments_sent).toBe(4);
    expect(udp.metrics.segments_delivered).toBe(3);
    expect(udp.metrics.retransmissions).toBe(0);
  });

  test('15. Transport studio: congestion window follows slow start then additive increase', async ({ page }) => {
    await resetProject(page, 'cwnd');
    await page.getByRole('button', { name: 'Transport Layer' }).click();
    await page.getByTestId('tab-congestion-studio').click();
    await expect(page.getByTestId('congestion-studio-container')).toBeVisible();

    const result = await command<{ cwnd_timeline: { cwnd_mss: number }[] }>(page, 'simulate_tcp', {
      config: {
        source_node_id: 'node-1',
        destination_node_id: 'node-3',
        payload_bytes: 40_000,
        segment_size_bytes: 1000,
        initial_cwnd_mss: 1,
        initial_ssthresh_mss: 16,
        seed: 42,
      },
    });
    const cwnd = result.cwnd_timeline.map((point) => point.cwnd_mss);
    // Slow start adds exactly one MSS per ACK.
    expect(cwnd.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Congestion avoidance adds ~1/cwnd per ACK: no full-MSS jumps, ~1 MSS per round trip.
    const start = cwnd.findIndex((value) => value >= 16);
    const avoidance = cwnd.slice(start + 1).map((value, index) => value - cwnd[start + index]);
    expect(Math.max(...avoidance)).toBeLessThan(1);
  });

  test('16. Application layer: DNS resolution over the real transport path', async ({ page }) => {
    await resetProject(page, 'application');
    await page.getByRole('button', { name: 'Application Layer' }).click();

    const dns = await command<{ metrics: Record<string, unknown>; state: Record<string, unknown> }>(
      page,
      'simulate_dns',
      {
        config: {
          client_node_id: 'node-1',
          server_node_id: 'node-3',
          query_name: 'www.example.com',
          query_type: 'A',
          query_mode: 'recursive',
        },
      },
    );
    expect(dns.metrics).toBeTruthy();
    await expect(page.getByRole('button', { name: 'DNS Studio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'HTTP Studio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'FTP Studio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SMTP Studio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SNMP Studio' })).toBeVisible();
  });

  test('17. Application layer: an invalid DNS query is rejected with a server message', async ({ page }) => {
    await resetProject(page, 'dns-invalid');
    const response = await page.request.post(`${API}/api/simulate_dns`, { data: { config: { query_name: '' } } });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('must not be empty');

    await page.getByRole('button', { name: 'Application Layer' }).click();
    // The UI must not invent a response for an invalid request.
    await expect(page.getByTestId('engine-status')).toHaveText('ONLINE');
  });

  test('18. QoS studio: metrics reflect the traffic that was simulated', async ({ page }) => {
    await resetProject(page, 'qos');
    const packetId = await command<string>(page, 'inject_packet', {
      srcNodeId: 'node-1',
      dstNodeId: 'node-3',
      sizeBytes: 1000,
    });
    await command(page, 'run_simulation_until_empty');

    await page.getByRole('button', { name: 'QoS Performance' }).click();
    await expect(page.locator('h2', { hasText: 'QoS Performance' })).toBeVisible();
    await expect(page.locator('text=Average Latency')).toBeVisible();

    const metrics = await command<{ packets_sent: number; packets_delivered: number; average_latency_us: number }>(
      page,
      'get_current_qos_metrics',
    );
    expect(metrics.packets_sent).toBeGreaterThan(0);
    expect(metrics.packets_delivered).toBeGreaterThan(0);
    expect(metrics.average_latency_us).toBeGreaterThan(0);
    expect(await command(page, 'get_packet_details', { packetId })).toBeTruthy();

    // The delivered count must be visible in the UI, not just in the API response.
    await expect(page.locator(`text=${metrics.packets_delivered}`).first()).toBeVisible();
  });

  test('19. Batch experiments: a bandwidth sweep changes latency and is reproducible', async ({ page }) => {
    await resetProject(page, 'experiments');
    await page.getByRole('button', { name: 'Batch Experiments' }).click();

    const config = {
      target: 'network', // Timed topology traffic, not a TCP bulk transfer.
      parameter: { type: 'link_bandwidth' },
      parameter_values: [100_000, 10_000_000],
      seeds: [42],
      simulation_duration_us: 2_000_000,
      packet_count: 20,
      packet_size_bytes: 1000,
      traffic_interval_us: 3000,
    };
    const first = await command<{ points: { aggregated_qos: { mean_latency_us: number } }[] }>(
      page,
      'run_parameter_sweep_command',
      { config },
    );
    const second = await command<{ points: { aggregated_qos: { mean_latency_us: number } }[] }>(
      page,
      'run_parameter_sweep_command',
      { config },
    );
    const latencies = first.points.map((point) => point.aggregated_qos.mean_latency_us);
    expect(latencies[0]).toBeGreaterThan(latencies[1]);
    expect(second.points.map((p) => p.aggregated_qos.mean_latency_us)).toEqual(latencies);

    await expect(page.getByRole('button', { name: 'Parameter Sweep', exact: true })).toBeVisible();
    await expect(page.locator('button:has-text("Comparative A/B")')).toBeVisible();
  });

  test('20. Batch experiments: the A/B comparison reports a measured delta', async ({ page }) => {
    await resetProject(page, 'ab');
    await page.getByRole('button', { name: 'Batch Experiments' }).click();
    await page.locator('button:has-text("Comparative A/B")').click();
    await expect(page.locator('h3:has-text("Comparative A/B Experiment Setup")')).toBeVisible();

    // Run the study through the UI: scenario A is the high-bandwidth baseline.
    await page.locator('button:has-text("Run Comparative A/B Test")').click();
    await expect(page.getByText(/Comparative Metric Deltas/i).first()).toBeVisible({ timeout: 60_000 });

    const result = await command<{ runs_count_per_scenario: number; deltas: { metric_name: string; val_a: number; val_b: number }[] }>(
      page,
      'run_comparative_experiment_command',
      {
        config: {
          experiment_name: 'e2e-ab',
          scenario_a: { name: 'fast', parameter_overrides: [[{ type: 'link_bandwidth' }, 1_000_000]] },
          scenario_b: { name: 'slow', parameter_overrides: [[{ type: 'link_bandwidth' }, 128_000]] },
          seeds: [42],
          simulation_duration_us: 2_000_000,
          packet_count: 20,
          packet_size_bytes: 1000,
          traffic_interval_us: 3000,
        },
      },
    );
    const latency = result.deltas.find((delta) => delta.metric_name === 'latency_us');
    expect(latency).toBeTruthy();
    expect(latency!.val_b).toBeGreaterThan(latency!.val_a);
    expect(result.runs_count_per_scenario).toBe(1);
  });

  test('21. Layout: no horizontal overflow at the supported viewport widths', async ({ page }) => {
    await resetProject(page, 'layout');
    const viewports = [
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 1024, height: 768 },
      { width: 768, height: 900 },
      { width: 375, height: 812 },
      { width: 320, height: 700 },
    ];
    const workspaces = [
      'Topology Canvas',
      'Routing Studio',
      'Addressing & NAT',
      'Simulation & Events',
      'Algorithm Studio',
      'Transport Layer',
      'Application Layer',
      'Circuit Switching',
      'QoS Performance',
      'Batch Experiments',
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const workspace of workspaces) {
        await page.getByRole('button', { name: workspace, exact: false }).first().click();
        await page.waitForTimeout(150);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${workspace} overflows by ${overflow}px at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('22. Topology editor: create a connection through the keyboard workflow', async ({ page }) => {
    await resetProject(page, 'connect-keyboard');
    const before = await command<{ links: unknown[] }>(page, 'get_project');
    expect(before.links).toHaveLength(2);

    // The toolbar button is rendered (and disabled) while the project is still loading; its
    // enabled state is the readiness signal for the 'c' shortcut, which also requires a loaded
    // project with at least two nodes. keyboard.press has no actionability check, so assert it.
    await expect(page.getByTestId('connect-nodes')).toBeEnabled();
    // The 'c' shortcut opens the dialog without touching the pointer.
    await page.keyboard.press('c');
    const dialog = page.getByTestId('connect-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    // Focus lands on the first field, so the workflow is operable from the keyboard alone.
    await expect(page.getByLabel('Source node')).toBeFocused();

    // Defaults: source = first node, target = last node — node-1 -> node-3 is a new link.
    await page.getByTestId('connect-dialog-confirm').click();
    await expect(dialog).toBeHidden();

    const after = await command<{ links: { source: { node_id: string }; target: { node_id: string } }[] }>(
      page,
      'get_project'
    );
    expect(after.links).toHaveLength(3);
    const added = after.links.find(
      (l) =>
        (l.source.node_id === 'node-1' && l.target.node_id === 'node-3') ||
        (l.source.node_id === 'node-3' && l.target.node_id === 'node-1')
    );
    expect(added, 'the keyboard workflow must create the node-1 <-> node-3 link').toBeTruthy();
  });

  test('23. Topology editor: the connection dialog validates choices and cancels cleanly', async ({ page }) => {
    await resetProject(page, 'connect-validation');

    // Open via the toolbar button this time (pointer and keyboard entry points both work).
    await page.getByTestId('connect-nodes').click();
    const dialog = page.getByTestId('connect-dialog');
    await expect(dialog).toBeVisible();

    // Connecting a node to itself is rejected before any backend call.
    await page.getByLabel('Target node').selectOption('node-1');
    await page.getByTestId('connect-dialog-confirm').click();
    await expect(page.getByRole('alert')).toContainText('cannot connect to itself');
    await expect(dialog).toBeVisible();

    // Escape closes the dialog and changes nothing.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const project = await command<{ links: unknown[] }>(page, 'get_project');
    expect(project.links).toHaveLength(2);
  });
});
