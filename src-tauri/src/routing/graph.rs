use crate::domain::{LinkStatus, Node, NodeType, Project};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricType {
    HopCount,
    PropagationDelay,
    InverseBandwidth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutingAlgorithm {
    Dijkstra,
    BellmanFord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub link_id: String,
    pub source: String,
    pub target: String,
    pub source_interface_id: String,
    pub target_interface_id: String,
    pub metric: u64,
    pub bandwidth_bps: u64,
    pub delay_us: u64,
    pub status: LinkStatus,
}

#[derive(Debug, Clone)]
pub struct RoutingGraph {
    pub nodes: HashMap<String, Node>,
    pub adjacency: HashMap<String, Vec<GraphEdge>>,
    pub metric_type: MetricType,
}

impl RoutingGraph {
    /// Builds an authoritative routing graph from a Project state.
    ///
    /// Clarifications enforced:
    /// 1. Physical topology links are bidirectional by default, producing A->B and B->A edges.
    /// 2. Link status:
    ///    - Up: normal metric.
    ///    - Degraded: deterministic penalty = (base * 3).max(base + 50).
    ///    - Down: excluded from routing adjacency.
    /// 3. Inverse-bandwidth metric = ceil(1_000_000_000 / bandwidth_bps), minimum 1.
    pub fn from_project(project: &Project, metric_type: MetricType) -> Self {
        let mut nodes = HashMap::new();
        let mut adjacency: HashMap<String, Vec<GraphEdge>> = HashMap::new();

        for node in &project.nodes {
            nodes.insert(node.id.clone(), node.clone());
            adjacency.insert(node.id.clone(), Vec::new());
        }

        for link in &project.links {
            // Down links are completely excluded from routing
            if link.status == LinkStatus::Down {
                continue;
            }

            // Both endpoint nodes must exist
            if !nodes.contains_key(&link.source.node_id)
                || !nodes.contains_key(&link.target.node_id)
            {
                continue;
            }

            let base_metric = match metric_type {
                MetricType::HopCount => 1u64,
                MetricType::PropagationDelay => link.propagation_delay_us.max(1),
                MetricType::InverseBandwidth => {
                    let bw = link.bandwidth_bps.max(1);
                    // Ceil(1_000_000_000 / bw), minimum 1
                    let metric = 1_000_000_000u64.div_ceil(bw);
                    metric.max(1)
                }
            };

            // Deterministic penalty for Degraded links
            let effective_metric = match link.status {
                LinkStatus::Up => base_metric,
                LinkStatus::Degraded => {
                    (base_metric.saturating_mul(3)).max(base_metric.saturating_add(50))
                }
                LinkStatus::Down => unreachable!(),
            };

            // Edge A -> B
            adjacency
                .entry(link.source.node_id.clone())
                .or_default()
                .push(GraphEdge {
                    link_id: link.id.clone(),
                    source: link.source.node_id.clone(),
                    target: link.target.node_id.clone(),
                    source_interface_id: link.source.interface_id.clone(),
                    target_interface_id: link.target.interface_id.clone(),
                    metric: effective_metric,
                    bandwidth_bps: link.bandwidth_bps,
                    delay_us: link.propagation_delay_us,
                    status: link.status,
                });

            // Edge B -> A (bidirectional physical link)
            adjacency
                .entry(link.target.node_id.clone())
                .or_default()
                .push(GraphEdge {
                    link_id: link.id.clone(),
                    source: link.target.node_id.clone(),
                    target: link.source.node_id.clone(),
                    source_interface_id: link.target.interface_id.clone(),
                    target_interface_id: link.source.interface_id.clone(),
                    metric: effective_metric,
                    bandwidth_bps: link.bandwidth_bps,
                    delay_us: link.propagation_delay_us,
                    status: link.status,
                });
        }

        Self {
            nodes,
            adjacency,
            metric_type,
        }
    }

    /// Determines if a node is allowed to forward Layer 3 transit traffic.
    ///
    /// Rules enforced:
    /// - Router = L3 routing device and may act as a transit hop.
    /// - PC, Server, Generic Host = end devices and cannot act as L3 transit routers.
    /// - Switch = Layer 2 device by default and must NOT act as an L3 transit router.
    /// - AccessPoint = Layer 2 wireless bridge by default and cannot act as an L3 transit router.
    ///
    /// Extensibility: If a future L3-capable switch mode is enabled, it can be checked here,
    /// but remains disabled by default.
    pub fn is_l3_transit_capable(&self, node_id: &str) -> bool {
        if let Some(node) = self.nodes.get(node_id) {
            match node.node_type {
                NodeType::Router => true,
                NodeType::Switch => {
                    // Extensible: future L3-capable switch mode disabled by default
                    false
                }
                NodeType::AccessPoint | NodeType::Pc | NodeType::Server | NodeType::Generic => {
                    false
                }
            }
        } else {
            false
        }
    }

    /// Backwards-compatible alias for is_l3_transit_capable
    pub fn is_transit_capable(&self, node_id: &str) -> bool {
        self.is_l3_transit_capable(node_id)
    }

    /// Determines if an L3 routing table can be generated for this node.
    /// Routers receive routing tables. L2 switches, APs, and end hosts do not.
    pub fn is_routing_device(&self, node_id: &str) -> bool {
        if let Some(node) = self.nodes.get(node_id) {
            match node.node_type {
                NodeType::Router => true,
                NodeType::Switch
                | NodeType::AccessPoint
                | NodeType::Pc
                | NodeType::Server
                | NodeType::Generic => false,
            }
        } else {
            false
        }
    }

    /// Determines if a node acts as a Layer 2 transparent forwarding device (e.g. standard Switch).
    ///
    /// Layer 2 devices forward frames across their interfaces within a physical/L2 broadcast domain,
    /// providing L2 connectivity between connected devices without terminating or routing IP packets.
    /// They do NOT act as Layer 3 routers and do NOT receive Layer 3 routing tables.
    pub fn is_l2_transparent_forwarder(&self, node_id: &str) -> bool {
        if let Some(node) = self.nodes.get(node_id) {
            match node.node_type {
                NodeType::Switch => true,
                // AccessPoint is currently modeled as not forwarding by default (extensible)
                NodeType::AccessPoint => false,
                NodeType::Router | NodeType::Pc | NodeType::Server | NodeType::Generic => false,
            }
        } else {
            false
        }
    }

    /// Determines if a node is allowed to forward connectivity/traffic in graph traversal.
    ///
    /// Allowed forwarders:
    /// - Layer 3 transit-capable routers (`NodeType::Router`)
    /// - Layer 2 transparent forwarding switches (`NodeType::Switch`)
    ///
    /// Prohibited forwarders:
    /// - Terminal end hosts (`Pc`, `Server`, `Generic`) cannot act as transit devices.
    pub fn can_forward_traffic(&self, node_id: &str) -> bool {
        self.is_l3_transit_capable(node_id) || self.is_l2_transparent_forwarder(node_id)
    }

    /// Normalizes a physical topology hop sequence into an authoritative Layer 3 routing path.
    ///
    /// In an L3 routing table:
    /// - The source router and destination node are always preserved.
    /// - Intermediate L3 transit routers are preserved as routing hops.
    /// - Intermediate Layer 2 transparent forwarders (e.g. Switches) are omitted from the L3 hop list,
    ///   ensuring that switches are NOT falsely classified as L3 routing hops.
    pub fn normalize_to_l3_path(&self, physical_path: &[String]) -> Vec<String> {
        if physical_path.is_empty() {
            return Vec::new();
        }
        if physical_path.len() <= 2 {
            return physical_path.to_vec();
        }

        let last_idx = physical_path.len() - 1;
        physical_path
            .iter()
            .enumerate()
            .filter(|(idx, hop)| {
                // Keep the source (first) and final destination (last).
                // Filter out intermediate L2 transparent forwarders.
                if *idx == 0 || *idx == last_idx {
                    true
                } else {
                    !self.is_l2_transparent_forwarder(hop)
                }
            })
            .map(|(_, hop)| hop.clone())
            .collect()
    }
}
