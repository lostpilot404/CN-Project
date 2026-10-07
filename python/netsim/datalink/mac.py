"""Medium Access Control (MAC) protocols: Pure ALOHA, Slotted ALOHA, CSMA, and CSMA/CD."""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import Any

from ..core.rng import DeterministicRng


class MacProtocol(str, Enum):
    PURE_ALOHA = "pure_aloha"
    SLOTTED_ALOHA = "slotted_aloha"
    CSMA = "csma"
    CSMA_CD = "csma_cd"


class CsmaPersistenceType(str, Enum):
    ONE_PERSISTENT = "one_persistent"
    NON_PERSISTENT = "non_persistent"
    P_PERSISTENT = "p_persistent"


CsmaMode = CsmaPersistenceType


class ChannelState(str, Enum):
    IDLE = "idle"
    BUSY = "busy"
    COLLISION = "collision"


class MacEventType(str, Enum):
    CARRIER_SENSED = "carrier_sensed"
    TRANSMISSION_STARTED = "transmission_started"
    COLLISION_DETECTED = "collision_detected"
    JAM_SIGNAL_SENT = "jam_signal_sent"
    TRANSMISSION_ABORTED = "transmission_aborted"
    BACKOFF_SCHEDULED = "backoff_scheduled"
    BACKOFF_EXPIRED = "backoff_expired"
    TRANSMISSION_SUCCESS = "transmission_success"


@dataclass
class MacConfig:
    protocol: MacProtocol = MacProtocol.CSMA_CD
    persistence: str = "one_persistent"  # "one_persistent", "non_persistent", "p_persistent"
    persistence_p: float = 0.5
    num_stations: int = 4
    total_frames_to_send: int = 10
    frame_duration_us: int = 10_000
    prop_delay_us: int = 50
    frame_size_bits: int = 8_000
    seed: int = 12345
    max_retries: int = 16
    offered_load_g: float = 1.5
    station_count: int | None = None
    traffic_load: float | None = None
    csma_mode: Any | None = None

    def __post_init__(self) -> None:
        if self.station_count is not None:
            self.num_stations = self.station_count
        if self.traffic_load is not None:
            self.offered_load_g = self.traffic_load
        if self.csma_mode is not None:
            if hasattr(self.csma_mode, "value"):
                self.persistence = self.csma_mode.value
            else:
                self.persistence = str(self.csma_mode)

    def to_dict(self) -> dict[str, Any]:
        persistence_dict: Any
        if self.persistence == "p_persistent":
            persistence_dict = {"p_persistent": {"probability": self.persistence_p}}
        else:
            persistence_dict = self.persistence
        return {
            "protocol": self.protocol.value if hasattr(self.protocol, "value") else str(self.protocol),
            "persistence": persistence_dict,
            "num_stations": self.num_stations,
            "total_frames_to_send": self.total_frames_to_send,
            "frame_duration_us": self.frame_duration_us,
            "prop_delay_us": self.prop_delay_us,
            "frame_size_bits": self.frame_size_bits,
            "seed": self.seed,
            "max_retries": self.max_retries,
            "offered_load_g": self.offered_load_g,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MacConfig:
        proto_val = data.get("protocol", "csma_cd")
        proto = MacProtocol(proto_val) if isinstance(proto_val, str) else MacProtocol.CSMA_CD

        pers = data.get("persistence", "one_persistent")
        pers_type = "one_persistent"
        pers_p = 0.5
        if isinstance(pers, dict):
            if "p_persistent" in pers:
                pers_type = "p_persistent"
                pers_p = float(pers["p_persistent"].get("probability", 0.5))
        elif isinstance(pers, str):
            pers_type = pers

        return cls(
            protocol=proto,
            persistence=pers_type,
            persistence_p=pers_p,
            num_stations=int(data.get("num_stations", 4)),
            total_frames_to_send=int(data.get("total_frames_to_send", 10)),
            frame_duration_us=int(data.get("frame_duration_us", 10_000)),
            prop_delay_us=int(data.get("prop_delay_us", 50)),
            frame_size_bits=int(data.get("frame_size_bits", 8_000)),
            seed=int(data.get("seed", 12345)),
            max_retries=int(data.get("max_retries", 16)),
            offered_load_g=float(data.get("offered_load_g", 1.5)),
        )


@dataclass
class MacEvent:
    step_index: int
    timestamp_us: int
    event_type: MacEventType
    station_id: int
    frame_id: int
    channel_state: ChannelState
    description: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "timestamp_us": self.timestamp_us,
            "event_type": self.event_type.value,
            "station_id": self.station_id,
            "frame_id": self.frame_id,
            "channel_state": self.channel_state.value,
            "description": self.description,
        }


