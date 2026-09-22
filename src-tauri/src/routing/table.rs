use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteTableEntry {
    pub destination: String,
    pub destination_label: String,
    pub next_hop: Option<String>,
    pub interface_id: Option<String>,
    pub metric: u64,
    pub path: Vec<String>,
    pub is_reachable: bool,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingTable {
    pub node_id: String,
    pub node_label: String,
    pub algorithm: String,
    pub metric_type: String,
    pub entries: Vec<RouteTableEntry>,
}
