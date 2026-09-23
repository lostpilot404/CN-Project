use serde::{Deserialize, Serialize};

/// Congestion control phases in educational TCP Reno.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CongestionPhase {
    SlowStart,
    CongestionAvoidance,
    FastRecovery,
    TimeoutRecovery,
}

/// Point on the congestion window timeline for graphical visualization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CwndPoint {
    pub timestamp_us: u64,
    pub cwnd_mss: f64,
    pub cwnd_bytes: u64,
    pub ssthresh_mss: f64,
    pub phase: CongestionPhase,
    pub reason: String,
}

/// Educational TCP Reno congestion controller.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CongestionController {
    pub cwnd_mss: f64,
    pub ssthresh_mss: f64,
    pub mss_bytes: u64,
    pub phase: CongestionPhase,
    pub duplicate_ack_count: u32,
    pub timeline: Vec<CwndPoint>,
    /// Accumulated fractional increments in Congestion Avoidance (fixed-point precision)
    ca_accumulator: f64,
}

impl CongestionController {
    pub fn new(initial_cwnd_mss: f64, initial_ssthresh_mss: f64, mss_bytes: u64) -> Self {
        let cwnd = initial_cwnd_mss.max(1.0);
        let ssthresh = initial_ssthresh_mss.max(2.0);
        let mut controller = Self {
            cwnd_mss: cwnd,
            ssthresh_mss: ssthresh,
            mss_bytes: mss_bytes.max(1),
            phase: CongestionPhase::SlowStart,
            duplicate_ack_count: 0,
            timeline: Vec::new(),
            ca_accumulator: 0.0,
        };
        controller.record_point(0, "Initial state (Slow Start)".to_string());
        controller
    }

    #[inline]
    pub fn cwnd_bytes(&self) -> u64 {
        (self.cwnd_mss * self.mss_bytes as f64).round() as u64
    }

    pub fn record_point(&mut self, timestamp_us: u64, reason: String) {
        self.timeline.push(CwndPoint {
            timestamp_us,
            cwnd_mss: (self.cwnd_mss * 1000.0).round() / 1000.0,
            cwnd_bytes: self.cwnd_bytes(),
            ssthresh_mss: (self.ssthresh_mss * 1000.0).round() / 1000.0,
            phase: self.phase,
            reason,
        });
    }

    /// Process a new ACK acknowledging previously unacknowledged data.
    pub fn on_new_ack(&mut self, timestamp_us: u64, bytes_acked: u64) {
        self.duplicate_ack_count = 0;

        match self.phase {
            CongestionPhase::SlowStart => {
                // In Slow Start: increase cwnd by 1 MSS for each ACK (exponential growth per RTT)
                let increment = (bytes_acked as f64 / self.mss_bytes as f64).max(1.0);
                self.cwnd_mss += increment;

                if self.cwnd_mss >= self.ssthresh_mss {
                    self.phase = CongestionPhase::CongestionAvoidance;
                    self.ca_accumulator = 0.0;
                    self.record_point(
                        timestamp_us,
                        format!(
                            "Reached ssthresh ({:.1} MSS); transitioned from Slow Start to Congestion Avoidance",
                            self.ssthresh_mss
                        ),
                    );
                } else {
                    self.record_point(
                        timestamp_us,
                        format!("Slow Start: cwnd increased to {:.2} MSS", self.cwnd_mss),
                    );
                }
            }
            CongestionPhase::CongestionAvoidance => {
                // In Congestion Avoidance: additive increase (~1 MSS per RTT)
                // Increment per ACK = 1.0 / cwnd_mss
                let step = 1.0 / self.cwnd_mss.max(1.0);
                self.ca_accumulator += step;
                if self.ca_accumulator >= 1.0 {
                    let full_mss = self.ca_accumulator.floor();
                    self.cwnd_mss += full_mss;
                    self.ca_accumulator -= full_mss;
                    self.record_point(
                        timestamp_us,
                        format!(
                            "Congestion Avoidance: additive increase (+1 MSS) -> cwnd is now {:.2} MSS",
                            self.cwnd_mss
                        ),
                    );
                } else {
                    self.cwnd_mss += step;
                    self.record_point(
                        timestamp_us,
                        format!(
                            "Congestion Avoidance: cwnd incremental update -> {:.2} MSS",
                            self.cwnd_mss
                        ),
                    );
                }
            }
            CongestionPhase::FastRecovery => {
                // New ACK received in Fast Recovery: deflates cwnd to ssthresh and exits to Congestion Avoidance
                self.cwnd_mss = self.ssthresh_mss;
                self.phase = CongestionPhase::CongestionAvoidance;
                self.ca_accumulator = 0.0;
                self.record_point(
                    timestamp_us,
                    format!(
                        "Exited Fast Recovery: new data ACKed, cwnd deflated to ssthresh ({:.1} MSS)",
                        self.ssthresh_mss
                    ),
                );
            }
            CongestionPhase::TimeoutRecovery => {
                // In Timeout Recovery: resumption in Slow Start
                self.cwnd_mss += 1.0;
                if self.cwnd_mss >= self.ssthresh_mss {
                    self.phase = CongestionPhase::CongestionAvoidance;
                    self.record_point(
                        timestamp_us,
                        format!(
                            "Timeout Recovery: reached ssthresh ({:.1} MSS) -> Congestion Avoidance",
                            self.ssthresh_mss
                        ),
                    );
                } else {
                    self.phase = CongestionPhase::SlowStart;
                    self.record_point(
                        timestamp_us,
                        format!(
                            "Timeout Recovery: cwnd increased to {:.2} MSS in Slow Start",
                            self.cwnd_mss
                        ),
                    );
                }
            }
        }
    }

