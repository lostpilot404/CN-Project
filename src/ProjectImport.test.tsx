import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Navbar } from './components/layout/Navbar';
import { api } from './lib/api';
import type { Project } from './types/project';

function renderNavbar(onLoadProject: (json: string) => Promise<void>) {
  return render(
    <Navbar
      project={null}
      currentTimeUs={0}
      onNewProject={() => {}}
      onSaveProject={() => {}}
      onLoadProject={onLoadProject}
      onResetProject={() => {}}
      backendStatus="online"
    />
  );
}

async function selectFile(contents: string, name = 'project.netsim') {
  const input = screen.getByTestId('import-project-file') as HTMLInputElement;
  const file = new File([contents], name, { type: 'application/json' });
  await userEvent.upload(input, file);
}

describe('Project import workflow', () => {
  beforeEach(async () => {
    await api.createProject('Import Tests');
  });

  it('asks for confirmation before replacing the current project', async () => {
    const onLoadProject = vi.fn().mockResolvedValue(undefined);
    renderNavbar(onLoadProject);
    await selectFile('{"schemaVersion": 1, "nodes": [], "links": []}');

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('replaces the current project');
    expect(dialog.textContent).toContain('project.netsim');

    await userEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onLoadProject).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
  });

  it('hands the file content to the app only after confirmation', async () => {
    const onLoadProject = vi.fn().mockResolvedValue(undefined);
    renderNavbar(onLoadProject);
    const contents = '{"schemaVersion": 1, "nodes": [], "links": []}';
    await selectFile(contents);

    await userEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(onLoadProject).toHaveBeenCalledWith(contents));
  });

  it('rejects unreadable files with a visible message and no dialog', async () => {
    const onLoadProject = vi.fn().mockResolvedValue(undefined);
    renderNavbar(onLoadProject);
    const input = screen.getByTestId('import-project-file') as HTMLInputElement;
    // Uploading without a file selection is a no-op; an oversized file is rejected before reading.
    const big = new File(['x'.repeat(6 * 1024 * 1024)], 'huge.netsim', { type: 'application/json' });
    await userEvent.upload(input, big);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('larger than 5 MB');
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(onLoadProject).not.toHaveBeenCalled();
  });
});

describe('loadProjectJson contract (test double mirrors the service)', () => {
  it('rejects invalid JSON without touching the project', async () => {
    const before = await api.getProject();
    await expect(api.loadProjectJson('{not json')).rejects.toThrow(/not valid JSON/);
    const after = await api.getProject();
    expect(after.nodes.map((n) => n.id)).toEqual(before.nodes.map((n) => n.id));
  });

  it('rejects unsupported schema versions explicitly', async () => {
    await expect(
      api.loadProjectJson(JSON.stringify({ schemaVersion: 9, nodes: [], links: [] }))
    ).rejects.toThrow(/schema version 9/);
  });

  it('rejects duplicate node identifiers', async () => {
    const doc = {
      schemaVersion: 1,
      nodes: [
        { id: 'dup', label: 'A', node_type: 'pc', position: { x: 0, y: 0 }, interfaces: [] },
        { id: 'dup', label: 'B', node_type: 'pc', position: { x: 0, y: 0 }, interfaces: [] },
      ],
      links: [],
    };
    await expect(api.loadProjectJson(JSON.stringify(doc))).rejects.toThrow(/duplicate node/);
  });

  it('round-trips a project through save and load', async () => {
    const exported = await api.saveProjectJson();
    await api.createProject('Scratch');
    const restored = await api.loadProjectJson(exported);
    const doc = JSON.parse(exported) as Project;
    expect(restored.nodes.map((n) => n.id)).toEqual(doc.nodes.map((n) => n.id));
    expect(restored.links.map((l) => l.id)).toEqual(doc.links.map((l) => l.id));
  });
});
