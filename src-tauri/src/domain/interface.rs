use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceStatus {
    Up,
    Down,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interface {
    pub id: String,
    pub name: String,
    pub node_id: String,
    pub mac_address: String,
    pub ipv4: Option<String>,
    pub subnet_mask: Option<String>,
    pub ipv6: Option<String>,
    pub link_id: Option<String>,
    pub status: InterfaceStatus,
}

impl Interface {
    pub fn new(id: String, name: String, node_id: String, mac_address: String) -> Self {
        Self {
            id,
            name,
            node_id,
            mac_address,
            ipv4: None,
            subnet_mask: None,
            ipv6: None,
            link_id: None,
            status: InterfaceStatus::Up,
        }
    }
}
