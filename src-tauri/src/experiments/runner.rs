use crate::domain::{LinkStatus, Project};
use crate::error::{NetSimError, Result};
use crate::experiments::config::{ComparativeExperimentConfig, SweepConfig, SweepParameter};
use crate::experiments::results::{
    ComparativeExperimentResult, MetricDelta, SweepExperimentResult, SweepPointResult,
    SweepRunResult,
};
use crate::experiments::sweep::{
    apply_parameter_to_project, validate_comparative_config, validate_sweep_config,
};
use crate::faults::{FaultSchedule, FaultType, RouteChangeRecord};
use crate::qos::{aggregate_qos, compute_network_qos, AggregatedQos, QosMetrics};
use crate::routing::graph::{MetricType, RoutingGraph};
use crate::simulation::engine::SimulationEngine;
use crate::simulation::SimTime;
use std::collections::HashMap;

/// Parameters for a single simulation run.
#[derive(Debug, Clone)]
pub struct SingleRunParams<'a> {
    pub base_project: &'a Project,
    pub seed: u64,
    pub duration_us: u64,
    pub traffic_src: &'a str,
    pub traffic_dst: &'a str,
    pub packet_size: usize,
    pub interval_us: u64,
    pub packet_count: usize,
    pub fault_schedule: Option<&'a FaultSchedule>,
}

/// Runs a single simulation instance deterministically and produces QoS metrics and route changes.
pub fn run_single_simulation(
    params: SingleRunParams<'_>,
) -> Result<(QosMetrics, Vec<RouteChangeRecord>)> {
    let project = params.base_project.clone();
    let mut route_changes = Vec::new();

    // Track dynamic routing changes across faults
    let mut current_graph_project = project.clone();
    let mut saved_node_link_states: HashMap<String, HashMap<String, LinkStatus>> = HashMap::new();

    let sorted_faults = params
        .fault_schedule
        .map(|fs| fs.sorted_entries())
        .unwrap_or_default();

    // Compute route change records for each fault
    for fault in &sorted_faults {
        let graph_before = RoutingGraph::from_project(&current_graph_project, MetricType::HopCount);
        let path_before_res = graph_before.find_path(params.traffic_src, params.traffic_dst);
        let reachable_before = path_before_res.is_some();
        let before_path_l3 = path_before_res
            .as_ref()
            .map(|(p, _)| graph_before.normalize_to_l3_path(p));

        let mut affected_links = Vec::new();

        // Apply fault to current_graph_project
        match &fault.fault_type {
            FaultType::LinkDown { link_id } => {
                affected_links.push(link_id.clone());
                if let Some(link) = current_graph_project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *link_id)
                {
                    link.status = LinkStatus::Down;
                }
            }
            FaultType::LinkRestore { link_id } => {
                affected_links.push(link_id.clone());
                if let Some(link) = current_graph_project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *link_id)
                {
                    link.status = LinkStatus::Up;
                }
            }
            FaultType::BandwidthDegradation {
                link_id,
                new_bandwidth_bps,
            } => {
                affected_links.push(link_id.clone());
                if let Some(link) = current_graph_project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *link_id)
                {
                    link.bandwidth_bps = *new_bandwidth_bps;
                }
            }
            FaultType::QueueCapacityChange {
                link_id,
                new_capacity,
            } => {
                affected_links.push(link_id.clone());
                if let Some(link) = current_graph_project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *link_id)
                {
                    link.queue_capacity = *new_capacity;
                }
            }
            FaultType::NodeFailure { node_id } => {
                let mut saved = HashMap::new();
                for link in &mut current_graph_project.links {
                    if link.source.node_id == *node_id || link.target.node_id == *node_id {
                        saved.insert(link.id.clone(), link.status);
                        link.status = LinkStatus::Down;
                        affected_links.push(link.id.clone());
                    }
                }
                saved_node_link_states.insert(node_id.clone(), saved);
            }
            FaultType::NodeRecovery { node_id } => {
                if let Some(saved) = saved_node_link_states.remove(node_id) {
                    for (lid, status) in saved {
                        affected_links.push(lid.clone());
                        if let Some(link) =
                            current_graph_project.links.iter_mut().find(|l| l.id == lid)
                        {
                            link.status = status;
                        }
                    }
                } else {
                    for link in &mut current_graph_project.links {
                        if (link.source.node_id == *node_id || link.target.node_id == *node_id)
                            && link.status == LinkStatus::Down
                        {
                            affected_links.push(link.id.clone());
                            link.status = LinkStatus::Up;
                        }
                    }
                }
            }
            FaultType::PacketDrop { .. } => {}
            FaultType::BitError {
                link_id,
                error_rate,
            } => {
                affected_links.push(link_id.clone());
                if let Some(link) = current_graph_project
                    .links
                    .iter_mut()
                    .find(|l| l.id == *link_id)
                {
                    link.bit_error_rate = *error_rate;
                }
            }
        }

        let graph_after = RoutingGraph::from_project(&current_graph_project, MetricType::HopCount);
        let path_after_res = graph_after.find_path(params.traffic_src, params.traffic_dst);
        let reachable_after = path_after_res.is_some();
        let after_path_l3 = path_after_res
            .as_ref()
            .map(|(p, _)| graph_after.normalize_to_l3_path(p));

        route_changes.push(RouteChangeRecord {
            source_node_id: params.traffic_src.to_string(),
            destination_node_id: params.traffic_dst.to_string(),
            before_path: before_path_l3,
            after_path: after_path_l3,
            reachable_before,
            reachable_after,
            affected_links,
            fault_id: fault.fault_id.clone(),
            timestamp_us: fault.timestamp_us,
        });
    }

    // Initialize authoritative SimulationEngine
    let mut engine = SimulationEngine::new(params.seed);
    engine.update_links(&project.links);

    // Schedule all faults in engine
    for fault in &sorted_faults {
        engine.schedule_fault(
            &fault.fault_id,
            fault.timestamp_us,
            fault.fault_type.clone(),
        );
    }

    // Schedule and step traffic deterministically
    let mut next_inject_us = 0u64;
    let interval = params.interval_us.max(1);

    for _ in 0..params.packet_count {
        if next_inject_us >= params.duration_us {
            break;
        }
        if next_inject_us > engine.current_time().as_micros() {
            let target = SimTime::from_micros(next_inject_us);
            engine.run_until(target)?;
        }
        engine.inject_packet(
            params.traffic_src.to_string(),
            params.traffic_dst.to_string(),
            params.packet_size,
            "HTTP".to_string(),
            "TCP".to_string(),
        );
        next_inject_us = next_inject_us.saturating_add(interval);
    }

    // Step remaining events up to duration_us
    if params.duration_us > engine.current_time().as_micros() {
        let target = SimTime::from_micros(params.duration_us);
        engine.run_until(target)?;
    }

    // Drain remaining packet transit if possible up to duration_us + 100,000 µs
    let drain_target = SimTime::from_micros(params.duration_us.saturating_add(100_000));
    let _ = engine.run_until(drain_target);

    let queue_snapshots: Vec<_> = engine
        .link_queues()
        .values()
        .map(|q| q.get_snapshot())
        .collect();

    let actual_elapsed_us = engine
        .current_time()
        .as_micros()
        .max(params.duration_us)
        .max(1);
    let qos = compute_network_qos(
        engine.metrics(),
        &engine.all_packets(),
        engine.processed_events(),
        &queue_snapshots,
        actual_elapsed_us,
    );

    Ok((qos, route_changes))
}