@dataclass
class SlotRecord:
    slot_index: int
    start_time_us: int
    end_time_us: int
    participating_stations: list[int]
    status: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "slot_index": self.slot_index,
            "start_time_us": self.start_time_us,
            "end_time_us": self.end_time_us,
            "participating_stations": self.participating_stations,
            "status": self.status,
        }


@dataclass
class MacMetrics:
    attempted_transmissions: int
    successful_transmissions: int
    collisions: int
    retransmissions: int
    channel_busy_time_us: int
    total_simulation_time_us: int
    throughput_frames_per_sec: float
    throughput_bits_per_sec: float
    collision_rate: float
    channel_utilization: float
    average_backoff_delay_us: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempted_transmissions": self.attempted_transmissions,
            "successful_transmissions": self.successful_transmissions,
            "collisions": self.collisions,
            "retransmissions": self.retransmissions,
            "channel_busy_time_us": self.channel_busy_time_us,
            "total_simulation_time_us": self.total_simulation_time_us,
            "throughput_frames_per_sec": self.throughput_frames_per_sec,
            "throughput_bits_per_sec": self.throughput_bits_per_sec,
            "collision_rate": self.collision_rate,
            "channel_utilization": self.channel_utilization,
            "average_backoff_delay_us": self.average_backoff_delay_us,
        }


@dataclass
class MacSimResult:
    protocol: MacProtocol
    config: MacConfig
    events: list[MacEvent]
    slot_records: list[SlotRecord]
    metrics: MacMetrics
    completed_successfully: bool

    @property
    def frames_transmitted(self) -> int:
        return self.metrics.attempted_transmissions

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol.value,
            "config": self.config.to_dict(),
            "events": [e.to_dict() for e in self.events],
            "slot_records": [s.to_dict() for s in self.slot_records],
            "metrics": self.metrics.to_dict(),
            "completed_successfully": self.completed_successfully,
        }


@dataclass
class _StationQueue:
    station_id: int
    pending_frames: int
    next_attempt_us: int
    active_frame_id: int
    collision_count: int


