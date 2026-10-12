from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from netsim.application import (
    AppProtocolEvent,
    AppProtocolMetrics,
    AppProtocolState,
    app_event_to_sim_event,
    build_application_packet,
)
from netsim.core.events import SimEvent
from netsim.core.schema import require_dict
from netsim.models.packet import AppHeader, Packet
from netsim.models.project import Project
from netsim.transport import (
    TransportConfig,
    TransportEvent,
    TransportProtocol,
    resolve_route_and_links,
)
from netsim.transport.tcp import simulate_tcp


class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"


@dataclass
class HttpRequest:
    method: HttpMethod
    path: str
    headers: dict[str, str] = field(default_factory=dict)
    body: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": self.method.value,
            "path": self.path,
            "headers": dict(self.headers),
            "body": self.body,
        }


@dataclass
class HttpResponse:
    status_code: int
    status_text: str
    headers: dict[str, str]
    body: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "status_code": self.status_code,
            "status_text": self.status_text,
            "headers": dict(self.headers),
            "body": self.body,
        }


@dataclass
class HttpConfig:
    client_node_id: str = "host-a"
    server_node_id: str = "web-server"
    request: HttpRequest = field(
        default_factory=lambda: HttpRequest(
            method=HttpMethod.GET,
            path="/index.html",
            headers={
                "Host": "example.com",
                "User-Agent": "NetSim-Client/1.0",
                "Accept": "text/html,application/xhtml+xml",
            },
            body=None,
        )
    )
    port: int = 80
    seed: int = 42

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HttpConfig:
        req_data = require_dict(data.get("request", {}), "request")
        m_str = req_data.get("method", "GET")
        method = HttpMethod(m_str) if isinstance(m_str, str) else m_str
        request = HttpRequest(
            method=method,
            path=req_data.get("path", "/index.html"),
            headers=dict(req_data.get("headers", {})),
            body=req_data.get("body"),
        )
        return cls(
            client_node_id=data.get("client_node_id", "host-a"),
            server_node_id=data.get("server_node_id", "web-server"),
            request=request,
            port=int(data.get("port", 80)),
            seed=int(data.get("seed", 42)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "client_node_id": self.client_node_id,
            "server_node_id": self.server_node_id,
            "request": self.request.to_dict(),
            "port": self.port,
            "seed": self.seed,
        }


@dataclass
class HttpSimResult:
    config: HttpConfig
    state: AppProtocolState
    response: HttpResponse
    events: list[AppProtocolEvent]
    sim_events: list[SimEvent]
    tcp_events: list[TransportEvent]
    packets: list[Packet]
    metrics: AppProtocolMetrics

    def to_dict(self) -> dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "state": self.state.value,
            "response": self.response.to_dict(),
            "events": [e.to_dict() for e in self.events],
            "sim_events": [se.to_dict() for se in self.sim_events],
            "tcp_events": [te.to_dict() for te in self.tcp_events],
            "packets": [p.to_dict() for p in self.packets],
            "metrics": self.metrics.to_dict(),
        }


def evaluate_http_endpoint(req: HttpRequest) -> HttpResponse:
    resp_headers: dict[str, str] = {
        "Server": "NetSim-HTTPd/2.4 (Educational)",
        "Connection": "close",
    }

    if req.method == HttpMethod.GET and req.path in ("/", "/index.html"):
        body = "<!DOCTYPE html><html><head><title>NetSim Home</title></head><body><h1>Welcome to NetSim</h1><p>Authoritative 5-Layer Simulation.</p></body></html>"
        resp_headers["Content-Type"] = "text/html; charset=utf-8"
        resp_headers["Content-Length"] = str(len(body))
        return HttpResponse(200, "OK", resp_headers, body)
    elif req.method == HttpMethod.GET and req.path == "/api/status":
        body = '{"system": "NetSim", "status": "online", "sim_time_authoritative": true}'
        resp_headers["Content-Type"] = "application/json"
        resp_headers["Content-Length"] = str(len(body))
        return HttpResponse(200, "OK", resp_headers, body)
    elif req.method == HttpMethod.POST and req.path in ("/api/data", "/submit"):
        received_len = len(req.body) if req.body else 0
        body = f'{{"success": true, "message": "Payload accepted", "bytes_processed": {received_len}}}'
        resp_headers["Content-Type"] = "application/json"
        resp_headers["Content-Length"] = str(len(body))
        return HttpResponse(200, "OK", resp_headers, body)
    else:
        body = f"<!DOCTYPE html><html><body><h1>404 Not Found</h1><p>The requested resource '{req.path}' was not found on this server.</p></body></html>"
        resp_headers["Content-Type"] = "text/html; charset=utf-8"
        resp_headers["Content-Length"] = str(len(body))
        return HttpResponse(404, "Not Found", resp_headers, body)