/// Executes a complete parameter sweep experiment across configured values and seeds.
pub fn run_parameter_sweep(
    config: &SweepConfig,
    active_project: &Project,
) -> Result<SweepExperimentResult> {
    validate_sweep_config(config)?;
    let start_instant = std::time::Instant::now();

    let base_project = config.base_project.as_ref().unwrap_or(active_project);

    if base_project.nodes.len() < 2 {
        return Err(NetSimError::InvalidConfiguration(
            "Network topology must contain at least 2 nodes for experiments".to_string(),
        ));
    }

    let src = config
        .traffic_src_id
        .clone()
        .unwrap_or_else(|| base_project.nodes[0].id.clone());
    let dst = config
        .traffic_dst_id
        .clone()
        .unwrap_or_else(|| base_project.nodes[1].id.clone());

    let packet_size = config.packet_size_bytes.unwrap_or(1000);
    let interval_us = config.traffic_interval_us.unwrap_or(10_000);
    let packet_count = config.packet_count.unwrap_or(10);
    let duration_us = config.simulation_duration_us;

    let mut points = Vec::new();
    let mut total_runs = 0;

    for &val in &config.parameter_values {
        let mut runs = Vec::new();
        let mut qos_list = Vec::new();

        // Apply parameter to a cloned project if it's a topology parameter
        let mut proj = base_project.clone();
        apply_parameter_to_project(&mut proj, &config.parameter, val)?;

        // Effective traffic parameters if this sweep targets traffic
        let effective_size = match config.parameter {
            SweepParameter::PacketSizeBytes => val.max(64.0) as usize,
            _ => packet_size,
        };
        let effective_interval = match config.parameter {
            SweepParameter::TrafficIntervalUs => val.max(1.0) as u64,
            _ => interval_us,
        };
        let effective_count = match config.parameter {
            SweepParameter::PacketCount => val.max(1.0) as usize,
            _ => packet_count,
        };

        for &seed in &config.seeds {
            total_runs += 1;
            let (qos, route_changes) = run_single_simulation(SingleRunParams {
                base_project: &proj,
                seed,
                duration_us,
                traffic_src: &src,
                traffic_dst: &dst,
                packet_size: effective_size,
                interval_us: effective_interval,
                packet_count: effective_count,
                fault_schedule: config.fault_schedule.as_ref(),
            })?;

            qos_list.push(qos.clone());
            runs.push(SweepRunResult {
                parameter_value: val,
                seed,
                qos,
                route_changes,
            });
        }

        let aggregated = aggregate_qos(&qos_list);
        points.push(SweepPointResult {
            parameter_value: val,
            aggregated_qos: aggregated,
            runs,
        });
    }

    let execution_time_ms = start_instant.elapsed().as_millis() as u64;

    Ok(SweepExperimentResult {
        experiment_name: config.experiment_name.clone(),
        parameter_name: config.parameter.name(),
        points,
        total_runs,
        seeds: config.seeds.clone(),
        execution_time_ms,
    })
}

