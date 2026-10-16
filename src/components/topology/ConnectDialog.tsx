import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';

export interface ConnectableNode {
  id: string;
  label: string;
}

interface ConnectDialogProps {
  open: boolean;
  nodes: ConnectableNode[];
  busy?: boolean;
  /** Resolve to an error message to keep the dialog open, or null on success. */
  onConfirm: (sourceId: string, targetId: string) => Promise<string | null>;
  onCancel: () => void;
}

/**
 * Keyboard-accessible connection workflow for the topology canvas.
 *
 * Pointer dragging remains available, but every connection can also be created here:
 * pick the source and target nodes with the keyboard, confirm, and the request goes
 * through the same authoritative `add_link` API as canvas drags. The dialog traps
 * focus while open, validates incompatible choices before calling the backend, and
 * restores focus to its trigger when it closes.
 */
export const ConnectDialog = ({ open, nodes, busy = false, onConfirm, onCancel }: ConnectDialogProps) => {
  const titleId = useId();
  const errorId = useId();
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // The parent re-creates `nodes`/`onCancel` every render (it re-renders on a 1 Hz
  // state poll), so the init/trap effect must depend on `open` only — otherwise every
  // parent tick resets the form, clears inline errors and steals focus mid-entry.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const current = nodesRef.current;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    setError(null);
    // Sensible defaults: first and last node.
    setSourceId((prev) => (prev && current.some((n) => n.id === prev) ? prev : current[0]?.id ?? ''));
    setTargetId((prev) =>
      prev && current.some((n) => n.id === prev) ? prev : current[current.length - 1]?.id ?? ''
    );
    firstFieldRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap: keep Tab cycling inside the dialog.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'select, button, [href], input, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    if (!sourceId || !targetId) {
      setError('Choose both a source and a target node.');
      return;
    }
    if (sourceId === targetId) {
      setError('Choose two different nodes — a node cannot connect to itself.');
      return;
    }
    setSubmitting(true);
    try {
      const failure = await onConfirm(sourceId, targetId);
      if (failure) {
        setError(failure);
      }
      // On success the parent closes the dialog.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70" aria-hidden="true" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={error ? errorId : undefined}
        className="relative w-[min(26rem,92vw)] rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        data-testid="connect-dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-sm font-semibold text-slate-100">
            Connect nodes
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close connect dialog"
            className="rounded-md p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            data-testid="connect-dialog-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="connect-source" className="block text-xs text-slate-400 mb-1">
              Source node
            </label>
            <select
              id="connect-source"
              ref={firstFieldRef}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              disabled={submitting || busy}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="connect-target" className="block text-xs text-slate-400 mb-1">
              Target node
            </label>
            <select
              id="connect-target"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={submitting || busy}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.id})
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p id={errorId} role="alert" className="mt-3 rounded-md border border-rose-800/60 bg-rose-950/40 px-2.5 py-2 text-xs text-rose-200">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            data-testid="connect-dialog-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 hover:bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            data-testid="connect-dialog-confirm"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            Connect
          </button>
        </div>
      </div>
    </div>
  );
};
