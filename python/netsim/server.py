"""Authoritative NetSim Python API Server.
Provides JSON RPC / HTTP interface for the presentation frontend and desktop shell.
"""

# ruff: noqa: E402
from __future__ import annotations

import copy
import json
import logging
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
from netsim.core.engine import SimulationEngine
from netsim.datalink.checksum import internet_checksum, verify_checksum
from netsim.datalink.crc import calculate_crc, verify_crc
from netsim.datalink.flow_control import (
    FlowControlConfig,
    simulate_go_back_n,
    simulate_selective_repeat,
    simulate_sliding_window,
)
from netsim.datalink.hamming import hamming_decode, hamming_encode
from netsim.datalink.mac import MacConfig, simulate_mac
from netsim.experiments.config import ComparativeExperimentConfig, SweepConfig
from netsim.experiments.runner import run_comparative_experiment, run_parameter_sweep
from netsim.faults.model import FaultScheduleEntry
from netsim.models.interface import Interface
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
        self.engine.update_links(self.project.links)
        self.undo_stack: list[Project] = []
        self.redo_stack: list[Project] = []
        self.nat_tables: dict[str, NatTable] = {}

    def push_undo(self) -> None:
        self.undo_stack.append(copy.deepcopy(self.project))
        self.redo_stack.clear()
        if len(self.undo_stack) > 50:
            self.undo_stack.pop(0)

    def reset_engine(self) -> None:
        self.engine.reset()
        self.engine.update_links(self.project.links)


SESSION = SessionState()


