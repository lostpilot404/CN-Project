import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  comparisonResultToCsv,
  comparisonResultToJson,
  exportFilename,
  exportSlug,
  metricUnit,
  sweepResultToCsv,
  sweepResultToJson,
} from './lib/exportResults';
import type {
  ComparativeExperimentResult,
  QosMetrics,
  SweepExperimentResult,
} from './types/experiments';

function qos(overrides: Partial<QosMetrics> = {}): QosMetrics {
  return {
    measurement_interval_us: 2000,
    throughput_bits_per_sec: 9600,
    throughput_bytes_per_sec: 1200,
    goodput_bits_per_sec: 8000,
    throughput_bytes_counted: 2400,
    goodput_payload_bytes: 2000,
    end_to_end_latencies_us: [100, 150],
    average_latency_us: 120.5,
    min_latency_us: 100,
    max_latency_us: 150,
    jitter_us: 12.25,
    jitter_samples: [5, 20],
    packets_sent: 10,
    packets_delivered: 9,
    packets_lost: 1,
    packet_loss_rate: 0.1,
    loss_by_category: {
      queue_overflow: 0,
      link_down: 0,
      bit_error: 0,
      stochastic_loss: 1,
      ttl_expired: 0,
      no_route: 0,
    },
    retransmissions: 2,
    link_utilization: [],
    queue_occupancy_average: 1.5,
    queue_occupancy_max: 4,
    queue_drops: 0,
    average_rtt_us: 300,
    ...overrides,
  };
}

const sweepResult: SweepExperimentResult = {
  experiment_name: 'Bandwidth Sweep Analysis',
  parameter_name: 'link_bandwidth',
  points: [
    {
      parameter_value: 1_000_000,
      aggregated_qos: {
        run_count: 2,
        mean_throughput_bps: 9600,
        mean_goodput_bps: 8000,
        mean_latency_us: 120.5,
        min_latency_us: 100,
        max_latency_us: 150,
        mean_jitter_us: 12.25,
        mean_loss_rate: 0.1,
        mean_retransmissions: 2,
        stddev_latency_us: 2.5,
        stddev_throughput_bps: 10.0,
      },
      runs: [
        { parameter_value: 1_000_000, seed: 42, qos: qos(), route_changes: [] },
        { parameter_value: 1_000_000, seed: 101, qos: qos(), route_changes: [] },
      ],
    },
    {
      parameter_value: 10_000_000,
      aggregated_qos: {
        run_count: 1,
        mean_throughput_bps: 96000,
        mean_goodput_bps: 80000,
        mean_latency_us: 50.25,
        min_latency_us: 40,
        max_latency_us: 60,
        mean_jitter_us: 5.5,
        mean_loss_rate: 0,
        mean_retransmissions: 0,
        stddev_latency_us: 0,
        stddev_throughput_bps: 0,
      },
      runs: [{ parameter_value: 10_000_000, seed: 42, qos: qos({ retransmissions: 0, packet_loss_rate: 0 }), route_changes: [] }],
    },
  ],
  total_runs: 3,
  seeds: [42, 101],
  execution_time_ms: 42,
};

const comparisonResult: ComparativeExperimentResult = {
  experiment_name: 'Capacity & Congestion A/B Test',
  scenario_a_name: 'High Bandwidth Baseline',
  scenario_b_name: 'Constrained Bandwidth Link',
  qos_a: sweepResult.points[0].aggregated_qos,
  qos_b: sweepResult.points[1].aggregated_qos,
  deltas: [
    { metric_name: 'throughput_bps', val_a: 9600, val_b: 96000, diff: 86400, percent_change: 900 },
    { metric_name: 'latency_us', val_a: 120.5, val_b: 50.25, diff: -70.25, percent_change: -58.3 },
    { metric_name: 'loss_rate', val_a: 0, val_b: 0.1, diff: 0.1, percent_change: null },
  ],
  route_changes_a: [],
  route_changes_b: [],
  runs_count_per_scenario: 2,
  execution_time_ms: 21,
};

describe('Experiment export filenames', () => {
  it('slugifies experiment names and falls back safely', () => {
    expect(exportSlug('Bandwidth Sweep Analysis')).toBe('bandwidth-sweep-analysis');
    expect(exportSlug('  ')).toBe('experiment');
  });

  it('produces names that identify kind, experiment and timestamp', () => {
    const name = exportFilename('sweep', 'Bandwidth Sweep Analysis', 'csv', new Date('2026-10-16T12:00:00Z'));
    expect(name).toBe('netsim-sweep-bandwidth-sweep-analysis-20261016120000.csv');
    const jname = exportFilename('comparison', 'Capacity & Congestion A/B Test', 'json', new Date('2026-10-16T12:00:00Z'));
    expect(jname).toMatch(/^netsim-comparison-capacity-congestion-a-b-test-\d{14}\.json$/);
  });
});

