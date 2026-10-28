import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConnectDialog, ConnectableNode } from './components/topology/ConnectDialog';

const NODES: ConnectableNode[] = [
  { id: 'node-1', label: 'Workstation PC1' },
  { id: 'node-2', label: 'Core Router R1' },
  { id: 'node-3', label: 'Server S1' },
];

function renderDialog(overrides: Partial<Parameters<typeof ConnectDialog>[0]> = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn().mockResolvedValue(null);
  const onCancel = overrides.onCancel ?? vi.fn();
  const utils = render(
    <ConnectDialog open nodes={NODES} onConfirm={onConfirm} onCancel={onCancel} {...overrides} />
  );
  return { ...utils, onConfirm: onConfirm as ReturnType<typeof vi.fn>, onCancel: onCancel as ReturnType<typeof vi.fn> };
}

function Harness({ onConfirm, onCancel }: { onConfirm: (a: string, b: string) => Promise<string | null>; onCancel: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <ConnectDialog
      open={open}
      nodes={NODES}
      onConfirm={onConfirm}
      onCancel={() => {
        onCancel();
        setOpen(false);
      }}
    />
  );
}

describe('Keyboard connection workflow (ConnectDialog)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a labelled modal dialog that focuses its first field on open', async () => {
    renderDialog();
    const dialog = screen.getByTestId('connect-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Connect nodes' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Source node')));
  });

  it('confirms a valid connection through the authoritative callback and closes on success', async () => {
    const { onConfirm } = renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Target node'), 'node-3');
    await userEvent.click(screen.getByTestId('connect-dialog-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('node-1', 'node-3'));
    // Success: no inline error rendered.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects a node connected to itself before any backend call', async () => {
    const { onConfirm } = renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Target node'), 'node-1');
    await userEvent.click(screen.getByTestId('connect-dialog-confirm'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('cannot connect to itself');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('surfaces authoritative backend errors inline and keeps the dialog open', async () => {
    const { onConfirm } = renderDialog({
      onConfirm: vi.fn().mockResolvedValue("Link 'link-1' already exists"),
    });
    await userEvent.click(screen.getByTestId('connect-dialog-confirm'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Link 'link-1' already exists");
    expect(onConfirm).toHaveBeenCalled();
    expect(screen.getByTestId('connect-dialog')).toBeInTheDocument();
  });

  it('cancels with the Cancel button and restores focus to the trigger', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Connect';
    document.body.appendChild(trigger);
    trigger.focus();

    const onCancel = vi.fn();
    render(<Harness onConfirm={vi.fn().mockResolvedValue(null)} onCancel={onCancel} />);
    await userEvent.click(screen.getByTestId('connect-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });

  it('cancels with Escape and restores focus to the trigger', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const onCancel = vi.fn();
    render(<Harness onConfirm={vi.fn().mockResolvedValue(null)} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });

  it('keeps focus trapped inside the dialog while it is open', async () => {
    renderDialog();
    const dialog = screen.getByTestId('connect-dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>('select, button');
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(first);

    first.focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it('keeps its form state and inline errors across parent re-renders (1 Hz poll regression)', async () => {
    // The app re-renders the canvas on a state poll, producing fresh `nodes`/`onCancel`
    // identities every tick. A dialog effect that depends on those identities resets the
    // form and clears errors mid-interaction — this pins the fix.
    function PollingHost() {
      const [tick, setTick] = useState(0);
      return (
        <div>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            tick
          </button>
          <ConnectDialog
            key="d"
            open
            nodes={NODES.map((n) => ({ ...n }))}
            onConfirm={vi.fn().mockResolvedValue('backend said no')}
            onCancel={vi.fn()}
          />
          <span data-tick>{tick}</span>
        </div>
      );
    }
    render(<PollingHost />);
    // user makes a deliberate choice and triggers a validation error
    await userEvent.selectOptions(screen.getByLabelText('Target node'), 'node-1');
    await userEvent.click(screen.getByTestId('connect-dialog-confirm'));
    await screen.findByRole('alert');
    // parent re-render with fresh prop identities (what the 1 s poll does)
    await userEvent.click(screen.getByRole('button', { name: 'tick' }));
    await userEvent.click(screen.getByRole('button', { name: 'tick' }));
    // selections and the inline error must survive
    expect(screen.getByLabelText('Target node')).toHaveValue('node-1');
    expect(screen.getByRole('alert').textContent).toContain('cannot connect to itself');
    // and focus must not be yanked back to the first field
    expect(screen.getByLabelText('Source node')).not.toHaveFocus();
  });

  it('renders nothing when closed', () => {
    render(
      <ConnectDialog open={false} nodes={NODES} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.queryByTestId('connect-dialog')).not.toBeInTheDocument();
  });
});
