use super::interface::Interface;
use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Pc,
    Server,
    Router,
    Switch,
    AccessPoint,
    Generic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeState {
    Up,
    Down,
    Degraded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub node_type: NodeType,
    pub position: Position,
    pub interfaces: Vec<Interface>,
    pub state: NodeState,
}

impl Node {
    pub fn new(id: String, label: String, node_type: NodeType, position: Position) -> Self {
        let mut node = Self {
            id,
            label,
            node_type,
            position,
            interfaces: Vec::new(),
            state: NodeState::Up,
        };
        node.interfaces = node.generate_default_interfaces();
        node
    }

    pub fn generate_default_interfaces(&self) -> Vec<Interface> {
        let hash = self
            .id
            .bytes()
            .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));
        let mac_prefix = format!("{:02x}:{:02x}", (hash >> 8) & 0xff, hash & 0xff);

        match self.node_type {
            NodeType::Pc => {
                let mut iface = Interface::new(
                    format!("{}-eth0", self.id),
                    "eth0".to_string(),
                    self.id.clone(),
                    format!("02:00:00:01:{}", mac_prefix),
                );
                iface.ipv4 = Some("192.168.1.10".to_string());
                iface.subnet_mask = Some("255.255.255.0".to_string());
                vec![iface]
            }
            NodeType::Server => {
                let mut iface = Interface::new(
                    format!("{}-eth0", self.id),
                    "eth0".to_string(),
                    self.id.clone(),
                    format!("02:00:00:02:{}", mac_prefix),
                );
                iface.ipv4 = Some("10.0.0.100".to_string());
                iface.subnet_mask = Some("255.255.255.0".to_string());
                vec![iface]
            }
            NodeType::Router => (0..4)
                .map(|i| {
                    let mut iface = Interface::new(
                        format!("{}-eth{}", self.id, i),
                        format!("eth{}", i),
                        self.id.clone(),
                        format!("02:00:00:03:{}:{:02x}", (hash & 0xff), i),
                    );
                    iface.ipv4 = Some(format!("10.{}.1.1", i));
                    iface.subnet_mask = Some("255.255.255.0".to_string());
                    iface
                })
                .collect(),
            NodeType::Switch => (1..=8)
                .map(|i| {
                    Interface::new(
                        format!("{}-port{}", self.id, i),
                        format!("port{}", i),
                        self.id.clone(),
                        format!("02:00:00:04:{}:{:02x}", (hash & 0xff), i),
                    )
                })
                .collect(),
            NodeType::AccessPoint => vec![
                Interface::new(
                    format!("{}-eth0", self.id),
                    "eth0".to_string(),
                    self.id.clone(),
                    format!("02:00:00:05:{}:01", hash & 0xff),
                ),
                Interface::new(
                    format!("{}-wlan0", self.id),
                    "wlan0".to_string(),
                    self.id.clone(),
                    format!("02:00:00:05:{}:02", hash & 0xff),
                ),
            ],
            NodeType::Generic => vec![
                Interface::new(
                    format!("{}-eth0", self.id),
                    "eth0".to_string(),
                    self.id.clone(),
                    format!("02:00:00:06:{}:01", hash & 0xff),
                ),
                Interface::new(
                    format!("{}-eth1", self.id),
                    "eth1".to_string(),
                    self.id.clone(),
                    format!("02:00:00:06:{}:02", hash & 0xff),
                ),
            ],
        }
    }

    pub fn first_free_interface(&self) -> Option<&Interface> {
        self.interfaces.iter().find(|i| i.link_id.is_none())
    }

    pub fn attach_link(&mut self, interface_id: &str, link_id: &str) -> Result<()> {
        if let Some(iface) = self
            .interfaces
            .iter_mut()
            .find(|i| i.id == interface_id || i.name == interface_id)
        {
            if let Some(existing) = &iface.link_id {
                if existing != link_id {
                    return Err(NetSimError::InvalidConnection(format!(
                        "Interface '{}' on node '{}' is already connected to link '{}'",
                        interface_id, self.id, existing
                    )));
                }
            }
            iface.link_id = Some(link_id.to_string());
            Ok(())
        } else {
            Err(NetSimError::InvalidConnection(format!(
                "Interface '{}' not found on node '{}'",
                interface_id, self.id
            )))
        }
    }

    pub fn detach_link(&mut self, link_id: &str) {
        for iface in &mut self.interfaces {
            if iface.link_id.as_deref() == Some(link_id) {
                iface.link_id = None;
            }
        }
    }
}
