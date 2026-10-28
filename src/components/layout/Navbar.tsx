import { useRef, useState } from 'react';
import { Activity, Cpu, FileDown, FileUp, FolderPlus, RotateCcw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Project } from '../../types/project';
import { formatTimeUs } from '../../lib/utils';
import type { BackendStatus } from '../../lib/apiClient';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface NavbarProps {
  project: Project | null;
  currentTimeUs: number;
  onNewProject: () => void;
  onSaveProject: () => void;
  onLoadProject: (jsonContent: string) => Promise<void>;
  onResetProject: () => void;
  backendStatus?: BackendStatus;
}

export const Navbar = ({
  project,
  currentTimeUs,
  onNewProject,
  onSaveProject,
  onLoadProject,
  onResetProject,
  backendStatus = 'unknown',
}: NavbarProps) => {
  const connected = backendStatus === 'online';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    const file = event.target.files?.[0];
    // Allow re-selecting the same file after a cancelled import.
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setImportError(`File “${file.name}” is larger than 5 MB and was not read.`);
      return;
    }
    try {
      const text = await file.text();
      setImportFileName(file.name);
      setPendingImport(text);
    } catch {
      setImportError(`File “${file.name}” could not be read.`);
    }
  };

  return (
    <header className="min-h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-x-3 px-2 sm:px-4 py-1.5 select-none z-20">
      {/* Brand & Project Info */}
      <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
        <div className="flex items-center space-x-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="hidden min-[400px]:inline font-bold tracking-tight text-white text-base">NetSim</span>
              <span className="hidden sm:inline text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-brand-950 text-brand-400 border border-brand-800">
                v1.0 Desktop
              </span>
            </div>
          </div>
        </div>

        <div className="hidden md:block h-4 w-px bg-slate-800 shrink-0" />

        <div className="hidden lg:flex text-xs min-w-0 items-baseline">
          <span className="text-slate-400 shrink-0">Project: </span>
          <span className="font-medium text-slate-200 truncate">{project?.metadata.name || 'Untitled'}</span>
          <span className="hidden lg:inline ml-2 text-[11px] text-slate-400 font-mono shrink-0">
            (Seed: {project?.simulation_config.seed || 42891})
          </span>
        </div>
      </div>

      {/* Center: Authoritative Virtual Clock */}
      <div className="flex items-center space-x-2 sm:space-x-3 bg-slate-950/80 px-2 sm:px-3.5 py-1.5 rounded-md border border-slate-800 shrink-0">
        <Cpu className="w-4 h-4 text-cyan-400 animate-pulse" />
        <div className="flex items-baseline space-x-2">
          <span className="hidden sm:inline text-[11px] font-medium text-slate-400 uppercase tracking-wider">Virtual Clock:</span>
          <span className="text-sm font-mono font-semibold text-cyan-300">
            {formatTimeUs(currentTimeUs)}
          </span>
        </div>
      </div>

      {/* Right Controls (icon-only on narrow screens; labels stay in the a11y tree). */}
      <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
        <button
          onClick={onNewProject}
          className="flex items-center space-x-1.5 px-2 lg:px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors"
          title="Create New Project"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span className="sr-only lg:not-sr-only">New</span>
        </button>

        <button
          onClick={onSaveProject}
          className="flex items-center space-x-1.5 px-2 lg:px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors"
          title="Export Project JSON"
        >
          <FileDown className="w-3.5 h-3.5" />
          <span className="sr-only lg:not-sr-only">Export JSON</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors"
          title="Import Project JSON (.netsim)"
          data-testid="import-project"
        >
          <FileUp className="w-3.5 h-3.5" />
          <span>Import JSON</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".netsim,application/json,.json"
          className="hidden"
          aria-label="Import project file"
          onChange={handleFileSelected}
          data-testid="import-project-file"
        />

        <button
          onClick={onResetProject}
          className="flex items-center space-x-1.5 px-2 lg:px-3 py-1.5 text-xs font-medium text-rose-300 hover:text-rose-200 bg-rose-950/40 hover:bg-rose-950/60 border border-rose-900/50 rounded-md transition-colors"
          title="Reset Simulation State"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="sr-only lg:not-sr-only">Reset</span>
        </button>

        <div className="hidden sm:block h-4 w-px bg-slate-800 mx-1" />

        <div
          data-testid="authority-badge"
          title={
            connected
              ? 'Connected to the authoritative Python simulation service.'
              : 'The Python simulation service is not reachable. Start it with: python python/netsim/server.py 8765'
          }
          className={
            connected
              ? 'flex items-center space-x-1 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 px-2 py-1 rounded'
              : 'flex items-center space-x-1 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900/60 px-2 py-1 rounded'
          }
        >
          {connected ? (
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-rose-300" />
          )}
          <span className="sr-only md:not-sr-only">{connected ? 'Python Authoritative' : 'Backend Offline'}</span>
        </div>
      </div>

      {importError && (
        <div
          role="alert"
          className="absolute top-14 right-4 z-30 mt-1 max-w-sm rounded-md border border-rose-700/60 bg-rose-950/95 px-3 py-2 text-xs text-rose-200"
        >
          {importError}
        </div>
      )}

      <ConfirmDialog
        open={pendingImport !== null}
        title="Import project"
        message={`Importing “${importFileName}” replaces the current project, including its topology and simulation state. This cannot be undone from the file itself. Continue?`}
        confirmLabel="Import and replace"
        destructive
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          const content = pendingImport;
          setPendingImport(null);
          if (content !== null) {
            void onLoadProject(content);
          }
        }}
      />
    </header>
  );
};
