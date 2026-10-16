from netsim.application.dns import (
    DnsConfig,
    DnsRecordType,
    DnsResponseCode,
    simulate_dns,
)
from netsim.application.ftp import FtpCommand, FtpConfig, simulate_ftp
from netsim.application.http import HttpConfig, HttpMethod, HttpRequest, simulate_http
from netsim.application.smtp import SmtpConfig, simulate_smtp
from netsim.application.snmp import SnmpConfig, simulate_snmp
from netsim.core.clock import SimTime
from netsim.core.engine import SimulationEngine
from netsim.datalink.checksum import internet_checksum, verify_checksum
from netsim.datalink.crc import CrcPreset, crc_compute, crc_verify
from netsim.datalink.flow_control import (
    FlowControlConfig,
    FlowControlProtocol,
    simulate_flow_control,
)
from netsim.datalink.hamming import hamming_decode, hamming_encode
from netsim.datalink.mac import CsmaMode, MacConfig, MacProtocol, simulate_mac
from netsim.experiments.config import (
    ComparativeExperimentConfig,
    ComparativeScenarioConfig,
    SweepConfig,
    SweepParameter,
    SweepParameterType,
)
from netsim.experiments.runner import run_comparative_experiment, run_parameter_sweep
from netsim.faults.model import FaultType
from netsim.models.interface import Interface
from netsim.models.link import Link, LinkEndpoint, LinkStatus
from netsim.models.node import Node, NodeType
from netsim.models.packet import PacketState
from netsim.models.project import Project
from netsim.qos.aggregation import aggregate_qos
from netsim.qos.metrics import QosMetrics, safe_div
from netsim.routing.graph import MetricType, RoutingGraph
from netsim.transport import TransportConfig, TransportProtocol
from netsim.transport.tcp import simulate_tcp
from netsim.transport.udp import simulate_udp


def create_two_node_project() -> Project:
    node_a = Node.create("node-a", "Host A", NodeType.HOST, 100.0, 100.0)
    node_b = Node.create("node-b", "Host B", NodeType.HOST, 300.0, 100.0)
    link_ab = Link(
        id="link-ab",
        source=LinkEndpoint(node_id="node-a", interface_id=node_a.interfaces[0].id),
        target=LinkEndpoint(node_id="node-b", interface_id=node_b.interfaces[0].id),
        bandwidth_bps=10_000_000,
        propagation_delay_us=10_000,
        packet_loss_rate=0.0,
        bit_error_rate=0.0,
        queue_capacity=10,
        status=LinkStatus.UP,
    )
    return Project.create("Test Two Node", nodes=[node_a, node_b], links=[link_ab])


# 1. basic packet delivery
def test_parity_01_basic_packet_delivery():
    proj = create_two_node_project()
    engine = SimulationEngine(seed=42)
    engine.update_topology(proj.nodes, proj.links)

    pkt_id = engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    assert pkt_id is not None
    engine.run_until(SimTime.from_micros(50_000))

    packets = engine.all_packets()
    assert len(packets) == 1
    pkt = packets[0]
    assert pkt.state == PacketState.DELIVERED
    assert pkt.current_node_id == "node-b"
    assert len(pkt.hop_history) >= 2


# 2. queue overflow
def test_parity_02_queue_overflow():
    proj = create_two_node_project()
    # Queue capacity is 10
    engine = SimulationEngine(seed=42)
    engine.update_topology(proj.nodes, proj.links)

    # Inject 25 packets rapidly at time 0
    for _ in range(25):
        engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")

    engine.run_until(SimTime.from_micros(500_000))
    metrics = engine.metrics
    assert metrics.packets_dropped_overflow > 0
    assert metrics.packets_delivered > 0
    assert metrics.packets_created == 25


# 3. link-down fault
def test_parity_03_link_down_fault():
    proj = create_two_node_project()
    engine = SimulationEngine(seed=42)
    engine.update_topology(proj.nodes, proj.links)

    # Schedule link-down at 5,000 us
    engine.schedule_fault("f-link-down", 5_000, FaultType.link_down("link-ab"))

    # Packet injected at 10,000 us (after link down)
    engine.run_until(SimTime.from_micros(10_000))
    engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")

    engine.run_until(SimTime.from_micros(50_000))
    assert engine.metrics.packets_dropped_link_down >= 1


# 4. restoration
def test_parity_04_restoration():
    proj = create_two_node_project()
    engine = SimulationEngine(seed=42)
    engine.update_topology(proj.nodes, proj.links)

    # Link down at 5ms, restored at 20ms
    engine.schedule_fault("f-down", 5_000, FaultType.link_down("link-ab"))
    engine.schedule_fault("f-up", 20_000, FaultType.link_restore("link-ab"))

    # Packet injected at 30ms (after restoration)
    engine.run_until(SimTime.from_micros(30_000))
    engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")

    engine.run_until(SimTime.from_micros(80_000))
    delivered = [p for p in engine.all_packets() if p.state == PacketState.DELIVERED]
    assert len(delivered) >= 1


