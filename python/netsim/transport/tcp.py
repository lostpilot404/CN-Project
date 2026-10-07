from __future__ import annotations

from dataclasses import dataclass

from netsim.congestion.cwnd import CongestionController
from netsim.core.delays import calculate_tx_delay_us
from netsim.models.project import Project
from netsim.transport import (
    ConnectionState,
    HopLink,
    RttEstimator,
    TcpFlag,
    TransportConfig,
    TransportEvent,
    TransportEventType,
    TransportMetrics,
    TransportProtocol,
    TransportSegment,
    TransportSimResult,
    resolve_route_and_links,
)


@dataclass
class InFlightSegment:
    seq: int
    length: int
    tx_time_us: int
    is_retransmit: bool = False
    retries: int = 0


@dataclass
class ArrivingAck:
    ack_number: int
    rx_time_us: int


def calculate_forward_delay(links: list[HopLink], size_bytes: int) -> int:
    return sum(calculate_tx_delay_us(size_bytes, lnk.bandwidth_bps) + lnk.delay_us for lnk in links)


def simulate_tcp(
    config: TransportConfig,
    project: Project | None = None,
) -> TransportSimResult:
    derived_route, hop_links = resolve_route_and_links(config, project)

    events: list[TransportEvent] = []
    step_index = 0
    curr_time_us = 0

    mss = max(1, config.segment_size_bytes)
    congestion_controller = CongestionController.new(
        config.initial_cwnd_mss,
        config.initial_ssthresh_mss,
        mss,
    )

    rtt_estimator = RttEstimator.new(max(10_000, config.initial_rto_us), 10_000, 3_000_000)

    connection_state = ConnectionState.SYN_SENT

    segments_sent = 0
    retransmissions = 0
    segments_lost = 0
    duplicate_acks = 0
    bytes_sent = 0
    bytes_delivered = 0
    timeout_count = 0
    fast_retransmit_count = 0
    receiver_window_occupancy_max = 0
    max_observed_cwnd = config.initial_cwnd_mss

    link_next_free_us: list[int] = [0] * len(hop_links)
    link_queue_occupancy: list[int] = [0] * len(hop_links)

    client_node = config.source_node_id
    server_node = config.destination_node_id

    # 1. THREE-WAY HANDSHAKE (SYN -> SYN-ACK -> ACK)
    client_isn = config.initial_sequence_number
    server_isn = 5000

    syn_segment = TransportSegment(
        source_port=config.source_port,
        destination_port=config.destination_port,
        sequence_number=client_isn,
        acknowledgment_number=0,
        flags=[TcpFlag.SYN],
        payload_length=0,
        advertised_window=config.receive_window_bytes,
        timestamp_us=curr_time_us,
        is_retransmission=False,
    )

    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            event_type=TransportEventType.SYN_SENT,
            source_node=client_node,
            destination_node=server_node,
            segment=syn_segment,
            connection_state=connection_state,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description=f"Client initiates TCP 3-way handshake: sent SYN [seq={client_isn}]",
        )
    )
    step_index += 1

    syn_transit_delay = calculate_forward_delay(hop_links, 40)
    server_syn_rx_time = curr_time_us + syn_transit_delay

    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=server_syn_rx_time,
            event_type=TransportEventType.SYN_RECEIVED,
            source_node=client_node,
            destination_node=server_node,
            segment=syn_segment,
            connection_state=ConnectionState.SYN_RECEIVED,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description=f"Server received SYN; transitioned from LISTEN to SYN-RECEIVED, replying with SYN-ACK [seq={server_isn}, ack={client_isn + 1}]",
        )
    )
    step_index += 1

    synack_segment = TransportSegment(
        source_port=config.destination_port,
        destination_port=config.source_port,
        sequence_number=server_isn,
        acknowledgment_number=client_isn + 1,
        flags=[TcpFlag.SYN, TcpFlag.ACK],
        payload_length=0,
        advertised_window=config.receive_window_bytes,
        timestamp_us=server_syn_rx_time,
        is_retransmission=False,
    )

    synack_transit_delay = calculate_forward_delay(hop_links, 40)
    client_synack_rx_time = server_syn_rx_time + synack_transit_delay

    handshake_rtt = client_synack_rx_time - curr_time_us
    rtt_estimator.update_sample(handshake_rtt)

    connection_state = ConnectionState.ESTABLISHED
    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=client_synack_rx_time,
            event_type=TransportEventType.CONNECTION_ESTABLISHED,
            source_node=server_node,
            destination_node=client_node,
            segment=synack_segment,
            connection_state=connection_state,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=handshake_rtt,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description=f"Client received SYN-ACK. First RTT sample = {handshake_rtt} us (SRTT={rtt_estimator.srtt_us} us, RTO={rtt_estimator.rto_us} us). Client state: ESTABLISHED",
        )
    )
    step_index += 1

    handshake_ack = TransportSegment(
        source_port=config.source_port,
        destination_port=config.destination_port,
        sequence_number=client_isn + 1,
        acknowledgment_number=server_isn + 1,
        flags=[TcpFlag.ACK],
        payload_length=0,
        advertised_window=config.receive_window_bytes,
        timestamp_us=client_synack_rx_time,
        is_retransmission=False,
    )

    handshake_complete_time = client_synack_rx_time + calculate_forward_delay(hop_links, 40)
    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=handshake_complete_time,
            event_type=TransportEventType.CONNECTION_ESTABLISHED,
            source_node=client_node,
            destination_node=server_node,
            segment=handshake_ack,
            connection_state=connection_state,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description="Server received final ACK. 3-way handshake COMPLETE. Both endpoints ESTABLISHED.",
        )
    )
    step_index += 1

    curr_time_us = client_synack_rx_time

    # 2. BYTE-ORIENTED DATA TRANSFER & CONGESTION
    total_payload = config.payload_bytes
    data_start_seq = client_isn + 1
    max_seq = data_start_seq + total_payload

    send_base = data_start_seq
    next_seq = data_start_seq
    rcv_nxt = data_start_seq

    in_flight: list[InFlightSegment] = []
    pending_acks: list[ArrivingAck] = []
    receiver_buffer: dict[int, int] = {}
    data_seg_counter = 0

    total_window_samples = 0
    cumulative_window_occupancy = 0.0

    iteration_guard = 0
    while send_base < max_seq and iteration_guard < 100_000:
        iteration_guard += 1

        max_observed_cwnd = max(max_observed_cwnd, congestion_controller.cwnd_mss)

        cwnd_bytes = congestion_controller.cwnd_bytes()
        effective_window = min(cwnd_bytes, config.receive_window_bytes)
        in_flight_bytes = sum(s.length for s in in_flight)

        total_window_samples += 1
        cumulative_window_occupancy += float(in_flight_bytes) / float(max(1, effective_window))

        while in_flight_bytes + mss <= effective_window and next_seq < max_seq:
            seg_len = min(max_seq - next_seq, mss)
            current_seg_idx = data_seg_counter
            data_seg_counter += 1

            segments_sent += 1
            bytes_sent += seg_len

            data_segment = TransportSegment(
                source_port=config.source_port,
                destination_port=config.destination_port,
                sequence_number=next_seq,
                acknowledgment_number=server_isn + 1,
                flags=[TcpFlag.ACK, TcpFlag.PSH],
                payload_length=seg_len,
                advertised_window=config.receive_window_bytes,
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
                    segment=data_segment,
                    connection_state=connection_state,
                    cwnd_mss=congestion_controller.cwnd_mss,
                    ssthresh_mss=congestion_controller.ssthresh_mss,
                    rtt_sample_us=None,
                    srtt_us=rtt_estimator.srtt_us,
                    rttvar_us=rtt_estimator.rttvar_us,
                    rto_us=rtt_estimator.rto_us,
                    description=f"Sent data segment [seq={next_seq}, len={seg_len}, seg_idx={current_seg_idx}]. In-flight: {in_flight_bytes + seg_len}/{effective_window} B",
                )
            )
            step_index += 1

            is_dropped_by_config = current_seg_idx in config.dropped_segments
            is_dropped_by_queue = False
            transit_time = curr_time_us

            for hop_idx, hop in enumerate(hop_links):
                tx_delay = calculate_tx_delay_us(seg_len, hop.bandwidth_bps)
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
                            segment=data_segment,
                            connection_state=connection_state,
                            cwnd_mss=congestion_controller.cwnd_mss,
                            ssthresh_mss=congestion_controller.ssthresh_mss,
                            rtt_sample_us=None,
                            srtt_us=rtt_estimator.srtt_us,
                            rttvar_us=rtt_estimator.rttvar_us,
                            rto_us=rtt_estimator.rto_us,
                            description=f"Drop-Tail at hop '{hop.source}' -> '{hop.target}': queue capacity ({hop.queue_capacity}) exceeded. Segment [seq={next_seq}] lost.",
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
                        segment=data_segment,
                        connection_state=connection_state,
                        cwnd_mss=congestion_controller.cwnd_mss,
                        ssthresh_mss=congestion_controller.ssthresh_mss,
                        rtt_sample_us=None,
                        srtt_us=rtt_estimator.srtt_us,
                        rttvar_us=rtt_estimator.rttvar_us,
                        rto_us=rtt_estimator.rto_us,
                        description=f"Controlled Loss: Segment [seq={next_seq}, seg_idx={current_seg_idx}] intentionally dropped",
                    )
                )
                step_index += 1

            will_arrive = not is_dropped_by_config and not is_dropped_by_queue
            arrival_time = transit_time

            in_flight.append(
                InFlightSegment(
                    seq=next_seq,
                    length=seg_len,
                    tx_time_us=curr_time_us,
                    is_retransmit=False,
                    retries=0,
                )
            )

            next_seq += seg_len
            in_flight_bytes += seg_len

            if will_arrive:
                rx_time = arrival_time
                seg_seq = data_segment.sequence_number
                seg_length = data_segment.payload_length

                if seg_seq == rcv_nxt:
                    rcv_nxt += seg_length
                    while rcv_nxt in receiver_buffer:
                        buffered_len = receiver_buffer.pop(rcv_nxt)
                        rcv_nxt += buffered_len
                    ack_to_generate = rcv_nxt
                elif seg_seq > rcv_nxt:
                    receiver_buffer[seg_seq] = seg_length
                    current_buf_bytes = sum(receiver_buffer.values())
                    receiver_window_occupancy_max = max(receiver_window_occupancy_max, current_buf_bytes)
                    ack_to_generate = rcv_nxt
                else:
                    ack_to_generate = rcv_nxt

                ack_return_delay = calculate_forward_delay(hop_links, 40)
                pending_acks.append(
                    ArrivingAck(
                        ack_number=ack_to_generate,
                        rx_time_us=rx_time + ack_return_delay,
                    )
                )
                pending_acks.sort(key=lambda a: a.rx_time_us)

        oldest_tx_time = in_flight[0].tx_time_us if in_flight else curr_time_us
        timeout_time = oldest_tx_time + rtt_estimator.rto_us

        next_ack = pending_acks[0] if pending_acks else None

        if next_ack is not None and next_ack.rx_time_us <= timeout_time:
            ack_info = pending_acks.pop(0)
            curr_time_us = ack_info.rx_time_us

            ack_seg = TransportSegment(
                source_port=config.destination_port,
                destination_port=config.source_port,
                sequence_number=server_isn + 1,
                acknowledgment_number=ack_info.ack_number,
                flags=[TcpFlag.ACK],
                payload_length=0,
                advertised_window=config.receive_window_bytes,
                timestamp_us=curr_time_us,
                is_retransmission=False,
            )

            if ack_info.ack_number > send_base:
                bytes_acked = ack_info.ack_number - send_base
                send_base = ack_info.ack_number
                bytes_delivered += bytes_acked

                sampled_rtt = None
                for s in in_flight:
                    if s.seq < send_base:
                        if not s.is_retransmit:
                            sample = max(0, curr_time_us - s.tx_time_us)
                            rtt_estimator.update_sample(sample)
                            sampled_rtt = sample
                        break

                in_flight = [s for s in in_flight if s.seq >= send_base]

                congestion_controller.on_new_ack(curr_time_us, bytes_acked)

                events.append(
                    TransportEvent(
                        step_index=step_index,
                        timestamp_us=curr_time_us,
                        event_type=TransportEventType.ACK_RECEIVED,
                        source_node=server_node,
                        destination_node=client_node,
                        segment=ack_seg,
                        connection_state=connection_state,
                        cwnd_mss=congestion_controller.cwnd_mss,
                        ssthresh_mss=congestion_controller.ssthresh_mss,
                        rtt_sample_us=sampled_rtt,
                        srtt_us=rtt_estimator.srtt_us,
                        rttvar_us=rtt_estimator.rttvar_us,
                        rto_us=rtt_estimator.rto_us,
                        description=f"Received ACK [ack={ack_info.ack_number}]. Acknowledged {bytes_acked} bytes. Send base now {send_base}. Cwnd={congestion_controller.cwnd_mss:.2f} MSS ({congestion_controller.phase.value})",
                    )
                )
                step_index += 1
            elif ack_info.ack_number == send_base and len(in_flight) > 0:
                duplicate_acks += 1
                is_fast_retransmit = congestion_controller.on_duplicate_ack(curr_time_us)

                events.append(
                    TransportEvent(
                        step_index=step_index,
                        timestamp_us=curr_time_us,
                        event_type=TransportEventType.ACK_RECEIVED,
                        source_node=server_node,
                        destination_node=client_node,
                        segment=ack_seg,
                        connection_state=connection_state,
                        cwnd_mss=congestion_controller.cwnd_mss,
                        ssthresh_mss=congestion_controller.ssthresh_mss,
                        rtt_sample_us=None,
                        srtt_us=rtt_estimator.srtt_us,
                        rttvar_us=rtt_estimator.rttvar_us,
                        rto_us=rtt_estimator.rto_us,
                        description=f"Duplicate cumulative ACK received [ack={ack_info.ack_number}]. Dup count = {congestion_controller.duplicate_ack_count}.",
                    )
                )
                step_index += 1

                if is_fast_retransmit:
                    fast_retransmit_count += 1
                    retransmissions += 1

                    missing_seg = in_flight[0]
                    missing_seg.is_retransmit = True
                    missing_seg.tx_time_us = curr_time_us
                    missing_seg.retries += 1

                    retransmit_seg = TransportSegment(
                        source_port=config.source_port,
                        destination_port=config.destination_port,
                        sequence_number=missing_seg.seq,
                        acknowledgment_number=server_isn + 1,
                        flags=[TcpFlag.ACK, TcpFlag.PSH],
                        payload_length=missing_seg.length,
                        advertised_window=config.receive_window_bytes,
                        timestamp_us=curr_time_us,
                        is_retransmission=True,
                    )

                    events.append(
                        TransportEvent(
                            step_index=step_index,
                            timestamp_us=curr_time_us,
                            event_type=TransportEventType.RETRANSMISSION,
                            source_node=client_node,
                            destination_node=server_node,
                            segment=retransmit_seg,
                            connection_state=connection_state,
                            cwnd_mss=congestion_controller.cwnd_mss,
                            ssthresh_mss=congestion_controller.ssthresh_mss,
                            rtt_sample_us=None,
                            srtt_us=rtt_estimator.srtt_us,
                            rttvar_us=rtt_estimator.rttvar_us,
                            rto_us=rtt_estimator.rto_us,
                            description=f"FAST RETRANSMIT: 3 duplicate ACKs detected. Immediately retransmitted missing segment [seq={missing_seg.seq}, len={missing_seg.length}]. Entered Fast Recovery.",
                        )
                    )
                    step_index += 1

                    forward_delay = calculate_forward_delay(hop_links, missing_seg.length)
                    arrival_time = curr_time_us + forward_delay

                    rx_time = arrival_time
                    missing_len = missing_seg.length
                    rcv_nxt += missing_len
                    while rcv_nxt in receiver_buffer:
                        buffered_len = receiver_buffer.pop(rcv_nxt)
                        rcv_nxt += buffered_len

                    ack_return_delay = calculate_forward_delay(hop_links, 40)
                    pending_acks.append(
                        ArrivingAck(
                            ack_number=rcv_nxt,
                            rx_time_us=rx_time + ack_return_delay,
                        )
                    )
                    pending_acks.sort(key=lambda a: a.rx_time_us)
        else:
            if in_flight:
                oldest_seg = in_flight[0]
                curr_time_us = timeout_time
                timeout_count += 1
                retransmissions += 1

                congestion_controller.on_timeout(curr_time_us)

                rtt_estimator.rto_us = max(
                    rtt_estimator.min_rto_us,
                    min(rtt_estimator.rto_us * 2, rtt_estimator.max_rto_us),
                )

                oldest_seg.retries += 1
                oldest_seg.is_retransmit = True
                oldest_seg.tx_time_us = curr_time_us

                retransmit_seg = TransportSegment(
                    source_port=config.source_port,
                    destination_port=config.destination_port,
                    sequence_number=oldest_seg.seq,
                    acknowledgment_number=server_isn + 1,
                    flags=[TcpFlag.ACK, TcpFlag.PSH],
                    payload_length=oldest_seg.length,
                    advertised_window=config.receive_window_bytes,
                    timestamp_us=curr_time_us,
                    is_retransmission=True,
                )

                events.append(
                    TransportEvent(
                        step_index=step_index,
                        timestamp_us=curr_time_us,
                        event_type=TransportEventType.TIMEOUT,
                        source_node=client_node,
                        destination_node=server_node,
                        segment=retransmit_seg,
                        connection_state=connection_state,
                        cwnd_mss=congestion_controller.cwnd_mss,
                        ssthresh_mss=congestion_controller.ssthresh_mss,
                        rtt_sample_us=None,
                        srtt_us=rtt_estimator.srtt_us,
                        rttvar_us=rtt_estimator.rttvar_us,
                        rto_us=rtt_estimator.rto_us,
                        description=f"RTO TIMEOUT on segment [seq={oldest_seg.seq}]. Retransmission #{oldest_seg.retries} sent. cwnd reset to 1 MSS, ssthresh={congestion_controller.ssthresh_mss:.1f} MSS, backed-off RTO={rtt_estimator.rto_us} us.",
                    )
                )
                step_index += 1

                if oldest_seg.retries > config.maximum_retries:
                    break

                forward_delay = calculate_forward_delay(hop_links, oldest_seg.length)
                arrival_time = curr_time_us + forward_delay

                rx_time = arrival_time
                missing_len = oldest_seg.length
                rcv_nxt += missing_len
                while rcv_nxt in receiver_buffer:
                    buffered_len = receiver_buffer.pop(rcv_nxt)
                    rcv_nxt += buffered_len

                ack_return_delay = calculate_forward_delay(hop_links, 40)
                pending_acks.append(
                    ArrivingAck(
                        ack_number=rcv_nxt,
                        rx_time_us=rx_time + ack_return_delay,
                    )
                )
                pending_acks.sort(key=lambda a: a.rx_time_us)
            else:
                curr_time_us += 10_000

    segments_delivered = bytes_delivered // mss
    if bytes_delivered % mss != 0:
        segments_delivered += 1

    # 3. FOUR-STEP CONNECTION TEARDOWN
    teardown_delay = calculate_forward_delay(hop_links, 40)

    connection_state = ConnectionState.FIN_WAIT_1
    client_fin = TransportSegment(
        source_port=config.source_port,
        destination_port=config.destination_port,
        sequence_number=next_seq,
        acknowledgment_number=server_isn + 1,
        flags=[TcpFlag.FIN, TcpFlag.ACK],
        payload_length=0,
        advertised_window=config.receive_window_bytes,
        timestamp_us=curr_time_us,
        is_retransmission=False,
    )

    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            event_type=TransportEventType.CONNECTION_CLOSED,
            source_node=client_node,
            destination_node=server_node,
            segment=client_fin,
            connection_state=connection_state,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description="Client sends FIN. Client enters FIN-WAIT-1.",
        )
    )
    step_index += 1

    server_fin_rx_time = curr_time_us + teardown_delay
    server_ack = TransportSegment(
        source_port=config.destination_port,
        destination_port=config.source_port,
        sequence_number=server_isn + 1,
        acknowledgment_number=next_seq + 1,
        flags=[TcpFlag.ACK],
        payload_length=0,
        advertised_window=config.receive_window_bytes,
        timestamp_us=server_fin_rx_time,
        is_retransmission=False,
    )

    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=server_fin_rx_time,
            event_type=TransportEventType.ACK_SENT,
            source_node=server_node,
            destination_node=client_node,
            segment=server_ack,
            connection_state=ConnectionState.CLOSE_WAIT,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description="Server received FIN, enters CLOSE-WAIT, and replies with ACK.",
        )
    )
    step_index += 1

    client_ack_rx_time = server_fin_rx_time + teardown_delay
    connection_state = ConnectionState.FIN_WAIT_2
    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=client_ack_rx_time,
            event_type=TransportEventType.ACK_RECEIVED,
            source_node=server_node,
            destination_node=client_node,
            segment=server_ack,
            connection_state=connection_state,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description="Client received ACK, transitions from FIN-WAIT-1 to FIN-WAIT-2.",
        )
    )
    step_index += 1

    server_fin_time = server_fin_rx_time + 1000
    server_fin = TransportSegment(
        source_port=config.destination_port,
        destination_port=config.source_port,
        sequence_number=server_isn + 1,
        acknowledgment_number=next_seq + 1,
        flags=[TcpFlag.FIN, TcpFlag.ACK],
        payload_length=0,
        advertised_window=config.receive_window_bytes,
        timestamp_us=server_fin_time,
        is_retransmission=False,
    )

    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=server_fin_time,
            event_type=TransportEventType.CONNECTION_CLOSED,
            source_node=server_node,
            destination_node=client_node,
            segment=server_fin,
            connection_state=ConnectionState.LAST_ACK,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description="Server sends FIN, entering LAST-ACK state.",
        )
    )
    step_index += 1

    client_fin_rx_time = server_fin_time + teardown_delay
    connection_state = ConnectionState.TIME_WAIT
    final_ack = TransportSegment(
        source_port=config.source_port,
        destination_port=config.destination_port,
        sequence_number=next_seq + 1,
        acknowledgment_number=server_isn + 2,
        flags=[TcpFlag.ACK],
        payload_length=0,
        advertised_window=config.receive_window_bytes,
        timestamp_us=client_fin_rx_time,
        is_retransmission=False,
    )

    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=client_fin_rx_time,
            event_type=TransportEventType.ACK_SENT,
            source_node=client_node,
            destination_node=server_node,
            segment=final_ack,
            connection_state=connection_state,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description="Client received Server FIN, sent final ACK, entered TIME-WAIT.",
        )
    )
    step_index += 1

    server_closed_time = client_fin_rx_time + teardown_delay
    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=server_closed_time,
            event_type=TransportEventType.CONNECTION_CLOSED,
            source_node=client_node,
            destination_node=server_node,
            segment=None,
            connection_state=ConnectionState.CLOSED,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description="Server received final ACK -> CLOSED.",
        )
    )
    step_index += 1

    curr_time_us = server_closed_time + 5000
    connection_state = ConnectionState.CLOSED
    events.append(
        TransportEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            event_type=TransportEventType.CONNECTION_CLOSED,
            source_node=client_node,
            destination_node=server_node,
            segment=None,
            connection_state=connection_state,
            cwnd_mss=congestion_controller.cwnd_mss,
            ssthresh_mss=congestion_controller.ssthresh_mss,
            rtt_sample_us=None,
            srtt_us=rtt_estimator.srtt_us,
            rttvar_us=rtt_estimator.rttvar_us,
            rto_us=rtt_estimator.rto_us,
            description="Client 2MSL TIME-WAIT timer expired. Client state: CLOSED. Transfer complete.",
        )
    )

    # 4. METRICS & TELEMETRY
    completion_time_us = max(1, curr_time_us)
    throughput_bits_per_sec = (bytes_sent * 8.0 * 1_000_000.0) / float(completion_time_us)
    throughput_bytes_per_sec = (bytes_sent * 1_000_000.0) / float(completion_time_us)
    goodput_bits_per_sec = (bytes_delivered * 8.0 * 1_000_000.0) / float(completion_time_us)
    total_attempts = segments_sent + segments_lost
    packet_loss_rate = float(segments_lost) / float(total_attempts) if total_attempts > 0 else 0.0

    sender_window_occupancy_avg = (
        cumulative_window_occupancy / float(total_window_samples) if total_window_samples > 0 else 0.0
    )

    metrics = TransportMetrics(
        segments_sent=segments_sent,
        segments_delivered=segments_delivered,
        retransmissions=retransmissions,
        segments_lost=segments_lost,
        duplicate_acks=duplicate_acks,
        bytes_sent=bytes_sent,
        bytes_delivered=bytes_delivered,
        completion_time_us=completion_time_us,
        average_rtt_us=rtt_estimator.average_rtt_us(),
        smoothed_rtt_us=rtt_estimator.srtt_us,
        final_rto_us=rtt_estimator.rto_us,
        throughput_bits_per_sec=throughput_bits_per_sec,
        throughput_bytes_per_sec=throughput_bytes_per_sec,
        goodput_bits_per_sec=goodput_bits_per_sec,
        packet_loss_rate=packet_loss_rate,
        sender_window_occupancy_avg=sender_window_occupancy_avg,
        receiver_window_occupancy_max=receiver_window_occupancy_max,
        congestion_window_final=congestion_controller.cwnd_mss,
        congestion_window_max=max_observed_cwnd,
        timeout_count=timeout_count,
        fast_retransmit_count=fast_retransmit_count,
    )

    events.sort(key=lambda e: (e.timestamp_us, e.step_index))
    for idx, event in enumerate(events):
        event.step_index = idx

    return TransportSimResult(
        protocol=TransportProtocol.TCP,
        config=config,
        derived_route=derived_route,
        events=events,
        cwnd_timeline=congestion_controller.timeline,
        metrics=metrics,
        completed=(send_base >= max_seq),
    )
