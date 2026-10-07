from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from netsim.application import (
    AppProtocolEvent,
    AppProtocolMetrics,
    AppProtocolState,
    app_event_to_sim_event,
    build_application_packet,
)
from netsim.core.events import SimEvent
from netsim.models.packet import AppHeader, Packet
from netsim.models.project import Project
from netsim.transport import (
    TransportConfig,
    TransportProtocol,
    resolve_route_and_links,
)


@dataclass
class SmtpConfig:
    client_node_id: str = "host-a"
    server_node_id: str = "mail-server"
    mail_from: str = "alice@example.com"
    rcpt_to: str = "bob@example.com"
    subject: str = "Quarterly Network Simulation Report"
    body: str = "Hello Bob,\nHere is the updated NetSim simulation data.\nRegards,\nAlice"
    reject_recipient: bool = False
    port: int = 25
    seed: int = 42

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SmtpConfig:
        return cls(
            client_node_id=data.get("client_node_id", "host-a"),
            server_node_id=data.get("server_node_id", "mail-server"),
            mail_from=data.get("mail_from", "alice@example.com"),
            rcpt_to=data.get("rcpt_to", "bob@example.com"),
            subject=data.get("subject", "Quarterly Network Simulation Report"),
            body=data.get(
                "body",
                "Hello Bob,\nHere is the updated NetSim simulation data.\nRegards,\nAlice",
            ),
            reject_recipient=bool(data.get("reject_recipient", False)),
            port=int(data.get("port", 25)),
            seed=int(data.get("seed", 42)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "client_node_id": self.client_node_id,
            "server_node_id": self.server_node_id,
            "mail_from": self.mail_from,
            "rcpt_to": self.rcpt_to,
            "subject": self.subject,
            "body": self.body,
            "reject_recipient": self.reject_recipient,
            "port": self.port,
            "seed": self.seed,
        }


@dataclass
class SmtpSimResult:
    config: SmtpConfig
    state: AppProtocolState
    is_accepted: bool
    events: list[AppProtocolEvent]
    sim_events: list[SimEvent]
    packets: list[Packet]
    metrics: AppProtocolMetrics

    def to_dict(self) -> dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "state": self.state.value,
            "is_accepted": self.is_accepted,
            "events": [e.to_dict() for e in self.events],
            "sim_events": [se.to_dict() for se in self.sim_events],
            "packets": [p.to_dict() for p in self.packets],
            "metrics": self.metrics.to_dict(),
        }


