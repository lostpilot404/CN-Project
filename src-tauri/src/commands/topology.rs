use crate::domain::{
    Interface, InterfaceStatus, Link, LinkEndpoint, LinkStatus, Node, NodeState, NodeType,
    Position, Project,
};
use crate::error::{NetSimError, Result};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryStatus {
    pub can_undo: bool,
    pub can_redo: bool,
}

#[tauri::command]
pub fn add_node(
    id: Option<String>,
    label: String,
    node_type: NodeType,
    x: f64,
    y: f64,
    state: State<'_, AppState>,
) -> Result<Node> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    let node_id = match id {
        Some(explicit_id) => {
            if proj.nodes.iter().any(|n| n.id == explicit_id) {
                return Err(NetSimError::DuplicateId(format!(
                    "Node with ID '{}' already exists",
                    explicit_id
                )));
            }
            explicit_id
        }
        None => {
            let mut counter = proj.nodes.len() + 1;
            loop {
                let candidate = format!("node-{}", counter);
                if !proj.nodes.iter().any(|n| n.id == candidate) {
                    break candidate;
                }
                counter += 1;
            }
        }
    };

    let node_label = if label.trim().is_empty() {
        format!("{:?} {}", node_type, node_id)
    } else {
        label
    };

    history.push_undo(proj.clone());

    let node = Node::new(node_id, node_label, node_type, Position { x, y });
    proj.nodes.push(node.clone());
    Ok(node)
}

#[tauri::command]
pub fn update_node(
    node_id: String,
    label: Option<String>,
    node_state: Option<NodeState>,
    position: Option<Position>,
    state: State<'_, AppState>,
) -> Result<Node> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    if !proj.nodes.iter().any(|n| n.id == node_id) {
        return Err(NetSimError::NodeNotFound(node_id));
    }

    history.push_undo(proj.clone());

    let node = proj
        .nodes
        .iter_mut()
        .find(|n| n.id == node_id)
        .ok_or_else(|| NetSimError::NodeNotFound(node_id.clone()))?;

    if let Some(lbl) = label {
        node.label = lbl;
    }
    if let Some(st) = node_state {
        node.state = st;
    }
    if let Some(pos) = position {
        node.position = pos;
    }

    Ok(node.clone())
}