def simulate_pure_aloha(config: MacConfig) -> MacSimResult:
    if config.num_stations == 0:
        raise ValueError("num_stations must be >= 1")
    if config.frame_duration_us == 0:
        raise ValueError("frame_duration_us must be > 0")

    rng = DeterministicRng(config.seed)
    current_time_us = 0
    step_index = 0

    frames_per_station = math.ceil(config.total_frames_to_send / float(config.num_stations))
    stations = [
        _StationQueue(
            station_id=i,
            pending_frames=frames_per_station,
            next_attempt_us=int(rng.gen_range_f64(0.0, 2.0) * config.frame_duration_us),
            active_frame_id=1,
            collision_count=0,
        )
        for i in range(config.num_stations)
    ]

    events: list[MacEvent] = []
    total_attempts = 0
    successful_tx = 0
    collision_count = 0
    retransmission_count = 0
    total_backoff_delay_us = 0
    channel_busy_us = 0

    target_successful = config.total_frames_to_send
    max_steps = 15_000

    while successful_tx < target_successful and step_index < max_steps:
        ready_times = [s.next_attempt_us for s in stations if s.pending_frames > 0]
        if not ready_times:
            break

        current_time_us = max(current_time_us, min(ready_times))

        transmitting_indices = [
            i
            for i, s in enumerate(stations)
            if s.pending_frames > 0 and s.next_attempt_us < current_time_us + config.frame_duration_us
        ]

        if len(transmitting_indices) == 1:
            idx = transmitting_indices[0]
            st = stations[idx]
            total_attempts += 1
            successful_tx += 1
            channel_busy_us += config.frame_duration_us

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=current_time_us,
                    event_type=MacEventType.TRANSMISSION_STARTED,
                    station_id=st.station_id,
                    frame_id=st.active_frame_id,
                    channel_state=ChannelState.BUSY,
                    description=f"Station {st.station_id} started transmission of frame {st.active_frame_id}",
                )
            )

            current_time_us += config.frame_duration_us

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=current_time_us,
                    event_type=MacEventType.TRANSMISSION_SUCCESS,
                    station_id=st.station_id,
                    frame_id=st.active_frame_id,
                    channel_state=ChannelState.IDLE,
                    description=f"Station {st.station_id} successfully delivered frame {st.active_frame_id}",
                )
            )

            st.pending_frames -= 1
            st.active_frame_id += 1
            st.collision_count = 0
            st.next_attempt_us = current_time_us + int(rng.gen_range_f64(0.5, 2.5) * config.frame_duration_us)
        else:
            colliding_ids = [stations[i].station_id for i in transmitting_indices]
            collision_count += len(transmitting_indices)
            total_attempts += len(transmitting_indices)
            retransmission_count += len(transmitting_indices)
            channel_busy_us += config.frame_duration_us

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=current_time_us,
                    event_type=MacEventType.COLLISION_DETECTED,
                    station_id=colliding_ids[0],
                    frame_id=0,
                    channel_state=ChannelState.COLLISION,
                    description=f"Overlapping transmission collision detected among stations {colliding_ids}",
                )
            )

            current_time_us += config.frame_duration_us

            for idx in transmitting_indices:
                st = stations[idx]
                st.collision_count += 1
                max_k = 1 << min(5, st.collision_count)
                k = rng.gen_range_u32(1, max_k)
                backoff_us = k * config.frame_duration_us
                st.next_attempt_us = current_time_us + backoff_us
                total_backoff_delay_us += backoff_us

                step_index += 1
                events.append(
                    MacEvent(
                        step_index=step_index,
                        timestamp_us=current_time_us,
                        event_type=MacEventType.BACKOFF_SCHEDULED,
                        station_id=st.station_id,
                        frame_id=st.active_frame_id,
                        channel_state=ChannelState.IDLE,
                        description=(
                            f"Station {st.station_id} scheduled backoff of {backoff_us} µs "
                            f"(k={k}) after collision #{st.collision_count}"
                        ),
                    )
                )

    total_time_sec = current_time_us / 1_000_000.0
    throughput_frames_sec = (successful_tx / total_time_sec) if total_time_sec > 0.0 else 0.0
    throughput_bits_sec = throughput_frames_sec * config.frame_size_bits
    col_rate = (collision_count / float(total_attempts)) if total_attempts > 0 else 0.0
    util = (channel_busy_us / float(current_time_us)) if current_time_us > 0 else 0.0
    avg_backoff = (total_backoff_delay_us / float(collision_count)) if collision_count > 0 else 0.0

    metrics = MacMetrics(
        attempted_transmissions=total_attempts,
        successful_transmissions=successful_tx,
        collisions=collision_count,
        retransmissions=retransmission_count,
        channel_busy_time_us=channel_busy_us,
        total_simulation_time_us=current_time_us,
        throughput_frames_per_sec=throughput_frames_sec,
        throughput_bits_per_sec=throughput_bits_sec,
        collision_rate=col_rate,
        channel_utilization=util,
        average_backoff_delay_us=avg_backoff,
    )

    return MacSimResult(
        protocol=MacProtocol.PURE_ALOHA,
        config=config,
        events=events,
        slot_records=[],
        metrics=metrics,
        completed_successfully=successful_tx >= target_successful,
    )