def simulate_smtp(config: SmtpConfig, project: Project | None = None) -> SmtpSimResult:
    events: list[AppProtocolEvent] = []
    packets: list[Packet] = []
    step_index = 0
    curr_time_us = 0

    session_id = f"smtp-sess-{config.port}"

    transport_cfg = TransportConfig(
        protocol=TransportProtocol.TCP,
        source_node_id=config.client_node_id,
        destination_node_id=config.server_node_id,
        source_port=49152,
        destination_port=config.port,
        payload_bytes=2000,
        segment_size_bytes=1460,
        initial_sequence_number=1,
        initial_cwnd_mss=1.0,
        initial_ssthresh_mss=16.0,
        initial_rto_us=100_000,
        receive_window_bytes=65535,
        seed=config.seed,
        dropped_segments=[],
        maximum_retries=5,
    )

    path_nodes, hop_links = resolve_route_and_links(transport_cfg, project)
    return_nodes = list(reversed(path_nodes))
    return_links = list(reversed(hop_links))

    # 1. TCP Connected
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="SMTP",
            event_type="SMTP_CONNECTED",
            description=f"TCP connection established to SMTP server {config.server_node_id}:{config.port}",
            packet_id=None,
            session_id=session_id,
            details=f"Port: {config.port}",
        )
    )
    step_index += 1
    curr_time_us += 5000

    # 2. Server Greeting (220)
    pkt_id_220 = "pkt-smtp-220"
    pkt_220, arr_220 = build_application_packet(
        pkt_id_220,
        config.server_node_id,
        config.client_node_id,
        return_nodes,
        return_links,
        AppHeader(
            protocol="SMTP",
            payload_preview="220 mail.example.com ESMTP Postfix (NetSim)",
            message_type="Greeting",
            session_id=session_id,
            transaction_id=1,
            resource_or_command="220",
            status_code="220 Service Ready",
        ),
        "TCP",
        config.port,
        49152,
        100,
        1,
        ["ACK"],
        64,
        curr_time_us,
    )
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="SMTP",
            event_type="SMTP_GREETING",
            description="Server sent 220 mail.example.com ESMTP Postfix",
            packet_id=pkt_id_220,
            session_id=session_id,
            details="SMTP Service Ready",
        )
    )
    step_index += 1
    packets.append(pkt_220)
    curr_time_us = arr_220 + 1000

    # 3. EHLO Command
    pkt_id_ehlo = "pkt-smtp-ehlo"
    pkt_ehlo, arr_ehlo = build_application_packet(
        pkt_id_ehlo,
        config.client_node_id,
        config.server_node_id,
        path_nodes,
        hop_links,
        AppHeader(
            protocol="SMTP",
            payload_preview="EHLO client.example.com",
            message_type="Command",
            session_id=session_id,
            transaction_id=2,
            resource_or_command="EHLO",
            status_code=None,
        ),
        "TCP",
        49152,
        config.port,
        200,
        164,
        ["PSH", "ACK"],
        32,
        curr_time_us,
    )
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="SMTP",
            event_type="SMTP_COMMAND",
            description="Client sent EHLO client.example.com",
            packet_id=pkt_id_ehlo,
            session_id=session_id,
            details="Client greeting",
        )
    )
    step_index += 1
    packets.append(pkt_ehlo)
    curr_time_us = arr_ehlo + 1000

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="SMTP",
            event_type="SMTP_RESPONSE",
            description="Server sent 250-mail.example.com Hello client.example.com",
            packet_id=None,
            session_id=session_id,
            details="250 OK",
        )
    )
    step_index += 1
    curr_time_us += 1000

    # 4. MAIL FROM Command
    pkt_id_mf = "pkt-smtp-mail-from"
    mf_str = f"MAIL FROM:<{config.mail_from}>"
    pkt_mf, arr_mf = build_application_packet(
        pkt_id_mf,
        config.client_node_id,
        config.server_node_id,
        path_nodes,
        hop_links,
        AppHeader(
            protocol="SMTP",
            payload_preview=mf_str,
            message_type="Command",
            session_id=session_id,
            transaction_id=3,
            resource_or_command=mf_str,
            status_code=None,
        ),
        "TCP",
        49152,
        config.port,
        300,
        250,
        ["PSH", "ACK"],
        len(mf_str),
        curr_time_us,
    )
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="SMTP",
            event_type="SMTP_COMMAND",
            description=f"Client sent {mf_str}",
            packet_id=pkt_id_mf,
            session_id=session_id,
            details=f"Sender: {config.mail_from}",
        )
    )
    step_index += 1
    packets.append(pkt_mf)
    curr_time_us = arr_mf + 1000

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="SMTP",
            event_type="SMTP_RESPONSE",
            description="Server sent 250 2.1.0 Ok (Sender verified)",
            packet_id=None,
            session_id=session_id,
            details="Sender accepted",
        )
    )
    step_index += 1
    curr_time_us += 1000

    # 5. RCPT TO Command
    pkt_id_rcpt = "pkt-smtp-rcpt-to"
    rcpt_str = f"RCPT TO:<{config.rcpt_to}>"
    pkt_rcpt, arr_rcpt = build_application_packet(
        pkt_id_rcpt,
        config.client_node_id,
        config.server_node_id,
        path_nodes,
        hop_links,
        AppHeader(
            protocol="SMTP",
            payload_preview=rcpt_str,
            message_type="Command",
            session_id=session_id,
            transaction_id=4,
            resource_or_command=rcpt_str,
            status_code=None,
        ),
        "TCP",
        49152,
        config.port,
        400,
        350,
        ["PSH", "ACK"],
        len(rcpt_str),
        curr_time_us,
    )
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="SMTP",
            event_type="SMTP_COMMAND",
            description=f"Client sent {rcpt_str}",
            packet_id=pkt_id_rcpt,
            session_id=session_id,
            details=f"Recipient: {config.rcpt_to}",
        )
    )
    step_index += 1
    packets.append(pkt_rcpt)
    curr_time_us = arr_rcpt + 1000

    if config.reject_recipient:
        events.append(
            AppProtocolEvent(
                step_index=step_index,
                timestamp_us=curr_time_us,
                node_id=config.server_node_id,
                protocol="SMTP",
                event_type="SMTP_RCPT_REJECTED",
                description=f"Server rejected recipient: 550 5.1.1 <{config.rcpt_to}>: User unknown in virtual mailbox",
                packet_id=None,
                session_id=session_id,
                details="Status 550 Recipient rejected",
            )
        )

        sim_events = [app_event_to_sim_event(idx + 1, ev) for idx, ev in enumerate(events)]

        return SmtpSimResult(
            config=config,
            state=AppProtocolState.FAILED,
            is_accepted=False,
            events=events,
            sim_events=sim_events,
            packets=packets,
            metrics=AppProtocolMetrics(
                transaction_duration_us=curr_time_us,
                requests_sent=3,
                responses_received=3,
                payload_bytes_sent=150,
                payload_bytes_received=150,
                success=False,
                error_message="Recipient rejected: 550 User unknown",
            ),
        )

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="SMTP",
            event_type="SMTP_RESPONSE",
            description="Server sent 250 2.1.5 Ok (Recipient accepted)",
            packet_id=None,
            session_id=session_id,
            details="Recipient accepted",
        )
    )
    step_index += 1
    curr_time_us += 1000

    # 6. DATA Command
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="SMTP",
            event_type="SMTP_COMMAND",
            description="Client sent DATA",
            packet_id=None,
            session_id=session_id,
            details="Entering data mode",
        )
    )
    step_index += 1
    curr_time_us += 1000

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="SMTP",
            event_type="SMTP_RESPONSE",
            description="Server sent 354 End data with <CR><LF>.<CR><LF>",
            packet_id=None,
            session_id=session_id,
            details="Ready for mail content",
        )
    )
    step_index += 1
    curr_time_us += 1000

    # 7. Message Content Transfer
    full_content = (
        f"Subject: {config.subject}\r\nFrom: {config.mail_from}\r\nTo: {config.rcpt_to}\r\n\r\n{config.body}\r\n.\r\n"
    )
    pkt_id_data = "pkt-smtp-data-msg"
    pkt_data, arr_data = build_application_packet(
        pkt_id_data,
        config.client_node_id,
        config.server_node_id,
        path_nodes,
        hop_links,
        AppHeader(
            protocol="SMTP",
            payload_preview=f"Subject: {config.subject}",
            message_type="Mail Data",
            session_id=session_id,
            transaction_id=5,
            resource_or_command=f"Subject: {config.subject}",
            status_code=None,
        ),
        "TCP",
        49152,
        config.port,
        500,
        450,
        ["PSH", "ACK"],
        len(full_content),
        curr_time_us,
    )
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="SMTP",
            event_type="SMTP_DATA_TRANSFER",
            description=f"Client dispatched email payload ({len(full_content)} bytes, Subject: '{config.subject}')",
            packet_id=pkt_id_data,
            session_id=session_id,
            details="Message content transferred",
        )
    )
    step_index += 1
    packets.append(pkt_data)
    curr_time_us = arr_data + 1000

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="SMTP",
            event_type="SMTP_MESSAGE_ACCEPTED",
            description="Server sent 250 2.0.0 Ok: queued as 4X8Z9Q001Z (Message accepted for delivery)",
            packet_id=None,
            session_id=session_id,
            details="Queue ID: 4X8Z9Q001Z",
        )
    )
    step_index += 1
    curr_time_us += 1000

    # 8. QUIT & 221 Bye
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="SMTP",
            event_type="SMTP_COMMAND",
            description="Client sent QUIT",
            packet_id=None,
            session_id=session_id,
            details="Closing session",
        )
    )
    step_index += 1

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us + 1000,
            node_id=config.server_node_id,
            protocol="SMTP",
            event_type="SMTP_RESPONSE",
            description="Server sent 221 2.0.0 Bye (Connection closed)",
            packet_id=None,
            session_id=session_id,
            details="Session cleanly closed",
        )
    )

    sim_events = [app_event_to_sim_event(idx + 1, ev) for idx, ev in enumerate(events)]

    metrics = AppProtocolMetrics(
        transaction_duration_us=curr_time_us + 1000,
        requests_sent=5,
        responses_received=5,
        payload_bytes_sent=len(full_content) + 150,
        payload_bytes_received=300,
        success=True,
        error_message=None,
    )

    return SmtpSimResult(
        config=config,
        state=AppProtocolState.COMPLETED,
        is_accepted=True,
        events=events,
        sim_events=sim_events,
        packets=packets,
        metrics=metrics,
    )
