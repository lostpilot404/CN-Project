"""Calculates transmission delay and arrival timing in microseconds."""

import math


def calculate_tx_delay_us(size_bytes: int, bandwidth_bps: int) -> int:
    """Calculates transmission delay in microseconds given packet size in bytes

    and link bandwidth in bits per second. Uses ceiling integer division
    to match authoritative integer discrete-event simulation behavior.
    """
    if bandwidth_bps <= 0:
        return 0
    bits = size_bytes * 8
    numerator = bits * 1_000_000
    # Ceiling division
    return math.ceil(numerator / bandwidth_bps)


def calculate_arrival_time_us(tx_start_us: int, tx_delay_us: int, propagation_delay_us: int) -> int:
    """Calculates packet arrival time in microseconds.

    Arrival = TxStart + TxDelay + PropagationDelay
    """
    return tx_start_us + tx_delay_us + propagation_delay_us