/// Helper to compute comparative metric deltas between scenario A and scenario B.
fn compute_deltas(a: &AggregatedQos, b: &AggregatedQos) -> Vec<MetricDelta> {
    let mut deltas = Vec::new();

    let calc = |name: &str, va: f64, vb: f64| -> MetricDelta {
        let diff = vb - va;
        let percent = if va != 0.0 {
            Some((diff / va) * 100.0)
        } else {
            None
        };
        MetricDelta {
            metric_name: name.to_string(),
            val_a: va,
            val_b: vb,
            diff,
            percent_change: percent,
        }
    };

    deltas.push(calc(
        "throughput_bps",
        a.mean_throughput_bps,
        b.mean_throughput_bps,
    ));
    deltas.push(calc("goodput_bps", a.mean_goodput_bps, b.mean_goodput_bps));
    deltas.push(calc("latency_us", a.mean_latency_us, b.mean_latency_us));
    deltas.push(calc("jitter_us", a.mean_jitter_us, b.mean_jitter_us));
    deltas.push(calc("loss_rate", a.mean_loss_rate, b.mean_loss_rate));
    deltas.push(calc(
        "retransmissions",
        a.mean_retransmissions,
        b.mean_retransmissions,
    ));

    deltas
}

/// Executes a comparative A/B experiment between two scenarios across multiple seeds.
pub fn run_comparative_experiment(
    config: &ComparativeExperimentConfig,
    active_project: &Project,
) -> Result<ComparativeExperimentResult> {
    validate_comparative_config(config)?;
    let start_instant = std::time::Instant::now();

    let base_project = config.base_project.as_ref().unwrap_or(active_project);

    if base_project.nodes.len() < 2 {
        return Err(NetSimError::InvalidConfiguration(
            "Network topology must contain at least 2 nodes for experiments".to_string(),
        ));
    }

    let src = config
        .traffic_src_id
        .clone()
        .unwrap_or_else(|| base_project.nodes[0].id.clone());
    let dst = config
        .traffic_dst_id
        .clone()
        .unwrap_or_else(|| base_project.nodes[1].id.clone());

    let packet_size = config.packet_size_bytes.unwrap_or(1000);
    let interval_us = config.traffic_interval_us.unwrap_or(10_000);
    let packet_count = config.packet_count.unwrap_or(10);
    let duration_us = config.simulation_duration_us;

    // Prepare Scenario A project
    let mut proj_a = config
        .scenario_a
        .project_override
        .clone()
        .unwrap_or_else(|| base_project.clone());
    if let Some(overrides) = &config.scenario_a.parameter_overrides {
        for (param, val) in overrides {
            apply_parameter_to_project(&mut proj_a, param, *val)?;
        }
    }

    // Prepare Scenario B project
    let mut proj_b = config
        .scenario_b
        .project_override
        .clone()
        .unwrap_or_else(|| base_project.clone());
    if let Some(overrides) = &config.scenario_b.parameter_overrides {
        for (param, val) in overrides {
            apply_parameter_to_project(&mut proj_b, param, *val)?;
        }
    }

    let mut qos_a_list = Vec::new();
    let mut qos_b_list = Vec::new();
    let mut route_changes_a = Vec::new();
    let mut route_changes_b = Vec::new();

    for &seed in &config.seeds {
        let (qos_a, rc_a) = run_single_simulation(SingleRunParams {
            base_project: &proj_a,
            seed,
            duration_us,
            traffic_src: &src,
            traffic_dst: &dst,
            packet_size,
            interval_us,
            packet_count,
            fault_schedule: config.scenario_a.fault_schedule.as_ref(),
        })?;
        qos_a_list.push(qos_a);
        route_changes_a.extend(rc_a);

        let (qos_b, rc_b) = run_single_simulation(SingleRunParams {
            base_project: &proj_b,
            seed,
            duration_us,
            traffic_src: &src,
            traffic_dst: &dst,
            packet_size,
            interval_us,
            packet_count,
            fault_schedule: config.scenario_b.fault_schedule.as_ref(),
        })?;
        qos_b_list.push(qos_b);
        route_changes_b.extend(rc_b);
    }

    let agg_a = aggregate_qos(&qos_a_list);
    let agg_b = aggregate_qos(&qos_b_list);
    let deltas = compute_deltas(&agg_a, &agg_b);
    let execution_time_ms = start_instant.elapsed().as_millis() as u64;

    Ok(ComparativeExperimentResult {
        experiment_name: config.experiment_name.clone(),
        scenario_a_name: config.scenario_a.name.clone(),
        scenario_b_name: config.scenario_b.name.clone(),
        qos_a: agg_a,
        qos_b: agg_b,
        deltas,
        route_changes_a,
        route_changes_b,
        runs_count_per_scenario: config.seeds.len(),
        execution_time_ms,
    })
}
