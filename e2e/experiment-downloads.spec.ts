/** Real Chromium downloads against the running UI/service; no simulated download or API fallback. */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve(process.env.NETSIM_EVIDENCE_DIR ?? 'test-results/download-evidence');
const API = process.env.NETSIM_API_URL ?? 'http://127.0.0.1:8765';
const seeds = [42, 101];
const values = [1_000_000, 10_000_000];

test.describe.configure({ mode: 'serial' });

for (const target of ['network', 'tcp', 'udp']) {
  for (const workflow of ['sweep', 'comparison']) {
    test(`${target}: ${workflow} JSON downloads and replays`, async ({ page, browser }) => {
      mkdirSync(evidenceDir, { recursive: true });
      const errors: string[] = [];
      const serviceErrors: string[] = [];
      const failedRequests: string[] = [];
      const warnings: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
        if (message.type() === 'warning') warnings.push(message.text());
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if ((response.url().includes('/api/') || response.url().includes('/netsim-api/')) && response.status() >= 400) {
          serviceErrors.push(`${response.status()} ${response.url()}`);
        }
      });
      page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
      // Offline external typography is not an application service. No first-party route is mocked.
      await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 200, body: '' }));
      const reset = await page.request.post(`${API}/api/create_project`, { data: { name: `browser-${target}-${workflow}` } });
      expect(reset.ok()).toBeTruthy();
      await page.goto('/');
      await expect(page.getByTestId('engine-status')).toHaveText('ONLINE');
      await page.getByRole('button', { name: 'Batch Experiments' }).click();
      if (workflow === 'comparison') await page.getByRole('button', { name: 'Comparative A/B', exact: true }).click();
      await page.getByLabel('Experiment Target', { exact: true }).selectOption(target);
      const name = `browser-${target}-${workflow}`;
      await page.getByLabel(workflow === 'sweep' ? 'Experiment Label' : 'Comparative Experiment Label', { exact: true }).fill(name);
      if (workflow === 'sweep') {
        await page.getByLabel('Variable Parameter').selectOption('link_bandwidth');
        await page.getByLabel('Sweep Values List (comma-separated numbers)', { exact: true }).fill(values.join(', '));
        await page.getByLabel('PRNG Seeds (comma-separated)', { exact: true }).fill(seeds.join(', '));
        await page.getByLabel('Packets per Run', { exact: true }).fill('12');
        if (target === 'network') await page.getByLabel('Simulation Time per Run (µs)', { exact: true }).fill('200000');
        else await expect(page.getByLabel('Simulation Time per Run (µs)', { exact: true })).toBeDisabled();
      } else {
        await page.getByLabel('Scenario Label', { exact: true }).nth(0).fill('1 Mbps baseline');
        await page.getByLabel('Scenario Label', { exact: true }).nth(1).fill('10 Mbps alternative');
        await page.getByLabel('Link Bandwidth (bps)', { exact: true }).nth(0).fill(String(values[0]));
        await page.getByLabel('Link Bandwidth (bps)', { exact: true }).nth(1).fill(String(values[1]));
        await page.getByLabel('Seeds (comma-separated)', { exact: true }).fill(seeds.join(', '));
        if (target === 'network') await page.getByLabel('Duration per run (µs)', { exact: true }).fill('200000');
        else await expect(page.getByLabel('Duration per run (µs)', { exact: true })).toBeDisabled();
      }
      await page.getByLabel(workflow === 'sweep' ? 'Experiment Label' : 'Comparative Experiment Label', { exact: true }).fill(name);
      const command = workflow === 'sweep' ? 'run_parameter_sweep_command' : 'run_comparative_experiment_command';
      const responsePromise = page.waitForResponse(r => r.url().includes(`/api/${command}`));
      await page.getByRole('button', { name: workflow === 'sweep' ? 'Execute Parameter Sweep' : 'Run Comparative A/B Test', exact: true }).click();
      const response = await responsePromise;
      expect(response.ok()).toBeTruthy();
      const responseBody = await response.json();
      expect(responseBody.status).toBe('ok');
      const downloadButton = page.getByRole('button', { name: workflow === 'sweep' ? 'Download sweep JSON' : 'Download A/B JSON', exact: true });
      await expect(downloadButton).toBeEnabled();
      const screenshot = path.join(evidenceDir, `${target}-${workflow}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      const resultsScreenshot = path.join(evidenceDir, `${target}-${workflow}-results.png`);
      const resultHeading = workflow === 'sweep'
        ? page.getByRole('heading', { name: 'Aggregated Metrics Table', exact: true })
        : page.getByRole('heading', { name: /Comparative Metric Deltas/ });
      await resultHeading.scrollIntoViewIfNeeded();
      await expect(resultHeading).toBeVisible();
      await page.screenshot({ path: resultsScreenshot, fullPage: true });
      // Editing the form must not change the completed download snapshot.
      await page.getByLabel(workflow === 'sweep' ? 'Experiment Label' : 'Comparative Experiment Label', { exact: true }).fill('edited after run; not the exported input');
      const downloadPromise = page.waitForEvent('download');
      await downloadButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`netsim-${workflow}.json`);
      expect(await download.failure()).toBeNull();
      const exportedPath = path.join(evidenceDir, `${target}-${workflow}.json`);
      await download.saveAs(exportedPath);
      expect(statSync(exportedPath).size).toBeGreaterThan(0);
      const saved = JSON.parse(readFileSync(exportedPath, 'utf8'));
      expect(saved).toEqual(responseBody.result);
      expect(saved.experiment_name).toBe(name);
      expect(saved.provenance.target).toBe(target);
      expect(saved.provenance.config.target).toBe(target);
      expect(saved.provenance.config.seeds).toEqual(seeds);
      expect(saved.provenance.config.base_project.nodes.length).toBeGreaterThanOrEqual(2);
      expect(saved.run_evidence).toHaveLength(4);
      expect([...new Set(saved.run_evidence.map((r: {model: string}) => r.model))]).toEqual([target]);
      expect([...new Set(saved.run_evidence.map((r: {seed: number}) => r.seed))]).toEqual(seeds);
      if (workflow === 'sweep') {
        expect(saved.provenance.config.parameter_values).toEqual(values);
        expect(saved.provenance.config.packet_count).toBe(12);
      } else {
        expect(saved.provenance.config.scenario_a.parameter_overrides[0][1]).toBe(values[0]);
        expect(saved.provenance.config.scenario_b.parameter_overrides[0][1]).toBe(values[1]);
      }
      for (let i = 0; i < saved.run_evidence.length; i++) {
        const run = saved.run_evidence[i];
        const bandwidth = workflow === 'sweep' ? values[Math.floor(i / seeds.length)] : values[i % 2];
        if (target === 'network') {
          expect(run.inputs.base_project.links.every((link: {bandwidth_bps: number}) => link.bandwidth_bps === bandwidth)).toBe(true);
        } else {
          expect(run.config.protocol).toBe(target);
          expect(run.effective_hops.every((hop: {bandwidth_bps: number}) => hop.bandwidth_bps === bandwidth)).toBe(true);
        }
      }
      const replayText = execFileSync(process.env.NETSIM_PYTHON ?? 'python3', ['examples/replay_experiment.py', exportedPath], {
        cwd: process.cwd(), env: { ...process.env, PYTHONPATH: 'python' }, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      });
      writeFileSync(path.join(evidenceDir, `${target}-${workflow}-replay.json`), replayText);
      const replay = JSON.parse(replayText);
      const originalDuration = saved.execution_time_ms;
      const replayDuration = replay.execution_time_ms;
      delete saved.execution_time_ms;
      delete replay.execution_time_ms;
      expect(replay).toEqual(saved);
      // Exercise the same-origin proxy too; only the health request here is supplemental.
      expect((await page.request.get('/netsim-api/health')).ok()).toBeTruthy();
      const record = { date: '2026-10-27', browser: browser.version(), target, workflow,
        format: 'JSON (only available format)', suggestedFilename: download.suggestedFilename(),
        path: path.basename(exportedPath), bytes: statSync(exportedPath).size,
        screenshot: path.basename(screenshot), resultsScreenshot: path.basename(resultsScreenshot), selectedValues: values, seeds,
        engineSourceSha256: saved.provenance.engine_source_sha256,
        snapshotMatchesUIResponse: true, effectiveInputsMatch: true, replayEqual: true,
        excludedFields: ['execution_time_ms'], originalDuration, replayDuration,
        formEditedBeforeDownload: true, errors, serviceErrors, failedRequests, warnings };
      writeFileSync(path.join(evidenceDir, `${target}-${workflow}-verification.json`), JSON.stringify(record, null, 2) + '\n');
      expect(errors).toEqual([]);
      expect(serviceErrors).toEqual([]);
      expect(failedRequests).toEqual([]);
    });
  }
}

test('dedicated GBN/SR comparison reproduces the reported matched-loss teaching task', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 200, body: '' }));
  await page.goto('/');
  await expect(page.getByTestId('engine-status')).toHaveText('ONLINE');
  await page.getByRole('button', { name: 'Algorithm Studio' }).click();
  await page.getByRole('button', { name: 'Flow Control', exact: true }).click();
  await page.getByRole('button', { name: 'GBN vs SR Comparison', exact: true }).click();
  // Comparison auto-runs on mode entry. Wait for it before setting the explicit task inputs.
  await expect(page.getByRole('button', { name: 'Run Simulation', exact: true })).toBeEnabled();
  for (const [label, value] of [
    ['Window Size (N)', '4'], ['Seq Space (M)', '8'], ['Total Frames', '8'],
    ['Frame Tx (µs)', '1000'], ['Prop Delay (µs)', '2000'], ['ACK Tx (µs)', '100'],
    ['Timeout (µs)', '10000'], ['Drop Frames (0-based indices, comma-separated)', '2'],
    ['Drop ACKs (seq numbers, comma-separated)', ''], ['RNG Seed (Authoritative Determinism)', '42'],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  const gbnPromise = page.waitForResponse(r => r.url().includes('/api/simulate_go_back_n'));
  const srPromise = page.waitForResponse(r => r.url().includes('/api/simulate_selective_repeat'));
  await page.getByRole('button', { name: 'Run Simulation', exact: true }).click();
  const gbn = (await (await gbnPromise).json()).result;
  const sr = (await (await srPromise).json()).result;
  expect(gbn.metrics.retransmissions).toBe(4);
  expect(sr.metrics.retransmissions).toBe(1);
  expect(gbn.metrics.completion_time_us).toBe(26200);
  expect(sr.metrics.completion_time_us).toBe(21100);
  expect(gbn.metrics.completed_frames).toBe(8);
  expect(sr.metrics.completed_frames).toBe(8);
  const { protocol: _gbnProtocol, ...gbnInputs } = gbn.config;
  const { protocol: _srProtocol, ...srInputs } = sr.config;
  expect(gbnInputs).toEqual(srInputs);
  await expect(page.locator('table')).toContainText('26200');
  await expect(page.locator('table')).toContainText('21100');
  mkdirSync(evidenceDir, { recursive: true });
  await page.locator('table').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidenceDir, 'gbn-sr-comparison.png'), fullPage: true });
  writeFileSync(path.join(evidenceDir, 'gbn-sr-ui-results.json'), JSON.stringify({ browser: browser.version(), errors,
    evidenceKind: 'Responses from real UI-triggered model runs, NOT a GUI download (studio has no download button)',
    gbn, sr }, null, 2) + '\n');
  expect(errors).toEqual([]);
});
