/// Calculates transmission delay in microseconds given packet size in bytes
/// and link bandwidth in bits per second.
/// Uses ceiling integer division to avoid floating-point non-determinism.
pub fn calculate_tx_delay_us(size_bytes: usize, bandwidth_bps: u64) -> u64 {
    if bandwidth_bps == 0 {
        return 0;
    }
    let bits = (size_bytes as u128) * 8;
    let numerator = bits * 1_000_000;
    let denominator = bandwidth_bps as u128;
    numerator.div_ceil(denominator) as u64
}

/// Calculates packet arrival time in microseconds.
/// Arrival = TxStart + TxDelay + PropagationDelay
pub fn calculate_arrival_time_us(
    tx_start_us: u64,
    tx_delay_us: u64,
    propagation_delay_us: u64,
) -> u64 {
    tx_start_us + tx_delay_us + propagation_delay_us
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tx_delay_calculation() {
        // 1000 bytes over 10 Mbps (10,000,000 bps)
        // bits = 8,000. 8,000 / 10,000,000 = 0.0008 s = 800 µs
        let delay = calculate_tx_delay_us(1000, 10_000_000);
        assert_eq!(delay, 800);

        // 1500 bytes over 1 Gbps (1,000,000,000 bps)
        // bits = 12,000. 12,000 / 1,000,000,000 = 0.000012 s = 12 µs
        let delay_gbps = calculate_tx_delay_us(1500, 1_000_000_000);
        assert_eq!(delay_gbps, 12);

        // 64 bytes over 100 Mbps (100,000,000 bps)
        // bits = 512. 512 / 100,000,000 = 5.12 µs -> ceiling = 6 µs
        let delay_small = calculate_tx_delay_us(64, 100_000_000);
        assert_eq!(delay_small, 6);
    }

    #[test]
    fn test_arrival_time_calculation() {
        let start = 1_000;
        let tx_delay = 800;
        let prop_delay = 5_000;
        let arrival = calculate_arrival_time_us(start, tx_delay, prop_delay);
        assert_eq!(arrival, 6_800);
    }
}
