/**
 * Accessibility verification with axe-core.
 *
 * Runs the real UI against the real Python simulation service and audits every workspace and
 * every sub-view with axe-core's WCAG 2.0/2.1 Level A and AA rule set. Any violation of any
 * impact fails the suite -- the assertion collects every view's findings first so one broken
 * workspace does not hide the rest.
 *
 * Scope and limits (recorded so the result is not over-read):
 *   - axe analyses the rendered DOM in its default state. Hover/focus styling is not audited
 *     here; those shades were checked arithmetically against the WCAG contrast formula instead.
 *   - Automated rules cannot detect every WCAG criterion; passing this suite is necessary, not
 *     sufficient, for conformance.
 *   - Dialogs and transient states are not opened by the audit.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = process.env.VITE_NETSIM_API_URL ?? process.env.NETSIM_API_URL ?? 'http://127.0.0.1:8765';

/** The nine top-level workspaces, in sidebar order. */
const WORKSPACES = [
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

/**
 * Sub-views that swap the content of a workspace without leaving it. `via` names the parent
 * sub-tab that has to be open first, for the one workspace whose sub-views are nested
 * (Algorithm Studio > Error Control > Hamming Code): switching away from the parent unmounts them.
 */
const SUB_VIEWS: { workspace: string; view: string; via?: string }[] = [
  { workspace: 'Routing Studio', view: 'Dijkstra (Link-State)' },
  { workspace: 'Routing Studio', view: 'Bellman-Ford (DV)' },
  { workspace: 'Addressing & NAT', view: 'IPv4 & CIDR Subnetting' },
  { workspace: 'Addressing & NAT', view: 'True VLSM Allocator' },
  { workspace: 'Addressing & NAT', view: 'Topology IP Auditor' },
  { workspace: 'Addressing & NAT', view: 'IPv6 Inspector' },
  { workspace: 'Addressing & NAT', view: 'NAT / NAPT Translation' },
  { workspace: 'Algorithm Studio', view: 'Error Control' },
  { workspace: 'Algorithm Studio', view: 'Flow Control' },
  { workspace: 'Algorithm Studio', view: 'Multiple Access' },
  { workspace: 'Algorithm Studio', view: 'Hamming Code', via: 'Error Control' },
  { workspace: 'Algorithm Studio', view: 'CRC Polynomial', via: 'Error Control' },
  { workspace: 'Algorithm Studio', view: 'Internet Checksum', via: 'Error Control' },
  { workspace: 'Transport Layer', view: 'TCP Studio' },
  { workspace: 'Transport Layer', view: 'UDP Studio' },
  { workspace: 'Transport Layer', view: 'Congestion Control' },
  { workspace: 'Transport Layer', view: 'TCP vs UDP Comparison' },
  { workspace: 'Application Layer', view: 'DNS Studio' },
  { workspace: 'Application Layer', view: 'HTTP Studio' },
  { workspace: 'Application Layer', view: 'FTP Studio' },
  { workspace: 'Application Layer', view: 'SMTP Studio' },
  { workspace: 'Application Layer', view: 'SNMP Studio' },
  { workspace: 'Batch Experiments', view: 'Parameter Sweep' },
  { workspace: 'Batch Experiments', view: 'Comparative A/B' },
];

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Finding {
  view: string;
  impact: string;
  id: string;
  targets: string[];
  help: string;
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  // Inter/JetBrains Mono come from Google Fonts, which is unreachable in this environment.
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  // Start from a known project so every workspace renders its populated state.
  const response = await page.request.post(`${API}/api/create_project`, { data: { name: 'a11y' } });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByTestId('engine-status')).toHaveText('ONLINE');
});

async function audit(page: Page, view: string): Promise<Finding[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map((violation) => ({
    view,
    impact: violation.impact ?? 'unknown',
    id: violation.id,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

function report(findings: Finding[]): string {
  if (findings.length === 0) return 'no violations';
  return findings
    .map(
      (f) =>
        `[${f.impact}] ${f.id} in "${f.view}" (${f.help})\n` +
        f.targets.map((t) => `    ${t}`).join('\n'),
    )
    .join('\n');
}

test('1. every workspace passes the WCAG A/AA audit', async ({ page }) => {
  const findings: Finding[] = [];
  for (const workspace of WORKSPACES) {
    await page.getByRole('button', { name: workspace, exact: true }).click();
    await expect(page.getByRole('button', { name: workspace, exact: true })).toBeVisible();
    findings.push(...(await audit(page, workspace)));
  }
  if (findings.length > 0) console.log(`\n${report(findings)}\n`);
  expect(findings, `\n${report(findings)}\n`).toEqual([]);
});

test('2. every sub-view passes the WCAG A/AA audit', async ({ page }) => {
  const findings: Finding[] = [];
  for (const { workspace, view, via } of SUB_VIEWS) {
    await page.getByRole('button', { name: workspace, exact: true }).click();
    if (via) {
      const parent = page.getByRole('button', { name: via, exact: true });
      await expect(parent, `${via} is not reachable inside ${workspace}`).toBeVisible();
      await parent.click();
    }
    const control = page.getByRole('button', { name: view, exact: true });
    await expect(control, `${view} is not reachable inside ${workspace}`).toBeVisible();
    await control.click();
    // Confirm the click actually switched this workspace's content.
    await expect(control).toHaveAttribute('class', /bg-(indigo|brand|cyan|emerald|teal|amber)-/);
    findings.push(...(await audit(page, `${workspace} > ${view}`)));
  }
  expect(findings, `\n${report(findings)}\n`).toEqual([]);
});

test('3. dialogs and transient states pass the WCAG A/AA audit', async ({ page }) => {
  const findings: Finding[] = [];

  // Keyboard help overlay on the topology canvas.
  await page.keyboard.press('?');
  const help = page.getByTestId('keyboard-help-overlay');
  await expect(help).toBeVisible();
  findings.push(...(await audit(page, 'Keyboard help overlay')));
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  // Import confirmation dialog (confirmation is required before replacing a project).
  await page.getByTestId('import-project-file').setInputFiles({
    name: 'dialog-audit.netsim',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion": 1, "nodes": [], "links": []}'),
  });
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  findings.push(...(await audit(page, 'Import confirmation dialog')));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Transient toast: a rejected import reports failure without replacing the project.
  await page.getByTestId('import-project-file').setInputFiles({
    name: 'broken.netsim',
    mimeType: 'application/json',
    buffer: Buffer.from('{not json'),
  });
  await expect(dialog).toBeVisible();
  await page.getByTestId('confirm-dialog-confirm').click();
  const toast = page.getByTestId('toast-notification');
  await expect(toast).toBeVisible();
  findings.push(...(await audit(page, 'Error toast (transient state)')));

  expect(findings, `\n${report(findings)}\n`).toEqual([]);
});
