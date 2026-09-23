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
pub struct SmtpConfig {
    pub client_node_id: String,
    pub server_node_id: String,
    pub mail_from: String,
    pub rcpt_to: String,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub reject_recipient: bool,
    #[serde(default = "default_smtp_port")]
    pub port: u16,
    #[serde(default = "default_seed")]
    pub seed: u64,
}

fn default_smtp_port() -> u16 {
    25
}

fn default_seed() -> u64 {
    42
}

impl Default for SmtpConfig {
    fn default() -> Self {
        Self {
            client_node_id: "host-a".to_string(),
            server_node_id: "mail-server".to_string(),
            mail_from: "alice@example.com".to_string(),
            rcpt_to: "bob@example.com".to_string(),
            subject: "Quarterly Network Simulation Report".to_string(),
            body: "Hello Bob,\nHere is the updated NetSim simulation data.\nRegards,\nAlice"
                .to_string(),
            reject_recipient: false,
            port: 25,
            seed: 42,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpSimResult {
    pub config: SmtpConfig,
    pub state: AppProtocolState,
    pub is_accepted: bool,
    pub events: Vec<AppProtocolEvent>,
    pub sim_events: Vec<SimEvent>,
    pub packets: Vec<Packet>,
    pub metrics: AppProtocolMetrics,
}

/// Simulates educational SMTP client/server mail submission workflow over authoritative TCP transport.
pub fn simulate_smtp(config: SmtpConfig, project: Option<&Project>) -> Result<SmtpSimResult> {
    let mut events = Vec::new();
    let mut packets = Vec::new();
    let mut step_index = 0;
    let mut curr_time_us: u64 = 0;

    let session_id = format!("smtp-sess-{}", config.port);

    let transport_cfg = TransportConfig {
        protocol: TransportProtocol::Tcp,
        source_node_id: config.client_node_id.clone(),
        destination_node_id: config.server_node_id.clone(),
        source_port: 49152,
        destination_port: config.port,
        payload_bytes: 2000,
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

    // 1. TCP Connected
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_CONNECTED".to_string(),
        description: format!(
            "TCP connection established to SMTP server {}:{}",
            config.server_node_id, config.port
        ),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some(format!("Port: {}", config.port)),
    });
    step_index += 1;
    curr_time_us += 5000;

    // 2. Server Greeting (220)
    let pkt_id_220 = "pkt-smtp-220".to_string();
    let (pkt_220, arr_220) = build_application_packet(
        &pkt_id_220,
        &config.server_node_id,
        &config.client_node_id,
        &return_nodes,
        &return_links,
        AppHeader {
            protocol: "SMTP".to_string(),
            payload_preview: "220 mail.example.com ESMTP Postfix (NetSim)".to_string(),
            message_type: Some("Greeting".to_string()),
            session_id: Some(session_id.clone()),
            transaction_id: Some(1),
            resource_or_command: Some("220".to_string()),
            status_code: Some("220 Service Ready".to_string()),
        },
        "TCP",
        config.port,
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
        protocol: "SMTP".to_string(),
        event_type: "SMTP_GREETING".to_string(),
        description: "Server sent 220 mail.example.com ESMTP Postfix".to_string(),
        packet_id: Some(pkt_id_220),
        session_id: Some(session_id.clone()),
        details: Some("SMTP Service Ready".to_string()),
    });
    step_index += 1;
    packets.push(pkt_220);
    curr_time_us = arr_220 + 1000;

    // 3. EHLO Command
    let pkt_id_ehlo = "pkt-smtp-ehlo".to_string();
    let (pkt_ehlo, arr_ehlo) = build_application_packet(
        &pkt_id_ehlo,
        &config.client_node_id,
        &config.server_node_id,
        &path_nodes,
        &hop_links,
        AppHeader {
            protocol: "SMTP".to_string(),
            payload_preview: "EHLO client.example.com".to_string(),
            message_type: Some("Command".to_string()),
            session_id: Some(session_id.clone()),
            transaction_id: Some(2),
            resource_or_command: Some("EHLO".to_string()),
            status_code: None,
        },
        "TCP",
        49152,
        config.port,
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
        protocol: "SMTP".to_string(),
        event_type: "SMTP_COMMAND".to_string(),
        description: "Client sent EHLO client.example.com".to_string(),
        packet_id: Some(pkt_id_ehlo),
        session_id: Some(session_id.clone()),
        details: Some("Client greeting".to_string()),
    });
    step_index += 1;
    packets.push(pkt_ehlo);
    curr_time_us = arr_ehlo + 1000;