def simulate_slotted_aloha(config: MacConfig) -> MacSimResult:
    if config.num_stations == 0:
        raise ValueError("num_stations must be >= 1")
    if config.frame_duration_us == 0:
        raise ValueError("frame_duration_us must be > 0")

    rng = DeterministicRng(config.seed)
    slot_duration = config.frame_duration_us
    current_slot = 0
    step_index = 0

    frames_per_station = math.ceil(config.total_frames_to_send / float(config.num_stations))
    stations = [
        _StationQueue(
            station_id=i,
            pending_frames=frames_per_station,
            next_attempt_us=rng.gen_range_u32(0, 2) * slot_duration,
            active_frame_id=1,
            collision_count=0,
        )
        for i in range(config.num_stations)
    ]

    events: list[MacEvent] = []
    slot_records: list[SlotRecord] = []
    total_attempts = 0
    successful_tx = 0
    collision_count = 0
    retransmission_count = 0
    total_backoff_delay_us = 0
    channel_busy_us = 0

    target_successful = config.total_frames_to_send
    max_slots = 5_000

    while successful_tx < target_successful and current_slot < max_slots:
        slot_start_us = current_slot * slot_duration
        slot_end_us = slot_start_us + slot_duration

        ready_indices = [
            i for i, s in enumerate(stations) if s.pending_frames > 0 and s.next_attempt_us <= slot_start_us
        ]

        if not ready_indices:
            slot_records.append(
                SlotRecord(
                    slot_index=current_slot,
                    start_time_us=slot_start_us,
                    end_time_us=slot_end_us,
                    participating_stations=[],
                    status="Idle",
                )
            )
        elif len(ready_indices) == 1:
            idx = ready_indices[0]
            st = stations[idx]
            total_attempts += 1
            successful_tx += 1
            channel_busy_us += slot_duration

            slot_records.append(
                SlotRecord(
                    slot_index=current_slot,
                    start_time_us=slot_start_us,
                    end_time_us=slot_end_us,
                    participating_stations=[st.station_id],
                    status=f"Success (Station {st.station_id})",
                )
            )

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=slot_start_us,
                    event_type=MacEventType.TRANSMISSION_STARTED,
                    station_id=st.station_id,
                    frame_id=st.active_frame_id,
                    channel_state=ChannelState.BUSY,
                    description=f"Station {st.station_id} transmitting in slot {current_slot}",
                )
            )

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=slot_end_us,
                    event_type=MacEventType.TRANSMISSION_SUCCESS,
                    station_id=st.station_id,
                    frame_id=st.active_frame_id,
                    channel_state=ChannelState.IDLE,
                    description=f"Station {st.station_id} successfully finished transmission in slot {current_slot}",
                )
            )

            st.pending_frames -= 1
            st.active_frame_id += 1
            st.collision_count = 0
            st.next_attempt_us = (current_slot + 1 + rng.gen_range_u32(1, 3)) * slot_duration
        else:
            colliding_ids = [stations[i].station_id for i in ready_indices]
            collision_count += len(ready_indices)
            total_attempts += len(ready_indices)
            retransmission_count += len(ready_indices)
            channel_busy_us += slot_duration

            slot_records.append(
                SlotRecord(
                    slot_index=current_slot,
                    start_time_us=slot_start_us,
                    end_time_us=slot_end_us,
                    participating_stations=colliding_ids,
                    status=f"Collision (Stations {colliding_ids})",
                )
            )

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=slot_start_us,
                    event_type=MacEventType.COLLISION_DETECTED,
                    station_id=colliding_ids[0],
                    frame_id=0,
                    channel_state=ChannelState.COLLISION,
                    description=f"Simultaneous transmission collision in slot {current_slot} among stations {colliding_ids}",
                )
            )

            for idx in ready_indices:
                st = stations[idx]
                st.collision_count += 1
                max_k = 1 << min(5, st.collision_count)
                k = rng.gen_range_u32(1, max_k)
                st.next_attempt_us = (current_slot + 1 + k) * slot_duration
                total_backoff_delay_us += k * slot_duration

        current_slot += 1

    total_time_us = current_slot * slot_duration
    total_time_sec = total_time_us / 1_000_000.0
    throughput_frames_sec = (successful_tx / total_time_sec) if total_time_sec > 0.0 else 0.0
    throughput_bits_sec = throughput_frames_sec * config.frame_size_bits
    col_rate = (collision_count / float(total_attempts)) if total_attempts > 0 else 0.0
    util = (channel_busy_us / float(total_time_us)) if total_time_us > 0 else 0.0
    avg_backoff = (total_backoff_delay_us / float(collision_count)) if collision_count > 0 else 0.0

    metrics = MacMetrics(
        attempted_transmissions=total_attempts,
        successful_transmissions=successful_tx,
        collisions=collision_count,
        retransmissions=retransmission_count,
        channel_busy_time_us=channel_busy_us,
        total_simulation_time_us=total_time_us,
        throughput_frames_per_sec=throughput_frames_sec,
        throughput_bits_per_sec=throughput_bits_sec,
        collision_rate=col_rate,
        channel_utilization=util,
        average_backoff_delay_us=avg_backoff,
    )

    return MacSimResult(
        protocol=MacProtocol.SLOTTED_ALOHA,
        config=config,
        events=events,
        slot_records=slot_records,
        metrics=metrics,
        completed_successfully=successful_tx >= target_successful,
    )


