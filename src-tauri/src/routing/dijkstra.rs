use super::graph::RoutingGraph;
use super::table::{RouteTableEntry, RoutingTable};
use crate::error::{NetSimError, Result};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

#[derive(Clone, Eq, PartialEq)]
struct HeapState {
    cost: u64,
    node_id: String,
}

// Invert ordering for min-heap; tie-break deterministically with lexicographical node_id
impl Ord for HeapState {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .cmp(&self.cost)
            .then_with(|| other.node_id.cmp(&self.node_id))
    }
}

impl PartialOrd for HeapState {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone)]
struct Predecessor {
    prev_node: String,
}

/// Computes Dijkstra single-source shortest paths and constructs the authoritative routing table.
///
/// Features:
/// - Priority queue with deterministic tie-breaking.
/// - Next-hop resolution & full path reconstruction.
/// - End-host non-transit rule: End hosts (PC, Server) cannot forward transit packets.
/// - Disconnected node handling (marked unreachable with metric = u64::MAX).
pub fn compute_dijkstra_shortest_paths(
    graph: &RoutingGraph,
    source_node_id: &str,
) -> Result<RoutingTable> {
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

    let mut dist: HashMap<String, u64> = HashMap::new();
    let mut prev: HashMap<String, Predecessor> = HashMap::new();
    let mut heap = BinaryHeap::new();

    for node_id in graph.nodes.keys() {
        if node_id == source_node_id {
            dist.insert(node_id.clone(), 0);
            heap.push(HeapState {
                cost: 0,
                node_id: node_id.clone(),
            });
        } else {
            dist.insert(node_id.clone(), u64::MAX);
        }
    }

    while let Some(HeapState { cost, node_id }) = heap.pop() {
        if cost > *dist.get(&node_id).unwrap_or(&u64::MAX) {
            continue;
        }

        // Forwarding rule: Only the source router itself OR forward-capable nodes
        // (L3 transit routers or L2 transparent forwarding switches) can forward traffic
        // out to other neighbors. End hosts (PC, Server, Generic) cannot forward traffic.
        if node_id != source_node_id && !graph.can_forward_traffic(&node_id) {
            continue;
        }

        if let Some(edges) = graph.adjacency.get(&node_id) {
            for edge in edges {
                let next_cost = cost.saturating_add(edge.metric);
                let current_best = *dist.get(&edge.target).unwrap_or(&u64::MAX);

                // If strictly better, or equal cost with lexicographically smaller previous node
                let should_update = if next_cost < current_best {
                    true
                } else if next_cost == current_best && current_best < u64::MAX {
                    if let Some(p) = prev.get(&edge.target) {
                        node_id < p.prev_node
                    } else {
                        false
                    }
                } else {
                    false
                };

                if should_update {
                    dist.insert(edge.target.clone(), next_cost);
                    prev.insert(
                        edge.target.clone(),
                        Predecessor {
                            prev_node: node_id.clone(),
                        },
                    );
                    heap.push(HeapState {
                        cost: next_cost,
                        node_id: edge.target.clone(),
                    });
                }
            }
        }
    }

    // Build routing table entries
    let mut entries = Vec::new();
    let mut sorted_destinations: Vec<_> = graph.nodes.keys().cloned().collect();
    sorted_destinations.sort();

    for dest_id in sorted_destinations {
        let dest_node = graph.nodes.get(&dest_id).unwrap();
        let cost = *dist.get(&dest_id).unwrap_or(&u64::MAX);

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
                protocol: "Dijkstra".to_string(),
            });
            continue;
        }

        // Reconstruct physical path backwards from dest_id to source_node_id
        let mut physical_path = Vec::new();
        let mut curr = dest_id.clone();
        physical_path.push(curr.clone());

        while curr != source_node_id {
            if let Some(p) = prev.get(&curr) {
                curr = p.prev_node.clone();
                physical_path.push(curr.clone());
            } else {
                break;
            }
        }
        physical_path.reverse();

        // Normalize physical path to Layer 3 routing path (intermediate L2 switches omitted from L3 hops)
        let l3_path = graph.normalize_to_l3_path(&physical_path);

        // Next-hop at Layer 3 is the first L3 device after source
        let next_hop = if l3_path.len() >= 2 {
            Some(l3_path[1].clone())
        } else {
            None
        };

        // Outbound interface is the physical interface on source node that connects to the first physical hop
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
            next_hop,
            interface_id: egress_interface,
            metric: cost,
            path: l3_path,
            is_reachable: true,
            protocol: "Dijkstra".to_string(),
        });
    }

    Ok(RoutingTable {
        node_id: source_node_id.to_string(),
        node_label: source_node.label.clone(),
        algorithm: "Dijkstra (Link-State)".to_string(),
        metric_type: format!("{:?}", graph.metric_type),
        entries,
    })
}