# 5. node failure/recovery
def test_parity_05_node_failure_recovery():
    node_a = Node.create("node-a", "Host A", NodeType.HOST, 100.0, 100.0)
    router_1 = Node.create("r1", "Router 1", NodeType.ROUTER, 200.0, 100.0)
    node_b = Node.create("node-b", "Host B", NodeType.HOST, 300.0, 100.0)

    l1 = Link(
        id="l-a-r1",
        source=LinkEndpoint("node-a", node_a.interfaces[0].id),
        target=LinkEndpoint("r1", router_1.interfaces[0].id),
        bandwidth_bps=10_000_000,
        propagation_delay_us=5_000,
        packet_loss_rate=0.0,
        bit_error_rate=0.0,
        queue_capacity=20,
        status=LinkStatus.UP,
    )
    l2 = Link(
        id="l-r1-b",
        source=LinkEndpoint("r1", router_1.interfaces[1].id),
        target=LinkEndpoint("node-b", node_b.interfaces[0].id),
        bandwidth_bps=10_000_000,
        propagation_delay_us=5_000,
        packet_loss_rate=0.0,
        bit_error_rate=0.0,
        queue_capacity=20,
        status=LinkStatus.UP,
    )

    proj = Project.create("Transit Proj", nodes=[node_a, router_1, node_b], links=[l1, l2])
    engine = SimulationEngine(seed=42)
    engine.update_topology(proj.nodes, proj.links)

    # Node failure at 5ms, recovery at 25ms
    engine.schedule_fault("f-node-fail", 5_000, FaultType.node_failure("r1"))
    engine.schedule_fault("f-node-rec", 25_000, FaultType.node_recovery("r1"))

    # Packet injected while node down
    engine.run_until(SimTime.from_micros(10_000))
    engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")

    # Packet injected after node recovered
    engine.run_until(SimTime.from_micros(30_000))
    engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")

    engine.run_until(SimTime.from_micros(100_000))
    delivered = [p for p in engine.all_packets() if p.state == PacketState.DELIVERED]
    assert len(delivered) >= 1


# 6. alternate route
def test_parity_06_alternate_route():
    # Diamond: node-a -> r1 -> node-b; and node-a -> r2 -> node-b
    node_a = Node.create("node-a", "Host A", NodeType.HOST, 100.0, 100.0)
    node_a.interfaces.append(
        Interface("node-a-eth1", "eth1", "node-a", "02:00:00:01:00:02", "192.168.1.11", "255.255.255.0")
    )
    r1 = Node.create("r1", "Router 1", NodeType.ROUTER, 200.0, 50.0)
    r2 = Node.create("r2", "Router 2", NodeType.ROUTER, 200.0, 150.0)
    node_b = Node.create("node-b", "Host B", NodeType.HOST, 300.0, 100.0)
    node_b.interfaces.append(
        Interface("node-b-eth1", "eth1", "node-b", "02:00:00:01:00:04", "192.168.1.12", "255.255.255.0")
    )

    l_a_r1 = Link(
        "l-a-r1",
        LinkEndpoint("node-a", node_a.interfaces[0].id),
        LinkEndpoint("r1", r1.interfaces[0].id),
        10_000_000,
        5_000,
        0.0,
        0.0,
        20,
        LinkStatus.UP,
    )
    l_r1_b = Link(
        "l-r1-b",
        LinkEndpoint("r1", r1.interfaces[1].id),
        LinkEndpoint("node-b", node_b.interfaces[0].id),
        10_000_000,
        5_000,
        0.0,
        0.0,
        20,
        LinkStatus.UP,
    )
    l_a_r2 = Link(
        "l-a-r2",
        LinkEndpoint("node-a", node_a.interfaces[1].id),
        LinkEndpoint("r2", r2.interfaces[0].id),
        10_000_000,
        10_000,
        0.0,
        0.0,
        20,
        LinkStatus.UP,
    )
    l_r2_b = Link(
        "l-r2-b",
        LinkEndpoint("r2", r2.interfaces[1].id),
        LinkEndpoint("node-b", node_b.interfaces[1].id),
        10_000_000,
        10_000,
        0.0,
        0.0,
        20,
        LinkStatus.UP,
    )

    proj = Project.create("Diamond", [node_a, r1, r2, node_b], [l_a_r1, l_r1_b, l_a_r2, l_r2_b])

    # Initial routing selects r1 (faster path)
    graph = RoutingGraph.from_project(proj, MetricType.HOP_COUNT)
    path = graph.find_path("node-a", "node-b")
    assert path is not None
    assert "r1" in path[0]

    # When l-a-r1 goes down, alternate route through r2 is found
    l_a_r1.status = LinkStatus.DOWN
    graph_alt = RoutingGraph.from_project(proj, MetricType.HOP_COUNT)
    path_alt = graph_alt.find_path("node-a", "node-b")
    assert path_alt is not None
    assert "r2" in path_alt[0]