    /// Process a duplicate ACK. Returns true if Fast Retransmit was triggered (3rd duplicate ACK).
    pub fn on_duplicate_ack(&mut self, timestamp_us: u64) -> bool {
        self.duplicate_ack_count += 1;

        if self.phase == CongestionPhase::FastRecovery {
            // In Fast Recovery, each additional duplicate ACK inflates cwnd by 1 MSS
            self.cwnd_mss += 1.0;
            self.record_point(
                timestamp_us,
                format!(
                    "Fast Recovery: duplicate ACK #{} inflated cwnd to {:.2} MSS",
                    self.duplicate_ack_count, self.cwnd_mss
                ),
            );
            return false;
        }

        if self.duplicate_ack_count == 3 {
            // 3 Duplicate ACKs -> Fast Retransmit & Fast Recovery
            self.ssthresh_mss = (self.cwnd_mss / 2.0).max(2.0);
            self.cwnd_mss = self.ssthresh_mss + 3.0;
            self.phase = CongestionPhase::FastRecovery;
            self.record_point(
                timestamp_us,
                format!(
                    "3 Duplicate ACKs received! Fast Retransmit triggered: ssthresh = {:.1} MSS, cwnd = {:.1} MSS (Fast Recovery)",
                    self.ssthresh_mss, self.cwnd_mss
                ),
            );
            true
        } else {
            self.record_point(
                timestamp_us,
                format!("Duplicate ACK #{} received", self.duplicate_ack_count),
            );
            false
        }
    }

    /// Process an RTO Timeout. Strong congestion response.
    pub fn on_timeout(&mut self, timestamp_us: u64) {
        self.ssthresh_mss = (self.cwnd_mss / 2.0).max(2.0);
        self.cwnd_mss = 1.0;
        self.phase = CongestionPhase::TimeoutRecovery;
        self.duplicate_ack_count = 0;
        self.ca_accumulator = 0.0;
        self.record_point(
            timestamp_us,
            format!(
                "RTO Timeout expired! Strong congestion response: ssthresh = {:.1} MSS, cwnd = 1.0 MSS (Timeout Recovery)",
                self.ssthresh_mss
            ),
        );
    }

    /// Explicit packet loss response (multiplicative decrease).
    pub fn on_packet_loss(&mut self, timestamp_us: u64, reason: &str) {
        self.ssthresh_mss = (self.cwnd_mss / 2.0).max(2.0);
        self.cwnd_mss = self.ssthresh_mss;
        self.phase = CongestionPhase::CongestionAvoidance;
        self.duplicate_ack_count = 0;
        self.ca_accumulator = 0.0;
        self.record_point(
            timestamp_us,
            format!(
                "Packet loss ({}): multiplicative decrease -> ssthresh = {:.1} MSS, cwnd = {:.1} MSS",
                reason, self.ssthresh_mss, self.cwnd_mss
            ),
        );
    }
}
