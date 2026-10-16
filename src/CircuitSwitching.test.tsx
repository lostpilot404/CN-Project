import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SwitchingWorkspace } from './components/switching/SwitchingWorkspace';
import { api } from './lib/api';
import type { Project } from './types/project';

describe('Circuit Switching studio', () => {
  let project: Project;

  beforeEach(async () => {
    // Fresh project + topology: node-1 -- node-2 -- node-3, with node-4 isolated.
    await api.createProject('Circuit Studio');
    await api.addNode('Host A', 'pc', 100, 100, 'node-1');
    await api.addNode('Router R1', 'router', 300, 100, 'node-2');
    await api.addNode('Host B', 'pc', 500, 100, 'node-3');
    await api.addNode('Isolated Host', 'pc', 700, 100, 'node-4');
    await api.addLink('node-1', 'node-2');
    await api.addLink('node-2', 'node-3');
    project = await api.getProject();
  });

  it('renders the workspace with an empty-state circuits panel', async () => {
    render(<SwitchingWorkspace project={project} />);
    expect(screen.getByTestId('switching-workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Circuit Switching' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No circuits yet.')).toBeInTheDocument());
    expect(screen.getByText('No capacity reserved.')).toBeInTheDocument();
  });

  it('establishes a circuit and reports the reserved path from the service', async () => {
    render(<SwitchingWorkspace project={project} />);
    // The double's mock topology routes node-1 -> node-2 -> node-3 (node-4 is isolated).
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[1], 'node-3');
    await userEvent.click(screen.getByTestId('request-circuit'));

    const accepted = await screen.findByTestId('circuit-accepted');
    expect(accepted.textContent).toContain('established');
    expect(accepted.textContent).toContain('node-1 → node-2 → node-3');
    // The circuits table now lists one active circuit.
    expect(screen.getByText(/1 active/)).toBeInTheDocument();
  });

  it('shows the admission-control reason when a request is blocked', async () => {
    render(<SwitchingWorkspace project={project} />);
    // node-4 is disconnected in the mock topology: the request must be blocked.
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[1], 'node-4');
    await userEvent.click(screen.getByTestId('request-circuit'));

    const blocked = await screen.findByTestId('circuit-blocked');
    expect(blocked.textContent).toContain('Request blocked');
    expect(blocked.textContent).toContain('No path exists');
  });

  it('rejects a non-positive capacity locally without calling the service', async () => {
    render(<SwitchingWorkspace project={project} />);
    await userEvent.clear(screen.getByLabelText('Reserved capacity (Mbps)'));
    await userEvent.type(screen.getByLabelText('Reserved capacity (Mbps)'), '0');
    await userEvent.click(screen.getByTestId('request-circuit'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('positive number');
  });

  it('tears down an active circuit and releases its reservation', async () => {
    render(<SwitchingWorkspace project={project} />);
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[1], 'node-3');
    await userEvent.click(screen.getByTestId('request-circuit'));
    await screen.findByTestId('circuit-accepted');

    const teardown = await screen.findByRole('button', { name: /tear down circuit/i });
    await userEvent.click(teardown);

    await waitFor(() => expect(screen.getByText('No capacity reserved.')).toBeInTheDocument());
    expect(screen.getByText(/0 active/)).toBeInTheDocument();
  });
});
