pub mod dns;
pub mod ftp;
pub mod http;
pub mod smtp;
pub mod snmp;

use crate::domain::{
    AppHeader, DataLinkHeader, EncapsulationStack, NetworkHeader, Packet, PacketHopRecord,
    PacketState, PhysicalLayerInfo, TransportHeader,
};
use crate::simulation::clock::SimTime;
use crate::simulation::delays::calculate_tx_delay_us;
use crate::simulation::event::{SimEvent, SimEventType};
use crate::transport::HopLink;
use serde::{Deserialize, Serialize};

/// High-level application protocol identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ApplicationProtocol {
    Dns,
    Http,
    Ftp,
    Smtp,
    Snmp,
}

/// Generic application protocol state for state visualization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppProtocolState {
    Idle,
    QuerySent,
    LookupProcessing,
    ResponseReceived,
    Connecting,
    Connected,
    RequestSent,
    DataTransferring,
    Completed,
    Failed,
    Terminated,
}

/// Structured application-layer event for UI timeline and inspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppProtocolEvent {
    pub step_index: usize,
    pub timestamp_us: u64,
    pub node_id: String,
    pub protocol: String,
    pub event_type: String,
    pub description: String,
    pub packet_id: Option<String>,
    pub session_id: Option<String>,
    pub details: Option<String>,
}

/// Measured application-level metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppProtocolMetrics {
    pub transaction_duration_us: u64,
    pub requests_sent: usize,
    pub responses_received: usize,
    pub payload_bytes_sent: usize,
    pub payload_bytes_received: usize,
    pub success: bool,
    pub error_message: Option<String>,
}