def simulate_csma(config: MacConfig) -> MacSimResult:
    if config.num_stations == 0:
        raise ValueError("num_stations must be >= 1")

    rng = DeterministicRng(config.seed)
    current_time_us = 0
    step_index = 0
    channel_busy_until_us = 0

    frames_per_station = math.ceil(config.total_frames_to_send / float(config.num_stations))
    stations = [
        _StationQueue(
            station_id=i,
            pending_frames=frames_per_station,
            next_attempt_us=int(rng.gen_range_f64(0.0, 1.5) * config.frame_duration_us),
            active_frame_id=1,
            collision_count=0,
        )
        for i in range(config.num_stations)
    ]

    events: list[MacEvent] = []
    total_attempts = 0
    successful_tx = 0
    collision_count = 0
    retransmission_count = 0
    total_backoff_delay_us = 0
    channel_busy_us = 0

    target_successful = config.total_frames_to_send
    max_steps = 15_000

    while successful_tx < target_successful and step_index < max_steps:
        ready_times = [s.next_attempt_us for s in stations if s.pending_frames > 0]
        if not ready_times:
            break

        current_time_us = max(current_time_us, min(ready_times))
        channel_state = ChannelState.BUSY if current_time_us < channel_busy_until_us else ChannelState.IDLE

        ready_indices = [
            i for i, s in enumerate(stations) if s.pending_frames > 0 and s.next_attempt_us <= current_time_us
        ]

        if not ready_indices:
            continue

        if channel_state == ChannelState.BUSY:
            if config.persistence == "one_persistent":
                defer_until = channel_busy_until_us
                for idx in ready_indices:
                    stations[idx].next_attempt_us = defer_until
                    step_index += 1
                    events.append(
                        MacEvent(
                            step_index=step_index,
                            timestamp_us=current_time_us,
                            event_type=MacEventType.CARRIER_SENSED,
                            station_id=stations[idx].station_id,
                            frame_id=stations[idx].active_frame_id,
                            channel_state=ChannelState.BUSY,
                            description=f"Station {stations[idx].station_id} sensed channel BUSY; 1-persistent mode defers to idle time ({defer_until} µs)",
                        )
                    )
                current_time_us = defer_until
            elif config.persistence == "non_persistent":
                for idx in ready_indices:
                    backoff = rng.gen_range_u32(1, 10) * config.frame_duration_us
                    stations[idx].next_attempt_us = current_time_us + backoff
                    total_backoff_delay_us += backoff
                    step_index += 1
                    events.append(
                        MacEvent(
                            step_index=step_index,
                            timestamp_us=current_time_us,
                            event_type=MacEventType.BACKOFF_SCHEDULED,
                            station_id=stations[idx].station_id,
                            frame_id=stations[idx].active_frame_id,
                            channel_state=ChannelState.BUSY,
                            description=f"Station {stations[idx].station_id} sensed BUSY; non-persistent mode backed off {backoff} µs",
                        )
                    )
            else:  # p-persistent
                next_slot = current_time_us + config.frame_duration_us
                for idx in ready_indices:
                    stations[idx].next_attempt_us = next_slot
            continue

        # Channel is IDLE
        if config.persistence in ("one_persistent", "non_persistent"):
            if len(ready_indices) == 1:
                idx = ready_indices[0]
                st = stations[idx]
                total_attempts += 1
                successful_tx += 1
                channel_busy_us += config.frame_duration_us
                channel_busy_until_us = current_time_us + config.frame_duration_us

                step_index += 1
                events.append(
                    MacEvent(
                        step_index=step_index,
                        timestamp_us=current_time_us,
                        event_type=MacEventType.TRANSMISSION_STARTED,
                        station_id=st.station_id,
                        frame_id=st.active_frame_id,
                        channel_state=ChannelState.BUSY,
                        description=f"Station {st.station_id} sensed IDLE and transmitted frame {st.active_frame_id}",
                    )
                )

                current_time_us += config.frame_duration_us

                step_index += 1
                events.append(
                    MacEvent(
                        step_index=step_index,
                        timestamp_us=current_time_us,
                        event_type=MacEventType.TRANSMISSION_SUCCESS,
                        station_id=st.station_id,
                        frame_id=st.active_frame_id,
                        channel_state=ChannelState.IDLE,
                        description=f"Station {st.station_id} completed transmission of frame {st.active_frame_id}",
                    )
                )

                st.pending_frames -= 1
                st.active_frame_id += 1
                st.next_attempt_us = current_time_us + int(rng.gen_range_f64(1.0, 3.0) * config.frame_duration_us)
            else:
                collision_count += len(ready_indices)
                total_attempts += len(ready_indices)
                retransmission_count += len(ready_indices)
                channel_busy_us += config.frame_duration_us
                channel_busy_until_us = current_time_us + config.frame_duration_us

                colliding_ids = [stations[i].station_id for i in ready_indices]
                step_index += 1
                events.append(
                    MacEvent(
                        step_index=step_index,
                        timestamp_us=current_time_us,
                        event_type=MacEventType.COLLISION_DETECTED,
                        station_id=colliding_ids[0],
                        frame_id=0,
                        channel_state=ChannelState.COLLISION,
                        description=f"Collision among stations {colliding_ids} sensing channel IDLE simultaneously",
                    )
                )

                current_time_us += config.frame_duration_us
                for idx in ready_indices:
                    backoff = rng.gen_range_u32(1, 8) * config.frame_duration_us
                    stations[idx].next_attempt_us = current_time_us + backoff
                    total_backoff_delay_us += backoff
        else:
            # p-persistent
            transmitting = [idx for idx in ready_indices if rng.gen_float() < config.persistence_p]
            if len(transmitting) == 1:
                idx = transmitting[0]
                st = stations[idx]
                total_attempts += 1
                successful_tx += 1
                channel_busy_us += config.frame_duration_us
                channel_busy_until_us = current_time_us + config.frame_duration_us
                current_time_us += config.frame_duration_us
                st.pending_frames -= 1
                st.active_frame_id += 1
                st.next_attempt_us = current_time_us + config.frame_duration_us
            elif len(transmitting) > 1:
                collision_count += len(transmitting)
                total_attempts += len(transmitting)
                retransmission_count += len(transmitting)
                channel_busy_us += config.frame_duration_us
                channel_busy_until_us = current_time_us + config.frame_duration_us
                current_time_us += config.frame_duration_us
                for idx in transmitting:
                    k = rng.gen_range_u32(1, 4)
                    stations[idx].next_attempt_us = current_time_us + (k * config.frame_duration_us)
            else:
                current_time_us += config.frame_duration_us

    total_time_sec = current_time_us / 1_000_000.0
    throughput_frames_sec = (successful_tx / total_time_sec) if total_time_sec > 0.0 else 0.0
    throughput_bits_sec = throughput_frames_sec * config.frame_size_bits
    col_rate = (collision_count / float(total_attempts)) if total_attempts > 0 else 0.0
    util = (channel_busy_us / float(current_time_us)) if current_time_us > 0 else 0.0
    avg_backoff = (total_backoff_delay_us / float(collision_count)) if collision_count > 0 else 0.0

    metrics = MacMetrics(
        attempted_transmissions=total_attempts,
        successful_transmissions=successful_tx,
        collisions=collision_count,
        retransmissions=retransmission_count,
        channel_busy_time_us=channel_busy_us,
        total_simulation_time_us=current_time_us,
        throughput_frames_per_sec=throughput_frames_sec,
        throughput_bits_per_sec=throughput_bits_sec,
        collision_rate=col_rate,
        channel_utilization=util,
        average_backoff_delay_us=avg_backoff,
    )

    return MacSimResult(
        protocol=MacProtocol.CSMA,
        config=config,
        events=events,
        slot_records=[],
        metrics=metrics,
        completed_successfully=successful_tx >= target_successful,
    )


