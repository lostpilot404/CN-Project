import { describe, it, expect } from 'vitest';
import { api } from './lib/tauri';
import { FlowControlConfig } from './types/flowControl';
import { MacConfig } from './types/mac';

describe('Phase 4C: Flow Control and Multiple Access Acceptance Tests', () => {
  // ==========================================
  // FLOW CONTROL: SLIDING WINDOW
  // ==========================================
  describe('Sliding Window Base Protocol', () => {
    it('simulates normal sliding-window progression and window advancement', async () => {
      const config: FlowControlConfig = {
        protocol: 'sliding_window',
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 6,
        frame_tx_time_us: 10000,
        prop_delay_us: 40000,
        ack_tx_time_us: 2000,
        timeout_us: 120000,
        seed: 42,
        dropped_frame_indices: [],
        corrupted_frame_indices: [],
        dropped_ack_seqs: [],
      };

      const res = await api.simulateSlidingWindow(config);
      expect(res).toBeDefined();
      expect(res.protocol).toBe('sliding_window');
      expect(res.is_completed).toBe(true);
      expect(res.metrics.completed_frames).toBe(6);
      expect(res.metrics.original_frames).toBe(6);
      expect(res.metrics.utilization).toBeGreaterThan(0);
      expect(res.events.length).toBeGreaterThan(0);

      // Check first event is frame transmission
      const firstEvent = res.events[0];
      expect(firstEvent.event_type).toBe('frame_sent');
      expect(firstEvent.seq_num).toBe(0);
    });
  });

  // ==========================================
  // FLOW CONTROL: GO-BACK-N ARQ
  // ==========================================
  describe('Go-Back-N ARQ Protocol', () => {
    it('simulates GBN frame loss, timeout, and retransmission cascade', async () => {
      const config: FlowControlConfig = {
        protocol: 'go_back_n',
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 6,
        frame_tx_time_us: 10000,
        prop_delay_us: 40000,
        ack_tx_time_us: 2000,
        timeout_us: 120000,
        seed: 42,
        dropped_frame_indices: [2],
        corrupted_frame_indices: [],
        dropped_ack_seqs: [],
      };

      const res = await api.simulateGoBackN(config);
      expect(res).toBeDefined();
      expect(res.protocol).toBe('go_back_n');
      expect(res.is_completed).toBe(true);

      // Verify loss and timeout events are captured in timeline
      const lossEvent = res.events.find((e) => e.event_type === 'frame_lost');
      expect(lossEvent).toBeDefined();
      expect(lossEvent?.frame_index).toBe(2);

      const timeoutEvent = res.events.find((e) => e.event_type === 'timeout_triggered');
      expect(timeoutEvent).toBeDefined();

      const retransEvent = res.events.find((e) => e.event_type === 'retransmission');
      expect(retransEvent).toBeDefined();
      expect(res.metrics.retransmissions).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================
  // FLOW CONTROL: SELECTIVE REPEAT ARQ
  // ==========================================
  describe('Selective Repeat ARQ Protocol', () => {
    it('simulates SR out-of-order receiver buffering and selective retransmission', async () => {
      const config: FlowControlConfig = {
        protocol: 'selective_repeat',
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 6,
        frame_tx_time_us: 10000,
        prop_delay_us: 40000,
        ack_tx_time_us: 2000,
        timeout_us: 120000,
        seed: 42,
        dropped_frame_indices: [2],
        corrupted_frame_indices: [],
        dropped_ack_seqs: [],
      };

      const res = await api.simulateSelectiveRepeat(config);
      expect(res).toBeDefined();
      expect(res.protocol).toBe('selective_repeat');
      expect(res.is_completed).toBe(true);

      // Verify that receiver buffered frames
      expect(res.metrics.receiver_buffer_occupancy_max).toBeGreaterThanOrEqual(1);

      // Verify selective retransmission of dropped frame ONLY
      const retransEvents = res.events.filter((e) => e.event_type === 'retransmission');
      expect(retransEvents.length).toBeGreaterThanOrEqual(1);
      for (const ev of retransEvents) {
        expect(ev.frame_index).toBe(2);
      }
    });
  });

  // ==========================================
  // MULTIPLE ACCESS: PURE ALOHA
  // ==========================================
  describe('Pure ALOHA Protocol', () => {
    it('simulates overlapping transmissions, collision detection, and backoff', async () => {
      const config: MacConfig = {
        protocol: 'pure_aloha',
        persistence: 'one_persistent',
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 42,
        max_retries: 16,
        offered_load_g: 1.0,
      };

      const res = await api.simulatePureAloha(config);
      expect(res).toBeDefined();
      expect(res.protocol).toBe('pure_aloha');
      expect(res.metrics.attempted_transmissions).toBeGreaterThan(0);
      expect(res.metrics.throughput_frames_per_sec).toBeGreaterThan(0);
      expect(res.metrics.throughput_bits_per_sec).toBeGreaterThan(0);
      expect(res.metrics.channel_utilization).toBeGreaterThan(0);

      // Verify collision events
      const collisionEv = res.events.find((e) => e.event_type === 'collision_detected');
      expect(collisionEv).toBeDefined();

      const backoffEv = res.events.find((e) => e.event_type === 'backoff_scheduled');
      expect(backoffEv).toBeDefined();
    });
  });

  // ==========================================
  // MULTIPLE ACCESS: SLOTTED ALOHA
  // ==========================================
  describe('Slotted ALOHA Protocol', () => {
    it('simulates discrete slot alignment with success and collision records', async () => {
      const config: MacConfig = {
        protocol: 'slotted_aloha',
        persistence: 'one_persistent',
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 42,
        max_retries: 16,
        offered_load_g: 1.0,
      };

      const res = await api.simulateSlottedAloha(config);
      expect(res).toBeDefined();
      expect(res.protocol).toBe('slotted_aloha');
      expect(res.slot_records.length).toBeGreaterThan(0);

      // Verify slot record structure
      const firstSlot = res.slot_records[0];
      expect(firstSlot.slot_index).toBe(0);
      expect(firstSlot.end_time_us - firstSlot.start_time_us).toBe(10000);
      expect(firstSlot.status).toContain('Success');
    });
  });

  // ==========================================
  // MULTIPLE ACCESS: CSMA
  // ==========================================
  describe('CSMA Protocol', () => {
    it('simulates carrier sensing and immediate transmission in 1-persistent mode', async () => {
      const config: MacConfig = {
        protocol: 'csma',
        persistence: 'one_persistent',
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 42,
        max_retries: 16,
        offered_load_g: 1.0,
      };

      const res = await api.simulateCsma(config);
      expect(res).toBeDefined();
      expect(res.protocol).toBe('csma');

      // Check carrier sensing event
      const senseEv = res.events.find((e) => e.event_type === 'carrier_sensed');
      expect(senseEv).toBeDefined();
      expect(senseEv?.channel_state).toBe('idle');
    });
  });

  // ==========================================
  // MULTIPLE ACCESS: CSMA/CD
  // ==========================================
  describe('CSMA/CD Protocol (Ethernet Contention)', () => {
    it('simulates collision detection, 32-bit jam signal, transmission abort, and binary exponential backoff', async () => {
      const config: MacConfig = {
        protocol: 'csma_cd',
        persistence: 'one_persistent',
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 42,
        max_retries: 16,
        offered_load_g: 1.5,
      };

      const res = await api.simulateCsmaCd(config);
      expect(res).toBeDefined();
      expect(res.protocol).toBe('csma_cd');

      // Verify CSMA/CD sequence: carrier sensed -> transmission started -> collision detected -> jam signal -> abort -> BEB
      const jamEv = res.events.find((e) => e.event_type === 'jam_signal_sent');
      expect(jamEv).toBeDefined();
      expect(jamEv?.description).toContain('jam signal');

      const abortEv = res.events.find((e) => e.event_type === 'transmission_aborted');
      expect(abortEv).toBeDefined();

      const backoffEv = res.events.find((e) => e.event_type === 'backoff_scheduled');
      expect(backoffEv).toBeDefined();
      expect(backoffEv?.description).toContain('BEB');
    });
  });
});
