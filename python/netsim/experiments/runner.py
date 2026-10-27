from __future__ import annotations

import copy
import hashlib
import platform
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from netsim.core.clock import SimTime
from netsim.core.engine import SimulationEngine
from netsim.experiments.config import (
    ComparativeExperimentConfig,
    ExperimentTarget,
    SweepConfig,
    SweepParameterType,
)
from netsim.experiments.results import (
    ComparativeExperimentResult,
    MetricDelta,
    SweepExperimentResult,
    SweepPointResult,
    SweepRunResult,
)
from netsim.experiments.sweep import (
    apply_parameter_to_project,
    validate_comparative_config,
    validate_sweep_config,
)
from netsim.faults.model import FaultSchedule, RouteChangeRecord
from netsim.models.link import LinkStatus
from netsim.models.project import Project
from netsim.qos.aggregation import AggregatedQos, aggregate_qos
from netsim.qos.metrics import QosMetrics, compute_network_qos
from netsim.routing.graph import MetricType, RoutingGraph
from netsim.transport import TransportConfig, TransportProtocol, resolve_route_and_links
from netsim.transport.tcp import simulate_tcp
from netsim.transport.udp import simulate_udp


@dataclass
class SingleRunParams:
    base_project: Project
    seed: int
    duration_us: int
    traffic_src: str
    traffic_dst: str
    packet_size: int
    interval_us: int
    packet_count: int
    fault_schedule: FaultSchedule | None = None


def run_single_simulation(params: SingleRunParams) -> tuple[QosMetrics, list[RouteChangeRecord]]:
    project = copy.deepcopy(params.base_project)
    route_changes: list[RouteChangeRecord] = []

    current_graph_project = copy.deepcopy(project)
    saved_node_link_states: dict[str, dict[str, LinkStatus]] = {}

    sorted_faults = params.fault_schedule.sorted_entries() if params.fault_schedule else []

    for fault in sorted_faults:
        graph_before = RoutingGraph.from_project(current_graph_project, MetricType.HOP_COUNT)
        path_before_res = graph_before.find_path(params.traffic_src, params.traffic_dst)
        reachable_before = path_before_res is not None
        before_path_l3 = graph_before.normalize_to_l3_path(path_before_res[0]) if path_before_res else None

        affected_links: list[str] = []

        ft = fault.fault_type
        if ft.is_link_down():
            lid = ft.link_id or ""
            affected_links.append(lid)
            for link in current_graph_project.links:
                if link.id == lid:
                    link.status = LinkStatus.DOWN
        elif ft.is_link_restore():
            lid = ft.link_id or ""
            affected_links.append(lid)
            for link in current_graph_project.links:
                if link.id == lid:
                    link.status = LinkStatus.UP
        elif ft.is_bandwidth_degradation():
            lid = ft.link_id or ""
            affected_links.append(lid)
            for link in current_graph_project.links:
                if link.id == lid:
                    link.bandwidth_bps = ft.new_bandwidth_bps or 1_000_000
        elif ft.is_queue_capacity_change():
            lid = ft.link_id or ""
            affected_links.append(lid)
            for link in current_graph_project.links:
                if link.id == lid:
                    link.queue_capacity = ft.new_capacity or 50
        elif ft.is_node_failure():
            nid = ft.node_id or ""
            saved = {}
            for link in current_graph_project.links:
                if link.source.node_id == nid or link.target.node_id == nid:
                    saved[link.id] = link.status
                    link.status = LinkStatus.DOWN
                    affected_links.append(link.id)
            saved_node_link_states[nid] = saved
        elif ft.is_node_recovery():
            nid = ft.node_id or ""
            if nid in saved_node_link_states:
                saved = saved_node_link_states.pop(nid)
                for lid, status in saved.items():
                    affected_links.append(lid)
                    for link in current_graph_project.links:
                        if link.id == lid:
                            link.status = status
            else:
                for link in current_graph_project.links:
                    if (link.source.node_id == nid or link.target.node_id == nid) and link.status == LinkStatus.DOWN:
                        affected_links.append(link.id)
                        link.status = LinkStatus.UP
        elif ft.is_bit_error():
            lid = ft.link_id or ""
            affected_links.append(lid)
            for link in current_graph_project.links:
                if link.id == lid:
                    link.bit_error_rate = ft.error_rate or 0.0

        graph_after = RoutingGraph.from_project(current_graph_project, MetricType.HOP_COUNT)
        path_after_res = graph_after.find_path(params.traffic_src, params.traffic_dst)
        reachable_after = path_after_res is not None
        after_path_l3 = graph_after.normalize_to_l3_path(path_after_res[0]) if path_after_res else None

        route_changes.append(
            RouteChangeRecord(
                source_node_id=params.traffic_src,
                destination_node_id=params.traffic_dst,
                before_path=before_path_l3,
                after_path=after_path_l3,
                reachable_before=reachable_before,
                reachable_after=reachable_after,
                affected_links=affected_links,
                fault_id=fault.fault_id,
                timestamp_us=fault.timestamp_us,
            )
        )

    engine = SimulationEngine(seed=params.seed)
    engine.update_links(project.links)

    for fault in sorted_faults:
        engine.schedule_fault(fault.fault_id, fault.timestamp_us, fault.fault_type)

    next_inject_us = 0
    interval = max(1, params.interval_us)

    for _ in range(params.packet_count):
        if next_inject_us >= params.duration_us:
            break
        if next_inject_us > engine.current_time.micros:
            engine.run_until(SimTime.from_micros(next_inject_us))
        engine.inject_packet(
            params.traffic_src,
            params.traffic_dst,
            params.packet_size,
            "HTTP",
            "TCP",
        )
        next_inject_us += interval

    if params.duration_us > engine.current_time.micros:
        engine.run_until(SimTime.from_micros(params.duration_us))

    drain_target = SimTime.from_micros(params.duration_us + 100_000)
    engine.run_until(drain_target)

    queue_snapshots = [q.get_snapshot() for q in engine.link_queues.values()]
    actual_elapsed_us = max(1, max(params.duration_us, engine.current_time().micros))

    qos = compute_network_qos(
        engine.metrics,
        engine.all_packets(),
        engine.processed_events,
        queue_snapshots,
        actual_elapsed_us,
    )

    return qos, route_changes