describe('Sweep JSON export', () => {
  it('preserves the backend result structure consumed by python-tools', () => {
    const doc = JSON.parse(sweepResultToJson(sweepResult));
    // Keys read by python-tools/analyze_results.py (_REQUIRED_KEYS + _parse_rows).
    for (const key of ['experiment_name', 'parameter_name', 'points', 'total_runs']) {
      expect(doc).toHaveProperty(key);
    }
    expect(doc.points[0]).toHaveProperty('parameter_value');
    expect(doc.points[0]).toHaveProperty('runs');
    const agg = doc.points[0].aggregated_qos;
    for (const key of [
      'run_count',
      'mean_throughput_bps',
      'mean_goodput_bps',
      'mean_latency_us',
      'mean_jitter_us',
      'mean_loss_rate',
      'mean_retransmissions',
    ]) {
      expect(agg).toHaveProperty(key);
    }
    expect(doc.seeds).toEqual([42, 101]);
  });
});

describe('Sweep CSV export', () => {
  const lines = () => sweepResultToCsv(sweepResult).trim().split('\n');

  it('uses unit-bearing column names', () => {
    const header = lines()[0];
    expect(header).toContain('parameter_value');
    expect(header).toContain('throughput_bps');
    expect(header).toContain('goodput_bps');
    expect(header).toContain('latency_us');
    expect(header).toContain('loss_rate');
  });

  it('emits per-run rows with seeds and aggregate rows with run counts', () => {
    const rows = lines().slice(1).map((l) => l.split(','));
    const runRows = rows.filter((r) => r[2] === 'run');
    const aggRows = rows.filter((r) => r[2] === 'aggregate');
    expect(runRows).toHaveLength(3); // 3 total_runs
    expect(aggRows).toHaveLength(2); // 2 sweep points

    // Run rows: seed filled, aggregate-only cells empty.
    expect(runRows[0][4]).toBe('42'); // seed
    expect(runRows[0][5]).toBe(''); // run_count not applicable
    expect(runRows[0][6]).toBe(''); // seeds not applicable
    expect(runRows[0][13]).toBe(''); // stddev not applicable

    // Aggregate rows: run_count and seeds filled, per-seed cell empty.
    expect(aggRows[0][4]).toBe(''); // seed not applicable
    expect(aggRows[0][5]).toBe('2'); // run_count
    expect(aggRows[0][6]).toBe('42;101'); // seeds
  });

  it('records measured values with their units in the column names', () => {
    const rows = lines().slice(1).map((l) => l.split(','));
    const run = rows[0];
    // throughput_bps / goodput_bps / latency_us columns
    expect(run[7]).toBe('9600');
    expect(run[8]).toBe('8000');
    expect(run[9]).toBe('120.5');
  });
});

describe('Comparison CSV export', () => {
  it('records scenario identities, measurements, raw deltas and percentage shifts', () => {
    const lines = comparisonResultToCsv(comparisonResult).trim().split('\n');
    const header = lines[0].split(',');
    expect(header).toEqual([
      'experiment_name',
      'scenario_a',
      'scenario_b',
      'metric_name',
      'unit',
      'value_a',
      'value_b',
      'diff',
      'percent_change',
    ]);
    const rows = lines.slice(1).map((l) => l.split(','));
    expect(rows).toHaveLength(3);
    expect(rows[0].slice(3)).toEqual(['throughput_bps', 'bps', '9600', '96000', '86400', '900']);
    expect(rows[1].slice(3)).toEqual(['latency_us', 'us', '120.5', '50.25', '-70.25', '-58.3']);
    // A null percentage change exports as an empty cell, not a fabricated number.
    expect(rows[2][8]).toBe('');
    // Raw deltas are always preserved even when the percentage is unavailable.
    expect(rows[2][7]).toBe('0.1');
    // Scenario identities are on every row.
    expect(rows[0][1]).toBe('High Bandwidth Baseline');
    expect(rows[0][2]).toBe('Constrained Bandwidth Link');
  });

  it('preserves the backend comparison structure in JSON', () => {
    const doc = JSON.parse(comparisonResultToJson(comparisonResult));
    expect(doc.scenario_a_name).toBe('High Bandwidth Baseline');
    expect(doc.deltas).toHaveLength(3);
    expect(doc.runs_count_per_scenario).toBe(2);
  });
});

describe('metric units', () => {
  it('derives units from metric suffixes and leaves dimensionless ones empty', () => {
    expect(metricUnit('throughput_bps')).toBe('bps');
    expect(metricUnit('latency_us')).toBe('us');
    expect(metricUnit('loss_rate')).toBe('ratio');
    expect(metricUnit('retransmissions')).toBe('');
  });
});

describe('ExportButtons UI', () => {
  const createObjectURL = vi.fn(() => 'blob:mock');
  const revokeObjectURL = vi.fn();

  beforeEach(async () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
    const { ExportButtons } = await import('./components/experiments/ExportButtons');
    const { render, screen } = await import('@testing-library/react');
    render(ExportButtons ? <ExportButtons kind="sweep" result={sweepResult} /> : <div />);
    void screen;
  });

  afterEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it('exports the result and reports the produced filename', async () => {
    const { screen, fireEvent } = await import('@testing-library/react');
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Exported netsim-sweep-bandwidth-sweep-analysis-\d{14}\.csv/)).toBeInTheDocument();
  });
});
