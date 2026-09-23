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
pub enum FtpCommand {
    User,
    Pass,
    List,
    Retr,
    Stor,
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FtpChannelType {
    Control,
    Data,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FtpConfig {
    pub client_node_id: String,
    pub server_node_id: String,
    pub username: String,
    pub password: Option<String>,
    pub transfer_command: FtpCommand, // LIST, RETR, or STOR
    pub filename: Option<String>,
    pub file_size_bytes: usize,
    #[serde(default = "default_control_port")]
    pub control_port: u16,
    #[serde(default = "default_data_port")]
    pub data_port: u16,
    #[serde(default = "default_seed")]
    pub seed: u64,
}

fn default_control_port() -> u16 {
    21
}

fn default_data_port() -> u16 {
    50000
}

fn default_seed() -> u64 {
    42
}

impl Default for FtpConfig {
    fn default() -> Self {
        Self {
            client_node_id: "host-a".to_string(),
            server_node_id: "ftp-server".to_string(),
            username: "anonymous".to_string(),
            password: Some("guest@example.com".to_string()),
            transfer_command: FtpCommand::Retr,
            filename: Some("research_paper.pdf".to_string()),
            file_size_bytes: 4096,
            control_port: 21,
            data_port: 50000,
            seed: 42,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FtpSimResult {
    pub config: FtpConfig,
    pub state: AppProtocolState,
    pub control_session_id: String,
    pub data_session_id: String,
    pub events: Vec<AppProtocolEvent>,
    pub sim_events: Vec<SimEvent>,
    pub packets: Vec<Packet>,
    pub metrics: AppProtocolMetrics,
}

/// Simulates educational FTP workflow with distinct Control Channel (port 21) and Data Channel.
pub fn simulate_ftp(config: FtpConfig, project: Option<&Project>) -> Result<FtpSimResult> {
    let mut events = Vec::new();
    let mut packets = Vec::new();
    let mut step_index = 0;
    let mut curr_time_us: u64 = 0;

    let control_session_id = "ftp-ctrl-sess-21".to_string();
    let data_session_id = format!("ftp-data-sess-{}", config.data_port);

    let transport_cfg = TransportConfig {
        protocol: TransportProtocol::Tcp,
        source_node_id: config.client_node_id.clone(),
        destination_node_id: config.server_node_id.clone(),
        source_port: 49152,
        destination_port: config.control_port,
        payload_bytes: 1000,
        segment_size_bytes: 1460,
        initial_sequence_number: 1,
        initial_cwnd_mss: 1.0,
        initial_ssthresh_mss: 16.0,
        initial_rto_us: 100_000,
        receive_window_bytes: 65535,
        seed: config.seed,
        dropped_segments: Vec::new(),
        maximum_retries: 5,
    };

    let (path_nodes, hop_links) = resolve_route_and_links(&transport_cfg, project)?;
    let return_nodes: Vec<String> = path_nodes.iter().cloned().rev().collect();
    let return_links: Vec<HopLink> = hop_links.iter().cloned().rev().collect();

    // 1. Control Channel Connection Established
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_CONTROL_CONNECTED".to_string(),
        description: format!(
            "Control channel TCP established on port {} between {} and {}",
            config.control_port, config.client_node_id, config.server_node_id
        ),
        packet_id: None,
        session_id: Some(control_session_id.clone()),
        details: Some(format!("Channel: Control, Port: {}", config.control_port)),
    });
    step_index += 1;

    // 2. Server Greeting (220)
    let pkt_id_220 = "pkt-ftp-ctrl-220".to_string();
    let (pkt_220, arr_220) = build_application_packet(
        &pkt_id_220,
        &config.server_node_id,
        &config.client_node_id,
        &return_nodes,
        &return_links,
        AppHeader {
            protocol: "FTP".to_string(),
            payload_preview: "220 NetSim FTP Server ready".to_string(),
            message_type: Some("Control Response".to_string()),
            session_id: Some(control_session_id.clone()),
            transaction_id: Some(1),
            resource_or_command: Some("220".to_string()),
            status_code: Some("220 Service Ready".to_string()),
        },
        "TCP",
        config.control_port,
        49152,
        Some(100),
        Some(1),
        vec!["ACK".to_string()],
        64,
        curr_time_us,
    );
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_SERVER_GREETING".to_string(),
        description: "FTP Server greeting: 220 NetSim FTP Server ready".to_string(),
        packet_id: Some(pkt_id_220),
        session_id: Some(control_session_id.clone()),
        details: Some("Control Channel Port 21".to_string()),
    });
    step_index += 1;
    packets.push(pkt_220);
    curr_time_us = arr_220 + 500;

    // 3. USER Command
    let pkt_id_user = "pkt-ftp-ctrl-user".to_string();
    let (pkt_user, arr_user) = build_application_packet(
        &pkt_id_user,
        &config.client_node_id,
        &config.server_node_id,
        &path_nodes,
        &hop_links,
        AppHeader {
            protocol: "FTP".to_string(),
            payload_preview: format!("USER {}", config.username),
            message_type: Some("Control Command".to_string()),
            session_id: Some(control_session_id.clone()),
            transaction_id: Some(2),
            resource_or_command: Some(format!("USER {}", config.username)),
            status_code: None,
        },
        "TCP",
        49152,
        config.control_port,
        Some(200),
        Some(164),
        vec!["PSH".to_string(), "ACK".to_string()],
        32,
        curr_time_us,
    );
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_CONTROL_COMMAND".to_string(),
        description: format!("Client sent USER {}", config.username),
        packet_id: Some(pkt_id_user),
        session_id: Some(control_session_id.clone()),
        details: Some("Authenticating user".to_string()),
    });
    step_index += 1;
    packets.push(pkt_user);
    curr_time_us = arr_user + 500;

    // 4. PASS Command & 230 Login
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_LOGIN".to_string(),
        description: format!(
            "Server accepted credentials: 230 User '{}' logged in, proceed",
            config.username
        ),
        packet_id: None,
        session_id: Some(control_session_id.clone()),
        details: Some("Status 230 User logged in".to_string()),
    });
    step_index += 1;
    curr_time_us += 1000;

    // 5. Transfer Request Command on Control Channel (e.g. RETR / STOR / LIST)
    let transfer_cmd_str = match config.transfer_command {
        FtpCommand::List => "LIST".to_string(),
        FtpCommand::Retr => format!("RETR {}", config.filename.as_deref().unwrap_or("file.dat")),
        FtpCommand::Stor => format!("STOR {}", config.filename.as_deref().unwrap_or("file.dat")),
        FtpCommand::Quit => "QUIT".to_string(),
        _ => "LIST".to_string(),
    };

    let pkt_id_cmd = "pkt-ftp-ctrl-cmd".to_string();
    let (pkt_cmd, arr_cmd) = build_application_packet(
        &pkt_id_cmd,
        &config.client_node_id,
        &config.server_node_id,
        &path_nodes,
        &hop_links,
        AppHeader {
            protocol: "FTP".to_string(),
            payload_preview: transfer_cmd_str.clone(),
            message_type: Some("Control Command".to_string()),
            session_id: Some(control_session_id.clone()),
            transaction_id: Some(3),
            resource_or_command: Some(transfer_cmd_str.clone()),
            status_code: None,
        },
        "TCP",
        49152,
        config.control_port,
        Some(300),
        Some(250),
        vec!["PSH".to_string(), "ACK".to_string()],
        64,
        curr_time_us,
    );
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_CONTROL_COMMAND".to_string(),
        description: format!("Client requested transfer: {}", transfer_cmd_str),
        packet_id: Some(pkt_id_cmd),
        session_id: Some(control_session_id.clone()),
        details: Some(format!("Control command on port {}", config.control_port)),
    });
    step_index += 1;
    packets.push(pkt_cmd);
    curr_time_us = arr_cmd + 500;

    // 6. Data Channel Establishment (Separate Port, Separate Session!)
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_DATA_CHANNEL_OPENED".to_string(),
        description: format!(
            "Server opening dedicated DATA channel TCP connection on port {}",
            config.data_port
        ),
        packet_id: None,
        session_id: Some(data_session_id.clone()),
        details: Some("150 File status okay; about to open data connection".to_string()),
    });
    step_index += 1;
    curr_time_us += 5000;

    // 7. Actual File Data Transfer on Data Channel
    let data_pkt_id = "pkt-ftp-data-01".to_string();
    let is_download =
        config.transfer_command == FtpCommand::Retr || config.transfer_command == FtpCommand::List;
    let (data_src, data_dst, d_nodes, d_links) = if is_download {
        (
            &config.server_node_id,
            &config.client_node_id,
            &return_nodes,
            &return_links,
        )
    } else {
        (
            &config.client_node_id,
            &config.server_node_id,
            &path_nodes,
            &hop_links,
        )
    };

    let (data_pkt, arr_data) = build_application_packet(
        &data_pkt_id,
        data_src,
        data_dst,
        d_nodes,
        d_links,
        AppHeader {
            protocol: "FTP".to_string(),
            payload_preview: format!(
                "FTP Data Payload ({} bytes for {})",
                config.file_size_bytes, transfer_cmd_str
            ),
            message_type: Some("Data Transfer".to_string()),
            session_id: Some(data_session_id.clone()),
            transaction_id: Some(10),
            resource_or_command: Some(transfer_cmd_str.clone()),
            status_code: None,
        },
        "TCP",
        config.data_port,
        50001,
        Some(10000),
        Some(1),
        vec!["ACK".to_string()],
        config.file_size_bytes,
        curr_time_us,
    );

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: data_src.to_string(),
        protocol: "FTP".to_string(),
        event_type: "FTP_DATA_TRANSFER".to_string(),
        description: format!(
            "DATA channel transfer: {} bytes transferred ({})",
            config.file_size_bytes, transfer_cmd_str
        ),
        packet_id: Some(data_pkt_id),
        session_id: Some(data_session_id.clone()),
        details: Some(format!(
            "Data channel port: {}, Total payload: {} bytes",
            config.data_port, config.file_size_bytes
        )),
    });
    step_index += 1;
    packets.push(data_pkt);
    curr_time_us = arr_data + 1000;

    // 8. Data Channel Closes & 226 Transfer Complete on Control Channel
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_TRANSFER_COMPLETE".to_string(),
        description: "226 Closing data connection; transfer successful".to_string(),
        packet_id: None,
        session_id: Some(control_session_id.clone()),
        details: Some("Data channel closed; status 226 emitted on control channel".to_string()),
    });
    step_index += 1;

    // 9. QUIT Command & 221 Goodbye
    curr_time_us += 5000;
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_CONTROL_COMMAND".to_string(),
        description: "Client sent QUIT on control channel".to_string(),
        packet_id: None,
        session_id: Some(control_session_id.clone()),
        details: Some("Terminating FTP session".to_string()),
    });
    step_index += 1;

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us + 1000,
        node_id: config.server_node_id.clone(),
        protocol: "FTP".to_string(),
        event_type: "FTP_SESSION_CLOSED".to_string(),
        description: "Server: 221 Goodbye; Control connection closed".to_string(),
        packet_id: None,
        session_id: Some(control_session_id.clone()),
        details: Some("Session cleanly closed".to_string()),
    });

    let sim_events = events
        .iter()
        .enumerate()
        .map(|(idx, ev)| app_event_to_sim_event(idx as u64 + 1, ev))
        .collect();

    let metrics = AppProtocolMetrics {
        transaction_duration_us: curr_time_us,
        requests_sent: 4,
        responses_received: 4,
        payload_bytes_sent: 128,
        payload_bytes_received: config.file_size_bytes + 256,
        success: true,
        error_message: None,
    };

    Ok(FtpSimResult {
        config,
        state: AppProtocolState::Completed,
        control_session_id,
        data_session_id,
        events,
        sim_events,
        packets,
        metrics,
    })
}
