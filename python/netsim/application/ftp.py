from __future__ import annotations

from dataclasses import dataclass
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
from netsim.models.packet import AppHeader, Packet
from netsim.models.project import Project
from netsim.transport import (
    TransportConfig,
    TransportProtocol,
    resolve_route_and_links,
)


class FtpCommand(str, Enum):
    USER = "USER"
    PASS = "PASS"
    LIST = "LIST"
    RETR = "RETR"
    STOR = "STOR"
    QUIT = "QUIT"


class FtpChannelType(str, Enum):
    CONTROL = "control"
    DATA = "data"


@dataclass
class FtpConfig:
    client_node_id: str = "host-a"
    server_node_id: str = "ftp-server"
    username: str = "anonymous"
    password: str | None = "guest@example.com"
    transfer_command: FtpCommand = FtpCommand.RETR
    filename: str | None = "research_paper.pdf"
    file_size_bytes: int = 4096
    control_port: int = 21
    data_port: int = 50000
    seed: int = 42

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FtpConfig:
        cmd_str = data.get("transfer_command", "RETR")
        cmd = FtpCommand(cmd_str) if isinstance(cmd_str, str) else cmd_str
        return cls(
            client_node_id=data.get("client_node_id", "host-a"),
            server_node_id=data.get("server_node_id", "ftp-server"),
            username=data.get("username", "anonymous"),
            password=data.get("password", "guest@example.com"),
            transfer_command=cmd,
            filename=data.get("filename", "research_paper.pdf"),
            file_size_bytes=int(data.get("file_size_bytes", 4096)),
            control_port=int(data.get("control_port", 21)),
            data_port=int(data.get("data_port", 50000)),
            seed=int(data.get("seed", 42)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "client_node_id": self.client_node_id,
            "server_node_id": self.server_node_id,
            "username": self.username,
            "password": self.password,
            "transfer_command": self.transfer_command.value,
            "filename": self.filename,
            "file_size_bytes": self.file_size_bytes,
            "control_port": self.control_port,
            "data_port": self.data_port,
            "seed": self.seed,
        }


@dataclass
class FtpSimResult:
    config: FtpConfig
    state: AppProtocolState
    control_session_id: str
    data_session_id: str
    events: list[AppProtocolEvent]
    sim_events: list[SimEvent]
    packets: list[Packet]
    metrics: AppProtocolMetrics

    def to_dict(self) -> dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "state": self.state.value,
            "control_session_id": self.control_session_id,
            "data_session_id": self.data_session_id,
            "events": [e.to_dict() for e in self.events],
            "sim_events": [se.to_dict() for se in self.sim_events],
            "packets": [p.to_dict() for p in self.packets],
            "metrics": self.metrics.to_dict(),
        }


