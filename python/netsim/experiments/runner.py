from __future__ import annotations

import copy
import time
from dataclasses import dataclass

from netsim.core.clock import SimTime
from netsim.core.engine import SimulationEngine
from netsim.experiments.config import (
    ComparativeExperimentConfig,
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


def run_parameter_sweep(
    config: SweepConfig,
    active_project: Project,
) -> SweepExperimentResult:
    validate_sweep_config(config)
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

    points: list[SweepPointResult] = []
    total_runs = 0

    for val in config.parameter_values:
        runs: list[SweepRunResult] = []
        qos_list: list[QosMetrics] = []

        proj = copy.deepcopy(base_project)
        apply_parameter_to_project(proj, config.parameter, val)

        effective_size = (
            int(max(64.0, val)) if config.parameter.param_type == SweepParameterType.PACKET_SIZE_BYTES else packet_size
        )
        effective_interval = (
            int(max(1.0, val)) if config.parameter.param_type == SweepParameterType.TRAFFIC_INTERVAL_US else interval_us
        )
        effective_count = (
            int(max(1.0, val)) if config.parameter.param_type == SweepParameterType.PACKET_COUNT else packet_count
        )

        for seed in config.seeds:
            total_runs += 1
            qos, route_changes = run_single_simulation(
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
                )
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

    qos_a_list: list[QosMetrics] = []
    qos_b_list: list[QosMetrics] = []
    route_changes_a: list[RouteChangeRecord] = []
    route_changes_b: list[RouteChangeRecord] = []

    for seed in config.seeds:
        qos_a, rc_a = run_single_simulation(
            SingleRunParams(
                base_project=proj_a,
                seed=seed,
                duration_us=duration_us,
                traffic_src=src,
                traffic_dst=dst,
                packet_size=packet_size,
                interval_us=interval_us,
                packet_count=packet_count,
                fault_schedule=config.scenario_a.fault_schedule,
            )
        )
        qos_a_list.append(qos_a)
        route_changes_a.extend(rc_a)

        qos_b, rc_b = run_single_simulation(
            SingleRunParams(
                base_project=proj_b,
                seed=seed,
                duration_us=duration_us,
                traffic_src=src,
                traffic_dst=dst,
                packet_size=packet_size,
                interval_us=interval_us,
                packet_count=packet_count,
                fault_schedule=config.scenario_b.fault_schedule,
            )
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
    )
