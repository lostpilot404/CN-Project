use super::graph::RoutingGraph;
use super::table::{RouteTableEntry, RoutingTable};
use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvergenceRound {
    pub round_number: usize,
    /// Distance from the monitored source to each destination at this round
    pub source_distances: HashMap<String, u64>,
    /// Summary of changes that occurred in this round
    pub changes: Vec<String>,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvergenceTelemetry {
    pub algorithm: String,
    pub source_node_id: String,
    pub total_rounds: usize,
    pub converged: bool,
    pub rounds: Vec<ConvergenceRound>,
    pub final_routing_table: RoutingTable,
}

/// Computes Bellman-Ford / Distance-Vector routing table and convergence telemetry.
///
/// Features:
/// - True round-by-round Distance Vector exchange simulation.
/// - Non-transit rule: End hosts (PC, Server) cannot forward transit routes.
/// - Deterministic tie-breaking for equal-cost paths (smaller neighbor node ID preferred).
/// - Path reconstruction and next-hop resolution.
/// - Early convergence termination and count-to-infinity safety bound (|V| rounds).
pub fn simulate_distance_vector_convergence(
    graph: &RoutingGraph,
    source_node_id: &str,
) -> Result<ConvergenceTelemetry> {
    let source_node = graph
        .nodes
        .get(source_node_id)
        .ok_or_else(|| NetSimError::NodeNotFound(source_node_id.to_string()))?;

    // Routing scope: Layer 3 routing tables are generated strictly for Routers.
    // L2 Switches, APs, and end hosts cannot receive an L3 routing table.
    if !graph.is_routing_device(source_node_id) {
        return Err(NetSimError::InvalidConfiguration(format!(
            "Node '{}' ({:?}) is not an L3 routing device. Routing tables are only generated for Routers.",
            source_node.label, source_node.node_type
        )));
    }

    let all_node_ids: Vec<String> = {
        let mut ids: Vec<String> = graph.nodes.keys().cloned().collect();
        ids.sort();
        ids
    };

    let num_nodes = all_node_ids.len();

    // Distance vector table: dist[u][v] = cost from u to v
    // Next-hop table: next_hop[u][v] = next hop on path from u to v
    let mut dist: HashMap<String, HashMap<String, u64>> = HashMap::new();
    let mut next_hop: HashMap<String, HashMap<String, Option<String>>> = HashMap::new();

    // Initialize Round 0
    for u in &all_node_ids {
        let mut u_dist = HashMap::new();
        let mut u_next = HashMap::new();
        for v in &all_node_ids {
            if u == v {
                u_dist.insert(v.clone(), 0u64);
                u_next.insert(v.clone(), None);
            } else {
                u_dist.insert(v.clone(), u64::MAX);
                u_next.insert(v.clone(), None);
            }
        }
        // Direct active neighbors
        if let Some(edges) = graph.adjacency.get(u) {
            for edge in edges {
                let current = *u_dist.get(&edge.target).unwrap_or(&u64::MAX);
                if edge.metric < current
                    || (edge.metric == current
                        && u_next
                            .get(&edge.target)
                            .and_then(|opt| opt.as_ref())
                            .is_none_or(|nh| edge.target < *nh))
                {
                    u_dist.insert(edge.target.clone(), edge.metric);
                    u_next.insert(edge.target.clone(), Some(edge.target.clone()));
                }
            }
        }
        dist.insert(u.clone(), u_dist);
        next_hop.insert(u.clone(), u_next);
    }

    let mut rounds: Vec<ConvergenceRound> = Vec::new();

    // Snapshot round 0
    let round_0_distances = dist.get(source_node_id).cloned().unwrap_or_default();
    rounds.push(ConvergenceRound {
        round_number: 0,
        source_distances: round_0_distances,
        changes: vec!["Initial local neighbor discovery (Round 0)".to_string()],
        changed: true,
    });

    let max_rounds = if num_nodes > 1 { num_nodes } else { 1 };
    let mut converged = false;

    for r in 1..=max_rounds {
        let mut new_dist = dist.clone();
        let mut new_next_hop = next_hop.clone();
        let mut round_changes = Vec::new();
        let mut any_changed = false;

        // In each round, every node receives vectors from its neighbors
        for u in &all_node_ids {
            let edges = match graph.adjacency.get(u) {
                Some(e) => e,
                None => continue,
            };

            for edge in edges {
                let v = &edge.target;
                let link_cost = edge.metric;

                // Forwarding constraint:
                // An L3 transit router OR L2 transparent forwarding switch can forward routes/connectivity.
                // End hosts (PC, Server, Generic) cannot forward routes for other destinations d != v.
                let v_can_forward = graph.can_forward_traffic(v);

                for d in &all_node_ids {
                    if d == u {
                        continue;
                    }

                    // If v cannot forward traffic, we can only reach v itself through v, not any other node d
                    if !v_can_forward && d != v {
                        continue;
                    }

                    let v_to_d_cost = dist
                        .get(v)
                        .and_then(|v_map| v_map.get(d))
                        .copied()
                        .unwrap_or(u64::MAX);

                    if v_to_d_cost == u64::MAX {
                        continue;
                    }

                    let candidate_cost = link_cost.saturating_add(v_to_d_cost);
                    let current_cost = new_dist
                        .get(u)
                        .and_then(|m| m.get(d))
                        .copied()
                        .unwrap_or(u64::MAX);

                    let current_nh = new_next_hop
                        .get(u)
                        .and_then(|m| m.get(d))
                        .and_then(|opt| opt.as_ref());

                    let should_update = if candidate_cost < current_cost {
                        true
                    } else if candidate_cost == current_cost && current_cost < u64::MAX {
                        // Deterministic tie break: lexicographically smaller next hop
                        match current_nh {
                            Some(curr) => v < curr,
                            None => true,
                        }
                    } else {
                        false
                    };

                    if should_update {
                        new_dist
                            .get_mut(u)
                            .unwrap()
                            .insert(d.clone(), candidate_cost);
                        new_next_hop
                            .get_mut(u)
                            .unwrap()
                            .insert(d.clone(), Some(v.clone()));

                        if u == source_node_id {
                            round_changes.push(format!(
                                "Updated route to {} via {}: cost {} (was {})",
                                d,
                                v,
                                candidate_cost,
                                if current_cost == u64::MAX {
                                    "inf".to_string()
                                } else {
                                    current_cost.to_string()
                                }
                            ));
                        }
                        any_changed = true;
                    }
                }
            }
        }

        dist = new_dist;
        next_hop = new_next_hop;

        let source_distances = dist.get(source_node_id).cloned().unwrap_or_default();
        rounds.push(ConvergenceRound {
            round_number: r,
            source_distances,
            changes: round_changes,
            changed: any_changed,
        });

        if !any_changed {
            converged = true;
            break;
        }
    }

    // Build the final routing table for the source node
    let final_routing_table =
        build_routing_table_from_vectors(graph, source_node_id, &dist, &next_hop)?;

    Ok(ConvergenceTelemetry {
        algorithm: "Bellman-Ford (Distance-Vector)".to_string(),
        source_node_id: source_node_id.to_string(),
        total_rounds: rounds.len().saturating_sub(1),
        converged,
        rounds,
        final_routing_table,
    })
}

/// Helper to build a RoutingTable from converged Distance Vector and Next-Hop states
fn build_routing_table_from_vectors(
    graph: &RoutingGraph,
    source_node_id: &str,
    dist: &HashMap<String, HashMap<String, u64>>,
    next_hop: &HashMap<String, HashMap<String, Option<String>>>,
) -> Result<RoutingTable> {
    let source_node = graph
        .nodes
        .get(source_node_id)
        .ok_or_else(|| NetSimError::NodeNotFound(source_node_id.to_string()))?;

    let mut entries = Vec::new();
    let mut sorted_destinations: Vec<_> = graph.nodes.keys().cloned().collect();
    sorted_destinations.sort();

    let source_dist = dist
        .get(source_node_id)
        .ok_or_else(|| NetSimError::NodeNotFound(source_node_id.to_string()))?;

    for dest_id in sorted_destinations {
        let dest_node = graph.nodes.get(&dest_id).unwrap();
        let cost = *source_dist.get(&dest_id).unwrap_or(&u64::MAX);

        if dest_id == source_node_id {
            entries.push(RouteTableEntry {
                destination: dest_id.clone(),
                destination_label: dest_node.label.clone(),
                next_hop: None,
                interface_id: None,
                metric: 0,
                path: vec![source_node_id.to_string()],
                is_reachable: true,
                protocol: "Local".to_string(),
            });
            continue;
        }

        if cost == u64::MAX {
            entries.push(RouteTableEntry {
                destination: dest_id.clone(),
                destination_label: dest_node.label.clone(),
                next_hop: None,
                interface_id: None,
                metric: u64::MAX,
                path: Vec::new(),
                is_reachable: false,
                protocol: "Bellman-Ford".to_string(),
            });
            continue;
        }

        // Reconstruct physical path by following next hops
        let mut physical_path = vec![source_node_id.to_string()];
        let mut curr = source_node_id.to_string();
        let mut visited = std::collections::HashSet::new();
        visited.insert(curr.clone());

        while curr != dest_id {
            let next = match next_hop
                .get(&curr)
                .and_then(|m| m.get(&dest_id))
                .and_then(|o| o.as_ref())
            {
                Some(n) => n.clone(),
                None => break,
            };
            if visited.contains(&next) {
                // Loop detected in path reconstruction
                break;
            }
            visited.insert(next.clone());
            physical_path.push(next.clone());
            curr = next;
        }

        // Normalize physical path to Layer 3 routing path (intermediate L2 switches omitted from L3 hops)
        let l3_path = graph.normalize_to_l3_path(&physical_path);

        // Next-hop at Layer 3 is the first L3 device after source
        let l3_next_hop = if l3_path.len() >= 2 {
            Some(l3_path[1].clone())
        } else {
            None
        };

        // Outbound interface from source to immediate physical next hop
        let egress_interface = if physical_path.len() >= 2 {
            let first_physical_hop = &physical_path[1];
            graph
                .adjacency
                .get(source_node_id)
                .and_then(|edges| edges.iter().find(|e| &e.target == first_physical_hop))
                .map(|e| e.source_interface_id.clone())
        } else {
            None
        };

        entries.push(RouteTableEntry {
            destination: dest_id.clone(),
            destination_label: dest_node.label.clone(),
            next_hop: l3_next_hop,
            interface_id: egress_interface,
            metric: cost,
            path: l3_path,
            is_reachable: true,
            protocol: "Bellman-Ford".to_string(),
        });
    }

    Ok(RoutingTable {
        node_id: source_node_id.to_string(),
        node_label: source_node.label.clone(),
        algorithm: "Bellman-Ford (Distance-Vector)".to_string(),
        metric_type: format!("{:?}", graph.metric_type),
        entries,
    })
}

/// Standalone Bellman-Ford shortest paths function matching compute_dijkstra_shortest_paths
pub fn compute_bellman_ford_shortest_paths(
    graph: &RoutingGraph,
    source_node_id: &str,
) -> Result<RoutingTable> {
    let telemetry = simulate_distance_vector_convergence(graph, source_node_id)?;
    Ok(telemetry.final_routing_table)
}
