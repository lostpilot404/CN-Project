"""Authoritative NetSim Python API Server.
Provides JSON RPC / HTTP interface for the presentation frontend and desktop shell.
"""

# ruff: noqa: E402
from __future__ import annotations

import copy
import ipaddress
import json
import logging
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

# Ensure parent directory (python/) is on sys.path
_pkg_root = str(Path(__file__).resolve().parent.parent)
if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)

from netsim.addressing.ipv4 import (
    calculate_subnet,
    detect_duplicate_ips,
    split_equal_subnets,
)
from netsim.addressing.ipv6 import analyze_ipv6_address
from netsim.addressing.nat import NatProtocol, NatTable
from netsim.addressing.vlsm import VlsmSubnetRequirement, allocate_vlsm
from netsim.application.dns import DnsConfig, simulate_dns
from netsim.application.ftp import FtpConfig, simulate_ftp
from netsim.application.http import HttpConfig, simulate_http
from netsim.application.smtp import SmtpConfig, simulate_smtp
from netsim.application.snmp import SnmpConfig, simulate_snmp
from netsim.core.engine import DEFAULT_PACKET_TTL, MAX_PACKET_TTL, SimulationEngine
from netsim.core.schema import require_int, require_non_empty
from netsim.datalink.checksum import internet_checksum, verify_checksum
from netsim.datalink.crc import calculate_crc, verify_crc
from netsim.datalink.flow_control import (
    FlowControlConfig,
    simulate_go_back_n,
    simulate_selective_repeat,
    simulate_sliding_window,
)
from netsim.datalink.hamming import ParityMode, hamming_encode, verify_and_correct_hamming
from netsim.datalink.mac import MacConfig, MacProtocol, simulate_mac
from netsim.experiments.config import ComparativeExperimentConfig, SweepConfig
from netsim.experiments.runner import run_comparative_experiment, run_parameter_sweep
from netsim.faults.model import FaultScheduleEntry, FaultType
from netsim.models.interface import Interface, InterfaceStatus
from netsim.models.link import Link, LinkEndpoint, LinkStatus
from netsim.models.node import Node, NodeState, NodeType, Position
from netsim.models.project import Project, ProjectMetadata
from netsim.qos.metrics import compute_network_qos
from netsim.routing.bellman_ford import (
    compute_bellman_ford_shortest_paths,
    simulate_distance_vector_convergence,
)
from netsim.routing.dijkstra import compute_dijkstra_shortest_paths
from netsim.routing.graph import MetricType, RoutingGraph
from netsim.switching.circuit import CircuitManager
from netsim.transport import TransportConfig
from netsim.transport.tcp import simulate_tcp
from netsim.transport.udp import simulate_udp

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("netsim.server")


def create_default_project() -> Project:
    node1 = Node(
        id="node-1",
        label="Workstation PC1",
        node_type=NodeType.PC,
        position=Position(x=120, y=180),
        interfaces=[
            Interface(
                id="if-1",
                name="eth0",
                node_id="node-1",
                mac_address="02:00:00:00:00:01",
                ipv4="192.168.1.10",
                subnet_mask="255.255.255.0",
            )
        ],
    )
    node2 = Node(
        id="node-2",
        label="Core Router R1",
        node_type=NodeType.ROUTER,
        position=Position(x=380, y=180),
        interfaces=[
            Interface(
                id="if-2a",
                name="eth0",
                node_id="node-2",
                mac_address="02:00:00:00:00:02",
                ipv4="192.168.1.1",
                subnet_mask="255.255.255.0",
            ),
            Interface(
                id="if-2b",
                name="eth1",
                node_id="node-2",
                mac_address="02:00:00:00:00:03",
                ipv4="10.0.0.1",
                subnet_mask="255.255.255.0",
            ),
        ],
    )
    node3 = Node(
        id="node-3",
        label="Server S1",
        node_type=NodeType.SERVER,
        position=Position(x=640, y=180),
        interfaces=[
            Interface(
                id="if-3",
                name="eth0",
                node_id="node-3",
                mac_address="02:00:00:00:00:04",
                ipv4="10.0.0.100",
                subnet_mask="255.255.255.0",
            )
        ],
    )
    link1 = Link(
        id="link-1",
        source=LinkEndpoint(node_id="node-1", interface_id="if-1"),
        target=LinkEndpoint(node_id="node-2", interface_id="if-2a"),
        bandwidth_bps=10_000_000,
        propagation_delay_us=5_000,
        loss_probability=0.0,
        bit_error_rate=0.0,
        queue_capacity=50,
        status=LinkStatus.UP,
    )
    link2 = Link(
        id="link-2",
        source=LinkEndpoint(node_id="node-2", interface_id="if-2b"),
        target=LinkEndpoint(node_id="node-3", interface_id="if-3"),
        bandwidth_bps=10_000_000,
        propagation_delay_us=5_000,
        loss_probability=0.0,
        bit_error_rate=0.0,
        queue_capacity=50,
        status=LinkStatus.UP,
    )
    # Mark the interfaces as attached so the topology editor can show live port bindings.
    for link in (link1, link2):
        for endpoint in (link.source, link.target):
            node = next((n for n in (node1, node2, node3) if n.id == endpoint.node_id), None)
            if node is not None:
                node.attach_link(endpoint.interface_id, link.id)

    return Project(
        schema_version=1,
        metadata=ProjectMetadata(
            name="Default NetSim Topology",
            description="B.Tech CSE Network Simulation Studio",
            author="NetSim Student",
        ),
        nodes=[node1, node2, node3],
        links=[link1, link2],
    )


class SessionState:
    def __init__(self) -> None:
        self.project = create_default_project()
        self.engine = SimulationEngine(seed=42)
        self.engine.update_topology(self.project.nodes, self.project.links)
        self.undo_stack: list[Project] = []
        self.redo_stack: list[Project] = []
        self.nat_tables: dict[str, NatTable] = {}
        self.circuit_manager = CircuitManager()

    def push_undo(self) -> None:
        self.undo_stack.append(copy.deepcopy(self.project))
        self.redo_stack.clear()
        if len(self.undo_stack) > 50:
            self.undo_stack.pop(0)

    def reset_engine(self) -> None:
        self.engine.reset()
        self.engine.update_topology(self.project.nodes, self.project.links)


SESSION = SessionState()

SERVER_VERSION = "0.9.0"
# Hard request-body cap (bytes). Project documents are small JSON; anything larger is
# refused with a structured 413 before it is read into memory.
MAX_REQUEST_BYTES = 5 * 1024 * 1024