def dispatch_command(cmd: str, args: dict[str, Any]) -> Any:
    # 1. Project Management
    if cmd in ("get_project", "getProject"):
        return SESSION.project.to_dict()

    elif cmd in ("create_project", "createProject"):
        SESSION.push_undo()
        name = args.get("name", "New NetSim Project")
        SESSION.project = create_default_project()
        SESSION.project.metadata.name = name
        SESSION.reset_engine()
        return SESSION.project.to_dict()

    elif cmd in ("save_project_json", "saveProjectJson"):
        return json.dumps(SESSION.project.to_dict(), indent=2)

    elif cmd in ("load_project_json", "loadProjectJson"):
        SESSION.push_undo()
        raw = args.get("json_string") or args.get("jsonString", "{}")
        data = json.loads(raw) if isinstance(raw, str) else raw
        SESSION.project = Project.from_dict(data)
        SESSION.reset_engine()
        return SESSION.project.to_dict()

    # 2. Topology Mutation
    elif cmd in ("add_node", "addNode"):
        SESSION.push_undo()
        label = args.get("label", "Node")
        raw_nt = args.get("node_type") or args.get("nodeType", "pc")
        nt = NodeType(raw_nt) if isinstance(raw_nt, str) else NodeType.PC
        x = float(args.get("x", 200.0))
        y = float(args.get("y", 200.0))
        node_id = f"node-{len(SESSION.project.nodes) + 1}"
        new_node = Node.create(node_id, label, nt, x, y)
        SESSION.project.nodes.append(new_node)
        return new_node.to_dict()

    elif cmd in ("update_node", "updateNode"):
        SESSION.push_undo()
        node_id = args.get("node_id") or args.get("nodeId")
        node = next((n for n in SESSION.project.nodes if n.id == node_id), None)
        if not node:
            raise ValueError(f"Node '{node_id}' not found")
        if "label" in args and args["label"]:
            node.label = args["label"]
        if "x" in args and "y" in args:
            node.position = Position(x=float(args["x"]), y=float(args["y"]))
        if "state" in args and args["state"]:
            st = args["state"]
            node.state = NodeState(st) if isinstance(st, str) else NodeState.UP
        return node.to_dict()

    elif cmd in ("remove_node", "removeNode"):
        SESSION.push_undo()
        node_id = args.get("node_id") or args.get("nodeId")
        SESSION.project.nodes = [n for n in SESSION.project.nodes if n.id != node_id]
        SESSION.project.links = [
            lnk for lnk in SESSION.project.links if lnk.source.node_id != node_id and lnk.target.node_id != node_id
        ]
        SESSION.reset_engine()
        return None

    elif cmd in ("add_link", "addLink"):
        SESSION.push_undo()
        src_node = args.get("source_node_id") or args.get("sourceNodeId")
        src_if = args.get("source_interface_id") or args.get("sourceInterfaceId")
        dst_node = args.get("target_node_id") or args.get("targetNodeId")
        dst_if = args.get("target_interface_id") or args.get("targetInterfaceId")
        bw = int(args.get("bandwidth_bps") or args.get("bandwidthBps", 10_000_000))
        delay = int(args.get("propagation_delay_us") or args.get("propagationDelayUs", 5_000))
        loss = float(args.get("loss_probability") or args.get("lossProbability", 0.0))
        ber = float(args.get("bit_error_rate") or args.get("bitErrorRate", 0.0))
        cap = int(args.get("queue_capacity") or args.get("queueCapacity", 50))
        link_id = f"link-{len(SESSION.project.links) + 1}"
        new_link = Link(
            id=link_id,
            source=LinkEndpoint(node_id=src_node, interface_id=src_if),
            target=LinkEndpoint(node_id=dst_node, interface_id=dst_if),
            bandwidth_bps=bw,
            propagation_delay_us=delay,
            loss_probability=loss,
            bit_error_rate=ber,
            queue_capacity=cap,
            status=LinkStatus.UP,
        )
        SESSION.project.links.append(new_link)
        SESSION.engine.update_links(SESSION.project.links)
        return new_link.to_dict()

    elif cmd in ("update_link", "updateLink"):
        SESSION.push_undo()
        link_id = args.get("link_id") or args.get("linkId")
        link = next((lnk for lnk in SESSION.project.links if lnk.id == link_id), None)
        if not link:
            raise ValueError(f"Link '{link_id}' not found")
        if "bandwidth_bps" in args or "bandwidthBps" in args:
            link.bandwidth_bps = int(args.get("bandwidth_bps") or args.get("bandwidthBps"))
        if "propagation_delay_us" in args or "propagationDelayUs" in args:
            link.propagation_delay_us = int(args.get("propagation_delay_us") or args.get("propagationDelayUs"))
        if "loss_probability" in args or "lossProbability" in args:
            link.loss_probability = float(args.get("loss_probability") or args.get("lossProbability"))
        if "bit_error_rate" in args or "bitErrorRate" in args:
            link.bit_error_rate = float(args.get("bit_error_rate") or args.get("bitErrorRate"))
        if "queue_capacity" in args or "queueCapacity" in args:
            link.queue_capacity = int(args.get("queue_capacity") or args.get("queueCapacity"))
        if "status" in args:
            st = args["status"]
            link.status = LinkStatus(st) if isinstance(st, str) else LinkStatus.UP
        SESSION.engine.update_links(SESSION.project.links)
        return link.to_dict()

    elif cmd in ("remove_link", "removeLink"):
        SESSION.push_undo()
        link_id = args.get("link_id") or args.get("linkId")
        SESSION.project.links = [lnk for lnk in SESSION.project.links if lnk.id != link_id]
        SESSION.engine.update_links(SESSION.project.links)
        return None

    elif cmd in ("update_interface", "updateInterface"):
        SESSION.push_undo()
        node_id = args.get("node_id") or args.get("nodeId")
        if_id = args.get("interface_id") or args.get("interfaceId")
        node = next((n for n in SESSION.project.nodes if n.id == node_id), None)
        if not node:
            raise ValueError(f"Node '{node_id}' not found")
        iface = next((i for i in node.interfaces if i.id == if_id), None)
        if not iface:
            raise ValueError(f"Interface '{if_id}' not found on node '{node_id}'")
        if "ipv4" in args:
            iface.ipv4 = args["ipv4"]
        if "subnet_mask" in args or "subnetMask" in args:
            iface.subnet_mask = args.get("subnet_mask") or args.get("subnetMask")
        if "ipv6" in args:
            iface.ipv6 = args["ipv6"]
        if "mac_address" in args or "macAddress" in args:
            iface.mac_address = args.get("mac_address") or args.get("macAddress")
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

    elif cmd in ("step_simulation", "stepSimulation"):
        evt = SESSION.engine.step()
        return evt.to_dict() if evt else None

    elif cmd in ("run_simulation_micros", "runSimulationMicros"):
        dur = int(args.get("duration_us") or args.get("durationUs", 100_000))
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
        src = args.get("src_node_id") or args.get("srcNodeId")
        dst = args.get("dst_node_id") or args.get("dstNodeId")
        size = int(args.get("size_bytes") or args.get("sizeBytes", 1000))
        app = args.get("app_protocol") or args.get("appProtocol", "HTTP")
        trans = args.get("transport_protocol") or args.get("transportProtocol", "TCP")
        pkt_id = SESSION.engine.inject_packet(src, dst, size, app, trans)
        return pkt_id

    elif cmd in ("get_packet_details", "getPacketDetails"):
        pkt_id = args.get("packet_id") or args.get("packetId")
        pkt = SESSION.engine.packets.get(pkt_id)
        return pkt.to_dict() if pkt else None

    elif cmd in ("schedule_demo_packet", "scheduleDemoPacket"):
        if len(SESSION.project.nodes) >= 2:
            src = SESSION.project.nodes[0].id
            dst = SESSION.project.nodes[-1].id
            return SESSION.engine.inject_packet(src, dst, 1000, "HTTP", "TCP")
        return None

    # 4. Algorithms & Addressing
    elif cmd in ("calculate_simple_checksum", "calculateSimpleChecksum"):
        data = args.get("data", "")
        return {"checksum": sum(b for b in data.encode("utf-8")) & 0xFFFF}

    elif cmd in ("calculate_routing_table", "calculateRoutingTable"):
        algo_str = args.get("algorithm", "dijkstra").lower()
        metric_str = args.get("metric_type") or args.get("metricType", "hop_count")
        node_id = args.get("node_id") or args.get("nodeId") or SESSION.project.nodes[0].id
        metric = MetricType(metric_str) if metric_str in [m.value for m in MetricType] else MetricType.HOP_COUNT
        graph = RoutingGraph.from_project(SESSION.project, metric)
        if algo_str == "bellman_ford":
            return compute_bellman_ford_shortest_paths(graph, node_id).to_dict()
        return compute_dijkstra_shortest_paths(graph, node_id).to_dict()

    elif cmd in ("simulate_routing_convergence", "simulateRoutingConvergence"):
        src_id = (
            args.get("source_node_id")
            or args.get("sourceNodeId")
            or args.get("node_id")
            or args.get("nodeId")
            or SESSION.project.nodes[0].id
        )
        metric_str = args.get("metric_type") or args.get("metricType", "hop_count")
        metric = MetricType(metric_str) if metric_str in [m.value for m in MetricType] else MetricType.HOP_COUNT
        graph = RoutingGraph.from_project(SESSION.project, metric)
        return simulate_distance_vector_convergence(graph, src_id).to_dict()

    elif cmd in ("calculate_ipv4_subnet", "calculateIpv4Subnet"):
        cidr = args.get("input") or args.get("cidr", "192.168.1.0/24")
        return calculate_subnet(cidr).to_dict()

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
        nid = args.get("node_id") or args.get("nodeId") or args.get("router_node_id", "router-1")
        pub = args.get("public_ip") or args.get("publicIp", "203.0.113.1")
        if nid not in SESSION.nat_tables:
            SESSION.nat_tables[nid] = NatTable(nid, pub)
        return SESSION.nat_tables[nid].to_dict()

    elif cmd in ("add_static_dnat_rule", "addStaticDnatRule"):
        nid = args.get("node_id") or args.get("nodeId", "router-1")
        pub = args.get("public_ip") or args.get("publicIp", "203.0.113.1")
        if nid not in SESSION.nat_tables:
            SESSION.nat_tables[nid] = NatTable(nid, pub)
        table = SESSION.nat_tables[nid]
        proto = NatProtocol(args.get("protocol", "tcp").lower())
        table.add_static_dnat_rule(
            protocol=proto,
            public_port=int(args.get("public_port") or args.get("publicPort")),
            private_ip=args.get("private_ip") or args.get("privateIp"),
            private_port=int(args.get("private_port") or args.get("privatePort")),
            description=args.get("description", "Static Port Forwarding"),
        )
        return table.to_dict()

    elif cmd in ("simulate_nat_outbound", "simulateNatOutbound"):
        nid = args.get("router_node_id") or args.get("routerNodeId", "router-1")
        pub = args.get("public_ip") or args.get("publicIp", "203.0.113.1")
        if nid not in SESSION.nat_tables:
            SESSION.nat_tables[nid] = NatTable(nid, pub)
        table = SESSION.nat_tables[nid]
        proto = NatProtocol(args.get("protocol", "tcp").lower())
        res = table.translate_outbound(
            src_ip=args.get("src_ip") or args.get("srcIp"),
            src_port=int(args.get("src_port") or args.get("srcPort")),
            dst_ip=args.get("dst_ip") or args.get("dstIp"),
            dst_port=int(args.get("dst_port") or args.get("dstPort")),
            protocol=proto,
            current_time_us=0,
        )
        return res.to_dict()

    elif cmd in ("simulate_nat_inbound", "simulateNatInbound"):
        nid = args.get("router_node_id") or args.get("routerNodeId", "router-1")
        pub = args.get("public_ip") or args.get("publicIp", "203.0.113.1")
        if nid not in SESSION.nat_tables:
            SESSION.nat_tables[nid] = NatTable(nid, pub)
        table = SESSION.nat_tables[nid]
        proto = NatProtocol(args.get("protocol", "tcp").lower())
        res = table.translate_inbound(
            src_ip=args.get("src_ip") or args.get("srcIp"),
            src_port=int(args.get("src_port") or args.get("srcPort")),
            dst_ip=args.get("dst_ip") or args.get("dstIp"),
            dst_port=int(args.get("dst_port") or args.get("dstPort")),
            protocol=proto,
            current_time_us=1000,
        )
        return res.to_dict() if res else None

    # 5. Data Link: Error Control & Flow Control
    elif cmd in ("calculate_hamming_encode", "calculateHammingEncode"):
        data_bits = args.get("data_bits") or args.get("dataBits", "1011")
        parity_mode = args.get("parity_mode") or args.get("parityMode", "even")
        return hamming_encode(data_bits, even_parity=(parity_mode == "even")).to_dict()

    elif cmd in ("verify_and_correct_hamming", "verifyAndCorrectHamming"):
        codeword = args.get("codeword", "1010101")
        parity_mode = args.get("parity_mode") or args.get("parityMode", "even")
        return hamming_decode(codeword, even_parity=(parity_mode == "even")).to_dict()

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
        payload = args.get("payload_hex") or args.get("payloadHex", "4500003c1c4640004006")
        csum = args.get("checksum_hex") or args.get("checksumHex", "b1e6")
        return verify_checksum(payload, csum).to_dict()

    elif cmd in ("simulate_sliding_window", "simulateSlidingWindow"):
        cfg_data = args.get("config", {})
        return simulate_sliding_window(FlowControlConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_go_back_n", "simulateGoBackN"):
        cfg_data = args.get("config", {})
        return simulate_go_back_n(FlowControlConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_selective_repeat", "simulateSelectiveRepeat"):
        cfg_data = args.get("config", {})
        return simulate_selective_repeat(FlowControlConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_pure_aloha", "simulatePureAloha"):
        cfg_data = args.get("config", {})
        cfg = MacConfig.from_dict(cfg_data)
        cfg.protocol = "pure_aloha"  # type: ignore
        return simulate_mac(cfg).to_dict()

    elif cmd in ("simulate_slotted_aloha", "simulateSlottedAloha"):
        cfg_data = args.get("config", {})
        cfg = MacConfig.from_dict(cfg_data)
        cfg.protocol = "slotted_aloha"  # type: ignore
        return simulate_mac(cfg).to_dict()

    elif cmd in ("simulate_csma", "simulateCsma"):
        cfg_data = args.get("config", {})
        cfg = MacConfig.from_dict(cfg_data)
        cfg.protocol = "csma"  # type: ignore
        return simulate_mac(cfg).to_dict()

    elif cmd in ("simulate_csma_cd", "simulateCsmaCd"):
        cfg_data = args.get("config", {})
        cfg = MacConfig.from_dict(cfg_data)
        cfg.protocol = "csma_cd"  # type: ignore
        return simulate_mac(cfg).to_dict()

    # 6. Transport Layer
    elif cmd in ("simulate_tcp", "simulateTcp"):
        cfg_data = args.get("config", {})
        cfg = TransportConfig.from_dict(cfg_data)
        return simulate_tcp(cfg, SESSION.project).to_dict()

    elif cmd in ("simulate_udp", "simulateUdp"):
        cfg_data = args.get("config", {})
        cfg = TransportConfig.from_dict(cfg_data)
        return simulate_udp(cfg, SESSION.project).to_dict()

    elif cmd in ("simulate_tcp_congestion", "simulateTcpCongestion"):
        cfg_data = args.get("config", {})
        cfg = TransportConfig.from_dict(cfg_data)
        return simulate_tcp(cfg, SESSION.project).to_dict()

    # 7. Application Protocols
    elif cmd in ("simulate_dns", "simulateDns"):
        cfg_data = args.get("config", {})
        return simulate_dns(DnsConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_http", "simulateHttp"):
        cfg_data = args.get("config", {})
        return simulate_http(HttpConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_ftp", "simulateFtp"):
        cfg_data = args.get("config", {})
        return simulate_ftp(FtpConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_smtp", "simulateSmtp"):
        cfg_data = args.get("config", {})
        return simulate_smtp(SmtpConfig.from_dict(cfg_data)).to_dict()

    elif cmd in ("simulate_snmp", "simulateSnmp"):
        cfg_data = args.get("config", {})
        return simulate_snmp(SnmpConfig.from_dict(cfg_data)).to_dict()

    # 8. QoS, Faults & Experiments
    elif cmd in ("get_current_qos_metrics", "getCurrentQosMetrics"):
        elapsed = SESSION.engine.current_time.as_micros()
        return compute_network_qos(
            SESSION.engine.metrics,
            list(SESSION.engine.packets.values()),
            SESSION.engine.processed_events,
            [],
            elapsed,
        ).to_dict()

    elif cmd in ("schedule_fault_command", "scheduleFaultCommand"):
        entry_data = args.get("entry") or args.get("fault_entry", {})
        entry = FaultScheduleEntry.from_dict(entry_data)
        SESSION.engine.schedule_fault(entry.fault_id, entry.timestamp_us, entry.fault_type)
        return None

    elif cmd in ("run_parameter_sweep_command", "runParameterSweepCommand"):
        cfg_data = args.get("config", {})
        cfg = SweepConfig.from_dict(cfg_data)
        return run_parameter_sweep(cfg, SESSION.project).to_dict()

    elif cmd in ("run_comparative_experiment_command", "runComparativeExperimentCommand"):
        cfg_data = args.get("config", {})
        cfg = ComparativeExperimentConfig.from_dict(cfg_data)
        return run_comparative_experiment(cfg, SESSION.project).to_dict()

    else:
        raise ValueError(f"Unknown API command: '{cmd}'")


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
            self.wfile.write(json.dumps({"status": "ok", "backend": "python", "version": "0.8.0"}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        # URL path: /api/<cmd> or /<cmd>
        cmd = self.path.lstrip("/").replace("api/", "")

        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
            args = payload.get("args", payload)
            result = dispatch_command(cmd, args)

            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            resp_bytes = json.dumps({"status": "ok", "result": result}).encode("utf-8")
            self.wfile.write(resp_bytes)
        except Exception as exc:
            logger.exception("Error executing command '%s'", cmd)
            self.send_response(500)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            err_bytes = json.dumps({"status": "error", "message": str(exc)}).encode("utf-8")
            self.wfile.write(err_bytes)

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
