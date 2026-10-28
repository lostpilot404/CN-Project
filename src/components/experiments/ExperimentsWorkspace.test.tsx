import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExperimentsWorkspace } from './ExperimentsWorkspace';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { runParameterSweep: vi.fn(), runComparativeExperiment: vi.fn() } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('experiment controls and exports', () => {
  it('offers only wired targets and hides unsupported transport parameters', () => {
    render(<ExperimentsWorkspace project={null} />);
    const target = screen.getByLabelText('Experiment Target');
    expect([...target.querySelectorAll('option')].map(o => o.value)).toEqual(['network', 'tcp', 'udp']);
    fireEvent.change(target, { target: { value: 'udp' } });
    expect([...screen.getByLabelText('Variable Parameter').querySelectorAll('option')].map(o => o.value))
      .toEqual(['link_bandwidth', 'propagation_delay', 'packet_size_bytes', 'packet_count']);
  });

  it('downloads the completed response snapshot after the form changes', async () => {
    const result = { experiment_name: 'saved run', parameter_name: 'link_bandwidth', points: [], total_runs: 0,
      seeds: [42], execution_time_ms: 1, provenance: { config: { target: 'network', seeds: [42] } }, run_evidence: [] };
    vi.mocked(api.runParameterSweep).mockResolvedValue(result);
    const create = vi.fn((_blob: Blob) => 'blob:snapshot');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ExperimentsWorkspace project={null} />);
    expect(screen.getByText('Download sweep JSON')).toBeDisabled();
    fireEvent.click(screen.getByText('Execute Parameter Sweep'));
    await waitFor(() => expect(screen.getByText('Download sweep JSON')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Experiment Label'), { target: { value: 'edited after execution' } });
    fireEvent.click(screen.getByText('Download sweep JSON'));
    const blob = create.mock.calls[0]?.[0] as unknown as Blob;
    const reader = new FileReader();
    const text = await new Promise<string>((resolve) => { reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(JSON.parse(text)).toEqual(result);
    vi.unstubAllGlobals();
  });
});
