/**
 * Application smoke/integration test against the running Python service.
 *
 * This is the closest executable equivalent to the browser end-to-end suite in environments
 * where a Playwright browser cannot be installed: it mounts the real React application, talks to
 * the real simulation service over HTTP and verifies that each workspace renders with data the
 * engine produced.
 *
 *   python python/netsim/server.py 8765
 *   NETSIM_LIVE_API=1 npx vitest run src/integration/appSmoke.test.tsx
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { checkBackendHealth } from '../lib/apiClient';

const live = process.env.NETSIM_LIVE_API === '1';

beforeAll(() => {
  // @xyflow/react measures the canvas with ResizeObserver, which jsdom does not implement.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (globalThis as unknown as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
});

describe.skipIf(!live)('application against the live simulation service', () => {
  beforeAll(async () => {
    const health = await checkBackendHealth();
    if (!health) {
      throw new Error('NETSIM_LIVE_API=1 but the simulation service is not reachable on 127.0.0.1:8765');
    }
  });

  it('loads the default topology from the service and reports the engine as online', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('engine-status')).toHaveTextContent('ONLINE'));
    expect(screen.getByTestId('authority-badge')).toHaveTextContent('Python Authoritative');
    expect(screen.getByText('Python core v0.9.0')).toBeInTheDocument();

    // Node labels come from the service payload, not from a hard-coded fixture.
    expect(await screen.findByText(/Workstation PC1/)).toBeInTheDocument();
  });

  it('exposes only implemented workspaces in the sidebar', async () => {
    render(<App />);
    const sidebar = screen.getByRole('complementary');
    for (const label of [
      'Topology Canvas',
      'Routing Studio',
      'Addressing & NAT',
      'Simulation & Events',
      'Algorithm Studio',
      'Transport Layer',
      'Application Layer',
      'QoS Performance',
      'Batch Experiments',
    ]) {
      expect(sidebar).toHaveTextContent(label);
    }
    expect(sidebar).not.toHaveTextContent('Learning Mode');
    expect(sidebar).not.toHaveTextContent('Exam Mode');
  });

  it('renders every workspace without surfacing an error toast', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('engine-status')).toHaveTextContent('ONLINE'));

    const workspaces = [
      { tab: 'Routing Studio', marker: /Routing Studio/ },
      { tab: 'Addressing & NAT', marker: /Addressing/ },
      { tab: 'Simulation & Events', marker: /Simulation/ },
      { tab: 'Algorithm Studio', marker: /Data Link Layer/ },
      { tab: 'Transport Layer', marker: /Transport/ },
      { tab: 'Application Layer', marker: /Application/ },
      { tab: 'QoS Performance', marker: /QoS Performance/ },
      { tab: 'Batch Experiments', marker: /Experiment/ },
      { tab: 'Topology Canvas', marker: /Workstation PC1/ },
    ];

    for (const workspace of workspaces) {
      await user.click(screen.getByRole('button', { name: workspace.tab }));
      const heading = await screen.findAllByText(workspace.marker);
      expect(heading.length, `${workspace.tab} did not render`).toBeGreaterThan(0);
      // The app surfaces backend failures as a toast; none may appear while navigating.
      expect(screen.queryByText(/backend|unreachable|failed to/i)).toBeNull();
    }
  });

  it('shows the offline state when the service cannot be reached', async () => {
    const { unmount } = render(<App />);
    await waitFor(() => expect(screen.getByTestId('engine-status')).toHaveTextContent('ONLINE'));
    unmount();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const { unmount: unmountOffline } = render(<App />);
    try {
      await waitFor(() => expect(screen.getByTestId('engine-status')).toHaveTextContent('OFFLINE'));
      expect(screen.getByTestId('authority-badge')).toHaveTextContent('Backend Offline');
      // Let the failed probes settle while the DOM is still mounted, then tear the app down
      // before the environment is disposed.
      await new Promise((resolve) => setTimeout(resolve, 50));
      unmountOffline();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