#[tauri::command]
pub fn remove_node(node_id: String, state: State<'_, AppState>) -> Result<()> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    if !proj.nodes.iter().any(|n| n.id == node_id) {
        return Err(NetSimError::NodeNotFound(node_id));
    }

    history.push_undo(proj.clone());

    // Identify all links connected to this node
    let links_to_remove: Vec<String> = proj
        .links
        .iter()
        .filter(|l| l.source.node_id == node_id || l.target.node_id == node_id)
        .map(|l| l.id.clone())
        .collect();

    // Detach these links from remaining nodes
    for link_id in &links_to_remove {
        for node in &mut proj.nodes {
            node.detach_link(link_id);
        }
    }

    // Remove the links
    proj.links.retain(|l| !links_to_remove.contains(&l.id));

    // Remove the node
    proj.nodes.retain(|n| n.id != node_id);

    // Sync authoritative links to simulation engine
    sim.update_links(&proj.links);

    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn add_link(
    id: Option<String>,
    source_node_id: String,
    source_interface_id: Option<String>,
    target_node_id: String,
    target_interface_id: Option<String>,
    bandwidth_bps: Option<u64>,
    propagation_delay_us: Option<u64>,
    loss_probability: Option<f64>,
    bit_error_rate: Option<f64>,
    queue_capacity: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Link> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    if source_node_id == target_node_id {
        return Err(NetSimError::InvalidConnection(
            "Cannot connect a node to itself".to_string(),
        ));
    }

    // Validate link ID if provided
    let link_id = match id {
        Some(explicit_id) => {
            if proj.links.iter().any(|l| l.id == explicit_id) {
                return Err(NetSimError::DuplicateId(format!(
                    "Link with ID '{}' already exists",
                    explicit_id
                )));
            }
            explicit_id
        }
        None => {
            let mut counter = proj.links.len() + 1;
            loop {
                let candidate = format!("link-{}-{}-{}", source_node_id, target_node_id, counter);
                if !proj.links.iter().any(|l| l.id == candidate) {
                    break candidate;
                }
                counter += 1;
            }
        }
    };

    // Find and validate source interface
    let src_node = proj
        .nodes
        .iter()
        .find(|n| n.id == source_node_id)
        .ok_or_else(|| NetSimError::NodeNotFound(source_node_id.clone()))?;

    let src_iface = match &source_interface_id {
        Some(iface_id) => src_node
            .interfaces
            .iter()
            .find(|i| &i.id == iface_id || &i.name == iface_id)
            .ok_or_else(|| {
                NetSimError::InvalidConnection(format!(
                    "Interface '{}' not found on node '{}'",
                    iface_id, source_node_id
                ))
            })?,
        None => src_node.first_free_interface().ok_or_else(|| {
            NetSimError::InvalidConnection(format!(
                "No free interface available on source node '{}'",
                source_node_id
            ))
        })?,
    };

    if let Some(existing_link) = &src_iface.link_id {
        return Err(NetSimError::InvalidConnection(format!(
            "Interface '{}' on node '{}' is already connected to link '{}'",
            src_iface.id, source_node_id, existing_link
        )));
    }
    let actual_src_iface_id = src_iface.id.clone();

    // Find and validate target interface
    let tgt_node = proj
        .nodes
        .iter()
        .find(|n| n.id == target_node_id)
        .ok_or_else(|| NetSimError::NodeNotFound(target_node_id.clone()))?;

    let tgt_iface = match &target_interface_id {
        Some(iface_id) => tgt_node
            .interfaces
            .iter()
            .find(|i| &i.id == iface_id || &i.name == iface_id)
            .ok_or_else(|| {
                NetSimError::InvalidConnection(format!(
                    "Interface '{}' not found on node '{}'",
                    iface_id, target_node_id
                ))
            })?,
        None => tgt_node.first_free_interface().ok_or_else(|| {
            NetSimError::InvalidConnection(format!(
                "No free interface available on target node '{}'",
                target_node_id
            ))
        })?,
    };

    if let Some(existing_link) = &tgt_iface.link_id {
        return Err(NetSimError::InvalidConnection(format!(
            "Interface '{}' on node '{}' is already connected to link '{}'",
            tgt_iface.id, target_node_id, existing_link
        )));
    }
    let actual_tgt_iface_id = tgt_iface.id.clone();

    // Construct and validate link properties
    let mut link = Link::new(
        link_id.clone(),
        LinkEndpoint {
            node_id: source_node_id.clone(),
            interface_id: actual_src_iface_id.clone(),
        },
        LinkEndpoint {
            node_id: target_node_id.clone(),
            interface_id: actual_tgt_iface_id.clone(),
        },
    );

    if let Some(bw) = bandwidth_bps {
        link.bandwidth_bps = bw;
    }
    if let Some(delay) = propagation_delay_us {
        link.propagation_delay_us = delay;
    }
    if let Some(loss) = loss_probability {
        link.loss_probability = loss;
    }
    if let Some(ber) = bit_error_rate {
        link.bit_error_rate = ber;
    }
    if let Some(q) = queue_capacity {
        link.queue_capacity = q;
    }

    link.validate()?;

    // Push undo snapshot
    history.push_undo(proj.clone());

    // Attach link to both interfaces
    if let Some(node) = proj.nodes.iter_mut().find(|n| n.id == source_node_id) {
        node.attach_link(&actual_src_iface_id, &link_id)?;
    }
    if let Some(node) = proj.nodes.iter_mut().find(|n| n.id == target_node_id) {
        node.attach_link(&actual_tgt_iface_id, &link_id)?;
    }

    proj.links.push(link.clone());

    // Sync authoritative links to simulation engine
    sim.update_links(&proj.links);

    Ok(link)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_link(
    link_id: String,
    bandwidth_bps: Option<u64>,
    propagation_delay_us: Option<u64>,
    loss_probability: Option<f64>,
    bit_error_rate: Option<f64>,
    queue_capacity: Option<usize>,
    status: Option<LinkStatus>,
    state: State<'_, AppState>,
) -> Result<Link> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    let link_index = proj
        .links
        .iter()
        .position(|l| l.id == link_id)
        .ok_or_else(|| NetSimError::LinkNotFound(link_id.clone()))?;

    let mut candidate = proj.links[link_index].clone();
    if let Some(bw) = bandwidth_bps {
        candidate.bandwidth_bps = bw;
    }
    if let Some(delay) = propagation_delay_us {
        candidate.propagation_delay_us = delay;
    }
    if let Some(loss) = loss_probability {
        candidate.loss_probability = loss;
    }
    if let Some(ber) = bit_error_rate {
        candidate.bit_error_rate = ber;
    }
    if let Some(q) = queue_capacity {
        candidate.queue_capacity = q;
    }
    if let Some(st) = status {
        candidate.status = st;
    }

    candidate.validate()?;

    history.push_undo(proj.clone());

    proj.links[link_index] = candidate.clone();

    // Sync authoritative links to simulation engine
    sim.update_links(&proj.links);

    Ok(candidate)
}

