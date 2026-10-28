import { useState } from 'react';
import { FileJson, Sheet } from 'lucide-react';
import {
  comparisonResultToCsv,
  comparisonResultToJson,
  downloadTextFile,
  exportFilename,
  sweepResultToCsv,
  sweepResultToJson,
} from '../../lib/exportResults';
import type { ComparativeExperimentResult, SweepExperimentResult } from '../../types/experiments';

interface ExportButtonsProps {
  kind: 'sweep' | 'comparison';
  result: SweepExperimentResult | ComparativeExperimentResult;
}

/**
 * JSON/CSV export controls for a completed experiment result. Success and failure are
 * announced inline (aria-live) with the produced filename; JSON is the verbatim backend
 * result consumed by python-tools.
 */
export const ExportButtons = ({ kind, result }: ExportButtonsProps) => {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExport = (format: 'json' | 'csv') => {
    setStatus(null);
    setError(null);
    try {
      const name = exportFilename(kind, result.experiment_name, format);
      const content =
        kind === 'sweep'
          ? format === 'json'
            ? sweepResultToJson(result as SweepExperimentResult)
            : sweepResultToCsv(result as SweepExperimentResult)
          : format === 'json'
          ? comparisonResultToJson(result as ComparativeExperimentResult)
          : comparisonResultToCsv(result as ComparativeExperimentResult);
      downloadTextFile(name, content, format === 'json' ? 'application/json' : 'text/csv');
      setStatus(`Exported ${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const buttonClass =
    'inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass} onClick={() => runExport('json')} data-testid="export-json">
        <FileJson className="w-3.5 h-3.5" aria-hidden="true" />
        Export JSON
      </button>
      <button type="button" className={buttonClass} onClick={() => runExport('csv')} data-testid="export-csv">
        <Sheet className="w-3.5 h-3.5" aria-hidden="true" />
        Export CSV
      </button>
      <span aria-live="polite" className="text-[11px]">
        {status && <span className="text-emerald-400">{status}</span>}
        {error && <span className="text-rose-400">Export failed: {error}</span>}
      </span>
    </div>
  );
};