    // Server 250 Response to EHLO
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_RESPONSE".to_string(),
        description: "Server sent 250-mail.example.com Hello client.example.com".to_string(),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some("250 OK".to_string()),
    });
    step_index += 1;
    curr_time_us += 1000;

    // 4. MAIL FROM Command
    let pkt_id_mf = "pkt-smtp-mail-from".to_string();
    let mf_str = format!("MAIL FROM:<{}>", config.mail_from);
    let (pkt_mf, arr_mf) = build_application_packet(
        &pkt_id_mf,
        &config.client_node_id,
        &config.server_node_id,
        &path_nodes,
        &hop_links,
        AppHeader {
            protocol: "SMTP".to_string(),
            payload_preview: mf_str.clone(),
            message_type: Some("Command".to_string()),
            session_id: Some(session_id.clone()),
            transaction_id: Some(3),
            resource_or_command: Some(mf_str.clone()),
            status_code: None,
        },
        "TCP",
        49152,
        config.port,
        Some(300),
        Some(250),
        vec!["PSH".to_string(), "ACK".to_string()],
        mf_str.len(),
        curr_time_us,
    );
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_COMMAND".to_string(),
        description: format!("Client sent {}", mf_str),
        packet_id: Some(pkt_id_mf),
        session_id: Some(session_id.clone()),
        details: Some(format!("Sender: {}", config.mail_from)),
    });
    step_index += 1;
    packets.push(pkt_mf);
    curr_time_us = arr_mf + 1000;

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_RESPONSE".to_string(),
        description: "Server sent 250 2.1.0 Ok (Sender verified)".to_string(),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some("Sender accepted".to_string()),
    });
    step_index += 1;
    curr_time_us += 1000;

    // 5. RCPT TO Command
    let pkt_id_rcpt = "pkt-smtp-rcpt-to".to_string();
    let rcpt_str = format!("RCPT TO:<{}>", config.rcpt_to);
    let (pkt_rcpt, arr_rcpt) = build_application_packet(
        &pkt_id_rcpt,
        &config.client_node_id,
        &config.server_node_id,
        &path_nodes,
        &hop_links,
        AppHeader {
            protocol: "SMTP".to_string(),
            payload_preview: rcpt_str.clone(),
            message_type: Some("Command".to_string()),
            session_id: Some(session_id.clone()),
            transaction_id: Some(4),
            resource_or_command: Some(rcpt_str.clone()),
            status_code: None,
        },
        "TCP",
        49152,
        config.port,
        Some(400),
        Some(350),
        vec!["PSH".to_string(), "ACK".to_string()],
        rcpt_str.len(),
        curr_time_us,
    );
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_COMMAND".to_string(),
        description: format!("Client sent {}", rcpt_str),
        packet_id: Some(pkt_id_rcpt),
        session_id: Some(session_id.clone()),
        details: Some(format!("Recipient: {}", config.rcpt_to)),
    });
    step_index += 1;
    packets.push(pkt_rcpt);
    curr_time_us = arr_rcpt + 1000;

    // Rejection Error Path check
    if config.reject_recipient {
        events.push(AppProtocolEvent {
            step_index,
            timestamp_us: curr_time_us,
            node_id: config.server_node_id.clone(),
            protocol: "SMTP".to_string(),
            event_type: "SMTP_RCPT_REJECTED".to_string(),
            description: format!(
                "Server rejected recipient: 550 5.1.1 <{}>: User unknown in virtual mailbox",
                config.rcpt_to
            ),
            packet_id: None,
            session_id: Some(session_id.clone()),
            details: Some("Status 550 Recipient rejected".to_string()),
        });

        let sim_events = events
            .iter()
            .enumerate()
            .map(|(idx, ev)| app_event_to_sim_event(idx as u64 + 1, ev))
            .collect();

        return Ok(SmtpSimResult {
            config,
            state: AppProtocolState::Failed,
            is_accepted: false,
            events,
            sim_events,
            packets,
            metrics: AppProtocolMetrics {
                transaction_duration_us: curr_time_us,
                requests_sent: 3,
                responses_received: 3,
                payload_bytes_sent: 150,
                payload_bytes_received: 150,
                success: false,
                error_message: Some("Recipient rejected: 550 User unknown".to_string()),
            },
        });
    }

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_RESPONSE".to_string(),
        description: "Server sent 250 2.1.5 Ok (Recipient accepted)".to_string(),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some("Recipient accepted".to_string()),
    });
    step_index += 1;
    curr_time_us += 1000;

    // 6. DATA Command
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_COMMAND".to_string(),
        description: "Client sent DATA".to_string(),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some("Entering data mode".to_string()),
    });
    step_index += 1;
    curr_time_us += 1000;

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_RESPONSE".to_string(),
        description: "Server sent 354 End data with <CR><LF>.<CR><LF>".to_string(),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some("Ready for mail content".to_string()),
    });
    step_index += 1;
    curr_time_us += 1000;

    // 7. Message Content Transfer
    let full_content = format!(
        "Subject: {}\r\nFrom: {}\r\nTo: {}\r\n\r\n{}\r\n.\r\n",
        config.subject, config.mail_from, config.rcpt_to, config.body
    );
    let pkt_id_data = "pkt-smtp-data-msg".to_string();
    let (pkt_data, arr_data) = build_application_packet(
        &pkt_id_data,
        &config.client_node_id,
        &config.server_node_id,
        &path_nodes,
        &hop_links,
        AppHeader {
            protocol: "SMTP".to_string(),
            payload_preview: format!("Subject: {}", config.subject),
            message_type: Some("Mail Data".to_string()),
            session_id: Some(session_id.clone()),
            transaction_id: Some(5),
            resource_or_command: Some(format!("Subject: {}", config.subject)),
            status_code: None,
        },
        "TCP",
        49152,
        config.port,
        Some(500),
        Some(450),
        vec!["PSH".to_string(), "ACK".to_string()],
        full_content.len(),
        curr_time_us,
    );
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_DATA_TRANSFER".to_string(),
        description: format!(
            "Client dispatched email payload ({} bytes, Subject: '{}')",
            full_content.len(),
            config.subject
        ),
        packet_id: Some(pkt_id_data),
        session_id: Some(session_id.clone()),
        details: Some("Message content transferred".to_string()),
    });
    step_index += 1;
    packets.push(pkt_data);
    curr_time_us = arr_data + 1000;

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_MESSAGE_ACCEPTED".to_string(),
        description:
            "Server sent 250 2.0.0 Ok: queued as 4X8Z9Q001Z (Message accepted for delivery)"
                .to_string(),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some("Queue ID: 4X8Z9Q001Z".to_string()),
    });
    step_index += 1;
    curr_time_us += 1000;

    // 8. QUIT & 221 Bye
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_COMMAND".to_string(),
        description: "Client sent QUIT".to_string(),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some("Closing session".to_string()),
    });
    step_index += 1;

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us + 1000,
        node_id: config.server_node_id.clone(),
        protocol: "SMTP".to_string(),
        event_type: "SMTP_RESPONSE".to_string(),
        description: "Server sent 221 2.0.0 Bye (Connection closed)".to_string(),
        packet_id: None,
        session_id: Some(session_id.clone()),
        details: Some("Session cleanly closed".to_string()),
    });

    let sim_events = events
        .iter()
        .enumerate()
        .map(|(idx, ev)| app_event_to_sim_event(idx as u64 + 1, ev))
        .collect();

    let metrics = AppProtocolMetrics {
        transaction_duration_us: curr_time_us + 1000,
        requests_sent: 5,
        responses_received: 5,
        payload_bytes_sent: full_content.len() + 150,
        payload_bytes_received: 300,
        success: true,
        error_message: None,
    };

    Ok(SmtpSimResult {
        config,
        state: AppProtocolState::Completed,
        is_accepted: true,
        events,
        sim_events,
        packets,
        metrics,
    })
}
