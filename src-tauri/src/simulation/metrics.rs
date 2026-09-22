use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SimulationMetrics {
    pub packets_created: u64,
    pub packets_delivered: u64,
    pub packets_dropped_overflow: u64,
    pub packets_dropped_loss: u64,
    pub packets_dropped_error: u64,
    pub packets_dropped_link_down: u64,
    pub bytes_transmitted: u64,
    pub bytes_delivered: u64,
    pub total_latency_us: u64,
    pub min_latency_us: Option<u64>,
    pub max_latency_us: Option<u64>,
}

impl SimulationMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_created(&mut self, _size_bytes: usize) {
        self.packets_created += 1;
    }

    pub fn record_tx(&mut self, size_bytes: usize) {
        self.bytes_transmitted += size_bytes as u64;
    }

    pub fn record_delivered(&mut self, size_bytes: usize, latency_us: u64) {
        self.packets_delivered += 1;
        self.bytes_delivered += size_bytes as u64;
        self.total_latency_us += latency_us;

        self.min_latency_us = Some(match self.min_latency_us {
            Some(min) => min.min(latency_us),
            None => latency_us,
        });

        self.max_latency_us = Some(match self.max_latency_us {
            Some(max) => max.max(latency_us),
            None => latency_us,
        });
    }

    pub fn record_dropped_overflow(&mut self) {
        self.packets_dropped_overflow += 1;
    }

    pub fn record_dropped_loss(&mut self) {
        self.packets_dropped_loss += 1;
    }

    pub fn record_dropped_error(&mut self) {
        self.packets_dropped_error += 1;
    }

    pub fn record_dropped_link_down(&mut self) {
        self.packets_dropped_link_down += 1;
    }

    pub fn total_dropped(&self) -> u64 {
        self.packets_dropped_overflow
            + self.packets_dropped_loss
            + self.packets_dropped_error
            + self.packets_dropped_link_down
    }

    pub fn delivery_ratio(&self) -> f64 {
        if self.packets_created == 0 {
            0.0
        } else {
            self.packets_delivered as f64 / self.packets_created as f64
        }
    }

    pub fn loss_ratio(&self) -> f64 {
        if self.packets_created == 0 {
            0.0
        } else {
            self.total_dropped() as f64 / self.packets_created as f64
        }
    }

    pub fn avg_latency_ms(&self) -> f64 {
        if self.packets_delivered == 0 {
            0.0
        } else {
            (self.total_latency_us as f64 / self.packets_delivered as f64) / 1_000.0
        }
    }

    pub fn throughput_bps(&self, elapsed_sim_time_us: u64) -> f64 {
        if elapsed_sim_time_us == 0 {
            0.0
        } else {
            (self.bytes_delivered as f64 * 8.0 * 1_000_000.0) / elapsed_sim_time_us as f64
        }
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}
