use super::{
    app_event_to_sim_event, build_application_packet, AppProtocolEvent, AppProtocolMetrics,
    AppProtocolState,
};
use crate::domain::{AppHeader, Packet, Project};
use crate::error::Result;
use crate::simulation::event::SimEvent;
use crate::transport::{
    resolve_route_and_links, simulate_tcp, HopLink, TransportConfig, TransportEvent,
    TransportProtocol,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status_code: u16,
    pub status_text: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpConfig {
    pub client_node_id: String,
    pub server_node_id: String,
    pub request: HttpRequest,
    #[serde(default = "default_http_port")]
    pub port: u16,
    #[serde(default = "default_seed")]
    pub seed: u64,
}

fn default_http_port() -> u16 {
    80
}

fn default_seed() -> u64 {
    42
}

impl Default for HttpConfig {
    fn default() -> Self {
        let mut headers = BTreeMap::new();
        headers.insert("Host".to_string(), "example.com".to_string());
        headers.insert("User-Agent".to_string(), "NetSim-Client/1.0".to_string());
        headers.insert(
            "Accept".to_string(),
            "text/html,application/xhtml+xml".to_string(),
        );

        Self {
            client_node_id: "host-a".to_string(),
            server_node_id: "web-server".to_string(),
            request: HttpRequest {
                method: HttpMethod::Get,
                path: "/index.html".to_string(),
                headers,
                body: None,
            },
            port: 80,
            seed: 42,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpSimResult {
    pub config: HttpConfig,
    pub state: AppProtocolState,
    pub response: HttpResponse,
    pub events: Vec<AppProtocolEvent>,
    pub sim_events: Vec<SimEvent>,
    pub tcp_events: Vec<TransportEvent>,
    pub packets: Vec<Packet>,
    pub metrics: AppProtocolMetrics,
}

/// Educational virtual web-server filesystem matching paths to status/content.
fn evaluate_http_endpoint(req: &HttpRequest) -> HttpResponse {
    let mut resp_headers = BTreeMap::new();
    resp_headers.insert(
        "Server".to_string(),
        "NetSim-HTTPd/2.4 (Educational)".to_string(),
    );
    resp_headers.insert("Connection".to_string(), "close".to_string());

    match (req.method, req.path.as_str()) {
        (HttpMethod::Get, "/" | "/index.html") => {
            let body = "<!DOCTYPE html><html><head><title>NetSim Home</title></head><body><h1>Welcome to NetSim</h1><p>Authoritative 5-Layer Simulation.</p></body></html>".to_string();
            resp_headers.insert(
                "Content-Type".to_string(),
                "text/html; charset=utf-8".to_string(),
            );
            resp_headers.insert("Content-Length".to_string(), body.len().to_string());
            HttpResponse {
                status_code: 200,
                status_text: "OK".to_string(),
                headers: resp_headers,
                body,
            }
        }
        (HttpMethod::Get, "/api/status") => {
            let body = "{\"system\": \"NetSim\", \"status\": \"online\", \"sim_time_authoritative\": true}".to_string();
            resp_headers.insert("Content-Type".to_string(), "application/json".to_string());
            resp_headers.insert("Content-Length".to_string(), body.len().to_string());
            HttpResponse {
                status_code: 200,
                status_text: "OK".to_string(),
                headers: resp_headers,
                body,
            }
        }
        (HttpMethod::Post, "/api/data" | "/submit") => {
            let received_len = req.body.as_ref().map(|b| b.len()).unwrap_or(0);
            let body = format!(
                "{{\"success\": true, \"message\": \"Payload accepted\", \"bytes_processed\": {}}}",
                received_len
            );
            resp_headers.insert("Content-Type".to_string(), "application/json".to_string());
            resp_headers.insert("Content-Length".to_string(), body.len().to_string());
            HttpResponse {
                status_code: 200,
                status_text: "OK".to_string(),
                headers: resp_headers,
                body,
            }
        }
        _ => {
            let body = format!("<!DOCTYPE html><html><body><h1>404 Not Found</h1><p>The requested resource '{}' was not found on this server.</p></body></html>", req.path);
            resp_headers.insert(
                "Content-Type".to_string(),
                "text/html; charset=utf-8".to_string(),
            );
            resp_headers.insert("Content-Length".to_string(), body.len().to_string());
            HttpResponse {
                status_code: 404,
                status_text: "Not Found".to_string(),
                headers: resp_headers,
                body,
            }
        }
    }
}

/// Simulates educational HTTP request-response over authoritative TCP transport.
pub fn simulate_http(config: HttpConfig, project: Option<&Project>) -> Result<HttpSimResult> {
    let mut events = Vec::new();
    let mut packets = Vec::new();
    let mut step_index = 0;
    let mut curr_time_us: u64 = 0;

    let response = evaluate_http_endpoint(&config.request);

    // Calculate payload size
    let req_body_len = config.request.body.as_ref().map(|b| b.len()).unwrap_or(0);
    let req_payload_size = 250 + req_body_len;
    let resp_payload_size = 200 + response.body.len();

    // 1. Run authoritative TCP simulation for the underlying connection
    let transport_cfg = TransportConfig {
        protocol: TransportProtocol::Tcp,
        source_node_id: config.client_node_id.clone(),
        destination_node_id: config.server_node_id.clone(),
        source_port: 52140,
        destination_port: config.port,
        payload_bytes: req_payload_size + resp_payload_size,
        segment_size_bytes: 1460,
        initial_sequence_number: 1000,
        initial_cwnd_mss: 1.0,
        initial_ssthresh_mss: 16.0,
        initial_rto_us: 100_000,
        receive_window_bytes: 65535,
        seed: config.seed,
        dropped_segments: Vec::new(),
        maximum_retries: 5,
    };

    let (path_nodes, hop_links) = resolve_route_and_links(&transport_cfg, project)?;
    let tcp_result = simulate_tcp(transport_cfg, project)?;

    // 2. TCP 3-Way Handshake event
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "HTTP".to_string(),
        event_type: "HTTP_TCP_HANDSHAKE_INITIATED".to_string(),
        description: format!(
            "Client {} initiating TCP connection to {}:{} (SYN)",
            config.client_node_id, config.server_node_id, config.port
        ),
        packet_id: None,
        session_id: Some("http-session-1".to_string()),
        details: Some("Three-way handshake SYN sent".to_string()),
    });
    step_index += 1;

    curr_time_us += 20_000; // Handshake complete

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "HTTP".to_string(),
        event_type: "HTTP_TCP_CONNECTED".to_string(),
        description: format!(
            "TCP connection established between {} and {}:{}",
            config.client_node_id, config.server_node_id, config.port
        ),
        packet_id: None,
        session_id: Some("http-session-1".to_string()),
        details: Some("Socket state: ESTABLISHED".to_string()),
    });
    step_index += 1;

    // 3. HTTP Request Transmission
    let req_pkt_id = "pkt-http-req-01".to_string();
    let app_header_req = AppHeader {
        protocol: "HTTP".to_string(),
        payload_preview: format!(
            "{:?} {} HTTP/1.1 ({} bytes)",
            config.request.method, config.request.path, req_payload_size
        ),
        message_type: Some("Request".to_string()),
        session_id: Some("http-session-1".to_string()),
        transaction_id: Some(1),
        resource_or_command: Some(format!(
            "{:?} {}",
            config.request.method, config.request.path
        )),
        status_code: None,
    };

    let (req_packet, req_arrival_us) = build_application_packet(
        &req_pkt_id,
        &config.client_node_id,
        &config.server_node_id,
        &path_nodes,
        &hop_links,
        app_header_req,
        "TCP",
        52140,
        config.port,
        Some(1001),
        Some(1),
        vec!["PSH".to_string(), "ACK".to_string()],
        req_payload_size,
        curr_time_us,
    );

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "HTTP".to_string(),
        event_type: "HTTP_REQUEST_SENT".to_string(),
        description: format!(
            "Client {} dispatched {:?} {} HTTP/1.1 (Payload: {} bytes)",
            config.client_node_id, config.request.method, config.request.path, req_payload_size
        ),
        packet_id: Some(req_pkt_id),
        session_id: Some("http-session-1".to_string()),
        details: Some(format!("Headers: {:?}", config.request.headers)),
    });
    step_index += 1;
    packets.push(req_packet);
    curr_time_us = req_arrival_us;

    // 4. Server Route Processing (pure local event)
    curr_time_us += 50; // Server request parsing and route execution
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "HTTP".to_string(),
        event_type: if response.status_code == 404 {
            "HTTP_NOT_FOUND".to_string()
        } else {
            "HTTP_REQUEST_PARSED".to_string()
        },
        description: format!(
            "Server {} evaluated endpoint '{}' -> {} {}",
            config.server_node_id, config.request.path, response.status_code, response.status_text
        ),
        packet_id: None,
        session_id: Some("http-session-1".to_string()),
        details: Some(format!(
            "Controller executed endpoint; generating {} bytes response body",
            response.body.len()
        )),
    });
    step_index += 1;

    // 5. HTTP Response Transmission
    let resp_pkt_id = "pkt-http-resp-01".to_string();
    let app_header_resp = AppHeader {
        protocol: "HTTP".to_string(),
        payload_preview: format!(
            "HTTP/1.1 {} {} ({} bytes)",
            response.status_code, response.status_text, resp_payload_size
        ),
        message_type: Some("Response".to_string()),
        session_id: Some("http-session-1".to_string()),
        transaction_id: Some(1),
        resource_or_command: Some(format!(
            "{:?} {}",
            config.request.method, config.request.path
        )),
        status_code: Some(format!("{} {}", response.status_code, response.status_text)),
    };

    let return_nodes: Vec<String> = path_nodes.iter().cloned().rev().collect();
    let return_links: Vec<HopLink> = hop_links.iter().cloned().rev().collect();

    let (resp_packet, resp_arrival_us) = build_application_packet(
        &resp_pkt_id,
        &config.server_node_id,
        &config.client_node_id,
        &return_nodes,
        &return_links,
        app_header_resp,
        "TCP",
        config.port,
        52140,
        Some(5001),
        Some(1001 + req_payload_size as u32),
        vec!["PSH".to_string(), "ACK".to_string()],
        resp_payload_size,
        curr_time_us,
    );

    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.server_node_id.clone(),
        protocol: "HTTP".to_string(),
        event_type: "HTTP_RESPONSE_SENT".to_string(),
        description: format!(
            "Server {} dispatched HTTP/1.1 {} {} (Body: {} bytes)",
            config.server_node_id,
            response.status_code,
            response.status_text,
            response.body.len()
        ),
        packet_id: Some(resp_pkt_id),
        session_id: Some("http-session-1".to_string()),
        details: Some(format!("Headers: {:?}", response.headers)),
    });
    step_index += 1;
    packets.push(resp_packet);
    curr_time_us = resp_arrival_us;

    // 6. Client Receives Response and Connection Closes
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "HTTP".to_string(),
        event_type: "HTTP_RESPONSE_RECEIVED".to_string(),
        description: format!(
            "Client {} received HTTP response (Status: {} {})",
            config.client_node_id, response.status_code, response.status_text
        ),
        packet_id: None,
        session_id: Some("http-session-1".to_string()),
        details: Some(format!("Elapsed time: {} µs", curr_time_us)),
    });
    step_index += 1;

    curr_time_us += 10_000; // Teardown FIN-ACK exchange
    events.push(AppProtocolEvent {
        step_index,
        timestamp_us: curr_time_us,
        node_id: config.client_node_id.clone(),
        protocol: "HTTP".to_string(),
        event_type: "HTTP_TCP_CLOSED".to_string(),
        description: format!(
            "TCP session closed via 4-step FIN-ACK teardown ({}:{} <-> {}:{})",
            config.client_node_id, 52140, config.server_node_id, config.port
        ),
        packet_id: None,
        session_id: Some("http-session-1".to_string()),
        details: Some("Connection: close enforced".to_string()),
    });

    let sim_events = events
        .iter()
        .enumerate()
        .map(|(idx, ev)| app_event_to_sim_event(idx as u64 + 1, ev))
        .collect();

    let state = if response.status_code == 200 {
        AppProtocolState::Completed
    } else {
        AppProtocolState::Failed
    };

    let metrics = AppProtocolMetrics {
        transaction_duration_us: curr_time_us,
        requests_sent: 1,
        responses_received: 1,
        payload_bytes_sent: req_payload_size,
        payload_bytes_received: resp_payload_size,
        success: response.status_code == 200,
        error_message: if response.status_code != 200 {
            Some(format!(
                "HTTP Error {} {}",
                response.status_code, response.status_text
            ))
        } else {
            None
        },
    };

    Ok(HttpSimResult {
        config,
        state,
        response,
        events,
        sim_events,
        tcp_events: tcp_result.events,
        packets,
        metrics,
    })
}
