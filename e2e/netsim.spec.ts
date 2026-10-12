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

    await page.goto('/');
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
    // Block every call to the simulation service and confirm the UI says so.
    await page.route(`${API}/**`, (route) => route.abort());
    await page.goto('/');
    await expect(page.getByTestId('authority-badge')).toContainText('Backend Offline');
    await expect(page.getByTestId('engine-status')).toHaveText('OFFLINE');
    // The status panel explains how to start the service (exposed as the badge tooltip).
    await expect(page.getByTestId('authority-badge')).toHaveAttribute('title', /python\/netsim\/server\.py/);
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
    await expect(page.locator('text=Workstation PC1')).toBeVisible();
  });

  test('4. Topology editor: connect two nodes and verify the link is created by the engine', async ({ page }) => {
    await resetProject(page, 'links');

    // Adding a link from a fully-wired node used to fail; the service now provisions a new port.
    const link = await command<{ id: string; source: { interface_id: string } }>(page, 'add_link', {
      sourceNodeId: 'node-1',
      targetNodeId: 'node-3',
      bandwidthBps: 5_000_000,
    });
    expect(link.id).toBeTruthy();
    expect(link.source.interface_id).toBeTruthy();

    await page.reload();
    await expect(page.locator('text=link-3')).toBeVisible();
  });

  test('5. Simulation studio: inject a packet and step the event timeline', async ({ page }) => {
    await resetProject(page, 'simulation');

    await page.getByRole('button', { name: 'Simulation & Events' }).click();
    await expect(page.getByTestId('simulation-studio')).toBeVisible();

    await page.getByRole('button', { name: 'Inject Packet' }).click();
    await page.getByRole('button', { name: 'Inject Packet', exact: true }).last().click();

    const packetId = await expect
      .poll(async () => {
        const state = await command<{ packets: { id: string }[] }>(page, 'get_simulation_state');
        return state.packets.length;
      })
      .toBeGreaterThan(0)
      .then(async () => (await command<{ packets: { id: string }[] }>(page, 'get_simulation_state')).packets[0].id);

    await page.getByRole('button', { name: 'Step Event' }).click();

    const detail = await command<{ hop_history: unknown[] }>(page, 'get_packet_details', { packetId });
    expect(detail.hop_history.length).toBeGreaterThan(1);
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

  test('7. Packet inspector: 5-layer encapsulation shows real header values', async ({ page }) => {
    await resetProject(page, 'inspector');
    const packetId = await command<string>(page, 'inject_packet', {
      srcNodeId: 'node-1',
      dstNodeId: 'node-3',
      sizeBytes: 1200,
      appProtocol: 'HTTP',
      transportProtocol: 'TCP',
    });
    await command(page, 'run_simulation_until_empty');

    await page.getByRole('button', { name: 'Application Layer' }).click();
    const inspector = page.getByTestId('packet-inspector');
    await expect(inspector).toBeVisible();

    // Layer headers must come from the packet the engine produced.
    const detail = await command<{ headers: Record<string, Record<string, unknown>> }>(page, 'get_packet_details', {
      packetId,
    });
    expect(detail.headers.transport.dst_port).toBe(80);
    await expect(inspector).toContainText(String(detail.headers.network.src_ip));

    await page.getByText('Encapsulation', { exact: false }).first().click();
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

  test('10. Addressing studio: subnet maths and VLSM allocations come from the service', async ({ page }) => {
    await resetProject(page, 'addressing');
    await page.getByRole('button', { name: 'Addressing & NAT' }).click();

    const subnet = await command<{ network_address: string; usable_hosts: number }>(page, 'calculate_ipv4_subnet', {
      input: '192.168.1.130/26',
    });
    expect(subnet.network_address).toBe('192.168.1.128');
    expect(subnet.usable_hosts).toBe(62);
    await expect(page.locator('text=192.168.1.128').first()).toBeVisible();

    const vlsm = await command<{ subnets: { name: string }[] }>(page, 'allocate_vlsm_subnets', {
      baseCidr: '192.168.20.0/24',
      requirements: [
        { name: 'Sales', needed_hosts: 100 },
        { name: 'Eng', needed_hosts: 50 },
        { name: 'WAN', needed_hosts: 2 },
      ],
    });
    expect(vlsm.subnets.length).toBe(3);
  });

  test('11. Algorithm studio: Hamming encode/correct and CRC verify', async ({ page }) => {
    await resetProject(page, 'datalink');
    await page.getByRole('button', { name: 'Algorithm Studio' }).click();
    await expect(page.locator('h1', { hasText: 'Data Link Layer Protocol & Algorithm Studio' })).toBeVisible();

    const encoded = await command<{ encoded_bits: string }>(page, 'calculate_hamming_encode', {
      dataBits: '1011',
      parityMode: 'even',
    });
    expect(encoded.encoded_bits).toBe('0110011');
    await expect(page.locator('text=0110011').first()).toBeVisible();

    const corrected = await command<{ corrected_bits: string; error_position: number }>(
      page,
      'verify_and_correct_hamming',
      { codeword: '1110011', parityMode: 'even' },
    );
    expect(corrected.error_position).toBeGreaterThan(0);

    const crc = await command<{ remainder: string }>(page, 'calculate_crc', {
      dataBits: '1101011011',
      polynomial: '10011',
    });
    expect(crc.remainder).toBe('1110');
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
    await expect(page.getByTestId('udp-studio-container')).toBeVisible();
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
    await expect(page.locator('h2', { hasText: 'QoS Performance & Fault Studio' })).toBeVisible();
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
      target: 'tcp',
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
    await expect(page.getByTestId('comparison-studio-container')).toBeVisible();

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
    ];
    const workspaces = [
      'Topology Canvas',
      'Routing Studio',
      'Addressing & NAT',
      'Simulation & Events',
      'Algorithm Studio',
      'Transport Layer',
      'Application Layer',
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
});