# 7. Hamming
def test_parity_07_hamming():
    enc = hamming_encode("1011", even_parity=True)
    assert len(enc.encoded_bits) == 7

    # Single bit error in position 3
    corrupted = list(enc.encoded_bits)
    corrupted[2] = "1" if corrupted[2] == "0" else "0"
    corrupted_str = "".join(corrupted)

    dec = hamming_decode(corrupted_str, even_parity=True)
    assert dec.has_error is True
    assert dec.corrected_bit_position == 3
    assert dec.decoded_data_bits == "1011"


# 8. CRC
def test_parity_08_crc():
    res = crc_compute("11010011101100", CrcPreset.CRC8)
    assert res.checksum_bits is not None
    assert len(res.checksum_bits) == 8

    # Verify frame
    v_ok = crc_verify(res.transmitted_frame, CrcPreset.CRC8)
    assert v_ok.is_valid is True

    # Corrupt a bit
    corrupted = list(res.transmitted_frame)
    corrupted[0] = "1" if corrupted[0] == "0" else "0"
    v_corrupt = crc_verify("".join(corrupted), CrcPreset.CRC8)
    assert v_corrupt.is_valid is False


# 9. checksum
def test_parity_09_checksum():
    data = bytes([0x45, 0x00, 0x00, 0x3C, 0x1C, 0x46, 0x40, 0x00, 0x40, 0x06])
    cs = internet_checksum(data)
    assert isinstance(cs.checksum_value, int)

    # Verification with checksum appended/verified
    v = verify_checksum(data, cs.checksum_value)
    assert v.is_valid is True

    # Corrupted
    v_corrupt = verify_checksum(data, cs.checksum_value ^ 0x01)
    assert v_corrupt.is_valid is False


# 10. GBN
def test_parity_10_gbn():
    cfg = FlowControlConfig(
        protocol=FlowControlProtocol.GO_BACK_N,
        window_size=4,
        total_frames=8,
        dropped_frames=[2],
    )
    res = simulate_flow_control(cfg)
    assert res.completed is True
    assert res.retransmitted_frames >= 1
    # Check that frames after 2 were rejected / retransmitted
    types = [e.event_type.value for e in res.events]
    assert "frame_lost" in types or "frame_rejected" in types


# 11. SR
def test_parity_11_sr():
    cfg = FlowControlConfig(
        protocol=FlowControlProtocol.SELECTIVE_REPEAT,
        window_size=4,
        total_frames=8,
        dropped_frames=[2],
    )
    res = simulate_flow_control(cfg)
    assert res.completed is True
    assert res.retransmitted_frames >= 1
    types = [e.event_type.value for e in res.events]
    assert "frame_buffered" in types or "selective_retransmission" in types


# 12. ALOHA
def test_parity_12_aloha():
    cfg = MacConfig(
        protocol=MacProtocol.PURE_ALOHA,
        station_count=3,
        traffic_load=1.5,
        seed=42,
    )
    res = simulate_mac(cfg)
    assert res.frames_transmitted >= 1


# 13. CSMA
def test_parity_13_csma():
    cfg = MacConfig(
        protocol=MacProtocol.CSMA,
        csma_mode=CsmaMode.ONE_PERSISTENT,
        station_count=4,
        traffic_load=1.0,
        seed=42,
    )
    res = simulate_mac(cfg)
    assert res.frames_transmitted >= 1


# 14. TCP retransmission
def test_parity_14_tcp_retransmission():
    cfg = TransportConfig(
        protocol=TransportProtocol.TCP,
        payload_bytes=8000,
        segment_size_bytes=1000,
        dropped_segments=[2],
        seed=42,
    )
    res = simulate_tcp(cfg)
    assert res.completed is True
    assert res.metrics.retransmissions >= 1
    assert res.metrics.fast_retransmit_count >= 1 or res.metrics.timeout_count >= 1


# 15. UDP loss
def test_parity_15_udp_loss():
    cfg = TransportConfig(
        protocol=TransportProtocol.UDP,
        payload_bytes=4000,
        segment_size_bytes=1000,
        dropped_segments=[1],
        seed=42,
    )
    res = simulate_udp(cfg)
    assert res.completed is True
    assert res.metrics.retransmissions == 0
    assert res.metrics.segments_lost >= 1


