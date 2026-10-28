from __future__ import annotations

import math

from netsim.core.delays import calculate_tx_delay_us
from netsim.core.overhead import packet_overhead_bytes
from netsim.models.project import Project
from netsim.transport import (
    ConnectionState,
    TransportConfig,
    TransportEvent,
    TransportEventType,
    TransportMetrics,
    TransportProtocol,
    TransportSegment,
    TransportSimResult,
    resolve_route_and_links,
)


def simulate_udp(
    config: TransportConfig,
    project: Project | None = None,
) -> TransportSimResult:
    derived_route, hop_links = resolve_route_and_links(config, project)

    events: list[TransportEvent] = []
    step_index = 0
    curr_time_us = 0

    mss = max(1, config.segment_size_bytes)
    total_bytes = config.payload_bytes
    total_datagrams = max(1, math.ceil(total_bytes / mss))

    segments_sent = 0
    segments_delivered = 0
    segments_lost = 0
    bytes_sent = 0
    bytes_delivered = 0

    link_next_free_us: list[int] = [0] * len(hop_links)
    link_queue_occupancy: list[int] = [0] * len(hop_links)

    client_node = config.source_node_id
    server_node = config.destination_node_id

    for d_idx in range(total_datagrams):
        remaining = max(0, total_bytes - d_idx * mss)
        datagram_len = min(remaining, mss)

        segments_sent += 1
        bytes_sent += datagram_len

        segment = TransportSegment(
            source_port=config.source_port,
            destination_port=config.destination_port,
            sequence_number=config.initial_sequence_number + d_idx * mss,
            acknowledgment_number=0,
            flags=[],
            payload_length=datagram_len,
            advertised_window=0,
            timestamp_us=curr_time_us,
            is_retransmission=False,
        )

        events.append(
            TransportEvent(
                step_index=step_index,
                timestamp_us=curr_time_us,
                event_type=TransportEventType.DATA_SEGMENT_SENT,
                source_node=client_node,
                destination_node=server_node,
                segment=segment,
                connection_state=ConnectionState.CLOSED,
                cwnd_mss=0.0,
                ssthresh_mss=0.0,
                rtt_sample_us=None,
                srtt_us=0,
                rttvar_us=0,
                rto_us=0,
                description=f"Sent UDP datagram #{d_idx + 1} [seq={segment.sequence_number}, len={datagram_len} B]",
            )
        )
        step_index += 1

        is_dropped_by_config = d_idx in config.dropped_segments
        is_dropped_by_queue = False
        transit_time = curr_time_us

        for hop_idx, hop in enumerate(hop_links):
            tx_delay = calculate_tx_delay_us(datagram_len, hop.bandwidth_bps)

            if transit_time >= link_next_free_us[hop_idx]:
                link_queue_occupancy[hop_idx] = 0

            if link_queue_occupancy[hop_idx] >= hop.queue_capacity:
                is_dropped_by_queue = True
                segments_lost += 1
                events.append(
                    TransportEvent(
                        step_index=step_index,
                        timestamp_us=transit_time,
                        event_type=TransportEventType.SEGMENT_LOST,
                        source_node=hop.source,
                        destination_node=hop.target,
                        segment=segment,
                        connection_state=ConnectionState.CLOSED,
                        cwnd_mss=0.0,
                        ssthresh_mss=0.0,
                        rtt_sample_us=None,
                        srtt_us=0,
                        rttvar_us=0,
                        rto_us=0,
                        description=f"Drop-Tail at hop '{hop.source}' -> '{hop.target}': queue capacity ({hop.queue_capacity}) exceeded. Datagram #{d_idx + 1} lost.",
                    )
                )
                step_index += 1
                break
            else:
                link_queue_occupancy[hop_idx] += 1
                serialize_start = max(transit_time, link_next_free_us[hop_idx])
                link_next_free_us[hop_idx] = serialize_start + tx_delay
                transit_time = serialize_start + tx_delay + hop.delay_us

        if is_dropped_by_config and not is_dropped_by_queue:
            segments_lost += 1
            events.append(
                TransportEvent(
                    step_index=step_index,
                    timestamp_us=curr_time_us + 100,
                    event_type=TransportEventType.SEGMENT_LOST,
                    source_node=client_node,
                    destination_node=server_node,
                    segment=segment,
                    connection_state=ConnectionState.CLOSED,
                    cwnd_mss=0.0,
                    ssthresh_mss=0.0,
                    rtt_sample_us=None,
                    srtt_us=0,
                    rttvar_us=0,
                    rto_us=0,
                    description=f"Controlled Loss: UDP datagram #{d_idx + 1} intentionally dropped (no transport retransmission)",
                )
            )
            step_index += 1

        if not is_dropped_by_config and not is_dropped_by_queue:
            segments_delivered += 1
            bytes_delivered += datagram_len

            events.append(
                TransportEvent(
                    step_index=step_index,
                    timestamp_us=transit_time,
                    event_type=TransportEventType.SEGMENT_DELIVERED,
                    source_node=client_node,
                    destination_node=server_node,
                    segment=segment,
                    connection_state=ConnectionState.CLOSED,
                    cwnd_mss=0.0,
                    ssthresh_mss=0.0,
                    rtt_sample_us=None,
                    srtt_us=0,
                    rttvar_us=0,
                    rto_us=0,
                    description=f"UDP datagram #{d_idx + 1} successfully delivered at destination [transit_time={transit_time} us]",
                )
            )
            step_index += 1

        curr_time_us += 5000

    # Throughput (sender boundary) = every wire byte sent: datagram payload plus the
    # per-datagram IP+UDP headers (overhead.py). UDP never retransmits.
    # Goodput (receiver boundary)  = unique payload bytes of delivered datagrams.
    completion_time_us = max(1, curr_time_us)
    header_bytes_sent = segments_sent * packet_overhead_bytes("UDP")
    wire_bytes_sent = bytes_sent + header_bytes_sent
    throughput_bits_per_sec = (wire_bytes_sent * 8.0 * 1_000_000.0) / float(completion_time_us)
    throughput_bytes_per_sec = (wire_bytes_sent * 1_000_000.0) / float(completion_time_us)
    goodput_bits_per_sec = (bytes_delivered * 8.0 * 1_000_000.0) / float(completion_time_us)
    total_attempts = segments_sent + segments_lost
    packet_loss_rate = float(segments_lost) / float(total_attempts) if total_attempts > 0 else 0.0

    metrics = TransportMetrics(
        segments_sent=segments_sent,
        segments_delivered=segments_delivered,
        retransmissions=0,
        segments_lost=segments_lost,
        duplicate_acks=0,
        bytes_sent=bytes_sent,
        bytes_delivered=bytes_delivered,
        completion_time_us=completion_time_us,
        average_rtt_us=0,
        smoothed_rtt_us=0,
        final_rto_us=0,
        throughput_bits_per_sec=throughput_bits_per_sec,
        throughput_bytes_per_sec=throughput_bytes_per_sec,
        goodput_bits_per_sec=goodput_bits_per_sec,
        retransmitted_payload_bytes=0,
        header_bytes_sent=header_bytes_sent,
        wire_bytes_sent=wire_bytes_sent,
        packet_loss_rate=packet_loss_rate,
        sender_window_occupancy_avg=0.0,
        receiver_window_occupancy_max=0,
        congestion_window_final=0.0,
        congestion_window_max=0.0,
        timeout_count=0,
        fast_retransmit_count=0,
    )

    events.sort(key=lambda e: (e.timestamp_us, e.step_index))
    for idx, event in enumerate(events):
        event.step_index = idx

    return TransportSimResult(
        protocol=TransportProtocol.UDP,
        config=config,
        derived_route=derived_route,
        events=events,
        cwnd_timeline=[],
        metrics=metrics,
        completed=True,
    )
