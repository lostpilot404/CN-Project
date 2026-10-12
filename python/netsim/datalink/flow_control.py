"""Data Link Flow Control simulation (Stop-and-Wait / Sliding Window, Go-Back-N, Selective Repeat)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class FlowControlProtocol(str, Enum):
    SLIDING_WINDOW = "sliding_window"
    GO_BACK_N = "go_back_n"
    SELECTIVE_REPEAT = "selective_repeat"


class FrameStatus(str, Enum):
    PENDING = "pending"
    TRANSMITTED = "transmitted"
    ACKNOWLEDGED = "acknowledged"
    LOST = "lost"
    CORRUPTED = "corrupted"
    TIMED_OUT = "timed_out"
    BUFFERED = "buffered"
    DELIVERED = "delivered"


class FlowEventType(str, Enum):
    FRAME_SENT = "frame_sent"
    FRAME_RECEIVED = "frame_received"
    ACK_SENT = "ack_sent"
    ACK_RECEIVED = "ack_received"
    FRAME_LOST = "frame_lost"
    FRAME_CORRUPTED = "frame_corrupted"
    FRAME_BUFFERED = "frame_buffered"
    TIMEOUT_TRIGGERED = "timeout_triggered"
    RETRANSMISSION = "retransmission"
    WINDOW_ADVANCED = "window_advanced"
    DELIVERED_TO_NETWORK = "delivered_to_network"


@dataclass
class FlowControlConfig:
    protocol: FlowControlProtocol = FlowControlProtocol.GO_BACK_N
    window_size: int = 4
    sequence_space: int = 8
    total_frames_to_send: int = 8
    frame_tx_time_us: int = 10_000
    prop_delay_us: int = 40_000
    ack_tx_time_us: int = 2_000
    timeout_us: int = 150_000
    seed: int = 42
    dropped_frame_indices: list[int] = field(default_factory=list)
    corrupted_frame_indices: list[int] = field(default_factory=list)
    dropped_ack_seqs: list[int] = field(default_factory=list)
    total_frames: int | None = None
    dropped_frames: list[int] | None = None

    def __post_init__(self) -> None:
        if self.total_frames is not None:
            self.total_frames_to_send = self.total_frames
        if self.dropped_frames is not None:
            self.dropped_frame_indices = self.dropped_frames

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol.value,
            "window_size": self.window_size,
            "sequence_space": self.sequence_space,
            "total_frames_to_send": self.total_frames_to_send,
            "frame_tx_time_us": self.frame_tx_time_us,
            "prop_delay_us": self.prop_delay_us,
            "ack_tx_time_us": self.ack_tx_time_us,
            "timeout_us": self.timeout_us,
            "seed": self.seed,
            "dropped_frame_indices": self.dropped_frame_indices,
            "corrupted_frame_indices": self.corrupted_frame_indices,
            "dropped_ack_seqs": self.dropped_ack_seqs,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FlowControlConfig:
        proto_val = data.get("protocol", "go_back_n")
        proto = FlowControlProtocol(proto_val) if isinstance(proto_val, str) else FlowControlProtocol.GO_BACK_N
        return cls(
            protocol=proto,
            window_size=int(data.get("window_size", 4)),
            sequence_space=int(data.get("sequence_space", 8)),
            total_frames_to_send=int(data.get("total_frames_to_send", 8)),
            frame_tx_time_us=int(data.get("frame_tx_time_us", 10_000)),
            prop_delay_us=int(data.get("prop_delay_us", 40_000)),
            ack_tx_time_us=int(data.get("ack_tx_time_us", 2_000)),
            timeout_us=int(data.get("timeout_us", 150_000)),
            seed=int(data.get("seed", 42)),
            dropped_frame_indices=data.get("dropped_frame_indices", []),
            corrupted_frame_indices=data.get("corrupted_frame_indices", []),
            dropped_ack_seqs=data.get("dropped_ack_seqs", []),
        )


@dataclass
class SenderWindowState:
    send_base: int
    next_seq_num: int
    window_size: int
    sequence_space: int
    active_window_seqs: list[int]
    unacknowledged_count: int
    is_window_full: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "send_base": self.send_base,
            "next_seq_num": self.next_seq_num,
            "window_size": self.window_size,
            "sequence_space": self.sequence_space,
            "active_window_seqs": self.active_window_seqs,
            "unacknowledged_count": self.unacknowledged_count,
            "is_window_full": self.is_window_full,
        }


@dataclass
class ReceiverWindowState:
    rcv_base: int
    window_size: int
    sequence_space: int
    active_window_seqs: list[int]
    buffered_seqs: list[int]
    delivered_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "rcv_base": self.rcv_base,
            "window_size": self.window_size,
            "sequence_space": self.sequence_space,
            "active_window_seqs": self.active_window_seqs,
            "buffered_seqs": self.buffered_seqs,
            "delivered_count": self.delivered_count,
        }


@dataclass
class SlidingFrame:
    frame_index: int
    seq_num: int
    status: FrameStatus
    is_retransmission: bool
    tx_count: int
    sent_at_us: int | None
    acked_at_us: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_index": self.frame_index,
            "seq_num": self.seq_num,
            "status": self.status.value,
            "is_retransmission": self.is_retransmission,
            "tx_count": self.tx_count,
            "sent_at_us": self.sent_at_us,
            "acked_at_us": self.acked_at_us,
        }


@dataclass
class FlowControlEvent:
    step_index: int
    timestamp_us: int
    event_type: FlowEventType
    frame_index: int | None
    seq_num: int
    ack_seq: int | None
    sender_window: SenderWindowState
    receiver_window: ReceiverWindowState
    description: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "timestamp_us": self.timestamp_us,
            "event_type": self.event_type.value,
            "frame_index": self.frame_index,
            "seq_num": self.seq_num,
            "ack_seq": self.ack_seq,
            "sender_window": self.sender_window.to_dict(),
            "receiver_window": self.receiver_window.to_dict(),
            "description": self.description,
        }


@dataclass
class FlowControlMetrics:
    total_frames_sent: int
    original_frames: int
    retransmissions: int
    ack_count: int
    duplicate_frames: int
    dropped_or_corrupted_frames: int
    completed_frames: int
    completion_time_us: int
    utilization: float
    protocol_overhead: float
    sender_window_occupancy_avg: float
    receiver_buffer_occupancy_max: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_frames_sent": self.total_frames_sent,
            "original_frames": self.original_frames,
            "retransmissions": self.retransmissions,
            "ack_count": self.ack_count,
            "duplicate_frames": self.duplicate_frames,
            "dropped_or_corrupted_frames": self.dropped_or_corrupted_frames,
            "completed_frames": self.completed_frames,
            "completion_time_us": self.completion_time_us,
            "utilization": self.utilization,
            "protocol_overhead": self.protocol_overhead,
            "sender_window_occupancy_avg": self.sender_window_occupancy_avg,
            "receiver_buffer_occupancy_max": self.receiver_buffer_occupancy_max,
        }


@dataclass
class FlowControlSimResult:
    protocol: FlowControlProtocol
    config: FlowControlConfig
    events: list[FlowControlEvent]
    frames: list[SlidingFrame]
    metrics: FlowControlMetrics
    final_sender: SenderWindowState
    final_receiver: ReceiverWindowState
    is_completed: bool

    @property
    def completed(self) -> bool:
        return self.is_completed

    @property
    def retransmitted_frames(self) -> int:
        return self.metrics.retransmissions

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol.value,
            "config": self.config.to_dict(),
            "events": [e.to_dict() for e in self.events],
            "frames": [f.to_dict() for f in self.frames],
            "metrics": self.metrics.to_dict(),
            "final_sender": self.final_sender.to_dict(),
            "final_receiver": self.final_receiver.to_dict(),
            "is_completed": self.is_completed,
        }


def validate_flow_control_config(config: FlowControlConfig) -> None:
    if config.window_size < 1:
        raise ValueError(f"Window size must be at least 1 (received {config.window_size})")
    if config.sequence_space < 1:
        raise ValueError(f"Sequence space must be greater than 0 (received {config.sequence_space})")
    if config.total_frames_to_send < 1:
        raise ValueError(f"Total frames to send must be at least 1 (received {config.total_frames_to_send})")
    if config.frame_tx_time_us <= 0:
        raise ValueError(f"Frame transmission time must be greater than 0 us (received {config.frame_tx_time_us})")
    if config.prop_delay_us < 0:
        raise ValueError(f"Propagation delay cannot be negative (received {config.prop_delay_us})")
    if config.ack_tx_time_us <= 0:
        raise ValueError(f"ACK transmission time must be greater than 0 us (received {config.ack_tx_time_us})")
    if config.timeout_us <= 0:
        raise ValueError(f"Retransmission timeout must be greater than 0 us (received {config.timeout_us})")
    for name, indices in (
        ("dropped_frame_indices", config.dropped_frame_indices),
        ("corrupted_frame_indices", config.corrupted_frame_indices),
        ("dropped_ack_seqs", config.dropped_ack_seqs),
    ):
        for idx in indices:
            if int(idx) < 0:
                raise ValueError(f"{name} cannot contain negative frame indices (received {idx})")

    if config.protocol in (FlowControlProtocol.SLIDING_WINDOW, FlowControlProtocol.GO_BACK_N):
        if config.sequence_space < config.window_size + 1:
            raise ValueError(
                f"Invalid Go-Back-N configuration: sequence space ({config.sequence_space}) "
                f"must be >= window size + 1 ({config.window_size + 1})."
            )
    elif config.protocol == FlowControlProtocol.SELECTIVE_REPEAT:
        if config.sequence_space < 2 * config.window_size:
            raise ValueError(
                f"Invalid Selective Repeat configuration: sequence space ({config.sequence_space}) "
                f"must be >= 2 * window size ({2 * config.window_size})."
            )


def circular_distance(from_seq: int, to_seq: int, seq_space: int) -> int:
    return (to_seq + seq_space - from_seq) % seq_space


def is_in_circular_window(seq: int, base: int, size: int, seq_space: int) -> bool:
    dist = circular_distance(base, seq, seq_space)
    return dist < size


def get_window_sequences(base: int, size: int, seq_space: int) -> list[int]:
    return [(base + i) % seq_space for i in range(size)]


@dataclass
class _InFlightFrame:
    frame_index: int
    seq_num: int
    send_time_us: int
    arrival_time_us: int
    is_dropped: bool
    is_corrupted: bool


@dataclass
class _InFlightAck:
    ack_seq: int
    is_selective: bool
    frame_index: int | None
    send_time_us: int
    arrival_time_us: int
    is_dropped: bool


def simulate_flow_control(config: FlowControlConfig) -> FlowControlSimResult:
    validate_flow_control_config(config)

    total_frames = config.total_frames_to_send
    rcv_window_size = config.window_size if config.protocol == FlowControlProtocol.SELECTIVE_REPEAT else 1

    frames = [
        SlidingFrame(
            frame_index=i,
            seq_num=i % config.sequence_space,
            status=FrameStatus.PENDING,
            is_retransmission=False,
            tx_count=0,
            sent_at_us=None,
            acked_at_us=None,
        )
        for i in range(total_frames)
    ]

    send_base = 0
    next_seq_num = 0
    next_frame_index_to_transmit = 0
    rcv_base = 0

    receiver_buffer: dict[int, int] = {}  # seq_num -> frame_index
    delivered_frames: list[int] = []

    gbn_timer_start_us: int | None = None
    sr_frame_timers: dict[int, int] = {}  # frame_index -> start_time_us

    current_time_us = 0
    step_counter = 0

    in_flight_frames: list[_InFlightFrame] = []
    in_flight_acks: list[_InFlightAck] = []
    events: list[FlowControlEvent] = []

    total_transmissions = 0
    retransmissions_count = 0
    acks_count = 0
    duplicates_count = 0
    dropped_or_corrupted_count = 0
    max_receiver_buffer_occupancy = 0
    window_occupancy_samples: list[float] = []

    def make_sender_state(sb: int, ns: int) -> SenderWindowState:
        unack = circular_distance(sb, ns, config.sequence_space)
        is_full = unack >= config.window_size
        active = get_window_sequences(sb, config.window_size, config.sequence_space)
        return SenderWindowState(
            send_base=sb,
            next_seq_num=ns,
            window_size=config.window_size,
            sequence_space=config.sequence_space,
            active_window_seqs=active,
            unacknowledged_count=unack,
            is_window_full=is_full,
        )

    def make_receiver_state(rb: int) -> ReceiverWindowState:
        active = get_window_sequences(rb, rcv_window_size, config.sequence_space)
        buffered = sorted(receiver_buffer.keys())
        return ReceiverWindowState(
            rcv_base=rb,
            window_size=rcv_window_size,
            sequence_space=config.sequence_space,
            active_window_seqs=active,
            buffered_seqs=buffered,
            delivered_count=len(delivered_frames),
        )

    max_sim_steps = 10_000
    while len(delivered_frames) < total_frames and step_counter < max_sim_steps:
        current_unack = circular_distance(send_base, next_seq_num, config.sequence_space)
        window_occupancy_samples.append(current_unack / float(config.window_size))
        max_receiver_buffer_occupancy = max(max_receiver_buffer_occupancy, len(receiver_buffer))

        # 1. Transmit new frames if window allows
        window_used = circular_distance(send_base, next_seq_num, config.sequence_space)
        if window_used < config.window_size and next_frame_index_to_transmit < total_frames:
            f_idx = next_frame_index_to_transmit
            seq = next_seq_num
            is_dropped = f_idx in config.dropped_frame_indices
            is_corrupted = f_idx in config.corrupted_frame_indices

            total_transmissions += 1
            frames[f_idx].tx_count += 1
            frames[f_idx].sent_at_us = current_time_us
            frames[f_idx].status = FrameStatus.TRANSMITTED

            arr_time = current_time_us + config.frame_tx_time_us + config.prop_delay_us
            in_flight_frames.append(
                _InFlightFrame(
                    frame_index=f_idx,
                    seq_num=seq,
                    send_time_us=current_time_us,
                    arrival_time_us=arr_time,
                    is_dropped=is_dropped,
                    is_corrupted=is_corrupted,
                )
            )

            if config.protocol == FlowControlProtocol.GO_BACK_N and gbn_timer_start_us is None:
                gbn_timer_start_us = current_time_us
            if config.protocol == FlowControlProtocol.SELECTIVE_REPEAT:
                sr_frame_timers[f_idx] = current_time_us

            step_counter += 1
            events.append(
                FlowControlEvent(
                    step_index=step_counter,
                    timestamp_us=current_time_us,
                    event_type=FlowEventType.FRAME_SENT,
                    frame_index=f_idx,
                    seq_num=seq,
                    ack_seq=None,
                    sender_window=make_sender_state(send_base, (next_seq_num + 1) % config.sequence_space),
                    receiver_window=make_receiver_state(rcv_base),
                    description=(
                        f"Sender transmitted frame [{f_idx}] with seq {seq} "
                        f"(Window used: {window_used + 1}/{config.window_size})"
                    ),
                )
            )

            next_seq_num = (next_seq_num + 1) % config.sequence_space
            next_frame_index_to_transmit += 1
            current_time_us += config.frame_tx_time_us
            continue

        # 2. Check earliest pending event
        candidates = []
        if in_flight_frames:
            candidates.append(min(f.arrival_time_us for f in in_flight_frames))
        if in_flight_acks:
            candidates.append(min(a.arrival_time_us for a in in_flight_acks))
        if config.protocol == FlowControlProtocol.GO_BACK_N and gbn_timer_start_us is not None:
            candidates.append(gbn_timer_start_us + config.timeout_us)
        if config.protocol == FlowControlProtocol.SELECTIVE_REPEAT and sr_frame_timers:
            candidates.append(min(t + config.timeout_us for t in sr_frame_timers.values()))

        if not candidates:
            break

        earliest_time = min(candidates)
        current_time_us = max(current_time_us, earliest_time)

        # A. Frame Arrival at Receiver
        frame_arriving_idx = None
        for i, in_flight_frame in enumerate(in_flight_frames):
            if in_flight_frame.arrival_time_us <= current_time_us:
                frame_arriving_idx = i
                break

        if frame_arriving_idx is not None:
            frame = in_flight_frames.pop(frame_arriving_idx)
            if frame.is_dropped:
                dropped_or_corrupted_count += 1
                step_counter += 1
                events.append(
                    FlowControlEvent(
                        step_index=step_counter,
                        timestamp_us=current_time_us,
                        event_type=FlowEventType.FRAME_LOST,
                        frame_index=frame.frame_index,
                        seq_num=frame.seq_num,
                        ack_seq=None,
                        sender_window=make_sender_state(send_base, next_seq_num),
                        receiver_window=make_receiver_state(rcv_base),
                        description=f"Frame [{frame.frame_index}] (seq {frame.seq_num}) was lost in channel transit (Dropped)",
                    )
                )
                continue

            if frame.is_corrupted:
                dropped_or_corrupted_count += 1
                step_counter += 1
                events.append(
                    FlowControlEvent(
                        step_index=step_counter,
                        timestamp_us=current_time_us,
                        event_type=FlowEventType.FRAME_CORRUPTED,
                        frame_index=frame.frame_index,
                        seq_num=frame.seq_num,
                        ack_seq=None,
                        sender_window=make_sender_state(send_base, next_seq_num),
                        receiver_window=make_receiver_state(rcv_base),
                        description=f"Frame [{frame.frame_index}] (seq {frame.seq_num}) arrived corrupted (Discarded by receiver CRC/Checksum check)",
                    )
                )
                continue

            step_counter += 1
            events.append(
                FlowControlEvent(
                    step_index=step_counter,
                    timestamp_us=current_time_us,
                    event_type=FlowEventType.FRAME_RECEIVED,
                    frame_index=frame.frame_index,
                    seq_num=frame.seq_num,
                    ack_seq=None,
                    sender_window=make_sender_state(send_base, next_seq_num),
                    receiver_window=make_receiver_state(rcv_base),
                    description=f"Receiver received frame [{frame.frame_index}] with seq {frame.seq_num} (rcv_base is {rcv_base})",
                )
            )

            if config.protocol in (FlowControlProtocol.SLIDING_WINDOW, FlowControlProtocol.GO_BACK_N):
                if frame.seq_num == rcv_base:
                    delivered_frames.append(frame.frame_index)
                    frames[frame.frame_index].status = FrameStatus.DELIVERED
                    rcv_base = (rcv_base + 1) % config.sequence_space

                    acks_count += 1
                    ack_seq = rcv_base
                    ack_is_dropped = ack_seq in config.dropped_ack_seqs
                    ack_arrival = current_time_us + config.ack_tx_time_us + config.prop_delay_us

                    in_flight_acks.append(
                        _InFlightAck(
                            ack_seq=ack_seq,
                            is_selective=False,
                            frame_index=frame.frame_index,
                            send_time_us=current_time_us,
                            arrival_time_us=ack_arrival,
                            is_dropped=ack_is_dropped,
                        )
                    )

                    step_counter += 1
                    events.append(
                        FlowControlEvent(
                            step_index=step_counter,
                            timestamp_us=current_time_us,
                            event_type=FlowEventType.ACK_SENT,
                            frame_index=frame.frame_index,
                            seq_num=frame.seq_num,
                            ack_seq=ack_seq,
                            sender_window=make_sender_state(send_base, next_seq_num),
                            receiver_window=make_receiver_state(rcv_base),
                            description=(
                                f"Receiver accepted in-order frame [{frame.frame_index}]; "
                                f"sent cumulative ACK {ack_seq} (Expecting {rcv_base})"
                            ),
                        )
                    )
                else:
                    duplicates_count += 1
                    acks_count += 1
                    ack_seq = rcv_base
                    ack_is_dropped = ack_seq in config.dropped_ack_seqs
                    ack_arrival = current_time_us + config.ack_tx_time_us + config.prop_delay_us

                    in_flight_acks.append(
                        _InFlightAck(
                            ack_seq=ack_seq,
                            is_selective=False,
                            frame_index=None,
                            send_time_us=current_time_us,
                            arrival_time_us=ack_arrival,
                            is_dropped=ack_is_dropped,
                        )
                    )

                    step_counter += 1
                    events.append(
                        FlowControlEvent(
                            step_index=step_counter,
                            timestamp_us=current_time_us,
                            event_type=FlowEventType.ACK_SENT,
                            frame_index=frame.frame_index,
                            seq_num=frame.seq_num,
                            ack_seq=ack_seq,
                            sender_window=make_sender_state(send_base, next_seq_num),
                            receiver_window=make_receiver_state(rcv_base),
                            description=(
                                f"Out-of-order frame [{frame.frame_index}] (seq {frame.seq_num}) discarded by GBN; "
                                f"resent cumulative duplicate ACK {ack_seq}"
                            ),
                        )
                    )

            elif config.protocol == FlowControlProtocol.SELECTIVE_REPEAT:
                if is_in_circular_window(frame.seq_num, rcv_base, rcv_window_size, config.sequence_space):
                    acks_count += 1
                    ack_seq = frame.seq_num
                    ack_is_dropped = ack_seq in config.dropped_ack_seqs
                    ack_arrival = current_time_us + config.ack_tx_time_us + config.prop_delay_us

                    in_flight_acks.append(
                        _InFlightAck(
                            ack_seq=ack_seq,
                            is_selective=True,
                            frame_index=frame.frame_index,
                            send_time_us=current_time_us,
                            arrival_time_us=ack_arrival,
                            is_dropped=ack_is_dropped,
                        )
                    )

                    step_counter += 1
                    events.append(
                        FlowControlEvent(
                            step_index=step_counter,
                            timestamp_us=current_time_us,
                            event_type=FlowEventType.ACK_SENT,
                            frame_index=frame.frame_index,
                            seq_num=frame.seq_num,
                            ack_seq=ack_seq,
                            sender_window=make_sender_state(send_base, next_seq_num),
                            receiver_window=make_receiver_state(rcv_base),
                            description=f"Receiver received frame [{frame.frame_index}] within window; sent individual selective ACK {ack_seq}",
                        )
                    )

                    if frame.seq_num == rcv_base:
                        delivered_frames.append(frame.frame_index)
                        frames[frame.frame_index].status = FrameStatus.DELIVERED
                        rcv_base = (rcv_base + 1) % config.sequence_space

                        while rcv_base in receiver_buffer:
                            del_idx = receiver_buffer.pop(rcv_base)
                            delivered_frames.append(del_idx)
                            frames[del_idx].status = FrameStatus.DELIVERED

                            step_counter += 1
                            events.append(
                                FlowControlEvent(
                                    step_index=step_counter,
                                    timestamp_us=current_time_us,
                                    event_type=FlowEventType.DELIVERED_TO_NETWORK,
                                    frame_index=del_idx,
                                    seq_num=rcv_base,
                                    ack_seq=None,
                                    sender_window=make_sender_state(send_base, next_seq_num),
                                    receiver_window=make_receiver_state(rcv_base),
                                    description=f"Contiguous buffered frame [{del_idx}] delivered in-order to network layer (rcv_base advances)",
                                )
                            )
                            rcv_base = (rcv_base + 1) % config.sequence_space
                    else:
                        receiver_buffer[frame.seq_num] = frame.frame_index
                        frames[frame.frame_index].status = FrameStatus.BUFFERED
                        step_counter += 1
                        events.append(
                            FlowControlEvent(
                                step_index=step_counter,
                                timestamp_us=current_time_us,
                                event_type=FlowEventType.FRAME_BUFFERED,
                                frame_index=frame.frame_index,
                                seq_num=frame.seq_num,
                                ack_seq=None,
                                sender_window=make_sender_state(send_base, next_seq_num),
                                receiver_window=make_receiver_state(rcv_base),
                                description=f"Receiver buffered out-of-order frame [{frame.frame_index}] (seq {frame.seq_num})",
                            )
                        )
                else:
                    duplicates_count += 1
                    acks_count += 1
                    ack_seq = frame.seq_num
                    ack_is_dropped = ack_seq in config.dropped_ack_seqs
                    ack_arrival = current_time_us + config.ack_tx_time_us + config.prop_delay_us

                    in_flight_acks.append(
                        _InFlightAck(
                            ack_seq=ack_seq,
                            is_selective=True,
                            frame_index=frame.frame_index,
                            send_time_us=current_time_us,
                            arrival_time_us=ack_arrival,
                            is_dropped=ack_is_dropped,
                        )
                    )
            continue

        # B. ACK Arrival at Sender
        ack_arriving_idx = None
        for i, a in enumerate(in_flight_acks):
            if a.arrival_time_us <= current_time_us:
                ack_arriving_idx = i
                break

        if ack_arriving_idx is not None:
            ack = in_flight_acks.pop(ack_arriving_idx)
            if ack.is_dropped:
                continue

            if config.protocol in (FlowControlProtocol.SLIDING_WINDOW, FlowControlProtocol.GO_BACK_N):
                advance = circular_distance(send_base, ack.ack_seq, config.sequence_space)
                if 0 < advance <= config.window_size:
                    old_base = send_base
                    send_base = ack.ack_seq

                    for i in range(advance):
                        seq = (old_base + i) % config.sequence_space
                        for f in frames:
                            if f.seq_num == seq and f.status == FrameStatus.TRANSMITTED:
                                f.status = FrameStatus.ACKNOWLEDGED
                                f.acked_at_us = current_time_us

                    if send_base == next_seq_num:
                        gbn_timer_start_us = None
                    else:
                        gbn_timer_start_us = current_time_us

                    step_counter += 1
                    events.append(
                        FlowControlEvent(
                            step_index=step_counter,
                            timestamp_us=current_time_us,
                            event_type=FlowEventType.ACK_RECEIVED,
                            frame_index=ack.frame_index,
                            seq_num=ack.ack_seq,
                            ack_seq=ack.ack_seq,
                            sender_window=make_sender_state(send_base, next_seq_num),
                            receiver_window=make_receiver_state(rcv_base),
                            description=f"Sender received cumulative ACK {ack.ack_seq}; window advanced from {old_base} to {send_base}",
                        )
                    )

            elif config.protocol == FlowControlProtocol.SELECTIVE_REPEAT:
                if ack.frame_index is not None and ack.frame_index < len(frames):
                    f_idx = ack.frame_index
                    frames[f_idx].status = FrameStatus.ACKNOWLEDGED
                    frames[f_idx].acked_at_us = current_time_us
                    sr_frame_timers.pop(f_idx, None)

                    advanced = False
                    while send_base != next_seq_num:
                        base_frame = next(
                            (
                                f
                                for f in frames
                                if f.seq_num == send_base
                                and f.status in (FrameStatus.ACKNOWLEDGED, FrameStatus.DELIVERED)
                            ),
                            None,
                        )
                        if base_frame is not None:
                            send_base = (send_base + 1) % config.sequence_space
                            advanced = True
                        else:
                            break

                    step_counter += 1
                    events.append(
                        FlowControlEvent(
                            step_index=step_counter,
                            timestamp_us=current_time_us,
                            event_type=FlowEventType.ACK_RECEIVED,
                            frame_index=f_idx,
                            seq_num=ack.ack_seq,
                            ack_seq=ack.ack_seq,
                            sender_window=make_sender_state(send_base, next_seq_num),
                            receiver_window=make_receiver_state(rcv_base),
                            description=(
                                f"Sender received selective ACK {ack.ack_seq} for frame [{f_idx}]"
                                + (f"; send_base advanced to {send_base}" if advanced else "")
                            ),
                        )
                    )
            continue

        # C. Timeout Expiration
        if config.protocol == FlowControlProtocol.GO_BACK_N:
            if gbn_timer_start_us is not None and current_time_us >= gbn_timer_start_us + config.timeout_us:
                unack_count = circular_distance(send_base, next_seq_num, config.sequence_space)

                step_counter += 1
                events.append(
                    FlowControlEvent(
                        step_index=step_counter,
                        timestamp_us=current_time_us,
                        event_type=FlowEventType.TIMEOUT_TRIGGERED,
                        frame_index=None,
                        seq_num=send_base,
                        ack_seq=None,
                        sender_window=make_sender_state(send_base, next_seq_num),
                        receiver_window=make_receiver_state(rcv_base),
                        description=(
                            f"GBN Timeout on oldest unacknowledged frame (seq {send_base}); "
                            f"retransmitting all {unack_count} outstanding frames in window"
                        ),
                    )
                )

                gbn_timer_start_us = current_time_us

                for offset in range(unack_count):
                    seq = (send_base + offset) % config.sequence_space
                    for f in frames:
                        if f.seq_num == seq and f.status == FrameStatus.TRANSMITTED:
                            f.tx_count += 1
                            f.is_retransmission = True
                            total_transmissions += 1
                            retransmissions_count += 1

                            arr_time = current_time_us + config.frame_tx_time_us + config.prop_delay_us
                            in_flight_frames.append(
                                _InFlightFrame(
                                    frame_index=f.frame_index,
                                    seq_num=seq,
                                    send_time_us=current_time_us,
                                    arrival_time_us=arr_time,
                                    is_dropped=False,
                                    is_corrupted=False,
                                )
                            )

                            step_counter += 1
                            events.append(
                                FlowControlEvent(
                                    step_index=step_counter,
                                    timestamp_us=current_time_us,
                                    event_type=FlowEventType.RETRANSMISSION,
                                    frame_index=f.frame_index,
                                    seq_num=seq,
                                    ack_seq=None,
                                    sender_window=make_sender_state(send_base, next_seq_num),
                                    receiver_window=make_receiver_state(rcv_base),
                                    description=f"GBN retransmitted outstanding frame [{f.frame_index}] with seq {seq}",
                                )
                            )
                continue

        elif config.protocol == FlowControlProtocol.SELECTIVE_REPEAT:
            timed_out_frames = [
                (idx, t) for idx, t in sr_frame_timers.items() if current_time_us >= t + config.timeout_us
            ]

            if timed_out_frames:
                f_idx, _ = timed_out_frames[0]
                sr_frame_timers[f_idx] = current_time_us
                seq = frames[f_idx].seq_num
                frames[f_idx].tx_count += 1
                frames[f_idx].is_retransmission = True
                total_transmissions += 1
                retransmissions_count += 1

                arr_time = current_time_us + config.frame_tx_time_us + config.prop_delay_us
                in_flight_frames.append(
                    _InFlightFrame(
                        frame_index=f_idx,
                        seq_num=seq,
                        send_time_us=current_time_us,
                        arrival_time_us=arr_time,
                        is_dropped=False,
                        is_corrupted=False,
                    )
                )

                step_counter += 1
                events.append(
                    FlowControlEvent(
                        step_index=step_counter,
                        timestamp_us=current_time_us,
                        event_type=FlowEventType.TIMEOUT_TRIGGERED,
                        frame_index=f_idx,
                        seq_num=seq,
                        ack_seq=None,
                        sender_window=make_sender_state(send_base, next_seq_num),
                        receiver_window=make_receiver_state(rcv_base),
                        description=f"Selective Repeat timeout on frame [{f_idx}] (seq {seq}); retransmitting ONLY this frame",
                    )
                )
                step_counter += 1
                events.append(
                    FlowControlEvent(
                        step_index=step_counter,
                        timestamp_us=current_time_us,
                        event_type=FlowEventType.RETRANSMISSION,
                        frame_index=f_idx,
                        seq_num=seq,
                        ack_seq=None,
                        sender_window=make_sender_state(send_base, next_seq_num),
                        receiver_window=make_receiver_state(rcv_base),
                        description=f"Selective Repeat retransmitted frame [{f_idx}] (seq {seq})",
                    )
                )
                continue

    completion_time = current_time_us
    original_frames = total_frames
    completed_frames = len(delivered_frames)
    useful_time_us = completed_frames * config.frame_tx_time_us
    utilization = (useful_time_us / float(completion_time)) if completion_time > 0 else 0.0
    protocol_overhead = (
        ((retransmissions_count + acks_count) / float(total_transmissions)) if total_transmissions > 0 else 0.0
    )
    avg_occupancy = (
        sum(window_occupancy_samples) / float(len(window_occupancy_samples)) if window_occupancy_samples else 0.0
    )

    metrics = FlowControlMetrics(
        total_frames_sent=total_transmissions,
        original_frames=original_frames,
        retransmissions=retransmissions_count,
        ack_count=acks_count,
        duplicate_frames=duplicates_count,
        dropped_or_corrupted_frames=dropped_or_corrupted_count,
        completed_frames=completed_frames,
        completion_time_us=completion_time,
        utilization=utilization,
        protocol_overhead=protocol_overhead,
        sender_window_occupancy_avg=avg_occupancy,
        receiver_buffer_occupancy_max=max_receiver_buffer_occupancy,
    )

    return FlowControlSimResult(
        protocol=config.protocol,
        config=config,
        events=events,
        frames=frames,
        metrics=metrics,
        final_sender=make_sender_state(send_base, next_seq_num),
        final_receiver=make_receiver_state(rcv_base),
        is_completed=completed_frames == original_frames,
    )


def simulate_sliding_window(config: FlowControlConfig) -> FlowControlSimResult:
    config.protocol = FlowControlProtocol.SLIDING_WINDOW
    return simulate_flow_control(config)


def simulate_go_back_n(config: FlowControlConfig) -> FlowControlSimResult:
    config.protocol = FlowControlProtocol.GO_BACK_N
    return simulate_flow_control(config)


def simulate_selective_repeat(config: FlowControlConfig) -> FlowControlSimResult:
    config.protocol = FlowControlProtocol.SELECTIVE_REPEAT
    return simulate_flow_control(config)