class CommandError(ValueError):
    """Raised for invalid request payloads; reported to clients as HTTP 400."""


class UnknownCommandError(CommandError):
    """Raised when a client requests an API command that does not exist."""


def arg(args: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """Return the first *present* key value, honouring explicit falsy values.

    Using an explicit membership test (rather than ``or``) prevents valid zero values
    such as ``loss_probability=0.0`` from silently falling through to a default.
    """
    for key in keys:
        if key in args and args[key] is not None:
            return args[key]
    return default


def find_node(node_id: str) -> Node:
    node = next((n for n in SESSION.project.nodes if n.id == node_id), None)
    if node is None:
        raise CommandError(f"Node '{node_id}' not found")
    return node


def unique_node_id() -> str:
    existing = {n.id for n in SESSION.project.nodes}
    i = len(existing) + 1
    while f"node-{i}" in existing:
        i += 1
    return f"node-{i}"


def unique_link_id() -> str:
    existing = {lnk.id for lnk in SESSION.project.links}
    i = len(existing) + 1
    while f"link-{i}" in existing:
        i += 1
    return f"link-{i}"


MAX_INTERFACES_PER_NODE = 24


def _interface_mac(node: Node, index: int) -> str:
    """Deterministic, locally administered MAC address for a generated port."""
    h = 0
    for b in node.id.encode("utf-8"):
        h = ((h * 31) + b) & 0xFFFFFFFF
    return f"02:00:00:{index:02x}:{(h >> 8) & 0xFF:02x}:{h & 0xFF:02x}"


def provision_interface(node: Node) -> Interface:
    """Create a new, unconnected interface on *node*.

    Nodes are created with a fixed number of ports. Without this a node that already uses all
    of its ports can never be connected again, which makes the topology editor unusable as soon
    as the shipped default project is loaded (all three default nodes have every port in use).
    """
    if len(node.interfaces) >= MAX_INTERFACES_PER_NODE:
        raise CommandError(f"Node '{node.id}' already has the maximum of {MAX_INTERFACES_PER_NODE} interfaces")
    used = set()
    for iface in node.interfaces:
        match = re.fullmatch(r"eth(\d+)", iface.name)
        if match:
            used.add(int(match.group(1)))
    index = 0
    while index in used:
        index += 1
    existing_ids = {i.id for i in node.interfaces}
    iface_id = f"{node.id}-eth{index}"
    while iface_id in existing_ids:
        index += 1
        iface_id = f"{node.id}-eth{index}"
    iface = Interface(
        id=iface_id,
        name=f"eth{index}",
        node_id=node.id,
        mac_address=_interface_mac(node, index),
    )
    node.interfaces.append(iface)
    return iface


def resolve_link_endpoint(node: Node, interface_id: str | None) -> Interface:
    """Resolve an endpoint interface, provisioning a fresh port when required.

    An explicitly requested interface must exist and be free; otherwise the first free port is
    used, and a new port is created when every existing port is taken.
    """
    if interface_id:
        iface = next((i for i in node.interfaces if i.id == interface_id or i.name == interface_id), None)
        if iface is None:
            raise CommandError(f"Interface '{interface_id}' not found on node '{node.id}'")
        if iface.link_id is not None:
            raise CommandError(
                f"Interface '{iface.name}' on node '{node.id}' is already connected to link '{iface.link_id}'"
            )
        return iface
    free = node.first_free_interface()
    if free is not None:
        return free
    return provision_interface(node)


def parse_enum(enum_cls: Any, value: Any, field: str) -> Any:
    """Case-sensitive enum lookup with an explicit list of accepted values in the message.

    Callers normalise the casing to the enum's own convention first (for example ``.upper()``
    for ``NatProtocol``, whose members are upper-case protocol names).
    """
    try:
        return enum_cls(value)
    except ValueError as exc:
        allowed = ", ".join(sorted(m.value for m in enum_cls))
        raise CommandError(f"Invalid {field} '{value}'. Expected one of: {allowed}") from exc


def validate_project(project: Project) -> None:
    """Structural validation shared by load/create paths."""
    node_ids = [n.id for n in project.nodes]
    if len(node_ids) != len(set(node_ids)):
        raise CommandError("Project contains duplicate node identifiers")
    known = set(node_ids)
    link_ids = [lnk.id for lnk in project.links]
    if len(link_ids) != len(set(link_ids)):
        raise CommandError("Project contains duplicate link identifiers")
    for link in project.links:
        if link.source.node_id not in known:
            raise CommandError(f"Link '{link.id}' references unknown source node '{link.source.node_id}'")
        if link.target.node_id not in known:
            raise CommandError(f"Link '{link.id}' references unknown target node '{link.target.node_id}'")
        try:
            link.validate()
        except ValueError as exc:
            raise CommandError(f"Link '{link.id}' is invalid: {exc}") from exc


def config_arg(args: dict[str, Any], key: str = "config") -> dict[str, Any]:
    """Return the nested configuration object, rejecting non-object payloads.

    Commands consistently take ``{"config": {...}}``. A caller that sends a string, list or
    ``null`` where an object is expected must get a structured 400 rather than a parser fault.
    """
    raw = args.get(key)
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise CommandError(f"'{key}' must be a JSON object (received {type(raw).__name__})")
    return raw


def _transport_config(args: dict[str, Any]) -> TransportConfig:
    cfg_data = config_arg(args)
    if not isinstance(cfg_data, dict):
        raise CommandError("Transport configuration must be an object")
    cfg_data = dict(cfg_data)
    if SESSION.project.nodes:
        cfg_data.setdefault("source_node_id", SESSION.project.nodes[0].id)
        cfg_data.setdefault("destination_node_id", SESSION.project.nodes[-1].id)
    try:
        cfg = TransportConfig.from_dict(cfg_data)
    except (ValueError, TypeError) as exc:
        raise CommandError(f"Invalid transport configuration: {exc}") from exc
    if cfg.source_node_id == cfg.destination_node_id:
        raise CommandError("Source and destination nodes must differ for a transport session")
    if cfg.segment_size_bytes < 1:
        raise CommandError("Segment size must be at least 1 byte")
    if cfg.payload_bytes < 1:
        raise CommandError("Payload size must be at least 1 byte")
    return cfg


def _validate_fault_target(fault: FaultType) -> None:
    """Reject faults that could never take effect.

    A fault pointing at a link or node that does not exist used to be accepted and then silently
    ignored when the engine executed it, so the UI reported a scheduled fault that did nothing.
    """
    if fault.link_id is not None:
        if not any(link.id == fault.link_id for link in SESSION.project.links):
            raise CommandError(f"Fault targets unknown link '{fault.link_id}'")
    if fault.node_id is not None:
        if not any(node.id == fault.node_id for node in SESSION.project.nodes):
            raise CommandError(f"Fault targets unknown node '{fault.node_id}'")
    if fault.type in ("link_down", "link_restore", "bandwidth_degradation", "queue_capacity_change", "bit_error"):
        if not fault.link_id:
            raise CommandError(f"Fault type '{fault.type}' requires a 'link_id'")
    if fault.type in ("node_failure", "node_recovery") and not fault.node_id:
        raise CommandError(f"Fault type '{fault.type}' requires a 'node_id'")
    if fault.type == "bandwidth_degradation":
        if fault.new_bandwidth_bps is None or int(fault.new_bandwidth_bps) < 1:
            raise CommandError("'bandwidth_degradation' requires 'new_bandwidth_bps' >= 1")
    if fault.type == "queue_capacity_change":
        if fault.new_capacity is None or int(fault.new_capacity) < 1:
            raise CommandError("'queue_capacity_change' requires 'new_capacity' >= 1")
    if fault.type == "bit_error":
        rate = fault.error_rate
        if rate is None or not (0.0 <= float(rate) <= 1.0):
            raise CommandError("'bit_error' requires 'error_rate' between 0.0 and 1.0")


def dispatch_command(cmd: str, args: dict[str, Any]) -> Any:
    # 1. Project Management
    if cmd in ("get_project", "getProject"):
        return SESSION.project.to_dict()

    elif cmd in ("create_project", "createProject"):
        SESSION.push_undo()
        name = args.get("name", "New NetSim Project")
        SESSION.project = create_default_project()
        SESSION.project.metadata.name = name
        # NAT tables are per-project configuration: a brand new project must not inherit the
        # dynamic mappings and static port forwards of the project it replaced.
        SESSION.nat_tables.clear()
        SESSION.circuit_manager.clear()
        SESSION.reset_engine()
        return SESSION.project.to_dict()

    elif cmd in ("save_project_json", "saveProjectJson"):
        return json.dumps(SESSION.project.to_dict(), indent=2)

    elif cmd in ("load_project_json", "loadProjectJson"):
        raw = arg(args, "jsonContent", "json_string", "jsonString", "content", default=None)
        if raw is None:
            raise CommandError("No project JSON supplied")
        if isinstance(raw, str):
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise CommandError(f"Project JSON is not valid JSON: {exc.msg} (line {exc.lineno})") from exc
        else:
            data = raw
        if not isinstance(data, dict):
            raise CommandError("Project JSON must decode to an object")
        try:
            project = Project.from_dict(data)
        except (KeyError, TypeError, ValueError) as exc:
            raise CommandError(f"Project JSON is not a valid NetSim project: {exc}") from exc
        if project.schema_version != 1:
            raise CommandError(
                f"Unsupported project schema version {project.schema_version}: this build supports version 1"
            )
        validate_project(project)
        SESSION.push_undo()
        SESSION.project = project
        # Loaded projects carry their own NAT configuration (if any) and never inherit another
        # project's tables; unknown router ids are recreated on first use.
        SESSION.nat_tables.clear()
        SESSION.circuit_manager.clear()
        SESSION.reset_engine()
        return SESSION.project.to_dict()

    # 2. Topology Mutation
    elif cmd in ("add_node", "addNode"):
        label = str(arg(args, "label", default="Node"))
        raw_nt = arg(args, "node_type", "nodeType", default="pc")
        nt = parse_enum(NodeType, raw_nt, "node type")
        pos = arg(args, "position", default=None)
        if isinstance(pos, dict):
            x = float(pos.get("x", 200.0))
            y = float(pos.get("y", 200.0))
        else:
            x = float(arg(args, "x", default=200.0))
            y = float(arg(args, "y", default=200.0))
        requested_id = arg(args, "id", "node_id", "nodeId", default=None)
        node_id = str(requested_id) if requested_id else unique_node_id()
        if any(n.id == node_id for n in SESSION.project.nodes):
            raise CommandError(f"Node '{node_id}' already exists")
        SESSION.push_undo()
        new_node = Node.create(node_id, label, nt, x, y)
        SESSION.project.nodes.append(new_node)
        return new_node.to_dict()

    elif cmd in ("update_node", "updateNode"):
        node_id = arg(args, "node_id", "nodeId")
        node = find_node(str(node_id))
        SESSION.push_undo()
        label = arg(args, "label", default=None)
        if label is not None:
            node.label = str(label)
        pos = arg(args, "position", default=None)
        if isinstance(pos, dict):
            node.position = Position(x=float(pos.get("x", node.position.x)), y=float(pos.get("y", node.position.y)))
        elif "x" in args or "y" in args:
            node.position = Position(
                x=float(arg(args, "x", default=node.position.x)), y=float(arg(args, "y", default=node.position.y))
            )
        state = arg(args, "state", "node_state", "nodeState", default=None)
        if state is not None:
            node.state = parse_enum(NodeState, state, "node state")
        return node.to_dict()

    elif cmd in ("remove_node", "removeNode"):
        raw_id = arg(args, "node_id", "nodeId")
        if raw_id is None or str(raw_id).strip() == "":
            raise CommandError("A node identifier is required to remove a node")
        node_id = str(raw_id)
        find_node(node_id)
        removed_link_ids = {
            lnk.id for lnk in SESSION.project.links if lnk.source.node_id == node_id or lnk.target.node_id == node_id
        }
        SESSION.push_undo()
        for link_id in removed_link_ids:
            SESSION.circuit_manager.release_circuits_for_link(link_id, f"Link {link_id} removed with node {node_id}")
        SESSION.project.nodes = [n for n in SESSION.project.nodes if n.id != node_id]
        SESSION.project.links = [lnk for lnk in SESSION.project.links if lnk.id not in removed_link_ids]
        for node in SESSION.project.nodes:
            for link_id in removed_link_ids:
                node.detach_link(link_id)
        SESSION.reset_engine()
        return None

    elif cmd in ("add_link", "addLink"):
        src_node_id = arg(args, "source_node_id", "sourceNodeId")
        dst_node_id = arg(args, "target_node_id", "targetNodeId")
        if not src_node_id or not dst_node_id:
            raise CommandError("Both source and target node identifiers are required to create a link")
        if src_node_id == dst_node_id:
            raise CommandError(f"Cannot connect node '{src_node_id}' to itself")
        src_node = find_node(str(src_node_id))
        dst_node = find_node(str(dst_node_id))

        src_if = resolve_link_endpoint(src_node, arg(args, "source_interface_id", "sourceInterfaceId"))
        dst_if = resolve_link_endpoint(dst_node, arg(args, "target_interface_id", "targetInterfaceId"))

        bw = int(arg(args, "bandwidth_bps", "bandwidthBps", default=10_000_000))
        delay = int(arg(args, "propagation_delay_us", "propagationDelayUs", default=5_000))
        loss = float(arg(args, "loss_probability", "lossProbability", default=0.0))
        ber = float(arg(args, "bit_error_rate", "bitErrorRate", default=0.0))
        cap = int(arg(args, "queue_capacity", "queueCapacity", default=50))
        requested_id = arg(args, "id", "link_id", "linkId", default=None)
        link_id = str(requested_id) if requested_id else unique_link_id()
        if any(lnk.id == link_id for lnk in SESSION.project.links):
            raise CommandError(f"Link '{link_id}' already exists")

        new_link = Link(
            id=link_id,
            source=LinkEndpoint(node_id=src_node.id, interface_id=src_if.id),
            target=LinkEndpoint(node_id=dst_node.id, interface_id=dst_if.id),
            bandwidth_bps=bw,
            propagation_delay_us=delay,
            loss_probability=loss,
            bit_error_rate=ber,
            queue_capacity=cap,
            status=LinkStatus.UP,
        )
        new_link.validate()
        SESSION.push_undo()
        src_node.attach_link(src_if.id, link_id)
        dst_node.attach_link(dst_if.id, link_id)
        SESSION.project.links.append(new_link)
        SESSION.engine.update_topology(SESSION.project.nodes, SESSION.project.links)
        return new_link.to_dict()

    elif cmd in ("update_link", "updateLink"):
        link_id = str(arg(args, "link_id", "linkId"))
        link = next((lnk for lnk in SESSION.project.links if lnk.id == link_id), None)
        if not link:
            raise ValueError(f"Link '{link_id}' not found")
        if any(k in args for k in ("bandwidth_bps", "bandwidthBps")):
            link.bandwidth_bps = int(arg(args, "bandwidth_bps", "bandwidthBps"))
        if any(k in args for k in ("propagation_delay_us", "propagationDelayUs")):
            link.propagation_delay_us = int(arg(args, "propagation_delay_us", "propagationDelayUs"))
        if any(k in args for k in ("loss_probability", "lossProbability")):
            link.loss_probability = float(arg(args, "loss_probability", "lossProbability"))
        if any(k in args for k in ("bit_error_rate", "bitErrorRate")):
            link.bit_error_rate = float(arg(args, "bit_error_rate", "bitErrorRate"))
        if any(k in args for k in ("queue_capacity", "queueCapacity")):
            link.queue_capacity = int(arg(args, "queue_capacity", "queueCapacity"))
        if "status" in args:
            link.status = parse_enum(LinkStatus, args["status"], "link status")
        link.validate()
        SESSION.push_undo()
        # Capacity or status changes invalidate circuit reservations on this link.
        if any(k in args for k in ("bandwidth_bps", "bandwidthBps", "status")):
            SESSION.circuit_manager.release_circuits_for_link(link.id, f"Link {link.id} capacity or status changed")
        # An explicit reconfiguration supersedes any captured pre-fault value.
        SESSION.engine.clear_fault_snapshot(link.id)
        SESSION.engine.update_topology(SESSION.project.nodes, SESSION.project.links)
        return link.to_dict()

    elif cmd in ("remove_link", "removeLink"):
        link_id = str(arg(args, "link_id", "linkId"))
        SESSION.push_undo()
        # Circuits reserve capacity on this link: release them before it disappears.
        SESSION.circuit_manager.release_circuits_for_link(link_id, f"Link {link_id} was removed")
        SESSION.project.links = [lnk for lnk in SESSION.project.links if lnk.id != link_id]
        for node in SESSION.project.nodes:
            node.detach_link(link_id)
        SESSION.engine.update_topology(SESSION.project.nodes, SESSION.project.links)
        return None

    elif cmd in ("update_interface", "updateInterface"):
        node_id = arg(args, "node_id", "nodeId")
        if_id = arg(args, "interface_id", "interfaceId")
        node = find_node(str(node_id))
        iface = next((i for i in node.interfaces if i.id == if_id), None)
        if not iface:
            raise ValueError(f"Interface '{if_id}' not found on node '{node_id}'")
        new_ipv4 = arg(args, "ipv4", default=iface.ipv4) if "ipv4" in args else iface.ipv4
        new_mask = arg(args, "subnet_mask", "subnetMask", default=iface.subnet_mask)
        new_ipv6 = arg(args, "ipv6", default=iface.ipv6) if "ipv6" in args else iface.ipv6
        if new_ipv4:
            try:
                ipaddress.IPv4Address(str(new_ipv4))
            except ValueError as exc:
                raise CommandError(f"Invalid IPv4 address '{new_ipv4}'") from exc
        if new_mask:
            try:
                ipaddress.IPv4Network(f"0.0.0.0/{new_mask}")
            except ValueError as exc:
                raise CommandError(f"Invalid IPv4 subnet mask '{new_mask}'") from exc
        if new_ipv6:
            try:
                ipaddress.IPv6Interface(str(new_ipv6))
            except ValueError as exc:
                raise CommandError(f"Invalid IPv6 address/prefix '{new_ipv6}'") from exc
        SESSION.push_undo()
        if "ipv4" in args:
            iface.ipv4 = new_ipv4
        if any(k in args for k in ("subnet_mask", "subnetMask")):
            iface.subnet_mask = new_mask
        if "ipv6" in args:
            iface.ipv6 = new_ipv6
        if any(k in args for k in ("mac_address", "macAddress")):
            iface.mac_address = arg(args, "mac_address", "macAddress")
        if "status" in args:
            iface.status = parse_enum(InterfaceStatus, args["status"], "interface status")
        return iface.to_dict()

    elif cmd in ("undo_topology", "undoTopology"):
        if SESSION.undo_stack:
            SESSION.redo_stack.append(copy.deepcopy(SESSION.project))
            SESSION.project = SESSION.undo_stack.pop()
            SESSION.reset_engine()
        return SESSION.project.to_dict()

    elif cmd in ("redo_topology", "redoTopology"):
        if SESSION.redo_stack:
            SESSION.undo_stack.append(copy.deepcopy(SESSION.project))
            SESSION.project = SESSION.redo_stack.pop()
            SESSION.reset_engine()
        return SESSION.project.to_dict()

    elif cmd in ("get_topology_history_status", "getTopologyHistoryStatus"):
        return {
            "can_undo": len(SESSION.undo_stack) > 0,
            "can_redo": len(SESSION.redo_stack) > 0,
            "undo_count": len(SESSION.undo_stack),
            "redo_count": len(SESSION.redo_stack),
        }

    # 3. Discrete Event Simulation Execution
    elif cmd in ("get_simulation_state", "getSimulationState"):
        return SESSION.engine.get_state_snapshot()

    elif cmd in ("set_forwarding_policy", "setForwardingPolicy"):
        """Configure the routing model that governs live packet forwarding.

        The policy is explicit and shared with the routing graph: 'dijkstra' (shortest
        path) over one of the supported metrics. Default: dijkstra + hop_count.
        """
        algo_raw = arg(args, "algorithm", default=SESSION.engine.forwarding_algorithm)
        algo_str = str(algo_raw).strip().lower().replace("-", "_")
        if algo_str not in ("dijkstra",):
            raise CommandError(f"Unsupported forwarding algorithm '{algo_raw}'. Expected 'dijkstra'")
        metric_raw = arg(args, "metric_type", "metricType", default=SESSION.engine.forwarding_metric.value)
        metric = parse_enum(MetricType, metric_raw, "routing metric")
        SESSION.engine.forwarding_algorithm = algo_str
        SESSION.engine.forwarding_metric = metric
        return {
            "algorithm": SESSION.engine.forwarding_algorithm,
            "metric_type": SESSION.engine.forwarding_metric.value,
            "default_ttl": DEFAULT_PACKET_TTL,
        }

    elif cmd in ("step_simulation", "stepSimulation"):
        evt = SESSION.engine.step()
        return evt.to_dict() if evt else None

    elif cmd in ("run_simulation_micros", "runSimulationMicros"):
        raw_dur = arg(args, "duration_us", "durationUs", default=100_000)
        try:
            dur = int(raw_dur)
        except (TypeError, ValueError) as exc:
            raise CommandError(
                f"Simulation duration must be an integer number of microseconds (received {raw_dur!r})"
            ) from exc
        if dur < 1:
            raise CommandError(f"Simulation duration must be at least 1 microsecond (received {dur})")
        target = SESSION.engine.current_time.add_micros(dur)
        return SESSION.engine.run_until(target)

    elif cmd in ("run_simulation_until_empty", "runSimulationUntilEmpty"):
        return SESSION.engine.run_all()

    elif cmd in ("pause_simulation", "pauseSimulation"):
        SESSION.engine.pause()
        return SESSION.engine.get_state_snapshot()

    elif cmd in ("reset_simulation", "resetSimulation"):
        SESSION.reset_engine()
        return SESSION.engine.get_state_snapshot()

    elif cmd in ("inject_packet", "injectPacket"):
        src = arg(args, "src_node_id", "srcNodeId")
        dst = arg(args, "dst_node_id", "dstNodeId")
        if not src or not dst:
            raise CommandError("Both source and destination node identifiers are required")
        find_node(str(src))
        find_node(str(dst))
        size = int(arg(args, "size_bytes", "sizeBytes", default=1000))
        if size < 1:
            raise CommandError("Packet size must be at least 1 byte")
        if size > 9_000_000:
            raise CommandError("Packet size must not exceed 9,000,000 bytes")
        app = str(arg(args, "app_protocol", "appProtocol", default="HTTP"))
        trans = str(arg(args, "transport_protocol", "transportProtocol", default="TCP"))
        raw_ttl = arg(args, "ttl", "packet_ttl", default=DEFAULT_PACKET_TTL)
        try:
            ttl = int(raw_ttl)
        except (TypeError, ValueError) as exc:
            raise CommandError(f"TTL must be an integer between 1 and 255 (received {raw_ttl!r})") from exc
        if ttl < 1 or ttl > MAX_PACKET_TTL:
            raise CommandError(f"TTL must be between 1 and 255 (received {ttl})")
        try:
            pkt_id = SESSION.engine.inject_packet(str(src), str(dst), size, app, trans, ttl=ttl)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        return pkt_id

    elif cmd in ("get_packet_details", "getPacketDetails"):
        pkt_id = arg(args, "packet_id", "packetId")
        if not pkt_id:
            raise CommandError("A packet identifier is required")
        pkt = SESSION.engine.packets.get(str(pkt_id))
        if pkt is None:
            raise CommandError(f"Packet '{pkt_id}' does not exist in the current simulation")
        return pkt.to_dict()

    elif cmd in ("schedule_demo_packet", "scheduleDemoPacket"):
        """Queue a canned demo flow; endpoints default to the first and last node.

        The endpoints are honoured when supplied - the client wrapper exposes them, and ignoring
        them meant a caller could ask for a specific pair and silently get a different one.
        """
        if len(SESSION.project.nodes) < 2:
            return None
        src = str(arg(args, "src_node_id", "srcNodeId", default=SESSION.project.nodes[0].id))
        dst = str(arg(args, "dst_node_id", "dstNodeId", default=SESSION.project.nodes[-1].id))
        find_node(src)
        find_node(dst)
        if src == dst:
            raise CommandError("A demo packet must have different source and destination nodes")
        return SESSION.engine.inject_packet(src, dst, 1000, "HTTP", "TCP")

    # 3b. Circuit Switching (educational model: setup / reservation / blocking / teardown)
    elif cmd in ("request_circuit", "requestCircuit"):
        src = arg(args, "source_node_id", "sourceNodeId")
        dst = arg(args, "target_node_id", "targetNodeId", "destination_node_id", "destinationNodeId")
        if not src or not dst:
            raise CommandError("Both source and target node identifiers are required for a circuit")
        find_node(str(src))
        find_node(str(dst))
        if str(src) == str(dst):
            raise CommandError("A circuit must connect two distinct nodes")
        raw_bw = arg(args, "bandwidth_bps", "bandwidthBps")
        try:
            bw = int(raw_bw)
        except (TypeError, ValueError) as exc:
            raise CommandError(f"Circuit bandwidth must be an integer number of bps (received {raw_bw!r})") from exc
        if bw < 1:
            raise CommandError("Circuit bandwidth must be at least 1 bps")
        if bw > 100_000_000_000:
            raise CommandError("Circuit bandwidth must not exceed 100,000,000,000 bps")
        cid = arg(args, "circuit_id", "circuitId", default=None)
        cid_str = str(cid).strip() if cid is not None else None
        if cid_str == "":
            raise CommandError("Circuit identifier must not be empty when supplied")
        try:
            circuit_result = SESSION.circuit_manager.request_circuit(
                SESSION.project.nodes,
                SESSION.project.links,
                str(src),
                str(dst),
                bw,
                circuit_id=cid_str,
            )
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        return circuit_result.to_dict()

    elif cmd in ("teardown_circuit", "teardownCircuit"):
        cid = arg(args, "circuit_id", "circuitId")
        if not cid or not str(cid).strip():
            raise CommandError("A circuit identifier is required to tear down a circuit")
        try:
            circuit = SESSION.circuit_manager.teardown_circuit(str(cid))
        except KeyError as exc:
            raise CommandError(str(exc).strip("'")) from exc
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        return circuit.to_dict()

    elif cmd in ("get_circuit_state", "getCircuitState"):
        return SESSION.circuit_manager.get_state(SESSION.project.nodes, SESSION.project.links)

    # 4. Algorithms & Addressing
    elif cmd in ("calculate_simple_checksum", "calculateSimpleChecksum"):
        data = arg(args, "data", default=None)
        if data is None or str(data) == "":
            raise CommandError("'data' is required to compute a simple checksum")
        return {"checksum": sum(b for b in str(data).encode("utf-8")) & 0xFFFF}

    elif cmd in ("calculate_routing_table", "calculateRoutingTable"):
        algo_str = str(arg(args, "algorithm", default="dijkstra")).lower()
        if algo_str not in ("dijkstra", "bellman_ford"):
            raise CommandError(f"Unsupported routing algorithm '{algo_str}'. Expected 'dijkstra' or 'bellman_ford'")
        metric_str = str(arg(args, "metric_type", "metricType", default="hop_count"))
        metric = parse_enum(MetricType, metric_str, "routing metric")
        node_id = str(arg(args, "node_id", "nodeId", default=SESSION.project.nodes[0].id))
        find_node(node_id)
        graph = RoutingGraph.from_project(SESSION.project, metric)
        if algo_str == "bellman_ford":
            try:
                return compute_bellman_ford_shortest_paths(graph, node_id).to_dict()
            except ValueError as exc:
                raise CommandError(str(exc)) from exc
        try:
            return compute_dijkstra_shortest_paths(graph, node_id).to_dict()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

    elif cmd in ("simulate_routing_convergence", "simulateRoutingConvergence"):
        src_id = str(
            arg(args, "source_node_id", "sourceNodeId", "node_id", "nodeId", default=SESSION.project.nodes[0].id)
        )
        find_node(src_id)
        metric_str = str(arg(args, "metric_type", "metricType", default="hop_count"))
        metric = parse_enum(MetricType, metric_str, "routing metric")
        graph = RoutingGraph.from_project(SESSION.project, metric)
        try:
            return simulate_distance_vector_convergence(graph, src_id).to_dict()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

    elif cmd in ("calculate_ipv4_subnet", "calculateIpv4Subnet"):
        cidr = arg(args, "input", "cidr", default=None)
        if cidr is None or str(cidr).strip() == "":
            raise CommandError("An IPv4 address or CIDR block is required (e.g. '192.168.1.0/24')")
        try:
            return calculate_subnet(str(cidr)).to_dict()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

    elif cmd in ("split_ipv4_subnet", "splitIpv4Subnet"):
        base = args.get("base_cidr") or args.get("baseCidr", "192.168.1.0/24")
        prefix = int(args.get("new_prefix") or args.get("newPrefix", 26))
        return split_equal_subnets(base, prefix).to_dict()

    elif cmd in ("allocate_vlsm_subnets", "allocateVlsmSubnets"):
        base = args.get("base_cidr") or args.get("baseCidr", "192.168.0.0/24")
        raw_reqs = args.get("requirements", [])
        reqs = [
            VlsmSubnetRequirement(
                name=r["name"],
                needed_hosts=int(r.get("needed_hosts", r.get("neededHosts", 10))),
            )
            for r in raw_reqs
        ]
        return allocate_vlsm(base, reqs).to_dict()

    elif cmd in ("detect_duplicate_ips_command", "detectDuplicateIpsCommand"):
        conflicts = detect_duplicate_ips(SESSION.project)
        return [c.to_dict() for c in conflicts]

    elif cmd in ("validate_ipv6_address", "validateIpv6Address"):
        addr = args.get("address") or args.get("input", "2001:db8::1/64")
        return analyze_ipv6_address(addr).to_dict()

    elif cmd in ("get_or_create_nat_table", "getOrCreateNatTable"):
        nid = arg(args, "router_node_id", "routerNodeId", "node_id", "nodeId", default="router-1")
        pub = args.get("public_ip") or args.get("publicIp", "203.0.113.1")
        if nid not in SESSION.nat_tables:
            SESSION.nat_tables[nid] = NatTable(nid, pub)
        return SESSION.nat_tables[nid].to_dict()

    elif cmd in ("add_static_dnat_rule", "addStaticDnatRule"):
        nid = arg(args, "router_node_id", "routerNodeId", "node_id", "nodeId", default="router-1")
        pub = arg(args, "public_ip", "publicIp", default="203.0.113.1")
        if nid not in SESSION.nat_tables:
            SESSION.nat_tables[nid] = NatTable(nid, pub)
        table = SESSION.nat_tables[nid]
        proto = parse_enum(NatProtocol, str(args.get("protocol", "tcp")).upper(), "NAT protocol")
        table.add_static_dnat_rule(
            protocol=proto,
            public_port=require_int(arg(args, "public_port", "publicPort"), "public_port", minimum=0, maximum=65535),
            private_ip=require_non_empty(arg(args, "private_ip", "privateIp"), "private_ip"),
            private_port=require_int(
                arg(args, "private_port", "privatePort"), "private_port", minimum=0, maximum=65535
            ),
            description=str(arg(args, "description", default="Static Port Forwarding")),
        )
        return table.to_dict()

    elif cmd in ("simulate_nat_outbound", "simulateNatOutbound"):
        nid = arg(args, "router_node_id", "routerNodeId", "node_id", "nodeId", default="router-1")
        pub = arg(args, "public_ip", "publicIp", default="203.0.113.1")
        if nid not in SESSION.nat_tables:
            SESSION.nat_tables[nid] = NatTable(nid, pub)
        table = SESSION.nat_tables[nid]
        proto = parse_enum(NatProtocol, str(args.get("protocol", "tcp")).upper(), "NAT protocol")
        res = table.translate_outbound(
            src_ip=require_non_empty(arg(args, "src_ip", "srcIp"), "src_ip"),
            src_port=require_int(arg(args, "src_port", "srcPort"), "src_port", minimum=0, maximum=65535),
            dst_ip=require_non_empty(arg(args, "dst_ip", "dstIp"), "dst_ip"),
            dst_port=require_int(arg(args, "dst_port", "dstPort"), "dst_port", minimum=0, maximum=65535),
            protocol=proto,
            current_time_us=0,
        )
        return res.to_dict()

    elif cmd in ("simulate_nat_inbound", "simulateNatInbound"):
        nid = arg(args, "router_node_id", "routerNodeId", "node_id", "nodeId", default="router-1")
        pub = arg(args, "public_ip", "publicIp", default="203.0.113.1")
        if nid not in SESSION.nat_tables:
            SESSION.nat_tables[nid] = NatTable(nid, pub)
        table = SESSION.nat_tables[nid]
        proto = parse_enum(NatProtocol, str(args.get("protocol", "tcp")).upper(), "NAT protocol")
        res = table.translate_inbound(
            src_ip=require_non_empty(arg(args, "src_ip", "srcIp"), "src_ip"),
            src_port=require_int(arg(args, "src_port", "srcPort"), "src_port", minimum=0, maximum=65535),
            dst_ip=require_non_empty(arg(args, "dst_ip", "dstIp"), "dst_ip"),
            dst_port=require_int(arg(args, "dst_port", "dstPort"), "dst_port", minimum=0, maximum=65535),
            protocol=proto,
            current_time_us=1000,
        )
        return res.to_dict() if res else None

    # 5. Data Link: Error Control & Flow Control
    elif cmd in ("calculate_hamming_encode", "calculateHammingEncode"):
        data_bits = str(arg(args, "data_bits", "dataBits", default="1011"))
        parity_mode = str(arg(args, "parity_mode", "parityMode", default="even")).lower()
        if parity_mode not in ("even", "odd"):
            raise CommandError(f"Unsupported parity mode '{parity_mode}'. Expected 'even' or 'odd'")
        return hamming_encode(data_bits, even_parity=(parity_mode == "even")).to_dict()

    elif cmd in ("verify_and_correct_hamming", "verifyAndCorrectHamming"):
        codeword = str(arg(args, "codeword", default="1010101"))
        parity_mode = str(arg(args, "parity_mode", "parityMode", default="even")).lower()
        if parity_mode not in ("even", "odd"):
            raise CommandError(f"Unsupported parity mode '{parity_mode}'. Expected 'even' or 'odd'")
        try:
            # Return the full verification result: the client contract (see
            # `HammingVerifyResult` in src/types/datalink.ts) includes the syndrome, the corrected
            # codeword and the status message, which `hamming_decode` does not carry.
            result = verify_and_correct_hamming(codeword, ParityMode.EVEN if parity_mode == "even" else ParityMode.ODD)
            return result.to_dict()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

    elif cmd in ("calculate_crc", "calculateCrc"):
        data_bits = args.get("data_bits") or args.get("dataBits", "11010011101100")
        poly = args.get("polynomial", "10011")
        poly_name = args.get("poly_name") or args.get("polyName", "Custom")
        return calculate_crc(data_bits, poly, poly_name).to_dict()

    elif cmd in ("verify_crc", "verifyCrc"):
        codeword = args.get("codeword", "110100111011000100")
        poly = args.get("polynomial", "10011")
        poly_name = args.get("poly_name") or args.get("polyName", "Custom")
        return verify_crc(codeword, poly, poly_name).to_dict()

    elif cmd in ("calculate_internet_checksum", "calculateInternetChecksum"):
        raw_hex = args.get("input_hex") or args.get("inputHex", "4500003c1c4640004006")
        return internet_checksum(raw_hex).to_dict()

    elif cmd in ("verify_internet_checksum", "verifyInternetChecksum"):
        payload = arg(args, "payload_hex", "payloadHex", default=None)
        csum = arg(args, "checksum_hex", "checksumHex", default=None)
        if not payload or not csum:
            raise CommandError("Both 'payloadHex' and 'checksumHex' are required to verify a checksum")
        try:
            return verify_checksum(str(payload), str(csum)).to_dict()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

    elif cmd in ("simulate_sliding_window", "simulateSlidingWindow"):
        cfg_data = config_arg(args)
        return simulate_sliding_window(FlowControlConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_go_back_n", "simulateGoBackN"):
        cfg_data = config_arg(args)
        return simulate_go_back_n(FlowControlConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_selective_repeat", "simulateSelectiveRepeat"):
        cfg_data = config_arg(args)
        return simulate_selective_repeat(FlowControlConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_pure_aloha", "simulatePureAloha"):
        cfg_data = config_arg(args)
        mac_cfg = MacConfig.from_dict(cfg_data)
        mac_cfg.protocol = MacProtocol.PURE_ALOHA
        return simulate_mac(mac_cfg).to_dict()

    elif cmd in ("simulate_slotted_aloha", "simulateSlottedAloha"):
        cfg_data = config_arg(args)
        mac_cfg = MacConfig.from_dict(cfg_data)
        mac_cfg.protocol = MacProtocol.SLOTTED_ALOHA
        return simulate_mac(mac_cfg).to_dict()

    elif cmd in ("simulate_csma", "simulateCsma"):
        cfg_data = config_arg(args)
        mac_cfg = MacConfig.from_dict(cfg_data)
        mac_cfg.protocol = MacProtocol.CSMA
        return simulate_mac(mac_cfg).to_dict()

    elif cmd in ("simulate_csma_cd", "simulateCsmaCd"):
        cfg_data = config_arg(args)
        mac_cfg = MacConfig.from_dict(cfg_data)
        mac_cfg.protocol = MacProtocol.CSMA_CD
        return simulate_mac(mac_cfg).to_dict()

    # 6. Transport Layer
    elif cmd in ("simulate_tcp", "simulateTcp"):
        transport_cfg = _transport_config(args)
        try:
            return simulate_tcp(transport_cfg, SESSION.project).to_dict()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

    elif cmd in ("simulate_udp", "simulateUdp"):
        transport_cfg = _transport_config(args)
        try:
            return simulate_udp(transport_cfg, SESSION.project).to_dict()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

    elif cmd in ("simulate_tcp_congestion", "simulateTcpCongestion"):
        transport_cfg = _transport_config(args)
        try:
            return simulate_tcp(transport_cfg, SESSION.project).to_dict()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

    # 7. Application Protocols
    elif cmd in ("simulate_dns", "simulateDns"):
        cfg_data = config_arg(args)
        return simulate_dns(DnsConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_http", "simulateHttp"):
        cfg_data = config_arg(args)
        return simulate_http(HttpConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_ftp", "simulateFtp"):
        cfg_data = config_arg(args)
        return simulate_ftp(FtpConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_smtp", "simulateSmtp"):
        cfg_data = config_arg(args)
        return simulate_smtp(SmtpConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_snmp", "simulateSnmp"):
        cfg_data = config_arg(args)
        return simulate_snmp(SnmpConfig.from_dict(cfg_data)).to_dict()

    # 8. QoS, Faults & Experiments
    elif cmd in ("get_current_qos_metrics", "getCurrentQosMetrics"):
        elapsed = SESSION.engine.current_time.as_micros()
        return compute_network_qos(
            SESSION.engine.metrics,
            list(SESSION.engine.packets.values()),
            SESSION.engine.processed_events,
            [q.get_snapshot() for q in SESSION.engine.link_queues.values()],
            elapsed,
        ).to_dict()

    elif cmd in ("schedule_fault_command", "scheduleFaultCommand"):
        entry_data = args.get("entry") or args.get("fault_entry") or {}
        if not isinstance(entry_data, dict):
            raise CommandError("Fault entry must be a JSON object")
        if not entry_data.get("fault_type"):
            raise CommandError("Fault entry requires a 'fault_type'")
        data = dict(entry_data)
        data.setdefault("fault_id", f"fault-{len(SESSION.engine.pending_faults) + 1}")
        try:
            entry = FaultScheduleEntry.from_dict(data)
        except (KeyError, ValueError, TypeError) as exc:
            raise CommandError(f"Invalid fault entry: {exc}") from exc
        _validate_fault_target(entry.fault_type)
        try:
            timestamp_us = int(data.get("timestamp_us", 0))
        except (TypeError, ValueError) as exc:
            raise CommandError(f"Fault timestamp_us must be an integer: {data.get('timestamp_us')!r}") from exc
        if timestamp_us < 0:
            raise CommandError("Fault timestamp_us must not be negative")
        SESSION.engine.schedule_fault(entry.fault_id, timestamp_us, entry.fault_type)
        return None

    elif cmd in ("run_parameter_sweep_command", "runParameterSweepCommand"):
        cfg_data = config_arg(args)
        sweep_cfg = SweepConfig.from_dict(cfg_data)
        return run_parameter_sweep(sweep_cfg, SESSION.project).to_dict()

    elif cmd in ("run_comparative_experiment_command", "runComparativeExperimentCommand"):
        cfg_data = config_arg(args)
        comparison_cfg = ComparativeExperimentConfig.from_dict(cfg_data)
        return run_comparative_experiment(comparison_cfg, SESSION.project).to_dict()

    else:
        raise UnknownCommandError(f"Unknown API command: '{cmd}'")


class NetSimRequestHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self) -> None:
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path in ("/health", "/api/health"):
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "status": "ok",
                        "backend": "python",
                        "authority": "python-simulation-core",
                        "version": SERVER_VERSION,
                        "status_detail": SESSION.engine.status.value,
                        "current_time_us": SESSION.engine.current_time.as_micros(),
                    }
                ).encode("utf-8")
            )
        else:
            self.send_response(404)
            self.end_headers()

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            content_length = int(raw_length)
        except ValueError:
            self._send_json(
                400,
                {
                    "status": "error",
                    "code": "invalid_request",
                    "message": f"Malformed Content-Length header: {raw_length!r}",
                },
            )
            return
        if content_length < 0:
            self._send_json(
                400,
                {"status": "error", "code": "invalid_request", "message": "Negative Content-Length"},
            )
            return
        if content_length > MAX_REQUEST_BYTES:
            # Refuse before buffering: projects are small JSON documents, so a body this
            # large is either a client bug or abuse. Structured response, no traceback.
            self._send_json(
                413,
                {
                    "status": "error",
                    "code": "request_too_large",
                    "message": f"Request body exceeds the {MAX_REQUEST_BYTES} byte limit",
                },
            )
            # Drain a bounded prefix so the client is not cut off mid-write (and never
            # buffer more than the cap regardless of what was declared).
            remaining = min(content_length, MAX_REQUEST_BYTES + 1)
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 65536))
                if not chunk:
                    break
                remaining -= len(chunk)
            return
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        # URL path: /api/<cmd> or /<cmd>
        cmd = self.path.lstrip("/").split("?")[0]
        if cmd.startswith("api/"):
            cmd = cmd[len("api/") :]

        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self._send_json(400, {"status": "error", "code": "invalid_json", "message": f"Malformed JSON body: {exc}"})
            return

        if not isinstance(payload, dict):
            self._send_json(
                400, {"status": "error", "code": "invalid_request", "message": "Request body must be a JSON object"}
            )
            return

        wrapped_args = payload.get("args")
        args = wrapped_args if isinstance(wrapped_args, dict) else payload

        try:
            result = dispatch_command(cmd, args)
        except UnknownCommandError as exc:
            logger.info("Rejected command '%s': %s", cmd, exc)
            self._send_json(404, {"status": "error", "code": "unknown_command", "message": str(exc)})
            return
        except (CommandError, ValueError) as exc:
            # Expected, user-facing validation failures: return a structured 400 with the
            # exact reason and never expose a traceback. KeyError/TypeError are deliberately
            # NOT listed here: they indicate a defect in the core and must surface as 500s
            # rather than being mislabelled as bad user input.
            logger.info("Rejected command '%s': %s", cmd, exc)
            self._send_json(400, {"status": "error", "code": "invalid_request", "message": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001 - defensive: never leak internals to the UI
            logger.exception("Internal error executing command '%s'", cmd)
            self._send_json(
                500,
                {
                    "status": "error",
                    "code": "internal_error",
                    "message": f"The simulation core failed to execute '{cmd}'. See the server log for details.",
                    "detail": type(exc).__name__,
                },
            )
            return

        self._send_json(200, {"status": "ok", "result": result})

    def log_message(self, format: str, *args: Any) -> None:
        # Suppress routine console clutter
        pass


def run_server(port: int = 8765) -> None:
    server = HTTPServer(("127.0.0.1", port), NetSimRequestHandler)
    logger.info("NetSim Python Simulation Server listening on http://127.0.0.1:%d", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server interrupted. Shutting down...")
        server.server_close()


if __name__ == "__main__":
    p = 8765
    if len(sys.argv) > 1:
        try:
            p = int(sys.argv[1])
        except ValueError:
            pass
    run_server(p)
