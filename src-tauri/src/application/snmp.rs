use super::{
    app_event_to_sim_event, build_application_packet, AppProtocolEvent, AppProtocolMetrics,
    AppProtocolState,
};
use crate::domain::{AppHeader, Packet, Project};
use crate::error::Result;
use crate::simulation::event::SimEvent;
use crate::transport::{resolve_route_and_links, HopLink, TransportConfig, TransportProtocol};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MibObject {
    pub oid: String,
    pub name: String,
    pub syntax: String,
    pub value: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpConfig {
    pub manager_node_id: String,
    pub agent_node_id: String,
    pub community: String,
    pub requested_oid: String,
    #[serde(default = "default_snmp_port")]
    pub port: u16,
    #[serde(default = "default_seed")]
    pub seed: u64,
}

fn default_snmp_port() -> u16 {
    161
}

fn default_seed() -> u64 {
    42
}

impl Default for SnmpConfig {
    fn default() -> Self {
        Self {
            manager_node_id: "nms-manager".to_string(),
            agent_node_id: "router-core".to_string(),
            community: "public".to_string(),
            requested_oid: "1.3.6.1.2.1.1.1.0".to_string(),
            port: 161,
            seed: 42,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpSimResult {
    pub config: SnmpConfig,
    pub state: AppProtocolState,
    pub found_object: Option<MibObject>,
    pub events: Vec<AppProtocolEvent>,
    pub sim_events: Vec<SimEvent>,
    pub packets: Vec<Packet>,
    pub metrics: AppProtocolMetrics,
}

/// Educational MIB-2 tree objects available on network devices.
pub fn get_default_mib_tree() -> Vec<MibObject> {
    vec![
        MibObject {
            oid: "1.3.6.1.2.1.1.1.0".to_string(),
            name: "sysDescr.0".to_string(),
            syntax: "DisplayString".to_string(),
            value: "NetSim CoreOS Router v2.4 (x86_64, Educational Edition)".to_string(),
            description: "A textual description of the network entity.".to_string(),
        },
        MibObject {
            oid: "1.3.6.1.2.1.1.3.0".to_string(),
            name: "sysUpTime.0".to_string(),
            syntax: "TimeTicks".to_string(),
            value: "1248900 (3 hours, 28 minutes, 9 seconds)".to_string(),
            description: "The time since the network management portion was initialized."
                .to_string(),
        },
        MibObject {
            oid: "1.3.6.1.2.1.1.5.0".to_string(),
            name: "sysName.0".to_string(),
            syntax: "DisplayString".to_string(),
            value: "Gateway-R1.internal".to_string(),
            description: "An administratively-assigned name for this managed node.".to_string(),
        },
        MibObject {
            oid: "1.3.6.1.2.1.2.2.1.10.1".to_string(),
            name: "ifInOctets.1".to_string(),
            syntax: "Counter32".to_string(),
            value: "849203948".to_string(),
            description: "The total number of octets received on interface eth0.".to_string(),
        },
        MibObject {
            oid: "1.3.6.1.2.1.2.2.1.16.1".to_string(),
            name: "ifOutOctets.1".to_string(),
            syntax: "Counter32".to_string(),
            value: "729482109".to_string(),
            description: "The total number of octets transmitted out of interface eth0."
                .to_string(),
        },
    ]
}

/// Simulates educational SNMP manager/agent polling workflow over authoritative UDP transport.
pub fn simulate_snmp(config: SnmpConfig, project: Option<&Project>) -> Result<SnmpSimResult> {
    let mut events = Vec::new();
    let mut packets = Vec::new();
    let mut step_index = 0;
    let mut curr_time_us: u64 = 0;

    let transport_cfg = TransportConfig {
        protocol: TransportProtocol::Udp,
        source_node_id: config.manager_node_id.clone(),
        destination_node_id: config.agent_node_id.clone(),
        source_port: 54161,
        destination_port: config.port,
        payload_bytes: 84,
        segment_size_bytes: 512,
        initial_sequence_number: 1,
        initial_cwnd_mss: 1.0,
        initial_ssthresh_mss: 16.0,
        initial_rto_us: 100_000,
        receive_window_bytes: 4096,
        seed: config.seed,
        dropped_segments: Vec::new(),
        maximum_retries: 0,
    };

    let (path_nodes, hop_links) = resolve_route_and_links(&transport_cfg, project)?;
    let return_nodes: Vec<String> = path_nodes.iter().cloned().rev().collect();
    let return_links: Vec<HopLink> = hop_links.iter().cloned().rev().collect();

    // 1. Manager sends GetRequest PDU
    let req_pkt_id = "pkt-snmp-get-req".to_string();
    let (req_pkt, req_arr_us) = build_application_packet(
        &req_pkt_id,
        &config.manager_node_id,
        &config.agent_node_id,
        &path_nodes,
        &hop_links,
        AppHeader {
            protocol: "SNMP".to_string(),
            payload_preview: format!(
                "GetRequest OID: {} (Community: {})",
                config.requested_oid, config.community
            ),
            message_type: Some("GetRequest".to_string()),
            session_id: Some(format!("snmp-{}", config.port)),
            transaction_id: Some(101),
            resource_or_command: Some(config.requested_oid.clone()),
            status_code: None,
        },
        "UDP",
        54161,
        config.port,
        None,
        None,
        Vec::new(),
        84,
        curr_time_us,
    );

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.manager_node_id.clone(),
        protocol: "SNMP".to_string(),
        event_type: "SNMP_GET_REQUEST".to_string(),
        description: format!(
            "Manager {} sent GetRequest for OID '{}' to agent {}",
            config.manager_node_id, config.requested_oid, config.agent_node_id
        ),
        packet_id: Some(req_pkt_id),
        session_id: Some(format!("snmp-{}", config.port)),
        details: Some(format!("Community: {}", config.community)),
    });
    step_index += 1;
    packets.push(req_pkt);
    curr_time_us = req_arr_us;

    // 2. Agent evaluates MIB tree (pure application event)
    curr_time_us += 30;
    let mib_tree = get_default_mib_tree();
    let matched = mib_tree.into_iter().find(|m| m.oid == config.requested_oid);

    let (response_str, found_obj, is_error) = match matched {
        Some(obj) => {
            events.push(AppProtocolEvent {
                step_index,
                timestamp_us: curr_time_us,
                node_id: config.agent_node_id.clone(),
                protocol: "SNMP".to_string(),
                event_type: "SNMP_AGENT_LOOKUP".to_string(),
                description: format!(
                    "Agent {} located MIB object '{}' = '{}'",
                    config.agent_node_id, obj.name, obj.value
                ),
                packet_id: None,
                session_id: Some(format!("snmp-{}", config.port)),
                details: Some(format!(
                    "Syntax: {}, Description: {}",
                    obj.syntax, obj.description
                )),
            });
            step_index += 1;
            (format!("{} = {}", obj.name, obj.value), Some(obj), false)
        }
        None => {
            events.push(AppProtocolEvent {
                step_index,
                timestamp_us: curr_time_us,
                node_id: config.agent_node_id.clone(),
                protocol: "SNMP".to_string(),
                event_type: "SNMP_UNKNOWN_OID".to_string(),
                description: format!(
                    "Agent {}: requested OID '{}' is unknown (noSuchName / noSuchObject)",
                    config.agent_node_id, config.requested_oid
                ),
                packet_id: None,
                session_id: Some(format!("snmp-{}", config.port)),
                details: Some("Error status: noSuchName (2)".to_string()),
            });
            step_index += 1;
            ("error: noSuchName".to_string(), None, true)
        }
    };

    // 3. Agent sends GetResponse PDU back to Manager
    let resp_pkt_id = "pkt-snmp-get-resp".to_string();
    let status_code_str = if is_error { "noSuchName" } else { "noError" };

    let (resp_pkt, resp_arr_us) = build_application_packet(
        &resp_pkt_id,
        &config.agent_node_id,
        &config.manager_node_id,
        &return_nodes,
        &return_links,
        AppHeader {
            protocol: "SNMP".to_string(),
            payload_preview: format!("GetResponse: {}", response_str),
            message_type: Some("GetResponse".to_string()),
            session_id: Some(format!("snmp-{}", config.port)),
            transaction_id: Some(101),
            resource_or_command: Some(config.requested_oid.clone()),
            status_code: Some(status_code_str.to_string()),
        },
        "UDP",
        config.port,
        54161,
        None,
        None,
        Vec::new(),
        112,
        curr_time_us,
    );

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.agent_node_id.clone(),
        protocol: "SNMP".to_string(),
        event_type: "SNMP_GET_RESPONSE".to_string(),
        description: format!(
            "Agent dispatched GetResponse ({}) to {}",
            status_code_str, config.manager_node_id
        ),
        packet_id: Some(resp_pkt_id),
        session_id: Some(format!("snmp-{}", config.port)),
        details: Some(format!("Result payload: {}", response_str)),
    });
    step_index += 1;
    packets.push(resp_pkt);
    curr_time_us = resp_arr_us;

    // 4. Manager receives response
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.manager_node_id.clone(),
        protocol: "SNMP".to_string(),
        event_type: "SNMP_RESPONSE_RECEIVED".to_string(),
        description: format!(
            "Manager received SNMP response: {}",
            if is_error {
                "noSuchName error"
            } else {
                &response_str
            }
        ),
        packet_id: None,
        session_id: Some(format!("snmp-{}", config.port)),
        details: Some(format!("Round-trip time: {} µs", curr_time_us)),
    });

    let sim_events = events
        .iter()
        .enumerate()
        .map(|(idx, ev)| app_event_to_sim_event(idx as u64 + 1, ev))
        .collect();

    let state = if is_error {
        AppProtocolState::Failed
    } else {
        AppProtocolState::Completed
    };

    let metrics = AppProtocolMetrics {
        transaction_duration_us: curr_time_us,
        requests_sent: 1,
        responses_received: 1,
        payload_bytes_sent: 84,
        payload_bytes_received: 112,
        success: !is_error,
        error_message: if is_error {
            Some(format!(
                "OID '{}' is not present in MIB (noSuchName)",
                config.requested_oid
            ))
        } else {
            None
        },
    };

    Ok(SnmpSimResult {
        config,
        state,
        found_object: found_obj,
        events,
        sim_events,
        packets,
        metrics,
    })
}
