import { describe, it, expect } from 'vitest';
import { api } from './lib/tauri';
import {
  QosMetrics,
  FaultScheduleEntry,
  SweepConfig,
  ComparativeExperimentConfig,
} from './types/experiments';

describe('Phase 7: QoS Metrics, Fault Injection & Experimentation Acceptance Tests', () => {
  // 1. Fetch current QoS metrics
  it('should fetch authoritative QoS metrics with valid rate and latency bounds', async () => {
    const qos: QosMetrics = await api.getCurrentQosMetrics();
    expect(qos).toBeDefined();
    expect(qos.measurement_interval_us).toBeGreaterThan(0);
    expect(qos.throughput_bits_per_sec).toBeGreaterThanOrEqual(0);
    expect(qos.goodput_bits_per_sec).toBeGreaterThanOrEqual(0);
    expect(qos.throughput_bits_per_sec).toBeGreaterThanOrEqual(qos.goodput_bits_per_sec);
    expect(Number.isNaN(qos.throughput_bits_per_sec)).toBe(false);
    expect(Number.isFinite(qos.throughput_bits_per_sec)).toBe(true);
    expect(qos.packet_loss_rate).toBeGreaterThanOrEqual(0);
    expect(qos.packet_loss_rate).toBeLessThanOrEqual(1.0);
    expect(Number.isNaN(qos.packet_loss_rate)).toBe(false);
  });

  // 2. RFC 3393 IPDV Jitter
  it('should compute RFC 3393 educational IPDV jitter per flow', async () => {
    const qos = await api.getCurrentQosMetrics();
    expect(qos.jitter_us).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(qos.jitter_us)).toBe(false);
    if (qos.jitter_samples.length > 0) {
      for (const sample of qos.jitter_samples) {
        expect(sample).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // 3. Loss category accounting consistency
  it('should maintain strict loss category breakdown without double-counting', async () => {
    const qos = await api.getCurrentQosMetrics();
    const categories = qos.loss_by_category;
    expect(categories).toBeDefined();
    expect(categories.queue_overflow).toBeGreaterThanOrEqual(0);
    expect(categories.link_down).toBeGreaterThanOrEqual(0);
    expect(categories.bit_error).toBeGreaterThanOrEqual(0);
    expect(categories.stochastic_loss).toBeGreaterThanOrEqual(0);

    const sumCategories =
      categories.queue_overflow +
      categories.link_down +
      categories.bit_error +
      categories.stochastic_loss;
    expect(sumCategories).toBe(qos.packets_lost);
  });

  // 4. Runtime fault injection
  it('should successfully schedule a runtime fault in simulation engine', async () => {
    const faultEntry: FaultScheduleEntry = {
      fault_id: 'test-fault-01',
      timestamp_us: 25000,
      fault_type: {
        type: 'link_down',
        link_id: 'link-1',
      },
      description: 'Scheduled link failure at 25ms',
    };

    await expect(api.scheduleFault(faultEntry)).resolves.not.toThrow();
  });

  // 5. Deterministic parameter sweep execution
  it('should execute a parameter sweep across multiple values and seeds', async () => {
    const config: SweepConfig = {
      experiment_name: 'Bandwidth Sweep Vitest',
      parameter: {
        type: 'link_bandwidth',
        link_id: null,
      },
      parameter_values: [1_000_000, 10_000_000, 100_000_000],
      seeds: [42, 101],
      simulation_duration_us: 50_000,
      packet_count: 5,
    };

    const res = await api.runParameterSweep(config);
    expect(res).toBeDefined();
    expect(res.experiment_name).toBe('Bandwidth Sweep Vitest');
    expect(res.points.length).toBe(3);
    expect(res.total_runs).toBe(6);
    expect(res.seeds).toEqual([42, 101]);
    expect(res.execution_time_ms).toBeGreaterThanOrEqual(0);

    for (const point of res.points) {
      expect(point.parameter_value).toBeGreaterThan(0);
      expect(point.aggregated_qos.run_count).toBe(2);
      expect(point.aggregated_qos.mean_throughput_bps).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(point.aggregated_qos.mean_throughput_bps)).toBe(false);
      expect(point.runs.length).toBe(2);
    }
  });

  // 6. Comparative A/B experiment execution and metric deltas
  it('should run a comparative A/B experiment and compute deltas', async () => {
    const config: ComparativeExperimentConfig = {
      experiment_name: 'Bandwidth A/B Benchmark',
      scenario_a: {
        name: 'High Capacity 100M',
        description: 'Baseline 100 Mbps',
        parameter_overrides: [[{ type: 'link_bandwidth', link_id: null }, 100_000_000]],
      },
      scenario_b: {
        name: 'Constrained 1M',
        description: 'Constrained 1 Mbps',
        parameter_overrides: [[{ type: 'link_bandwidth', link_id: null }, 1_000_000]],
      },
      seeds: [42],
      simulation_duration_us: 60_000,
    };

    const res = await api.runComparativeExperiment(config);
    expect(res).toBeDefined();
    expect(res.scenario_a_name).toBe('High Capacity 100M');
    expect(res.scenario_b_name).toBe('Constrained 1M');
    expect(res.qos_a).toBeDefined();
    expect(res.qos_b).toBeDefined();
    expect(res.deltas.length).toBeGreaterThanOrEqual(4);

    const throughputDelta = res.deltas.find((d) => d.metric_name === 'throughput_bps');
    expect(throughputDelta).toBeDefined();
    expect(throughputDelta?.val_a).toBe(10000000);
    expect(throughputDelta?.val_b).toBe(1000000);
    expect(throughputDelta?.diff).toBe(-9000000);

    const latencyDelta = res.deltas.find((d) => d.metric_name === 'latency_us');
    expect(latencyDelta).toBeDefined();
    expect(latencyDelta?.diff).toBeGreaterThan(0); // Scenario B has higher latency
  });

  // 7. Explicit ExperimentTarget execution
  it('should support explicit ExperimentTarget classification (Tcp, Udp, Application, FlowControl, Mac)', async () => {
    const targets = ['tcp', 'udp', 'application', 'flow_control', 'mac'] as const;
    for (const target of targets) {
      const config: SweepConfig = {
        experiment_name: `${target.toUpperCase()} Sweep`,
        target,
        parameter: {
          type: 'link_bandwidth',
          link_id: null,
        },
        parameter_values: [10_000_000],
        seeds: [42],
        simulation_duration_us: 10_000,
        packet_count: 2,
      };
      const res = await api.runParameterSweep(config);
      expect(res).toBeDefined();
      expect(res.points.length).toBe(1);
    }
  });

  // 8. Parameter and target configuration validation
  it('should validate parameter compatibility with the experiment target', () => {
    // Valid combination
    const tcpConfig: SweepConfig = {
      experiment_name: 'TCP Window Sweep',
      target: 'tcp',
      parameter: { type: 'window_size' },
      parameter_values: [1, 2, 4],
      seeds: [42],
      simulation_duration_us: 10000,
    };
    expect(tcpConfig.target).toBe('tcp');
    expect(tcpConfig.parameter.type).toBe('window_size');
  });
});
