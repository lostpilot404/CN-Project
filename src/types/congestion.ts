export type CongestionPhase =
  | 'slow_start'
  | 'congestion_avoidance'
  | 'fast_recovery'
  | 'timeout_recovery';

export interface CwndPoint {
  timestamp_us: number;
  cwnd_mss: number;
  cwnd_bytes: number;
  ssthresh_mss: number;
  phase: CongestionPhase;
  reason: string;
}