#[tauri::command]
pub fn remove_link(link_id: String, state: State<'_, AppState>) -> Result<()> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    if !proj.links.iter().any(|l| l.id == link_id) {
        return Err(NetSimError::LinkNotFound(link_id));
    }

    history.push_undo(proj.clone());

    for node in &mut proj.nodes {
        node.detach_link(&link_id);
    }

    proj.links.retain(|l| l.id != link_id);

    // Sync authoritative links to simulation engine
    sim.update_links(&proj.links);

    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_interface(
    node_id: String,
    interface_id: String,
    ipv4: Option<String>,
    subnet_mask: Option<String>,
    ipv6: Option<String>,
    mac_address: Option<String>,
    status: Option<InterfaceStatus>,
    state: State<'_, AppState>,
) -> Result<Interface> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    // Validate IPv4 format if provided
    if let Some(ref ip_str) = ipv4 {
        if !ip_str.trim().is_empty() {
            ip_str.parse::<Ipv4Addr>().map_err(|_| {
                NetSimError::AddressingError(format!("Invalid IPv4 address format: '{}'", ip_str))
            })?;
        }
    }

    // Validate Subnet mask format if provided
    if let Some(ref mask_str) = subnet_mask {
        if !mask_str.trim().is_empty() {
            mask_str.parse::<Ipv4Addr>().map_err(|_| {
                NetSimError::AddressingError(format!("Invalid Subnet Mask format: '{}'", mask_str))
            })?;
        }
    }

    let node = proj
        .nodes
        .iter()
        .find(|n| n.id == node_id)
        .ok_or_else(|| NetSimError::NodeNotFound(node_id.clone()))?;

    if !node
        .interfaces
        .iter()
        .any(|i| i.id == interface_id || i.name == interface_id)
    {
        return Err(NetSimError::InvalidConnection(format!(
            "Interface '{}' not found on node '{}'",
            interface_id, node_id
        )));
    }

    history.push_undo(proj.clone());

    let node = proj
        .nodes
        .iter_mut()
        .find(|n| n.id == node_id)
        .ok_or_else(|| NetSimError::NodeNotFound(node_id.clone()))?;

    let iface = node
        .interfaces
        .iter_mut()
        .find(|i| i.id == interface_id || i.name == interface_id)
        .ok_or_else(|| {
            NetSimError::InvalidConnection(format!(
                "Interface '{}' not found on node '{}'",
                interface_id, node_id
            ))
        })?;

    if let Some(ip) = ipv4 {
        iface.ipv4 = if ip.trim().is_empty() { None } else { Some(ip) };
    }
    if let Some(mask) = subnet_mask {
        iface.subnet_mask = if mask.trim().is_empty() {
            None
        } else {
            Some(mask)
        };
    }
    if let Some(ip6) = ipv6 {
        iface.ipv6 = if ip6.trim().is_empty() {
            None
        } else {
            Some(ip6)
        };
    }
    if let Some(mac) = mac_address {
        iface.mac_address = mac;
    }
    if let Some(st) = status {
        iface.status = st;
    }

    Ok(iface.clone())
}

#[tauri::command]
pub fn undo_topology(state: State<'_, AppState>) -> Result<Project> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    if history.undo(&mut proj) {
        sim.update_links(&proj.links);
        Ok(proj.clone())
    } else {
        Err(NetSimError::InvalidTopology("Nothing to undo".to_string()))
    }
}

#[tauri::command]
pub fn redo_topology(state: State<'_, AppState>) -> Result<Project> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    if history.redo(&mut proj) {
        sim.update_links(&proj.links);
        Ok(proj.clone())
    } else {
        Err(NetSimError::InvalidTopology("Nothing to redo".to_string()))
    }
}

#[tauri::command]
pub fn get_topology_history_status(state: State<'_, AppState>) -> Result<HistoryStatus> {
    let history = state
        .history
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    Ok(HistoryStatus {
        can_undo: history.can_undo(),
        can_redo: history.can_redo(),
    })
}
