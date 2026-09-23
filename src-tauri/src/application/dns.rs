use super::{
    app_event_to_sim_event, build_application_packet, AppProtocolEvent, AppProtocolMetrics,
    AppProtocolState,
};
use crate::domain::{AppHeader, Packet, Project};
use crate::error::Result;
use crate::simulation::event::SimEvent;
use crate::transport::{resolve_route_and_links, HopLink, TransportConfig, TransportProtocol};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum DnsRecordType {
    A,
    Aaaa,
    Cname,
    Mx,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DnsRecord {
    pub name: String,
    pub record_type: DnsRecordType,
    pub value: String,
    pub ttl: u32,
    #[serde(default)]
    pub priority: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DnsQueryMode {
    Recursive,
    Iterative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum DnsResponseCode {
    NoError,
    NxDomain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsConfig {
    pub client_node_id: String,
    pub server_node_id: String,
    #[serde(default)]
    pub auth_server_node_id: Option<String>,
    pub query_name: String,
    pub query_type: DnsRecordType,
    pub query_mode: DnsQueryMode,
    pub query_id: u16,
    #[serde(default)]
    pub custom_records: Vec<DnsRecord>,
    #[serde(default = "default_seed")]
    pub seed: u64,
}

fn default_seed() -> u64 {
    42
}

impl Default for DnsConfig {
    fn default() -> Self {
        Self {
            client_node_id: "host-a".to_string(),
            server_node_id: "dns-resolver".to_string(),
            auth_server_node_id: Some("dns-auth".to_string()),
            query_name: "www.example.com".to_string(),
            query_type: DnsRecordType::A,
            query_mode: DnsQueryMode::Recursive,
            query_id: 1001,
            custom_records: Vec::new(),
            seed: 42,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsSimResult {
    pub config: DnsConfig,
    pub state: AppProtocolState,
    pub response_code: DnsResponseCode,
    pub answers: Vec<DnsRecord>,
    pub events: Vec<AppProtocolEvent>,
    pub sim_events: Vec<SimEvent>,
    pub packets: Vec<Packet>,
    pub metrics: AppProtocolMetrics,
}

/// Returns default educational DNS zone records if none are provided.
pub fn get_default_dns_zone() -> Vec<DnsRecord> {
    vec![
        DnsRecord {
            name: "example.com".to_string(),
            record_type: DnsRecordType::A,
            value: "93.184.216.34".to_string(),
            ttl: 300,
            priority: None,
        },
        DnsRecord {
            name: "www.example.com".to_string(),
            record_type: DnsRecordType::A,
            value: "93.184.216.34".to_string(),
            ttl: 300,
            priority: None,
        },
        DnsRecord {
            name: "ipv6.example.com".to_string(),
            record_type: DnsRecordType::Aaaa,
            value: "2606:2800:220:1:248:1893:25c8:1946".to_string(),
            ttl: 300,
            priority: None,
        },
        DnsRecord {
            name: "mail.example.org".to_string(),
            record_type: DnsRecordType::Mx,
            value: "mailhost.example.org".to_string(),
            ttl: 600,
            priority: Some(10),
        },
        DnsRecord {
            name: "ftp.example.com".to_string(),
            record_type: DnsRecordType::Cname,
            value: "www.example.com".to_string(),
            ttl: 300,
            priority: None,
        },
    ]
}

/// Simulates an educational DNS request/response workflow over authoritative multi-hop UDP.
pub fn simulate_dns(config: DnsConfig, project: Option<&Project>) -> Result<DnsSimResult> {
    let mut zone = get_default_dns_zone();
    zone.extend(config.custom_records.clone());

    let mut events = Vec::new();
    let mut packets = Vec::new();
    let mut step_index = 0;
    let mut curr_time_us: u64 = 0;

    let transport_cfg = TransportConfig {
        protocol: TransportProtocol::Udp,
        source_node_id: config.client_node_id.clone(),
        destination_node_id: config.server_node_id.clone(),
        source_port: 53120,
        destination_port: 53,
        payload_bytes: 64,
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

    // 1. Client creates and sends query
    let query_pkt_id = format!("pkt-dns-q-{}", config.query_id);
    let app_header_q = AppHeader {
        protocol: "DNS".to_string(),
        payload_preview: format!(
            "DNS Standard Query {}: {:?} {}",
            config.query_id, config.query_type, config.query_name
        ),
        message_type: Some("Query".to_string()),
        session_id: Some(format!("dns-{}", config.query_id)),
        transaction_id: Some(config.query_id as u32),
        resource_or_command: Some(format!("{:?} {}", config.query_type, config.query_name)),
        status_code: None,
    };

    let (q_packet, arrival_time_us) = build_application_packet(
        &query_pkt_id,
        &config.client_node_id,
        &config.server_node_id,
        &path_nodes,
        &hop_links,
        app_header_q,
        "UDP",
        53120,
        53,
        None,
        None,
        Vec::new(),
        64,
        curr_time_us,
    );

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "DNS".to_string(),
        event_type: "DNS_QUERY_SENT".to_string(),
        description: format!(
            "Client {} sent {:?} query for '{}' (ID: {}) to resolver {}",
            config.client_node_id,
            config.query_type,
            config.query_name,
            config.query_id,
            config.server_node_id
        ),
        packet_id: Some(query_pkt_id),
        session_id: Some(format!("dns-{}", config.query_id)),
        details: Some(format!(
            "Mode: {:?}, Transmit time: {} µs",
            config.query_mode, curr_time_us
        )),
    });
    step_index += 1;
    packets.push(q_packet);
    curr_time_us = arrival_time_us;

    // 2. Server receives query and performs lookup (pure application event)
    curr_time_us += 50; // local processing delay
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "DNS".to_string(),
        event_type: "DNS_LOOKUP".to_string(),
        description: format!(
            "Resolver {} inspecting local zone database for '{:?} {}'",
            config.server_node_id, config.query_type, config.query_name
        ),
        packet_id: None,
        session_id: Some(format!("dns-{}", config.query_id)),
        details: Some(format!("Zone database records searched: {}", zone.len())),
    });
    step_index += 1;

    let matching_records: Vec<DnsRecord> = zone
        .into_iter()
        .filter(|r| {
            r.name.eq_ignore_ascii_case(&config.query_name) && r.record_type == config.query_type
        })
        .collect();

    let (response_code, found_records) = if !matching_records.is_empty() {
        (DnsResponseCode::NoError, matching_records)
    } else {
        // If iterative or recursive with upstream authoritative server
        if let Some(auth_server) = &config.auth_server_node_id {
            if config.query_mode == DnsQueryMode::Iterative {
                events.push(AppProtocolEvent {
                    step_index,
                    timestamp_us: curr_time_us + 20,
                    node_id: config.server_node_id.clone(),
                    protocol: "DNS".to_string(),
                    event_type: "DNS_REFERRAL".to_string(),
                    description: format!(
                        "Resolver {} referred client to authoritative DNS server {}",
                        config.server_node_id, auth_server
                    ),
                    packet_id: None,
                    session_id: Some(format!("dns-{}", config.query_id)),
                    details: Some("Referral NS response returned in iterative step".to_string()),
                });
                step_index += 1;
            } else {
                events.push(AppProtocolEvent {
                    step_index,
                    timestamp_us: curr_time_us + 30,
                    node_id: config.server_node_id.clone(),
                    protocol: "DNS".to_string(),
                    event_type: "DNS_RECURSIVE_FORWARD".to_string(),
                    description: format!(
                        "Resolver {} recursively queries authoritative server {}",
                        config.server_node_id, auth_server
                    ),
                    packet_id: None,
                    session_id: Some(format!("dns-{}", config.query_id)),
                    details: Some("Upstream authoritative query dispatched".to_string()),
                });
                step_index += 1;
            }
        }
        (DnsResponseCode::NxDomain, Vec::new())
    };

    let answers = found_records.clone();

    // 3. Server sends DNS Response back to client
    let resp_pkt_id = format!("pkt-dns-r-{}", config.query_id);
    let status_str = match response_code {
        DnsResponseCode::NoError => "NOERROR",
        DnsResponseCode::NxDomain => "NXDOMAIN",
    };

    let app_header_r = AppHeader {
        protocol: "DNS".to_string(),
        payload_preview: format!(
            "DNS Response {}: {} ({} answers)",
            config.query_id,
            status_str,
            found_records.len()
        ),
        message_type: Some("Response".to_string()),
        session_id: Some(format!("dns-{}", config.query_id)),
        transaction_id: Some(config.query_id as u32),
        resource_or_command: Some(format!("{:?} {}", config.query_type, config.query_name)),
        status_code: Some(status_str.to_string()),
    };

    let return_nodes: Vec<String> = path_nodes.iter().cloned().rev().collect();
    let return_links: Vec<HopLink> = hop_links.iter().cloned().rev().collect();

    let (r_packet, final_arrival_us) = build_application_packet(
        &resp_pkt_id,
        &config.server_node_id,
        &config.client_node_id,
        &return_nodes,
        &return_links,
        app_header_r,
        "UDP",
        53,
        53120,
        None,
        None,
        Vec::new(),
        found_records.len() * 32 + 64,
        curr_time_us,
    );

    let event_type_str = match response_code {
        DnsResponseCode::NoError => "DNS_RESPONSE_SENT",
        DnsResponseCode::NxDomain => "DNS_NXDOMAIN",
    };

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "DNS".to_string(),
        event_type: event_type_str.to_string(),
        description: format!(
            "DNS Server {} dispatched {} response with {} record(s) to {}",
            config.server_node_id,
            status_str,
            found_records.len(),
            config.client_node_id
        ),
        packet_id: Some(resp_pkt_id),
        session_id: Some(format!("dns-{}", config.query_id)),
        details: Some(format!(
            "Response status: {}, records returned: {:?}",
            status_str, found_records
        )),
    });
    step_index += 1;
    packets.push(r_packet);
    curr_time_us = final_arrival_us;

    // Client receives response
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "DNS".to_string(),
        event_type: "DNS_RESPONSE_RECEIVED".to_string(),
        description: format!(
            "Client {} received DNS response (Status: {}, Answers: {})",
            config.client_node_id,
            status_str,
            answers.len()
        ),
        packet_id: None,
        session_id: Some(format!("dns-{}", config.query_id)),
        details: Some(format!("Total transaction latency: {} µs", curr_time_us)),
    });

    let sim_events = events
        .iter()
        .enumerate()
        .map(|(idx, ev)| app_event_to_sim_event(idx as u64 + 1, ev))
        .collect();

    let state = match response_code {
        DnsResponseCode::NoError => AppProtocolState::Completed,
        DnsResponseCode::NxDomain => AppProtocolState::Failed,
    };

    let metrics = AppProtocolMetrics {
        transaction_duration_us: curr_time_us,
        requests_sent: 1,
        responses_received: 1,
        payload_bytes_sent: 64,
        payload_bytes_received: answers.len() * 32 + 64,
        success: response_code == DnsResponseCode::NoError,
        error_message: if response_code == DnsResponseCode::NxDomain {
            Some(format!(
                "Domain '{}' not found (NXDOMAIN)",
                config.query_name
            ))
        } else {
            None
        },
    };

    Ok(DnsSimResult {
        config,
        state,
        response_code,
        answers,
        events,
        sim_events,
        packets,
        metrics,
    })
}