def execute_run(
    params: SingleRunParams, target: ExperimentTarget | None, evidence: list[dict[str, Any]], label: str
) -> tuple[QosMetrics, list[RouteChangeRecord]]:
    """Dispatch explicitly; preserve the original topology engine for legacy target=None."""
    target = target or ExperimentTarget.NETWORK
    if target == ExperimentTarget.NETWORK:
        qos, routes = run_single_simulation(params)
        evidence.append(
            {
                "scenario": label,
                "seed": params.seed,
                "model": "network",
                "inputs": {
                    **asdict(params),
                    "base_project": params.base_project.to_dict(),
                    "fault_schedule": params.fault_schedule.to_dict() if params.fault_schedule else None,
                },
                "qos": qos.to_dict(),
            }
        )
        return qos, routes
    if target not in (ExperimentTarget.TCP, ExperimentTarget.UDP):
        raise ValueError(f"Unsupported experiment target '{target.value}'; use its dedicated studio")
    if params.fault_schedule and params.fault_schedule.entries:
        raise ValueError("Transport experiments do not support scheduled faults")
    if any(link.loss_probability or link.bit_error_rate for link in params.base_project.links):
        raise ValueError("Transport experiments do not model stochastic link loss or BER; use the network target")
    config = TransportConfig(
        protocol=TransportProtocol(target.value),
        source_node_id=params.traffic_src,
        destination_node_id=params.traffic_dst,
        payload_bytes=params.packet_size * params.packet_count,
        segment_size_bytes=params.packet_size,
        seed=params.seed,
    )
    for link in params.base_project.links:
        if link.bandwidth_bps < 1_000_000 or link.propagation_delay_us < 100:
            raise ValueError("Transport topology requires bandwidth >= 1000000 bps and delay >= 100 us (model floors)")
    result = (simulate_tcp if target == ExperimentTarget.TCP else simulate_udp)(config, params.base_project)
    metrics = result.metrics
    elapsed = max(1, metrics.completion_time_us)
    # Only map metrics genuinely calculated by the transport model. TCP latency below is
    # an RTT/2 estimate, not a one-way latency sample. UDP has no RTT estimate.
    qos = QosMetrics(
        measurement_interval_us=elapsed,
        packets_sent=metrics.segments_sent,
        packets_delivered=metrics.segments_delivered,
        packets_lost=metrics.segments_lost,
        retransmissions=metrics.retransmissions,
        packet_loss_rate=metrics.packet_loss_rate,
        throughput_bits_per_sec=metrics.throughput_bits_per_sec,
        throughput_bytes_per_sec=metrics.throughput_bytes_per_sec,
        goodput_bits_per_sec=metrics.goodput_bits_per_sec,
        average_rtt_us=metrics.average_rtt_us if target == ExperimentTarget.TCP else None,
        average_latency_us=metrics.average_rtt_us / 2 if target == ExperimentTarget.TCP else 0,
    )
    _, hops = resolve_route_and_links(config, params.base_project)
    evidence.append(
        {
            "scenario": label,
            "seed": params.seed,
            "model": target.value,
            "config": config.to_dict(),
            "effective_hops": [asdict(hop) for hop in hops],
            "metrics": metrics.to_dict(),
            "qos": qos.to_dict(),
        }
    )
    return qos, []