# 16. DNS
def test_parity_16_dns():
    cfg = DnsConfig(
        query_name="www.example.com",
        query_type=DnsRecordType.A,
        seed=42,
    )
    res = simulate_dns(cfg)
    assert res.response_code == DnsResponseCode.NOERROR
    assert len(res.answers) >= 1
    assert res.answers[0].value == "93.184.216.34"


# 17. HTTP
def test_parity_17_http():
    cfg = HttpConfig(
        request=HttpRequest(
            method=HttpMethod.GET,
            path="/index.html",
        ),
        seed=42,
    )
    res = simulate_http(cfg)
    assert res.response.status_code == 200
    assert "NetSim Home" in res.response.body
    assert len(res.tcp_events) > 0


# 18. FTP
def test_parity_18_ftp():
    cfg = FtpConfig(
        transfer_command=FtpCommand.RETR,
        filename="test.pdf",
        file_size_bytes=2048,
        seed=42,
    )
    res = simulate_ftp(cfg)
    assert res.state.value == "completed"
    assert res.metrics.success is True
    assert res.control_session_id != res.data_session_id


# 19. SMTP
def test_parity_19_smtp():
    cfg = SmtpConfig(
        mail_from="alice@example.com",
        rcpt_to="bob@example.com",
        subject="Parity Test",
        body="Hello world",
        seed=42,
    )
    res = simulate_smtp(cfg)
    assert res.is_accepted is True
    assert res.metrics.success is True


# 20. SNMP
def test_parity_20_snmp():
    cfg = SnmpConfig(
        requested_oid="1.3.6.1.2.1.1.1.0",
        seed=42,
    )
    res = simulate_snmp(cfg)
    assert res.found_object is not None
    assert "NetSim CoreOS" in res.found_object.value
    assert res.metrics.success is True


# 21. QoS
def test_parity_21_qos():
    div_zero = safe_div(100.0, 0.0)
    assert div_zero == 0.0

    runs = [
        QosMetrics(throughput_bits_per_sec=1000.0, average_latency_us=50.0, packet_loss_rate=0.01),
        QosMetrics(throughput_bits_per_sec=2000.0, average_latency_us=60.0, packet_loss_rate=0.02),
    ]
    agg = aggregate_qos(runs)
    assert agg.run_count == 2
    assert agg.mean_throughput_bps == 1500.0
    assert agg.mean_latency_us == 55.0


# 22. parameter sweep
def test_parity_22_parameter_sweep():
    proj = create_two_node_project()
    cfg = SweepConfig(
        experiment_name="Bandwidth Sweep",
        parameter=SweepParameter(param_type=SweepParameterType.LINK_BANDWIDTH),
        parameter_values=[1_000_000.0, 5_000_000.0, 10_000_000.0],
        seeds=[42],
        simulation_duration_us=100_000,
        base_project=proj,
        packet_count=5,
    )
    res = run_parameter_sweep(cfg, proj)
    assert res.total_runs == 3
    assert len(res.points) == 3


# 23. multi-seed
def test_parity_23_multi_seed():
    proj = create_two_node_project()
    cfg = SweepConfig(
        experiment_name="Multi Seed",
        parameter=SweepParameter(param_type=SweepParameterType.PACKET_SIZE_BYTES),
        parameter_values=[500.0],
        seeds=[1, 2, 3],
        simulation_duration_us=50_000,
        base_project=proj,
        packet_count=5,
    )
    res = run_parameter_sweep(cfg, proj)
    assert res.total_runs == 3
    assert len(res.points[0].runs) == 3


# 24. comparison experiment
def test_parity_24_comparison_experiment():
    proj = create_two_node_project()
    cfg = ComparativeExperimentConfig(
        experiment_name="Comparison AB",
        scenario_a=ComparativeScenarioConfig(
            name="Scenario Low Delay",
            description="5ms delay",
            parameter_overrides=[(SweepParameter(SweepParameterType.PROPAGATION_DELAY), 5_000.0)],
        ),
        scenario_b=ComparativeScenarioConfig(
            name="Scenario High Delay",
            description="50ms delay",
            parameter_overrides=[(SweepParameter(SweepParameterType.PROPAGATION_DELAY), 50_000.0)],
        ),
        seeds=[42],
        simulation_duration_us=100_000,
        base_project=proj,
        packet_count=5,
    )
    res = run_comparative_experiment(cfg, proj)
    assert res.runs_count_per_scenario == 1
    assert len(res.deltas) > 0