def simulate_http(config: HttpConfig, project: Project | None = None) -> HttpSimResult:
    events: list[AppProtocolEvent] = []
    packets: list[Packet] = []
    step_index = 0
    curr_time_us = 0

    response = evaluate_http_endpoint(config.request)

    req_body_len = len(config.request.body) if config.request.body else 0
    req_payload_size = 250 + req_body_len
    resp_payload_size = 200 + len(response.body)

    # 1. Run authoritative TCP simulation
    transport_cfg = TransportConfig(
        protocol=TransportProtocol.TCP,
        source_node_id=config.client_node_id,
        destination_node_id=config.server_node_id,
        source_port=52140,
        destination_port=config.port,
        payload_bytes=req_payload_size + resp_payload_size,
        segment_size_bytes=1460,
        initial_sequence_number=1000,
        initial_cwnd_mss=1.0,
        initial_ssthresh_mss=16.0,
        initial_rto_us=100_000,
        receive_window_bytes=65535,
        seed=config.seed,
        dropped_segments=[],
        maximum_retries=5,
    )

    path_nodes, hop_links = resolve_route_and_links(transport_cfg, project)
    tcp_result = simulate_tcp(transport_cfg, project)

    # 2. TCP 3-Way Handshake event
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="HTTP",
            event_type="HTTP_TCP_HANDSHAKE_INITIATED",
            description=f"Client {config.client_node_id} initiating TCP connection to {config.server_node_id}:{config.port} (SYN)",
            packet_id=None,
            session_id="http-session-1",
            details="Three-way handshake SYN sent",
        )
    )
    step_index += 1

    curr_time_us += 20_000

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="HTTP",
            event_type="HTTP_TCP_CONNECTED",
            description=f"TCP connection established between {config.client_node_id} and {config.server_node_id}:{config.port}",
            packet_id=None,
            session_id="http-session-1",
            details="Socket state: ESTABLISHED",
        )
    )
    step_index += 1

    # 3. HTTP Request Transmission
    req_pkt_id = "pkt-http-req-01"
    app_header_req = AppHeader(
        protocol="HTTP",
        payload_preview=f"{config.request.method.value} {config.request.path} HTTP/1.1 ({req_payload_size} bytes)",
        message_type="Request",
        session_id="http-session-1",
        transaction_id=1,
        resource_or_command=f"{config.request.method.value} {config.request.path}",
        status_code=None,
    )

    req_packet, req_arrival_us = build_application_packet(
        req_pkt_id,
        config.client_node_id,
        config.server_node_id,
        path_nodes,
        hop_links,
        app_header_req,
        "TCP",
        52140,
        config.port,
        1001,
        1,
        ["PSH", "ACK"],
        req_payload_size,
        curr_time_us,
    )

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="HTTP",
            event_type="HTTP_REQUEST_SENT",
            description=f"Client {config.client_node_id} dispatched {config.request.method.value} {config.request.path} HTTP/1.1 (Payload: {req_payload_size} bytes)",
            packet_id=req_pkt_id,
            session_id="http-session-1",
            details=f"Headers: {config.request.headers}",
        )
    )
    step_index += 1
    packets.append(req_packet)
    curr_time_us = req_arrival_us

    # 4. Server Route Processing
    curr_time_us += 50
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="HTTP",
            event_type="HTTP_NOT_FOUND" if response.status_code == 404 else "HTTP_REQUEST_PARSED",
            description=f"Server {config.server_node_id} evaluated endpoint '{config.request.path}' -> {response.status_code} {response.status_text}",
            packet_id=None,
            session_id="http-session-1",
            details=f"Controller executed endpoint; generating {len(response.body)} bytes response body",
        )
    )
    step_index += 1

    # 5. HTTP Response Transmission
    resp_pkt_id = "pkt-http-resp-01"
    app_header_resp = AppHeader(
        protocol="HTTP",
        payload_preview=f"HTTP/1.1 {response.status_code} {response.status_text} ({resp_payload_size} bytes)",
        message_type="Response",
        session_id="http-session-1",
        transaction_id=1,
        resource_or_command=f"{config.request.method.value} {config.request.path}",
        status_code=f"{response.status_code} {response.status_text}",
    )

    return_nodes = list(reversed(path_nodes))
    return_links = list(reversed(hop_links))

    resp_packet, resp_arrival_us = build_application_packet(
        resp_pkt_id,
        config.server_node_id,
        config.client_node_id,
        return_nodes,
        return_links,
        app_header_resp,
        "TCP",
        config.port,
        52140,
        5001,
        1001 + req_payload_size,
        ["PSH", "ACK"],
        resp_payload_size,
        curr_time_us,
    )

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="HTTP",
            event_type="HTTP_RESPONSE_SENT",
            description=f"Server {config.server_node_id} dispatched HTTP/1.1 {response.status_code} {response.status_text} (Body: {len(response.body)} bytes)",
            packet_id=resp_pkt_id,
            session_id="http-session-1",
            details=f"Headers: {response.headers}",
        )
    )
    step_index += 1
    packets.append(resp_packet)
    curr_time_us = resp_arrival_us

    # 6. Client Receives Response and Connection Closes
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="HTTP",
            event_type="HTTP_RESPONSE_RECEIVED",
            description=f"Client {config.client_node_id} received HTTP response (Status: {response.status_code} {response.status_text})",
            packet_id=None,
            session_id="http-session-1",
            details=f"Elapsed time: {curr_time_us} µs",
        )
    )
    step_index += 1

    curr_time_us += 10_000
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="HTTP",
            event_type="HTTP_TCP_CLOSED",
            description=f"TCP session closed via 4-step FIN-ACK teardown ({config.client_node_id}:52140 <-> {config.server_node_id}:{config.port})",
            packet_id=None,
            session_id="http-session-1",
            details="Connection: close enforced",
        )
    )

    sim_events = [app_event_to_sim_event(idx + 1, ev) for idx, ev in enumerate(events)]

    state = AppProtocolState.COMPLETED if response.status_code == 200 else AppProtocolState.FAILED

    metrics = AppProtocolMetrics(
        transaction_duration_us=curr_time_us,
        requests_sent=1,
        responses_received=1,
        payload_bytes_sent=req_payload_size,
        payload_bytes_received=resp_payload_size,
        success=(response.status_code == 200),
        error_message=(
            f"HTTP Error {response.status_code} {response.status_text}" if response.status_code != 200 else None
        ),
    )

    return HttpSimResult(
        config=config,
        state=state,
        response=response,
        events=events,
        sim_events=sim_events,
        tcp_events=tcp_result.events,
        packets=packets,
        metrics=metrics,
    )