def simulate_csma_cd(config: MacConfig) -> MacSimResult:
    if config.num_stations == 0:
        raise ValueError("num_stations must be >= 1")

    rng = DeterministicRng(config.seed)
    current_time_us = 0
    step_index = 0
    channel_busy_until_us = 0

    slot_time_us = max(10, 2 * config.prop_delay_us)
    jam_signal_duration_us = max(10, config.prop_delay_us)

    frames_per_station = math.ceil(config.total_frames_to_send / float(config.num_stations))
    stations = [
        _StationQueue(
            station_id=i,
            pending_frames=frames_per_station,
            next_attempt_us=int(rng.gen_range_f64(0.0, 1.2) * config.frame_duration_us),
            active_frame_id=1,
            collision_count=0,
        )
        for i in range(config.num_stations)
    ]

    events: list[MacEvent] = []
    total_attempts = 0
    successful_tx = 0
    collision_count = 0
    retransmission_count = 0
    total_backoff_delay_us = 0
    channel_busy_us = 0

    target_successful = config.total_frames_to_send
    max_steps = 15_000

    while successful_tx < target_successful and step_index < max_steps:
        ready_times = [s.next_attempt_us for s in stations if s.pending_frames > 0]
        if not ready_times:
            break

        current_time_us = max(current_time_us, min(ready_times))

        ready_indices = [
            i
            for i, s in enumerate(stations)
            if s.pending_frames > 0 and s.next_attempt_us <= current_time_us + slot_time_us
        ]

        if not ready_indices:
            current_time_us += slot_time_us
            continue

        if current_time_us < channel_busy_until_us:
            defer_time = channel_busy_until_us
            for idx in ready_indices:
                stations[idx].next_attempt_us = defer_time
            current_time_us = defer_time
            continue

        if len(ready_indices) == 1:
            idx = ready_indices[0]
            st = stations[idx]
            total_attempts += 1
            successful_tx += 1
            channel_busy_us += config.frame_duration_us
            channel_busy_until_us = current_time_us + config.frame_duration_us

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=current_time_us,
                    event_type=MacEventType.CARRIER_SENSED,
                    station_id=st.station_id,
                    frame_id=st.active_frame_id,
                    channel_state=ChannelState.IDLE,
                    description=f"Station {st.station_id} sensed carrier IDLE",
                )
            )

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=current_time_us,
                    event_type=MacEventType.TRANSMISSION_STARTED,
                    station_id=st.station_id,
                    frame_id=st.active_frame_id,
                    channel_state=ChannelState.BUSY,
                    description=f"Station {st.station_id} began transmitting frame {st.active_frame_id}",
                )
            )

            current_time_us += config.frame_duration_us

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=current_time_us,
                    event_type=MacEventType.TRANSMISSION_SUCCESS,
                    station_id=st.station_id,
                    frame_id=st.active_frame_id,
                    channel_state=ChannelState.IDLE,
                    description=(
                        f"Station {st.station_id} successfully finished transmitting frame "
                        f"{st.active_frame_id} (No collision detected within 2τ)"
                    ),
                )
            )

            st.pending_frames -= 1
            st.active_frame_id += 1
            st.collision_count = 0
            st.next_attempt_us = current_time_us + int(rng.gen_range_f64(1.0, 2.5) * config.frame_duration_us)
        else:
            colliding_ids = [stations[i].station_id for i in ready_indices]
            collision_count += len(ready_indices)
            total_attempts += len(ready_indices)
            retransmission_count += len(ready_indices)

            collision_detect_time = current_time_us + slot_time_us
            channel_busy_us += slot_time_us + jam_signal_duration_us
            channel_busy_until_us = collision_detect_time + jam_signal_duration_us

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=current_time_us,
                    event_type=MacEventType.TRANSMISSION_STARTED,
                    station_id=colliding_ids[0],
                    frame_id=0,
                    channel_state=ChannelState.BUSY,
                    description=f"Stations {colliding_ids} started transmitting simultaneously",
                )
            )

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=collision_detect_time,
                    event_type=MacEventType.COLLISION_DETECTED,
                    station_id=colliding_ids[0],
                    frame_id=0,
                    channel_state=ChannelState.COLLISION,
                    description=f"Collision detected within 2τ interval at {collision_detect_time} µs among stations {colliding_ids}",
                )
            )

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=collision_detect_time,
                    event_type=MacEventType.JAM_SIGNAL_SENT,
                    station_id=colliding_ids[0],
                    frame_id=0,
                    channel_state=ChannelState.COLLISION,
                    description="Stations broadcast 32-bit Jam Signal to notify all network participants",
                )
            )

            step_index += 1
            events.append(
                MacEvent(
                    step_index=step_index,
                    timestamp_us=collision_detect_time + jam_signal_duration_us,
                    event_type=MacEventType.TRANSMISSION_ABORTED,
                    station_id=colliding_ids[0],
                    frame_id=0,
                    channel_state=ChannelState.IDLE,
                    description="Transmissions aborted; entering Binary Exponential Backoff (BEB)",
                )
            )

            current_time_us = collision_detect_time + jam_signal_duration_us

            for idx in ready_indices:
                st = stations[idx]
                st.collision_count += 1
                max_k = 1 << min(10, st.collision_count)
                r_slots = rng.gen_range_u32(0, max_k - 1)
                backoff_us = r_slots * slot_time_us
                st.next_attempt_us = current_time_us + backoff_us
                total_backoff_delay_us += backoff_us

                step_index += 1
                events.append(
                    MacEvent(
                        step_index=step_index,
                        timestamp_us=current_time_us,
                        event_type=MacEventType.BACKOFF_SCHEDULED,
                        station_id=st.station_id,
                        frame_id=st.active_frame_id,
                        channel_state=ChannelState.IDLE,
                        description=(
                            f"Station {st.station_id} BEB backoff = {r_slots} slots "
                            f"({backoff_us} µs) after collision #{st.collision_count}"
                        ),
                    )
                )

    total_time_sec = current_time_us / 1_000_000.0
    throughput_frames_sec = (successful_tx / total_time_sec) if total_time_sec > 0.0 else 0.0
    throughput_bits_sec = throughput_frames_sec * config.frame_size_bits
    col_rate = (collision_count / float(total_attempts)) if total_attempts > 0 else 0.0
    util = (channel_busy_us / float(current_time_us)) if current_time_us > 0 else 0.0
    avg_backoff = (total_backoff_delay_us / float(collision_count)) if collision_count > 0 else 0.0

    metrics = MacMetrics(
        attempted_transmissions=total_attempts,
        successful_transmissions=successful_tx,
        collisions=collision_count,
        retransmissions=retransmission_count,
        channel_busy_time_us=channel_busy_us,
        total_simulation_time_us=current_time_us,
        throughput_frames_per_sec=throughput_frames_sec,
        throughput_bits_per_sec=throughput_bits_sec,
        collision_rate=col_rate,
        channel_utilization=util,
        average_backoff_delay_us=avg_backoff,
    )

    return MacSimResult(
        protocol=MacProtocol.CSMA_CD,
        config=config,
        events=events,
        slot_records=[],
        metrics=metrics,
        completed_successfully=successful_tx >= target_successful,
    )


def simulate_mac(config: MacConfig) -> MacSimResult:
    if config.protocol == MacProtocol.PURE_ALOHA:
        return simulate_pure_aloha(config)
    elif config.protocol == MacProtocol.SLOTTED_ALOHA:
        return simulate_slotted_aloha(config)
    elif config.protocol == MacProtocol.CSMA:
        return simulate_csma(config)
    elif config.protocol == MacProtocol.CSMA_CD:
        return simulate_csma_cd(config)
    else:
        return simulate_csma_cd(config)
