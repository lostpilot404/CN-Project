/**
 * Experiment result exports (JSON + CSV).
 *
 * The JSON export is the verbatim backend result object so that
 * `python-tools/analyze_results.py` and `python-tools/plot_metrics.py` can read the file
 * unchanged. The CSV exports are tidy, spreadsheet-friendly tables with units in the column
 * names and explicit empty cells where a value does not apply to a row type.
 */
import type {
  AggregatedQos,
  ComparativeExperimentResult,
  MetricDelta,
  SweepExperimentResult,
} from '../types/experiments';

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/** Filesystem-friendly experiment name. */
export function exportSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'experiment';
}

/** `netsim-sweep-<name>-<yyyymmdd-hhmmss>.csv` — kind, identity and timestamp. */
export function exportFilename(kind: 'sweep' | 'comparison', experimentName: string, ext: 'json' | 'csv', now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14); // yyyymmddhhmmss
  return `netsim-${kind}-${exportSlug(experimentName)}-${stamp}.${ext}`;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** The bare sweep result — exactly the shape analyze_results.py / plot_metrics.py parse. */
export function sweepResultToJson(result: SweepExperimentResult): string {
  return JSON.stringify(result, null, 2);
}

/** The bare comparison result — same structure the backend produced. */
export function comparisonResultToJson(result: ComparativeExperimentResult): string {
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

/** Unit for a metric column based on its suffix; '' when dimensionless. */
export function metricUnit(metricName: string): string {
  if (metricName.endsWith('_bps')) return 'bps';
  if (metricName.endsWith('_us')) return 'us';
  if (metricName.endsWith('_rate')) return 'ratio';
  if (metricName.endsWith('_bytes')) return 'bytes';
  return '';
}

// ---------------------------------------------------------------------------
// Sweep CSV
// ---------------------------------------------------------------------------

const SWEEP_COLUMNS = [
  'experiment_name',
  'parameter_name',
  'row_type', // 'aggregate' | 'run'
  'parameter_value',
  'seed', // run rows only
  'run_count', // aggregate rows only
  'seeds', // aggregate rows only (semicolon-separated)
  'throughput_bps',
  'goodput_bps',
  'latency_us',
  'jitter_us',
  'loss_rate',
  'retransmissions',
  'throughput_stddev_bps', // aggregate rows only
  'latency_min_us',
  'latency_max_us',
  'latency_stddev_us', // aggregate rows only
];

/**
 * One CSV: per-run rows (seed filled, aggregates empty) plus per-point aggregate rows
 * (seed empty, run_count/seeds/stddev filled) — parameter values, run/seed information and
 * aggregated metrics all preserved.
 */
export function sweepResultToCsv(result: SweepExperimentResult): string {
  const lines: string[] = [csvRow(SWEEP_COLUMNS)];
  for (const point of result.points) {
    for (const run of point.runs) {
      lines.push(
        csvRow([
          result.experiment_name,
          result.parameter_name,
          'run',
          run.parameter_value,
          run.seed,
          null,
          null,
          run.qos.throughput_bits_per_sec,
          run.qos.goodput_bits_per_sec,
          run.qos.average_latency_us,
          run.qos.jitter_us,
          run.qos.packet_loss_rate,
          run.qos.retransmissions,
          null,
          run.qos.min_latency_us,
          run.qos.max_latency_us,
          null,
        ])
      );
    }
    const a: AggregatedQos = point.aggregated_qos;
    lines.push(
      csvRow([
        result.experiment_name,
        result.parameter_name,
        'aggregate',
        point.parameter_value,
        null,
        a.run_count,
        result.seeds.join(';'),
        a.mean_throughput_bps,
        a.mean_goodput_bps,
        a.mean_latency_us,
        a.mean_jitter_us,
        a.mean_loss_rate,
        a.mean_retransmissions,
        a.stddev_throughput_bps,
        a.min_latency_us,
        a.max_latency_us,
        a.stddev_latency_us,
      ])
    );
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Comparison CSV
// ---------------------------------------------------------------------------

const COMPARISON_COLUMNS = [
  'experiment_name',
  'scenario_a',
  'scenario_b',
  'metric_name',
  'unit',
  'value_a',
  'value_b',
  'diff', // raw delta (b - a)
  'percent_change', // empty when not applicable (e.g. zero baseline)
];

/** One row per metric with both scenario measurements, the raw delta and the percentage shift. */
export function comparisonResultToCsv(result: ComparativeExperimentResult): string {
  const lines: string[] = [csvRow(COMPARISON_COLUMNS)];
  for (const d of result.deltas as MetricDelta[]) {
    lines.push(
      csvRow([
        result.experiment_name,
        result.scenario_a_name,
        result.scenario_b_name,
        d.metric_name,
        metricUnit(d.metric_name),
        d.val_a,
        d.val_b,
        d.diff,
        d.percent_change,
      ])
    );
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** Trigger a browser download of `content` as `filename`. */
export function downloadTextFile(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