def simulate_ftp(config: FtpConfig, project: Project | None = None) -> FtpSimResult:
    events: list[AppProtocolEvent] = []
    packets: list[Packet] = []
    step_index = 0
    curr_time_us = 0

    control_session_id = "ftp-ctrl-sess-21"
    data_session_id = f"ftp-data-sess-{config.data_port}"

    transport_cfg = TransportConfig(
        protocol=TransportProtocol.TCP,
        source_node_id=config.client_node_id,
        destination_node_id=config.server_node_id,
        source_port=49152,
        destination_port=config.control_port,
        payload_bytes=1000,
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

    # 1. Control Channel Connection Established
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="FTP",
            event_type="FTP_CONTROL_CONNECTED",
            description=f"Control channel TCP established on port {config.control_port} between {config.client_node_id} and {config.server_node_id}",
            packet_id=None,
            session_id=control_session_id,
            details=f"Channel: Control, Port: {config.control_port}",
        )
    )
    step_index += 1

    # 2. Server Greeting (220)
    pkt_id_220 = "pkt-ftp-ctrl-220"
    pkt_220, arr_220 = build_application_packet(
        pkt_id_220,
        config.server_node_id,
        config.client_node_id,
        return_nodes,
        return_links,
        AppHeader(
            protocol="FTP",
            payload_preview="220 NetSim FTP Server ready",
            message_type="Control Response",
            session_id=control_session_id,
            transaction_id=1,
            resource_or_command="220",
            status_code="220 Service Ready",
        ),
        "TCP",
        config.control_port,
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
            protocol="FTP",
            event_type="FTP_SERVER_GREETING",
            description="FTP Server greeting: 220 NetSim FTP Server ready",
            packet_id=pkt_id_220,
            session_id=control_session_id,
            details="Control Channel Port 21",
        )
    )
    step_index += 1
    packets.append(pkt_220)
    curr_time_us = arr_220 + 500

    # 3. USER Command
    pkt_id_user = "pkt-ftp-ctrl-user"
    pkt_user, arr_user = build_application_packet(
        pkt_id_user,
        config.client_node_id,
        config.server_node_id,
        path_nodes,
        hop_links,
        AppHeader(
            protocol="FTP",
            payload_preview=f"USER {config.username}",
            message_type="Control Command",
            session_id=control_session_id,
            transaction_id=2,
            resource_or_command=f"USER {config.username}",
            status_code=None,
        ),
        "TCP",
        49152,
        config.control_port,
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
            protocol="FTP",
            event_type="FTP_CONTROL_COMMAND",
            description=f"Client sent USER {config.username}",
            packet_id=pkt_id_user,
            session_id=control_session_id,
            details="Authenticating user",
        )
    )
    step_index += 1
    packets.append(pkt_user)
    curr_time_us = arr_user + 500

    # 4. PASS Command & 230 Login
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="FTP",
            event_type="FTP_LOGIN",
            description=f"Server accepted credentials: 230 User '{config.username}' logged in, proceed",
            packet_id=None,
            session_id=control_session_id,
            details="Status 230 User logged in",
        )
    )
    step_index += 1
    curr_time_us += 1000

    # 5. Transfer Request Command on Control Channel
    if config.transfer_command == FtpCommand.LIST:
        transfer_cmd_str = "LIST"
    elif config.transfer_command == FtpCommand.RETR:
        transfer_cmd_str = f"RETR {config.filename or 'file.dat'}"
    elif config.transfer_command == FtpCommand.STOR:
        transfer_cmd_str = f"STOR {config.filename or 'file.dat'}"
    elif config.transfer_command == FtpCommand.QUIT:
        transfer_cmd_str = "QUIT"
    else:
        transfer_cmd_str = "LIST"

    pkt_id_cmd = "pkt-ftp-ctrl-cmd"
    pkt_cmd, arr_cmd = build_application_packet(
        pkt_id_cmd,
        config.client_node_id,
        config.server_node_id,
        path_nodes,
        hop_links,
        AppHeader(
            protocol="FTP",
            payload_preview=transfer_cmd_str,
            message_type="Control Command",
            session_id=control_session_id,
            transaction_id=3,
            resource_or_command=transfer_cmd_str,
            status_code=None,
        ),
        "TCP",
        49152,
        config.control_port,
        300,
        250,
        ["PSH", "ACK"],
        64,
        curr_time_us,
    )
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="FTP",
            event_type="FTP_CONTROL_COMMAND",
            description=f"Client requested transfer: {transfer_cmd_str}",
            packet_id=pkt_id_cmd,
            session_id=control_session_id,
            details=f"Control command on port {config.control_port}",
        )
    )
    step_index += 1
    packets.append(pkt_cmd)
    curr_time_us = arr_cmd + 500

    # 6. Data Channel Establishment
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="FTP",
            event_type="FTP_DATA_CHANNEL_OPENED",
            description=f"Server opening dedicated DATA channel TCP connection on port {config.data_port}",
            packet_id=None,
            session_id=data_session_id,
            details="150 File status okay; about to open data connection",
        )
    )
    step_index += 1
    curr_time_us += 5000

    # 7. Actual File Data Transfer on Data Channel
    data_pkt_id = "pkt-ftp-data-01"
    is_download = config.transfer_command in (FtpCommand.RETR, FtpCommand.LIST)
    if is_download:
        data_src, data_dst, d_nodes, d_links = (
            config.server_node_id,
            config.client_node_id,
            return_nodes,
            return_links,
        )
    else:
        data_src, data_dst, d_nodes, d_links = (
            config.client_node_id,
            config.server_node_id,
            path_nodes,
            hop_links,
        )

    data_pkt, arr_data = build_application_packet(
        data_pkt_id,
        data_src,
        data_dst,
        d_nodes,
        d_links,
        AppHeader(
            protocol="FTP",
            payload_preview=f"FTP Data Payload ({config.file_size_bytes} bytes for {transfer_cmd_str})",
            message_type="Data Transfer",
            session_id=data_session_id,
            transaction_id=10,
            resource_or_command=transfer_cmd_str,
            status_code=None,
        ),
        "TCP",
        config.data_port,
        50001,
        10000,
        1,
        ["ACK"],
        config.file_size_bytes,
        curr_time_us,
    )

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=data_src,
            protocol="FTP",
            event_type="FTP_DATA_TRANSFER",
            description=f"DATA channel transfer: {config.file_size_bytes} bytes transferred ({transfer_cmd_str})",
            packet_id=data_pkt_id,
            session_id=data_session_id,
            details=f"Data channel port: {config.data_port}, Total payload: {config.file_size_bytes} bytes",
        )
    )
    step_index += 1
    packets.append(data_pkt)
    curr_time_us = arr_data + 1000

    # 8. Data Channel Closes & 226 Transfer Complete
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.server_node_id,
            protocol="FTP",
            event_type="FTP_TRANSFER_COMPLETE",
            description="226 Closing data connection; transfer successful",
            packet_id=None,
            session_id=control_session_id,
            details="Data channel closed; status 226 emitted on control channel",
        )
    )
    step_index += 1

    # 9. QUIT Command & 221 Goodbye
    curr_time_us += 5000
    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us,
            node_id=config.client_node_id,
            protocol="FTP",
            event_type="FTP_CONTROL_COMMAND",
            description="Client sent QUIT on control channel",
            packet_id=None,
            session_id=control_session_id,
            details="Terminating FTP session",
        )
    )
    step_index += 1

    events.append(
        AppProtocolEvent(
            step_index=step_index,
            timestamp_us=curr_time_us + 1000,
            node_id=config.server_node_id,
            protocol="FTP",
            event_type="FTP_SESSION_CLOSED",
            description="Server: 221 Goodbye; Control connection closed",
            packet_id=None,
            session_id=control_session_id,
            details="Session cleanly closed",
        )
    )

    sim_events = [app_event_to_sim_event(idx + 1, ev) for idx, ev in enumerate(events)]

    metrics = AppProtocolMetrics(
        transaction_duration_us=curr_time_us,
        requests_sent=4,
        responses_received=4,
        payload_bytes_sent=128,
        payload_bytes_received=config.file_size_bytes + 256,
        success=True,
        error_message=None,
    )

    return FtpSimResult(
        config=config,
        state=AppProtocolState.COMPLETED,
        control_session_id=control_session_id,
        data_session_id=data_session_id,
        events=events,
        sim_events=sim_events,
        packets=packets,
        metrics=metrics,
    )