def validate_execution_settings(config: SweepConfig | ComparativeExperimentConfig) -> None:
    for name in ("packet_size_bytes", "packet_count", "traffic_interval_us"):
        value = getattr(config, name)
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not float(value).is_integer()
            or value <= 0
        ):
            raise ValueError(f"{name} must be a positive integer")
    if config.target in (ExperimentTarget.TCP, ExperimentTarget.UDP) and config.traffic_interval_us is not None:
        raise ValueError("Transport experiments run a bulk transfer to completion; traffic_interval_us is unsupported")


def provenance(config: SweepConfig | ComparativeExperimentConfig, project: Project) -> dict[str, Any]:
    source_root = Path(__file__).resolve().parents[1]
    source_hash = hashlib.sha256()
    for source in sorted(source_root.rglob("*.py")):
        source_hash.update(str(source.relative_to(source_root)).encode())
        source_hash.update(source.read_bytes())
    snapshot = config.to_dict()
    snapshot["base_project"] = project.to_dict()
    return {
        "schema_version": 1,
        "engine": "netsim-python",
        "model_version": "0.9.0",
        "engine_source_sha256": source_hash.hexdigest(),
        "python_version": platform.python_version(),
        "config": snapshot,
        "target": (config.target or ExperimentTarget.NETWORK).value,
        "timing": "duration plus 100000us drain"
        if config.target in (None, ExperimentTarget.NETWORK)
        else "bulk transfer to completion; simulation_duration_us does not truncate transfer",
        "metric_notes": "Transport: latency is TCP RTT/2 estimate; UDP latency and jitter unavailable (zero placeholders). "
        "Seeds do not introduce random loss into transport models. Effective hops include model floors.",
        "wall_clock_field": "execution_time_ms is not deterministic",
    }


def run_parameter_sweep(
    config: SweepConfig,
    active_project: Project,
) -> SweepExperimentResult:
    validate_sweep_config(config)
    validate_execution_settings(config)
    start_time = time.time()

    base_project = config.base_project or active_project
    if len(base_project.nodes) < 2:
        raise ValueError("Network topology must contain at least 2 nodes for experiments")

    src = config.traffic_src_id or base_project.nodes[0].id
    dst = config.traffic_dst_id or base_project.nodes[1].id

    packet_size = config.packet_size_bytes or 1000
    interval_us = config.traffic_interval_us or 10_000
    packet_count = config.packet_count or 10
    duration_us = config.simulation_duration_us

    evidence: list[dict[str, Any]] = []
    points: list[SweepPointResult] = []
    total_runs = 0

    for val in config.parameter_values:
        runs: list[SweepRunResult] = []
        qos_list: list[QosMetrics] = []

        proj = copy.deepcopy(base_project)
        apply_parameter_to_project(proj, config.parameter, val)

        effective_size = (
            int(val) if config.parameter.param_type == SweepParameterType.PACKET_SIZE_BYTES else packet_size
        )
        effective_interval = (
            int(max(1.0, val)) if config.parameter.param_type == SweepParameterType.TRAFFIC_INTERVAL_US else interval_us
        )
        effective_count = (
            int(max(1.0, val)) if config.parameter.param_type == SweepParameterType.PACKET_COUNT else packet_count
        )

        for seed in config.seeds:
            total_runs += 1
            qos, route_changes = execute_run(
                SingleRunParams(
                    base_project=proj,
                    seed=seed,
                    duration_us=duration_us,
                    traffic_src=src,
                    traffic_dst=dst,
                    packet_size=effective_size,
                    interval_us=effective_interval,
                    packet_count=effective_count,
                    fault_schedule=config.fault_schedule,
                ),
                config.target,
                evidence,
                f"parameter={val}",
            )
            qos_list.append(qos)
            runs.append(
                SweepRunResult(
                    parameter_value=val,
                    seed=seed,
                    qos=qos,
                    route_changes=route_changes,
                )
            )

        aggregated = aggregate_qos(qos_list)
        points.append(
            SweepPointResult(
                parameter_value=val,
                aggregated_qos=aggregated,
                runs=runs,
            )
        )

    execution_time_ms = int((time.time() - start_time) * 1000)

    return SweepExperimentResult(
        experiment_name=config.experiment_name,
        parameter_name=config.parameter.name(),
        points=points,
        total_runs=total_runs,
        seeds=list(config.seeds),
        execution_time_ms=execution_time_ms,
        provenance=provenance(config, base_project),
        run_evidence=evidence,
    )