/// Helper to build an authentic 5-layer network Packet and simulate its physical traversal
/// across the multi-hop path and link queues, recording exact hop_history.
#[allow(clippy::too_many_arguments)]
pub fn build_application_packet(
    packet_id: &str,
    src_node: &str,
    dst_node: &str,
    path_nodes: &[String],
    hop_links: &[HopLink],
    app_header: AppHeader,
    transport_protocol: &str,
    src_port: u16,
    dst_port: u16,
    seq_num: Option<u32>,
    ack_num: Option<u32>,
    flags: Vec<String>,
    payload_size: usize,
    start_time_us: u64,
) -> (Packet, u64) {
    let mut curr_time_us = start_time_us;
    let mut hop_history = Vec::new();
    let mut hop_index = 0;

    // Hop 0: Created at source
    hop_history.push(PacketHopRecord {
        hop_index,
        node_id: src_node.to_string(),
        link_id: None,
        timestamp_us: curr_time_us,
        state: PacketState::Created,
        description: format!(
            "{} packet {} created at {}",
            app_header.protocol, packet_id, src_node
        ),
    });
    hop_index += 1;

    let mut current_node = src_node.to_string();
    let mut last_link_info = None;

    for (link_idx, link) in hop_links.iter().enumerate() {
        let is_forward = link.source == current_node;
        let next_node = if is_forward {
            &link.target
        } else {
            &link.source
        };

        // Queueing
        hop_history.push(PacketHopRecord {
            hop_index,
            node_id: current_node.clone(),
            link_id: Some(link.link_id.clone()),
            timestamp_us: curr_time_us,
            state: PacketState::Queued,
            description: format!(
                "Packet {} queued for transmission onto link {}",
                packet_id, link.link_id
            ),
        });
        hop_index += 1;

        // Transmission delay
        let tx_delay = calculate_tx_delay_us(payload_size.max(64), link.bandwidth_bps);
        let prop_delay = link.delay_us;

        last_link_info = Some(PhysicalLayerInfo {
            link_id: Some(link.link_id.clone()),
            bandwidth_bps: Some(link.bandwidth_bps),
            propagation_delay_us: Some(prop_delay),
            tx_start_us: Some(curr_time_us),
            tx_finish_us: Some(curr_time_us + tx_delay),
            bit_count: payload_size * 8,
            preamble_bits: None,
            signal_encoding: None,
        });

        hop_history.push(PacketHopRecord {
            hop_index,
            node_id: current_node.clone(),
            link_id: Some(link.link_id.clone()),
            timestamp_us: curr_time_us,
            state: PacketState::Transmitting,
            description: format!(
                "Packet {} transmission started on link {}",
                packet_id, link.link_id
            ),
        });
        hop_index += 1;

        curr_time_us += tx_delay;

        hop_history.push(PacketHopRecord {
            hop_index,
            node_id: current_node.clone(),
            link_id: Some(link.link_id.clone()),
            timestamp_us: curr_time_us,
            state: PacketState::InFlight,
            description: format!(
                "Packet {} completed transmission onto link {}, in-flight",
                packet_id, link.link_id
            ),
        });
        hop_index += 1;

        curr_time_us += prop_delay;

        let is_last_hop = link_idx == hop_links.len() - 1;
        let arrival_state = if is_last_hop {
            PacketState::Delivered
        } else {
            PacketState::InFlight
        };

        hop_history.push(PacketHopRecord {
            hop_index,
            node_id: next_node.clone(),
            link_id: Some(link.link_id.clone()),
            timestamp_us: curr_time_us,
            state: arrival_state,
            description: if is_last_hop {
                format!(
                    "Packet {} delivered to destination {}",
                    packet_id, next_node
                )
            } else {
                format!(
                    "Packet {} arrived at intermediate router {}",
                    packet_id, next_node
                )
            },
        });
        hop_index += 1;

        current_node = next_node.clone();
    }

    let packet = Packet {
        id: packet_id.to_string(),
        src_node_id: src_node.to_string(),
        dst_node_id: dst_node.to_string(),
        size_bytes: payload_size,
        created_at_us: start_time_us,
        current_node_id: dst_node.to_string(),
        next_hop_node_id: None,
        state: PacketState::Delivered,
        headers: EncapsulationStack {
            application: app_header,
            transport: TransportHeader {
                protocol: transport_protocol.to_string(),
                src_port,
                dst_port,
                seq_num,
                ack_num,
                window_size: if transport_protocol == "TCP" {
                    Some(65535)
                } else {
                    None
                },
                flags,
                payload_length: Some(payload_size),
                is_retransmission: Some(false),
                connection_state: if transport_protocol == "TCP" {
                    Some("established".to_string())
                } else {
                    None
                },
            },
            network: NetworkHeader {
                version: 4,
                src_ip: format!("10.0.0.{}", src_node.len() + 1),
                dst_ip: format!("10.0.0.{}", dst_node.len() + 10),
                ttl: 64,
                protocol_num: if transport_protocol == "TCP" { 6 } else { 17 },
                checksum: 0x4f12,
            },
            datalink: DataLinkHeader {
                src_mac: "02:00:00:00:00:01".to_string(),
                dst_mac: "02:00:00:00:00:02".to_string(),
                ether_type: 0x0800,
                crc_fcs: 0x89abcdef,
                frame_type: Some("Ethernet II".to_string()),
                fcs_valid: Some(true),
            },
            physical: last_link_info,
        },
        journey_hops: path_nodes.to_vec(),
        planned_route: path_nodes.to_vec(),
        hop_history,
    };

    (packet, curr_time_us)
}

/// Converts an AppProtocolEvent into a standard SimEvent.
pub fn app_event_to_sim_event(id: u64, ev: &AppProtocolEvent) -> SimEvent {
    SimEvent {
        id,
        timestamp: SimTime::from_micros(ev.timestamp_us),
        event_type: SimEventType::ApplicationEvent {
            protocol: ev.protocol.clone(),
            event_name: ev.event_type.clone(),
            node_id: ev.node_id.clone(),
            packet_id: ev.packet_id.clone(),
            session_id: ev.session_id.clone(),
            details: ev.details.clone().unwrap_or_else(|| ev.description.clone()),
        },
        description: ev.description.clone(),
        packet_id: ev.packet_id.clone(),
        node_id: Some(ev.node_id.clone()),
        link_id: None,
        layer: Some("Application".to_string()),
        protocol: Some(ev.protocol.clone()),
    }
}