def compute_deltas(a: AggregatedQos, b: AggregatedQos) -> list[MetricDelta]:
    deltas: list[MetricDelta] = []

    def calc(name: str, va: float, vb: float) -> MetricDelta:
        diff = vb - va
        percent = ((diff / va) * 100.0) if va != 0.0 else None
        return MetricDelta(
            metric_name=name,
            val_a=va,
            val_b=vb,
            diff=diff,
            percent_change=percent,
        )

    deltas.append(calc("throughput_bps", a.mean_throughput_bps, b.mean_throughput_bps))
    deltas.append(calc("goodput_bps", a.mean_goodput_bps, b.mean_goodput_bps))
    deltas.append(calc("latency_us", a.mean_latency_us, b.mean_latency_us))
    deltas.append(calc("jitter_us", a.mean_jitter_us, b.mean_jitter_us))
    deltas.append(calc("loss_rate", a.mean_loss_rate, b.mean_loss_rate))
    deltas.append(calc("retransmissions", a.mean_retransmissions, b.mean_retransmissions))

    return deltas


def run_comparative_experiment(
    config: ComparativeExperimentConfig,
    active_project: Project,
) -> ComparativeExperimentResult:
    validate_comparative_config(config)
    validate_execution_settings(config)
    start_time = time.time()

    base_project = config.base_project or active_project
    if len(base_project.nodes) < 2:
        raise ValueError("Network topology must contain at least 2 nodes for experiments")

    src = config.traffic_src_id or base_project.nodes[0].id
    dst = config.traffic_dst_id or base_project.nodes[1].id

    packet_size = config.packet_size_bytes or 1000
    interval_us = config.traffic_interval_us or 10_000
    packet_count = config.packet_count or 10
    duration_us = config.simulation_duration_us

    proj_a = copy.deepcopy(config.scenario_a.project_override or base_project)
    if config.scenario_a.parameter_overrides:
        for param, val in config.scenario_a.parameter_overrides:
            apply_parameter_to_project(proj_a, param, val)

    proj_b = copy.deepcopy(config.scenario_b.project_override or base_project)
    if config.scenario_b.parameter_overrides:
        for param, val in config.scenario_b.parameter_overrides:
            apply_parameter_to_project(proj_b, param, val)

    evidence: list[dict[str, Any]] = []
    qos_a_list: list[QosMetrics] = []
    qos_b_list: list[QosMetrics] = []
    route_changes_a: list[RouteChangeRecord] = []
    route_changes_b: list[RouteChangeRecord] = []

    for seed in config.seeds:
        overrides = {p.param_type: value for p, value in config.scenario_a.parameter_overrides or []}
        qos_a, rc_a = execute_run(
            SingleRunParams(
                base_project=proj_a,
                seed=seed,
                duration_us=duration_us,
                traffic_src=src,
                traffic_dst=dst,
                packet_size=int(overrides.get(SweepParameterType.PACKET_SIZE_BYTES, packet_size)),
                interval_us=int(overrides.get(SweepParameterType.TRAFFIC_INTERVAL_US, interval_us)),
                packet_count=int(overrides.get(SweepParameterType.PACKET_COUNT, packet_count)),
                fault_schedule=config.scenario_a.fault_schedule,
            ),
            config.target,
            evidence,
            "a",
        )
        qos_a_list.append(qos_a)
        route_changes_a.extend(rc_a)

        overrides = {p.param_type: value for p, value in config.scenario_b.parameter_overrides or []}
        qos_b, rc_b = execute_run(
            SingleRunParams(
                base_project=proj_b,
                seed=seed,
                duration_us=duration_us,
                traffic_src=src,
                traffic_dst=dst,
                packet_size=int(overrides.get(SweepParameterType.PACKET_SIZE_BYTES, packet_size)),
                interval_us=int(overrides.get(SweepParameterType.TRAFFIC_INTERVAL_US, interval_us)),
                packet_count=int(overrides.get(SweepParameterType.PACKET_COUNT, packet_count)),
                fault_schedule=config.scenario_b.fault_schedule,
            ),
            config.target,
            evidence,
            "b",
        )
        qos_b_list.append(qos_b)
        route_changes_b.extend(rc_b)

    agg_a = aggregate_qos(qos_a_list)
    agg_b = aggregate_qos(qos_b_list)
    deltas = compute_deltas(agg_a, agg_b)
    execution_time_ms = int((time.time() - start_time) * 1000)

    return ComparativeExperimentResult(
        experiment_name=config.experiment_name,
        scenario_a_name=config.scenario_a.name,
        scenario_b_name=config.scenario_b.name,
        qos_a=agg_a,
        qos_b=agg_b,
        deltas=deltas,
        route_changes_a=route_changes_a,
        route_changes_b=route_changes_b,
        runs_count_per_scenario=len(config.seeds),
        execution_time_ms=execution_time_ms,
        provenance=provenance(config, base_project),
        run_evidence=evidence,
    )
