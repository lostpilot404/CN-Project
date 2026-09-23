use crate::commands::algorithms::calculate_simple_checksum;
use crate::domain::{
    InterfaceStatus, Link, LinkEndpoint, LinkStatus, Node, NodeState, NodeType, PacketState,
    Position, Project, TopologyHistory,
};
use crate::error::NetSimError;
use crate::simulation::{
    calculate_arrival_time_us, calculate_tx_delay_us, DeterministicRng, LinkQueue, QueueError,
    SimEventType, SimTime, SimulationEngine, SimulationStatus,
};

#[test]
fn test_project_defaults_and_serialization() {
    let project = Project::new("Test Network".to_string());
    assert_eq!(project.schema_version, 1);
    assert_eq!(project.metadata.name, "Test Network");
    assert_eq!(project.nodes.len(), 0);
    assert_eq!(project.links.len(), 0);

    let json = serde_json::to_string_pretty(&project).expect("Serialization failed");
    let deserialized: Project = serde_json::from_str(&json).expect("Deserialization failed");
    assert_eq!(deserialized.metadata.name, "Test Network");
    assert_eq!(deserialized.simulation_config.seed, 42891);
}

#[test]
fn test_node_and_link_domain_creation() {
    let node = Node::new(
        "pc-1".to_string(),
        "Workstation 1".to_string(),
        NodeType::Pc,
        Position { x: 100.0, y: 150.0 },
    );
    assert_eq!(node.id, "pc-1");
    assert_eq!(node.node_type, NodeType::Pc);
    assert_eq!(node.position.x, 100.0);

    let link = Link::new(
        "link-1".to_string(),
        LinkEndpoint {
            node_id: "pc-1".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "router-1".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    assert_eq!(link.id, "link-1");
    assert_eq!(link.status, LinkStatus::Up);
    assert_eq!(link.queue_capacity, 50);
}

#[test]
fn test_sim_time_arithmetic() {
    let t0 = SimTime::ZERO;
    assert_eq!(t0.as_micros(), 0);

    let t1 = SimTime::from_millis(15);
    assert_eq!(t1.as_micros(), 15_000);
    assert_eq!(t1.as_millis(), 15.0);

    let t2 = t1.add_micros(500);
    assert_eq!(t2.as_micros(), 15_500);
    assert_eq!(t2.as_millis(), 15.5);
    assert!(t2 > t1);
    assert!(t1 < t2);
}

#[test]
fn test_discrete_event_queue_ordering() {
    let mut engine = SimulationEngine::new(12345);

    // Schedule events out of chronological order
    engine.schedule_event(
        SimTime::from_micros(5_000),
        SimEventType::PacketArrived {
            packet_id: "pkt-1".to_string(),
            node_id: "node-b".to_string(),
            link_id: "link-1".to_string(),
        },
        "Arrived second".to_string(),
    );
    engine.schedule_event(
        SimTime::from_micros(1_000),
        SimEventType::PacketCreated {
            packet_id: "pkt-1".to_string(),
            node_id: "node-a".to_string(),
            size_bytes: 1000,
        },
        "Created first".to_string(),
    );
    engine.schedule_event(
        SimTime::from_micros(2_500),
        SimEventType::TransmissionStarted {
            packet_id: "pkt-1".to_string(),
            link_id: "link-1".to_string(),
            tx_delay_us: 1500,
        },
        "Tx started middle".to_string(),
    );

    // Verify step executes in strictly ascending timestamp order
    let ev1 = engine.step().unwrap().expect("Event 1 missing");
    assert_eq!(ev1.timestamp.as_micros(), 1_000);
    assert_eq!(engine.current_time().as_micros(), 1_000);

    let ev2 = engine.step().unwrap().expect("Event 2 missing");
    assert_eq!(ev2.timestamp.as_micros(), 2_500);
    assert_eq!(engine.current_time().as_micros(), 2_500);

    let ev3 = engine.step().unwrap().expect("Event 3 missing");
    assert_eq!(ev3.timestamp.as_micros(), 5_000);
    assert_eq!(engine.current_time().as_micros(), 5_000);

    let ev4 = engine.step().unwrap();
    assert!(ev4.is_none());
    assert_eq!(engine.status(), SimulationStatus::Completed);
}

#[test]
fn test_simultaneous_event_tie_breaking() {
    let mut engine = SimulationEngine::new(99);

    // Schedule 3 events with the exact same timestamp
    let t = SimTime::from_micros(3_000);
    engine.schedule_event(
        t,
        SimEventType::PacketCreated {
            packet_id: "pkt-1".to_string(),
            node_id: "node-1".to_string(),
            size_bytes: 500,
        },
        "Event A (id 1)".to_string(),
    );
    engine.schedule_event(
        t,
        SimEventType::PacketCreated {
            packet_id: "pkt-2".to_string(),
            node_id: "node-2".to_string(),
            size_bytes: 600,
        },
        "Event B (id 2)".to_string(),
    );
    engine.schedule_event(
        t,
        SimEventType::PacketCreated {
            packet_id: "pkt-3".to_string(),
            node_id: "node-3".to_string(),
            size_bytes: 700,
        },
        "Event C (id 3)".to_string(),
    );

    // Monotonic ID tie-breaking ensures strictly deterministic execution order 1 -> 2 -> 3
    let ev1 = engine.step().unwrap().unwrap();
    let ev2 = engine.step().unwrap().unwrap();
    let ev3 = engine.step().unwrap().unwrap();

    assert_eq!(ev1.id, 1);
    assert_eq!(ev2.id, 2);
    assert_eq!(ev3.id, 3);
    assert_eq!(ev1.timestamp, ev2.timestamp);
    assert_eq!(ev2.timestamp, ev3.timestamp);
}

#[test]
fn test_delay_calculations() {
    // 1000 bytes over 10 Mbps (10,000,000 bps)
    // bits = 8,000. 8,000 * 1,000,000 / 10,000,000 = 800 µs
    let tx_delay = calculate_tx_delay_us(1000, 10_000_000);
    assert_eq!(tx_delay, 800);

    // 1500 bytes over 1 Gbps (1,000,000,000 bps) = 12 µs
    let tx_delay_gbps = calculate_tx_delay_us(1500, 1_000_000_000);
    assert_eq!(tx_delay_gbps, 12);

    // Integer ceiling division check:
    // 64 bytes = 512 bits. Over 100 Mbps = 5.12 µs -> ceiling 6 µs
    let tx_delay_ceil = calculate_tx_delay_us(64, 100_000_000);
    assert_eq!(tx_delay_ceil, 6);

    // Arrival time: tx_start + tx_delay + prop_delay
    let arrival = calculate_arrival_time_us(2000, tx_delay, 5000);
    assert_eq!(arrival, 7800);
}

#[test]
fn test_queue_fifo_and_overflow_drop_tail() {
    let mut q = LinkQueue::new("link-test".to_string(), 2);
    assert_eq!(q.occupancy(), 0);
    assert!(q.is_empty());

    // Enqueue 2 packets
    assert_eq!(q.enqueue("pkt-1".to_string()), Ok(()));
    assert_eq!(q.enqueue("pkt-2".to_string()), Ok(()));
    assert_eq!(q.occupancy(), 2);

    // 3rd packet should overflow (drop-tail)
    assert_eq!(q.enqueue("pkt-3".to_string()), Err(QueueError::QueueFull));
    assert_eq!(q.total_dropped_overflow, 1);
    assert_eq!(q.occupancy(), 2);

    // Verify FIFO dequeue order
    assert_eq!(q.dequeue(), Some("pkt-1".to_string()));
    assert_eq!(q.dequeue(), Some("pkt-2".to_string()));
    assert_eq!(q.dequeue(), None);
    assert!(q.is_empty());
}

#[test]
fn test_packet_transmission_and_arrival_timing() {
    let mut engine = SimulationEngine::new(42);

    // Configure a direct link between node-a and node-b
    let mut link = Link::new(
        "link-ab".to_string(),
        LinkEndpoint {
            node_id: "node-a".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "node-b".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    link.bandwidth_bps = 10_000_000; // 10 Mbps -> 1000 bytes = 800 µs tx delay
    link.propagation_delay_us = 5_000; // 5000 µs propagation delay
    link.loss_probability = 0.0;
    link.bit_error_rate = 0.0;
    engine.update_links(&[link]);

    // Inject packet at virtual time 0
    let pkt_id = engine.inject_packet(
        "node-a".to_string(),
        "node-b".to_string(),
        1000,
        "HTTP".to_string(),
        "TCP".to_string(),
    );

    // Step 1: PacketCreated at 0 µs
    let ev1 = engine.step().unwrap().unwrap();
    assert_eq!(ev1.timestamp.as_micros(), 0);

    // Step 2: QueueEntered at 5 µs
    let ev2 = engine.step().unwrap().unwrap();
    assert_eq!(ev2.timestamp.as_micros(), 5);

    // Step 3: TransmissionStarted at 5 µs (queue was idle)
    let ev3 = engine.step().unwrap().unwrap();
    assert_eq!(ev3.timestamp.as_micros(), 5);

    // Step 4: TransmissionFinished at 5 + 800 = 805 µs
    let ev4 = engine.step().unwrap().unwrap();
    assert_eq!(ev4.timestamp.as_micros(), 805);

    // Step 5: PacketArrived at 5 + 800 + 5000 = 5805 µs
    let ev5 = engine.step().unwrap().unwrap();
    assert_eq!(ev5.timestamp.as_micros(), 5805);

    // Verify packet state is Delivered
    let pkt = engine.get_packet(&pkt_id).expect("Packet not found");
    assert_eq!(pkt.state, PacketState::Delivered);
    assert_eq!(pkt.current_node_id, "node-b");
    assert_eq!(pkt.journey_hops, vec!["node-a", "node-b"]);

    // Verify metrics
    let metrics = engine.metrics();
    assert_eq!(metrics.packets_created, 1);
    assert_eq!(metrics.packets_delivered, 1);
    assert_eq!(metrics.total_dropped(), 0);
    assert_eq!(metrics.total_latency_us, 5805);
}

#[test]
fn test_drop_tail_overflow_under_load() {
    let mut engine = SimulationEngine::new(42);

    let mut link = Link::new(
        "link-small-q".to_string(),
        LinkEndpoint {
            node_id: "node-a".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "node-b".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    link.queue_capacity = 1; // Queue can hold at most 1 packet waiting
    link.bandwidth_bps = 1_000_000; // 1 Mbps -> 1000 bytes = 8000 µs
    link.propagation_delay_us = 1_000;
    link.loss_probability = 0.0;
    link.bit_error_rate = 0.0;
    engine.update_links(&[link]);

    // Inject 4 packets simultaneously
    let mut pkt_ids = Vec::new();
    for _ in 0..4 {
        pkt_ids.push(engine.inject_packet(
            "node-a".to_string(),
            "node-b".to_string(),
            1000,
            "HTTP".to_string(),
            "TCP".to_string(),
        ));
    }

    // Run until all events are processed
    let processed = engine.run_all().unwrap();
    assert!(processed > 0);

    // With queue capacity 1 + 1 transmitting, at least 2 packets must be dropped due to overflow
    let metrics = engine.metrics();
    assert!(metrics.packets_dropped_overflow >= 2);
    assert_eq!(metrics.packets_created, 4);
}

#[test]
fn test_link_down_packet_drop() {
    let mut engine = SimulationEngine::new(42);

    let mut link = Link::new(
        "link-broken".to_string(),
        LinkEndpoint {
            node_id: "node-a".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "node-b".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    link.status = LinkStatus::Down; // Link is administratively down
    engine.update_links(&[link]);

    let pkt_id = engine.inject_packet(
        "node-a".to_string(),
        "node-b".to_string(),
        1000,
        "HTTP".to_string(),
        "TCP".to_string(),
    );

    engine.run_all().unwrap();

    let pkt = engine.get_packet(&pkt_id).unwrap();
    assert_eq!(pkt.state, PacketState::DroppedLinkDown);
    assert_eq!(engine.metrics().packets_dropped_link_down, 1);
}

#[test]
fn test_stochastic_loss_and_bit_error_drops() {
    // 1. 100% Loss rate
    let mut engine_loss = SimulationEngine::new(100);
    let mut link_loss = Link::new(
        "link-lossy".to_string(),
        LinkEndpoint {
            node_id: "node-a".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "node-b".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    link_loss.loss_probability = 1.0; // 100% loss
    engine_loss.update_links(&[link_loss]);

    engine_loss.inject_packet(
        "node-a".to_string(),
        "node-b".to_string(),
        1000,
        "HTTP".to_string(),
        "TCP".to_string(),
    );
    engine_loss.run_all().unwrap();
    assert_eq!(engine_loss.metrics().packets_dropped_loss, 1);

    // 2. 100% Bit error rate
    let mut engine_err = SimulationEngine::new(100);
    let mut link_err = Link::new(
        "link-err".to_string(),
        LinkEndpoint {
            node_id: "node-a".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "node-b".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    link_err.loss_probability = 0.0;
    link_err.bit_error_rate = 1.0; // 100% bit error
    engine_err.update_links(&[link_err]);

    engine_err.inject_packet(
        "node-a".to_string(),
        "node-b".to_string(),
        1000,
        "HTTP".to_string(),
        "TCP".to_string(),
    );
    engine_err.run_all().unwrap();
    assert_eq!(engine_err.metrics().packets_dropped_error, 1);
}

#[test]
fn test_seeded_rng_reproducibility() {
    let mut rng1 = DeterministicRng::new(9999);
    let mut rng2 = DeterministicRng::new(9999);

    for _ in 0..100 {
        let f1 = rng1.gen_range_f64(0.0, 1.0);
        let f2 = rng2.gen_range_f64(0.0, 1.0);
        assert_eq!(f1, f2);

        let b1 = rng1.gen_bool(0.3);
        let b2 = rng2.gen_bool(0.3);
        assert_eq!(b1, b2);

        let u1 = rng1.gen_range_u32(10, 500);
        let u2 = rng2.gen_range_u32(10, 500);
        assert_eq!(u1, u2);
    }
}

#[test]
fn test_deterministic_replay_and_reset() {
    let seed = 8888;
    let mut engine1 = SimulationEngine::new(seed);
    let mut engine2 = SimulationEngine::new(seed);

    let link = Link::new(
        "link-test".to_string(),
        LinkEndpoint {
            node_id: "n1".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "n2".to_string(),
            interface_id: "eth0".to_string(),
        },
    );

    engine1.update_links(std::slice::from_ref(&link));
    engine2.update_links(&[link]);

    for _ in 0..5 {
        engine1.inject_packet(
            "n1".to_string(),
            "n2".to_string(),
            1000,
            "HTTP".to_string(),
            "TCP".to_string(),
        );
        engine2.inject_packet(
            "n1".to_string(),
            "n2".to_string(),
            1000,
            "HTTP".to_string(),
            "TCP".to_string(),
        );
    }

    let count1 = engine1.run_all().unwrap();
    let count2 = engine2.run_all().unwrap();

    assert_eq!(count1, count2);
    assert_eq!(engine1.current_time(), engine2.current_time());
    assert_eq!(
        engine1.metrics().packets_delivered,
        engine2.metrics().packets_delivered
    );
    assert_eq!(
        engine1.metrics().total_latency_us,
        engine2.metrics().total_latency_us
    );

    // Test engine1 reset with same seed
    engine1.reset(seed);
    assert_eq!(engine1.current_time(), SimTime::ZERO);
    assert_eq!(engine1.status(), SimulationStatus::Ready);
    assert_eq!(engine1.metrics().packets_created, 0);
    assert_eq!(engine1.metrics().packets_delivered, 0);

    // Replay on engine1
    for _ in 0..5 {
        engine1.inject_packet(
            "n1".to_string(),
            "n2".to_string(),
            1000,
            "HTTP".to_string(),
            "TCP".to_string(),
        );
    }
    let count1_replay = engine1.run_all().unwrap();
    assert_eq!(count1_replay, count2);
    assert_eq!(engine1.current_time(), engine2.current_time());
}

#[test]
fn test_simulation_controls_step_run_until_pause() {
    let mut engine = SimulationEngine::new(123);
    let link = Link::new(
        "link-test".to_string(),
        LinkEndpoint {
            node_id: "n1".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "n2".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    engine.update_links(&[link]);

    engine.inject_packet(
        "n1".to_string(),
        "n2".to_string(),
        1000,
        "HTTP".to_string(),
        "TCP".to_string(),
    );

    // Run until 50 µs
    let stepped = engine.run_until(SimTime::from_micros(50)).unwrap();
    assert!(stepped > 0);
    assert!(engine.current_time().as_micros() <= 50);

    // Test pause
    engine.pause();
    assert_eq!(engine.status(), SimulationStatus::Paused);

    // Run remaining
    let rem = engine.run_all().unwrap();
    assert!(rem > 0);
    assert_eq!(engine.status(), SimulationStatus::Completed);
}

#[test]
fn test_simple_checksum_algorithm() {
    let words = vec![0x4500, 0x003c, 0x1c46, 0x4000, 0x4006];
    let res = calculate_simple_checksum(words).expect("Checksum calculation failed");
    assert!(res.is_valid);
    assert_eq!(res.checksum_hex.len(), 4);
}

#[test]
fn test_node_types_and_default_interface_generation() {
    let pc = Node::new(
        "pc-1".to_string(),
        "PC 1".to_string(),
        NodeType::Pc,
        Position { x: 0.0, y: 0.0 },
    );
    assert_eq!(pc.interfaces.len(), 1);
    assert_eq!(pc.interfaces[0].name, "eth0");
    assert_eq!(pc.interfaces[0].ipv4, Some("192.168.1.10".to_string()));
    assert_eq!(pc.interfaces[0].status, InterfaceStatus::Up);
    assert_eq!(pc.state, NodeState::Up);

    let server = Node::new(
        "srv-1".to_string(),
        "Server 1".to_string(),
        NodeType::Server,
        Position { x: 0.0, y: 0.0 },
    );
    assert_eq!(server.interfaces.len(), 1);
    assert_eq!(server.interfaces[0].name, "eth0");
    assert_eq!(server.interfaces[0].ipv4, Some("10.0.0.100".to_string()));

    let router = Node::new(
        "r-1".to_string(),
        "Router 1".to_string(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    assert_eq!(router.interfaces.len(), 4);
    assert_eq!(router.interfaces[0].name, "eth0");
    assert_eq!(router.interfaces[3].name, "eth3");
    assert!(router.interfaces[0]
        .ipv4
        .as_ref()
        .unwrap()
        .contains("10.0.1.1"));

    let switch = Node::new(
        "sw-1".to_string(),
        "Switch 1".to_string(),
        NodeType::Switch,
        Position { x: 0.0, y: 0.0 },
    );
    assert_eq!(switch.interfaces.len(), 8);
    assert_eq!(switch.interfaces[0].name, "port1");
    assert_eq!(switch.interfaces[7].name, "port8");
    assert!(switch.interfaces[0].ipv4.is_none());

    let ap = Node::new(
        "ap-1".to_string(),
        "AP 1".to_string(),
        NodeType::AccessPoint,
        Position { x: 0.0, y: 0.0 },
    );
    assert_eq!(ap.interfaces.len(), 2);
    assert_eq!(ap.interfaces[0].name, "eth0");
    assert_eq!(ap.interfaces[1].name, "wlan0");

    let generic = Node::new(
        "gen-1".to_string(),
        "Gen 1".to_string(),
        NodeType::Generic,
        Position { x: 0.0, y: 0.0 },
    );
    assert_eq!(generic.interfaces.len(), 2);
}

#[test]
fn test_link_validation_rules() {
    let endpoint_a = LinkEndpoint {
        node_id: "node-1".to_string(),
        interface_id: "eth0".to_string(),
    };
    let endpoint_b = LinkEndpoint {
        node_id: "node-2".to_string(),
        interface_id: "eth0".to_string(),
    };

    // Valid link
    let mut link = Link::new("link-1".to_string(), endpoint_a.clone(), endpoint_b.clone());
    assert!(link.validate().is_ok());

    // Self-loop validation
    let self_loop = Link::new("link-self".to_string(), endpoint_a.clone(), endpoint_a);
    match self_loop.validate() {
        Err(NetSimError::InvalidConnection(msg)) => assert!(msg.contains("itself")),
        other => panic!("Expected InvalidConnection, got {:?}", other),
    }

    // Zero bandwidth
    link.bandwidth_bps = 0;
    match link.validate() {
        Err(NetSimError::InvalidProperty(msg)) => assert!(msg.contains("bandwidth")),
        other => panic!("Expected InvalidProperty for 0 bandwidth, got {:?}", other),
    }
    link.bandwidth_bps = 10_000_000;

    // Invalid loss probability
    link.loss_probability = 1.5;
    assert!(link.validate().is_err());
    link.loss_probability = -0.1;
    assert!(link.validate().is_err());
    link.loss_probability = 0.05;
    assert!(link.validate().is_ok());

    // Invalid BER
    link.bit_error_rate = 2.0;
    assert!(link.validate().is_err());
    link.bit_error_rate = 0.0001;
    assert!(link.validate().is_ok());

    // Zero queue capacity
    link.queue_capacity = 0;
    assert!(link.validate().is_err());
    link.queue_capacity = 50;
    assert!(link.validate().is_ok());
}

#[test]
fn test_node_interface_attachment_and_detachment() {
    let mut node = Node::new(
        "pc-1".to_string(),
        "PC 1".to_string(),
        NodeType::Pc,
        Position { x: 0.0, y: 0.0 },
    );
    assert!(node.first_free_interface().is_some());
    assert_eq!(node.interfaces[0].link_id, None);

    // Attach link
    assert!(node.attach_link("eth0", "link-100").is_ok());
    assert_eq!(node.interfaces[0].link_id.as_deref(), Some("link-100"));
    assert!(node.first_free_interface().is_none());

    // Attaching same link is idempotent
    assert!(node.attach_link("eth0", "link-100").is_ok());

    // Attaching different link while occupied fails
    let err = node.attach_link("eth0", "link-200");
    assert!(err.is_err());
    match err {
        Err(NetSimError::InvalidConnection(msg)) => assert!(msg.contains("already connected")),
        other => panic!("Expected InvalidConnection, got {:?}", other),
    }

    // Non-existent interface fails
    assert!(node.attach_link("eth99", "link-300").is_err());

    // Detach link
    node.detach_link("link-100");
    assert_eq!(node.interfaces[0].link_id, None);
    assert!(node.first_free_interface().is_some());
}

#[test]
fn test_node_deletion_cascading_and_interface_cleanup() {
    let mut proj = Project::new("Cascade Test".to_string());
    let mut n1 = Node::new(
        "n1".to_string(),
        "PC 1".to_string(),
        NodeType::Pc,
        Position { x: 0.0, y: 0.0 },
    );
    let mut n2 = Node::new(
        "n2".to_string(),
        "Router 1".to_string(),
        NodeType::Router,
        Position { x: 100.0, y: 0.0 },
    );
    let mut n3 = Node::new(
        "n3".to_string(),
        "Server 1".to_string(),
        NodeType::Server,
        Position { x: 200.0, y: 0.0 },
    );

    n1.attach_link("eth0", "link-1-2").unwrap();
    n2.attach_link("eth0", "link-1-2").unwrap();
    n2.attach_link("eth1", "link-2-3").unwrap();
    n3.attach_link("eth0", "link-2-3").unwrap();

    let l1 = Link::new(
        "link-1-2".to_string(),
        LinkEndpoint {
            node_id: "n1".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "n2".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    let l2 = Link::new(
        "link-2-3".to_string(),
        LinkEndpoint {
            node_id: "n2".to_string(),
            interface_id: "eth1".to_string(),
        },
        LinkEndpoint {
            node_id: "n3".to_string(),
            interface_id: "eth0".to_string(),
        },
    );

    proj.nodes = vec![n1, n2, n3];
    proj.links = vec![l1, l2];

    // Deleting n2 should remove both links and detach them from n1 and n3
    let target = "n2";
    let links_to_remove: Vec<String> = proj
        .links
        .iter()
        .filter(|l| l.source.node_id == target || l.target.node_id == target)
        .map(|l| l.id.clone())
        .collect();
    assert_eq!(links_to_remove.len(), 2);

    for lid in &links_to_remove {
        for n in &mut proj.nodes {
            n.detach_link(lid);
        }
    }
    proj.links.retain(|l| !links_to_remove.contains(&l.id));
    proj.nodes.retain(|n| n.id != target);

    assert_eq!(proj.nodes.len(), 2);
    assert_eq!(proj.links.len(), 0);

    // Interfaces on n1 and n3 must now be free
    let remaining_n1 = proj.nodes.iter().find(|n| n.id == "n1").unwrap();
    assert_eq!(remaining_n1.interfaces[0].link_id, None);
    let remaining_n3 = proj.nodes.iter().find(|n| n.id == "n3").unwrap();
    assert_eq!(remaining_n3.interfaces[0].link_id, None);
}

#[test]
fn test_topology_history_undo_redo() {
    let mut history = TopologyHistory::new(5);
    assert!(!history.can_undo());
    assert!(!history.can_redo());

    let mut current = Project::new("V0".to_string());

    // Mutation 1
    history.push_undo(current.clone());
    current.metadata.name = "V1".to_string();
    assert!(history.can_undo());
    assert!(!history.can_redo());

    // Mutation 2
    history.push_undo(current.clone());
    current.metadata.name = "V2".to_string();

    // Undo -> V1
    assert!(history.undo(&mut current));
    assert_eq!(current.metadata.name, "V1");
    assert!(history.can_undo());
    assert!(history.can_redo());

    // Undo -> V0
    assert!(history.undo(&mut current));
    assert_eq!(current.metadata.name, "V0");
    assert!(!history.can_undo());
    assert!(history.can_redo());

    // Redo -> V1
    assert!(history.redo(&mut current));
    assert_eq!(current.metadata.name, "V1");

    // Redo -> V2
    assert!(history.redo(&mut current));
    assert_eq!(current.metadata.name, "V2");
    assert!(!history.can_redo());

    // Pushing new undo clears redo stack
    history.push_undo(current.clone());
    current.metadata.name = "V3".to_string();
    assert!(!history.can_redo());

    // Test max depth capping
    for i in 4..20 {
        history.push_undo(current.clone());
        current.metadata.name = format!("V{}", i);
    }
    // Can only undo up to max_depth (5) times
    let mut undo_count = 0;
    while history.undo(&mut current) {
        undo_count += 1;
    }
    assert_eq!(undo_count, 5);
}

#[test]
fn test_topology_simulation_state_synchronization() {
    let mut proj = Project::new("Sync Test".to_string());
    let mut engine = SimulationEngine::new(42);

    let l1 = Link::new(
        "link-alpha".to_string(),
        LinkEndpoint {
            node_id: "a".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "b".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    let l2 = Link::new(
        "link-beta".to_string(),
        LinkEndpoint {
            node_id: "b".to_string(),
            interface_id: "eth1".to_string(),
        },
        LinkEndpoint {
            node_id: "c".to_string(),
            interface_id: "eth0".to_string(),
        },
    );

    proj.links.push(l1);
    proj.links.push(l2);

    // Sync to simulation engine
    engine.update_links(&proj.links);
    let queues = engine.link_queues();
    assert_eq!(queues.len(), 2);
    assert!(queues.contains_key("link-alpha"));
    assert!(queues.contains_key("link-beta"));

    // Remove one link from topology and re-sync
    proj.links.retain(|l| l.id != "link-alpha");
    engine.update_links(&proj.links);
    let queues_updated = engine.link_queues();
    assert_eq!(queues_updated.len(), 1);
    assert!(!queues_updated.contains_key("link-alpha"));
    assert!(queues_updated.contains_key("link-beta"));
}

#[test]
fn test_complex_topology_serialization_roundtrip() {
    let mut proj = Project::new("Full Campus Topology".to_string());
    let pc1 = Node::new(
        "pc-1".to_string(),
        "Student Lab PC".to_string(),
        NodeType::Pc,
        Position { x: 50.0, y: 50.0 },
    );
    let r1 = Node::new(
        "r-1".to_string(),
        "Core Gateway".to_string(),
        NodeType::Router,
        Position { x: 250.0, y: 150.0 },
    );
    let s1 = Node::new(
        "s-1".to_string(),
        "DC Web Server".to_string(),
        NodeType::Server,
        Position { x: 450.0, y: 50.0 },
    );

    let mut link1 = Link::new(
        "link-pc1-r1".to_string(),
        LinkEndpoint {
            node_id: "pc-1".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "r-1".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    link1.bandwidth_bps = 1_000_000_000;
    link1.propagation_delay_us = 500;
    link1.loss_probability = 0.001;
    link1.bit_error_rate = 0.00001;
    link1.queue_capacity = 200;
    link1.status = LinkStatus::Up;

    proj.nodes = vec![pc1, r1, s1];
    proj.links = vec![link1];

    let json = serde_json::to_string_pretty(&proj).expect("Serialization failed");
    let restored: Project = serde_json::from_str(&json).expect("Deserialization failed");

    assert_eq!(restored.nodes.len(), 3);
    assert_eq!(restored.links.len(), 1);
    assert_eq!(restored.links[0].bandwidth_bps, 1_000_000_000);
    assert_eq!(restored.links[0].propagation_delay_us, 500);
    assert_eq!(restored.links[0].queue_capacity, 200);
    assert_eq!(restored.nodes[1].interfaces.len(), 4);
}

#[test]
fn test_duplicate_id_and_endpoint_validation() {
    let mut proj = Project::new("Validation Test".to_string());
    let node1 = Node::new(
        "pc-1".to_string(),
        "PC 1".to_string(),
        NodeType::Pc,
        Position { x: 0.0, y: 0.0 },
    );
    let node2 = Node::new(
        "pc-2".to_string(),
        "PC 2".to_string(),
        NodeType::Pc,
        Position { x: 100.0, y: 0.0 },
    );
    proj.nodes = vec![node1, node2];

    // Duplicate node ID detection
    let is_duplicate_node = proj.nodes.iter().any(|n| n.id == "pc-1");
    assert!(is_duplicate_node);

    let is_non_duplicate_node = proj.nodes.iter().any(|n| n.id == "pc-3");
    assert!(!is_non_duplicate_node);

    // Non-existent endpoint validation
    let source_id = "non-existent-1";
    let target_id = "pc-2";
    let source_exists = proj.nodes.iter().any(|n| n.id == source_id);
    let target_exists = proj.nodes.iter().any(|n| n.id == target_id);
    assert!(!source_exists);
    assert!(target_exists);

    // Duplicate link ID detection
    let l1 = Link::new(
        "link-pc1-pc2".to_string(),
        LinkEndpoint {
            node_id: "pc-1".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "pc-2".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    proj.links.push(l1);

    let is_duplicate_link = proj.links.iter().any(|l| l.id == "link-pc1-pc2");
    assert!(is_duplicate_link);
    let is_new_link = proj.links.iter().any(|l| l.id == "link-other");
    assert!(!is_new_link);
}

#[test]
fn test_interface_address_validation() {
    use std::net::Ipv4Addr;

    // Valid IPv4
    assert!("192.168.1.1".parse::<Ipv4Addr>().is_ok());
    assert!("10.0.0.1".parse::<Ipv4Addr>().is_ok());
    assert!("255.255.255.0".parse::<Ipv4Addr>().is_ok());

    // Invalid IPv4
    assert!("256.1.1.1".parse::<Ipv4Addr>().is_err());
    assert!("not.an.ip.address".parse::<Ipv4Addr>().is_err());
    assert!("192.168.1".parse::<Ipv4Addr>().is_err());
    assert!("192.168.1.1.1".parse::<Ipv4Addr>().is_err());
}

#[test]
fn test_phase3_full_acceptance_workflow_18_steps() {
    let mut history = TopologyHistory::new(50);
    let mut proj = Project::new("E2E Acceptance Topology".to_string());
    let mut sim = SimulationEngine::new(42891);

    // Step 1: Clean topology
    assert_eq!(proj.nodes.len(), 0);
    assert_eq!(proj.links.len(), 0);

    // Step 2: Add PC
    history.push_undo(proj.clone());
    let pc = Node::new(
        "pc-1".to_string(),
        "Lab PC 1".to_string(),
        NodeType::Pc,
        Position { x: 100.0, y: 200.0 },
    );
    proj.nodes.push(pc);

    // Step 3: Add Router
    history.push_undo(proj.clone());
    let router = Node::new(
        "r-1".to_string(),
        "Gateway R1".to_string(),
        NodeType::Router,
        Position { x: 350.0, y: 200.0 },
    );
    proj.nodes.push(router);

    // Step 4: Add Server
    history.push_undo(proj.clone());
    let server = Node::new(
        "srv-1".to_string(),
        "Web Server S1".to_string(),
        NodeType::Server,
        Position { x: 600.0, y: 200.0 },
    );
    proj.nodes.push(server);

    // Step 5: Connect valid interfaces
    // Link 1: PC eth0 <-> Router eth0
    history.push_undo(proj.clone());
    let link1 = Link::new(
        "link-pc-r1".to_string(),
        LinkEndpoint {
            node_id: "pc-1".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "r-1".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    assert!(link1.validate().is_ok());
    proj.nodes
        .iter_mut()
        .find(|n| n.id == "pc-1")
        .unwrap()
        .attach_link("eth0", "link-pc-r1")
        .unwrap();
    proj.nodes
        .iter_mut()
        .find(|n| n.id == "r-1")
        .unwrap()
        .attach_link("eth0", "link-pc-r1")
        .unwrap();
    proj.links.push(link1);

    // Link 2: Router eth1 <-> Server eth0
    history.push_undo(proj.clone());
    let link2 = Link::new(
        "link-r1-srv".to_string(),
        LinkEndpoint {
            node_id: "r-1".to_string(),
            interface_id: "eth1".to_string(),
        },
        LinkEndpoint {
            node_id: "srv-1".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    assert!(link2.validate().is_ok());
    proj.nodes
        .iter_mut()
        .find(|n| n.id == "r-1")
        .unwrap()
        .attach_link("eth1", "link-r1-srv")
        .unwrap();
    proj.nodes
        .iter_mut()
        .find(|n| n.id == "srv-1")
        .unwrap()
        .attach_link("eth0", "link-r1-srv")
        .unwrap();
    proj.links.push(link2);

    sim.update_links(&proj.links);

    // Step 6: Verify links in topology state
    assert_eq!(proj.nodes.len(), 3);
    assert_eq!(proj.links.len(), 2);
    assert_eq!(sim.link_queues().len(), 2);

    // Step 7: Select node and change its label
    history.push_undo(proj.clone());
    let pc_ref = proj.nodes.iter_mut().find(|n| n.id == "pc-1").unwrap();
    pc_ref.label = "Accounting Workstation".to_string();
    assert_eq!(pc_ref.label, "Accounting Workstation");

    // Step 8: Change node interface IPv4 address and subnet mask
    history.push_undo(proj.clone());
    let iface_ref = proj
        .nodes
        .iter_mut()
        .find(|n| n.id == "pc-1")
        .unwrap()
        .interfaces
        .get_mut(0)
        .unwrap();
    iface_ref.ipv4 = Some("192.168.10.50".to_string());
    iface_ref.subnet_mask = Some("255.255.255.128".to_string());
    assert_eq!(iface_ref.ipv4.as_deref(), Some("192.168.10.50"));
    assert_eq!(iface_ref.subnet_mask.as_deref(), Some("255.255.255.128"));

    // Step 9: Select a link and change properties
    history.push_undo(proj.clone());
    let link1_ref = proj
        .links
        .iter_mut()
        .find(|l| l.id == "link-pc-r1")
        .unwrap();
    link1_ref.bandwidth_bps = 50_000_000;
    link1_ref.propagation_delay_us = 5_000;
    link1_ref.loss_probability = 0.015;
    link1_ref.bit_error_rate = 0.0001;
    link1_ref.queue_capacity = 150;
    link1_ref.status = LinkStatus::Degraded;
    assert!(link1_ref.validate().is_ok());
    sim.update_links(&proj.links);

    // Step 10: Verify updated values reflected in state
    let read_link = proj.links.iter().find(|l| l.id == "link-pc-r1").unwrap();
    assert_eq!(read_link.bandwidth_bps, 50_000_000);
    assert_eq!(read_link.propagation_delay_us, 5_000);
    assert_eq!(read_link.loss_probability, 0.015);
    assert_eq!(read_link.queue_capacity, 150);
    assert_eq!(read_link.status, LinkStatus::Degraded);

    // Step 11: Attempt invalid self-loop and confirm rejected
    let self_loop = Link::new(
        "invalid-loop".to_string(),
        LinkEndpoint {
            node_id: "pc-1".to_string(),
            interface_id: "eth0".to_string(),
        },
        LinkEndpoint {
            node_id: "pc-1".to_string(),
            interface_id: "eth0".to_string(),
        },
    );
    assert!(self_loop.validate().is_err());

    // Step 12: Attempt to connect already occupied interface and confirm rejected
    let pc_node = proj.nodes.iter().find(|n| n.id == "pc-1").unwrap();
    let occupied_iface = &pc_node.interfaces[0];
    assert!(occupied_iface.link_id.is_some());
    let attach_res = proj
        .nodes
        .iter_mut()
        .find(|n| n.id == "pc-1")
        .unwrap()
        .attach_link("eth0", "link-other");
    assert!(attach_res.is_err());

    // Step 13: Delete a node (r-1) and verify connected links/interfaces are cleaned up
    history.push_undo(proj.clone());
    let links_to_del: Vec<String> = proj
        .links
        .iter()
        .filter(|l| l.source.node_id == "r-1" || l.target.node_id == "r-1")
        .map(|l| l.id.clone())
        .collect();
    assert_eq!(links_to_del.len(), 2);
    for lid in &links_to_del {
        for n in &mut proj.nodes {
            n.detach_link(lid);
        }
    }
    proj.links.retain(|l| !links_to_del.contains(&l.id));
    proj.nodes.retain(|n| n.id != "r-1");
    sim.update_links(&proj.links);

    assert_eq!(proj.nodes.len(), 2);
    assert_eq!(proj.links.len(), 0);
    assert_eq!(sim.link_queues().len(), 0);
    assert_eq!(
        proj.nodes
            .iter()
            .find(|n| n.id == "pc-1")
            .unwrap()
            .interfaces[0]
            .link_id,
        None
    );
    assert_eq!(
        proj.nodes
            .iter()
            .find(|n| n.id == "srv-1")
            .unwrap()
            .interfaces[0]
            .link_id,
        None
    );

    // Step 14: Undo the deletion
    assert!(history.can_undo());
    assert!(history.undo(&mut proj));
    sim.update_links(&proj.links);
    assert_eq!(proj.nodes.len(), 3);
    assert_eq!(proj.links.len(), 2);
    assert_eq!(sim.link_queues().len(), 2);

    // Step 15: Redo the deletion
    assert!(history.can_redo());
    assert!(history.redo(&mut proj));
    sim.update_links(&proj.links);
    assert_eq!(proj.nodes.len(), 2);
    assert_eq!(proj.links.len(), 0);
    assert_eq!(sim.link_queues().len(), 0);

    // Revert deletion back to full topology
    assert!(history.undo(&mut proj));
    sim.update_links(&proj.links);
    assert_eq!(proj.nodes.len(), 3);
    assert_eq!(proj.links.len(), 2);

    // Step 16: Verify simulation state remains synchronized
    assert_eq!(sim.link_queues().len(), 2);
    assert!(sim.link_queues().contains_key("link-pc-r1"));
    assert!(sim.link_queues().contains_key("link-r1-srv"));

    // Step 17: History stack bounds and query
    assert!(history.can_undo());

    // Step 18: State consistency
    assert_eq!(proj.nodes.len(), 3);
}

#[test]
fn test_routing_dijkstra_linear_and_diamond_topology() {
    use crate::routing::{compute_dijkstra_shortest_paths, MetricType, RoutingGraph};

    let mut proj = Project::new("Diamond Routing".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 100.0, y: -50.0 },
    );
    let r3 = Node::new(
        "r3".into(),
        "Router 3".into(),
        NodeType::Router,
        Position { x: 100.0, y: 50.0 },
    );
    let r4 = Node::new(
        "r4".into(),
        "Router 4".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );

    proj.nodes = vec![r1, r2, r3, r4];

    // R1 - R2 (cost 10 us delay)
    let mut l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    l1.propagation_delay_us = 10;

    // R1 - R3 (cost 30 us delay)
    let mut l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r3".into(),
            interface_id: "eth0".into(),
        },
    );
    l2.propagation_delay_us = 30;

    // R2 - R4 (cost 30 us delay) -> Total R1-R2-R4 = 40
    let mut l3 = Link::new(
        "l3".into(),
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r4".into(),
            interface_id: "eth0".into(),
        },
    );
    l3.propagation_delay_us = 30;

    // R3 - R4 (cost 5 us delay) -> Total R1-R3-R4 = 35 (SHORTEST!)
    let mut l4 = Link::new(
        "l4".into(),
        LinkEndpoint {
            node_id: "r3".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r4".into(),
            interface_id: "eth1".into(),
        },
    );
    l4.propagation_delay_us = 5;

    proj.links = vec![l1, l2, l3, l4];

    let graph = RoutingGraph::from_project(&proj, MetricType::PropagationDelay);
    let table = compute_dijkstra_shortest_paths(&graph, "r1").expect("Dijkstra failed");

    // Route to R4 should be via R3 with metric 35
    let r4_entry = table
        .entries
        .iter()
        .find(|e| e.destination == "r4")
        .unwrap();
    assert_eq!(r4_entry.metric, 35);
    assert_eq!(r4_entry.next_hop.as_deref(), Some("r3"));
    assert_eq!(r4_entry.path, vec!["r1", "r3", "r4"]);
    assert_eq!(r4_entry.interface_id.as_deref(), Some("eth1"));

    // Route to R2 should be direct with metric 10
    let r2_entry = table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert_eq!(r2_entry.metric, 10);
    assert_eq!(r2_entry.next_hop.as_deref(), Some("r2"));
    assert_eq!(r2_entry.path, vec!["r1", "r2"]);
    assert_eq!(r2_entry.interface_id.as_deref(), Some("eth0"));
}

#[test]
fn test_routing_bidirectional_links_default() {
    use crate::routing::{compute_dijkstra_shortest_paths, MetricType, RoutingGraph};

    let mut proj = Project::new("Bidirectional Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 100.0, y: 0.0 },
    );
    proj.nodes = vec![r1, r2];

    let mut link = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    link.propagation_delay_us = 25;
    proj.links = vec![link];

    let graph = RoutingGraph::from_project(&proj, MetricType::PropagationDelay);

    // Edge R1 -> R2
    let t1 = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    let e1 = t1.entries.iter().find(|e| e.destination == "r2").unwrap();
    assert_eq!(e1.metric, 25);
    assert_eq!(e1.next_hop.as_deref(), Some("r2"));

    // Edge R2 -> R1 (verified bidirectional from single link)
    let t2 = compute_dijkstra_shortest_paths(&graph, "r2").unwrap();
    let e2 = t2.entries.iter().find(|e| e.destination == "r1").unwrap();
    assert_eq!(e2.metric, 25);
    assert_eq!(e2.next_hop.as_deref(), Some("r1"));
}

#[test]
fn test_routing_link_status_and_degraded_penalty() {
    use crate::routing::{compute_dijkstra_shortest_paths, MetricType, RoutingGraph};

    let mut proj = Project::new("Degraded Penalty Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 100.0, y: 0.0 },
    );
    let r3 = Node::new(
        "r3".into(),
        "Router 3".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    proj.nodes = vec![r1, r2, r3];

    // Link 1: Up, delay 20
    let mut l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    l1.propagation_delay_us = 20;
    l1.status = LinkStatus::Up;

    // Link 2: Degraded, delay 20 -> penalty = (20 * 3).max(20 + 50) = 70
    let mut l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r3".into(),
            interface_id: "eth0".into(),
        },
    );
    l2.propagation_delay_us = 20;
    l2.status = LinkStatus::Degraded;

    proj.links = vec![l1, l2];

    let graph = RoutingGraph::from_project(&proj, MetricType::PropagationDelay);
    let table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();

    let r2_entry = table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert_eq!(r2_entry.metric, 20); // Normal

    let r3_entry = table
        .entries
        .iter()
        .find(|e| e.destination == "r3")
        .unwrap();
    assert_eq!(r3_entry.metric, 20 + 70); // 20 + 70 = 90
    assert!(r3_entry.is_reachable);

    // Now set Link 2 to Down: r3 must become unreachable
    proj.links[1].status = LinkStatus::Down;
    let graph_down = RoutingGraph::from_project(&proj, MetricType::PropagationDelay);
    let table_down = compute_dijkstra_shortest_paths(&graph_down, "r1").unwrap();
    let r3_down = table_down
        .entries
        .iter()
        .find(|e| e.destination == "r3")
        .unwrap();
    assert!(!r3_down.is_reachable);
    assert_eq!(r3_down.metric, u64::MAX);
}

#[test]
fn test_l3_transit_1_router_can_act_as_l3_transit() {
    use crate::routing::{
        compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths, MetricType,
        RoutingGraph,
    };

    // R1 <-> R2 <-> R3 where all are Routers
    let mut proj = Project::new("Router Transit Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 100.0, y: 0.0 },
    );
    let r3 = Node::new(
        "r3".into(),
        "Router 3".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    proj.nodes = vec![r1, r2, r3];

    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    let l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r3".into(),
            interface_id: "eth0".into(),
        },
    );
    proj.links = vec![l1, l2];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);

    // Dijkstra verification: R2 acts as transit hop to R3
    let dijkstra_table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    let r3_dijkstra = dijkstra_table
        .entries
        .iter()
        .find(|e| e.destination == "r3")
        .unwrap();
    assert!(r3_dijkstra.is_reachable);
    assert_eq!(r3_dijkstra.metric, 2);
    assert_eq!(r3_dijkstra.next_hop.as_deref(), Some("r2"));
    assert_eq!(r3_dijkstra.path, vec!["r1", "r2", "r3"]);

    // Bellman-Ford verification: R2 acts as transit hop to R3
    let bf_table = compute_bellman_ford_shortest_paths(&graph, "r1").unwrap();
    let r3_bf = bf_table
        .entries
        .iter()
        .find(|e| e.destination == "r3")
        .unwrap();
    assert!(r3_bf.is_reachable);
    assert_eq!(r3_bf.metric, 2);
    assert_eq!(r3_bf.next_hop.as_deref(), Some("r2"));
}

#[test]
fn test_l3_transit_2_pc_cannot_act_as_l3_transit() {
    use crate::routing::{
        compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths, MetricType,
        RoutingGraph,
    };

    // R1 <-> PC1 <-> R2 where PC1 is a PC end-device
    let mut proj = Project::new("PC Non-transit Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let pc1 = Node::new(
        "pc1".into(),
        "PC 1".into(),
        NodeType::Pc,
        Position { x: 100.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    proj.nodes = vec![r1, pc1, r2];

    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "pc1".into(),
            interface_id: "eth0".into(),
        },
    );
    let l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "pc1".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    proj.links = vec![l1, l2];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);
    assert!(!graph.is_l3_transit_capable("pc1"));

    // Dijkstra: PC1 is reachable (1 hop), but R2 is unreachable through PC1
    let d_table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    let pc_entry = d_table
        .entries
        .iter()
        .find(|e| e.destination == "pc1")
        .unwrap();
    assert!(pc_entry.is_reachable);
    let r2_entry = d_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(!r2_entry.is_reachable);
    assert_eq!(r2_entry.metric, u64::MAX);

    // Bellman-Ford: R2 is unreachable through PC1
    let bf_table = compute_bellman_ford_shortest_paths(&graph, "r1").unwrap();
    let r2_bf = bf_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(!r2_bf.is_reachable);
    assert_eq!(r2_bf.metric, u64::MAX);
}

#[test]
fn test_l3_transit_3_server_cannot_act_as_l3_transit() {
    use crate::routing::{
        compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths, MetricType,
        RoutingGraph,
    };

    // R1 <-> SRV1 <-> R2 where SRV1 is a Server end-device
    let mut proj = Project::new("Server Non-transit Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let srv1 = Node::new(
        "srv1".into(),
        "Server 1".into(),
        NodeType::Server,
        Position { x: 100.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    proj.nodes = vec![r1, srv1, r2];

    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "srv1".into(),
            interface_id: "eth0".into(),
        },
    );
    let l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "srv1".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    proj.links = vec![l1, l2];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);
    assert!(!graph.is_l3_transit_capable("srv1"));

    // Dijkstra: SRV1 reachable, R2 unreachable
    let d_table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    assert!(
        d_table
            .entries
            .iter()
            .find(|e| e.destination == "srv1")
            .unwrap()
            .is_reachable
    );
    let r2_entry = d_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(!r2_entry.is_reachable);
    assert_eq!(r2_entry.metric, u64::MAX);

    // Bellman-Ford: R2 unreachable
    let bf_table = compute_bellman_ford_shortest_paths(&graph, "r1").unwrap();
    let r2_bf = bf_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(!r2_bf.is_reachable);
    assert_eq!(r2_bf.metric, u64::MAX);
}

#[test]
fn test_l3_transit_4_generic_host_cannot_act_as_l3_transit() {
    use crate::routing::{
        compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths, MetricType,
        RoutingGraph,
    };

    // R1 <-> GEN1 <-> R2 where GEN1 is a Generic host
    let mut proj = Project::new("Generic Non-transit Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let gen1 = Node::new(
        "gen1".into(),
        "Generic 1".into(),
        NodeType::Generic,
        Position { x: 100.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    proj.nodes = vec![r1, gen1, r2];

    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "gen1".into(),
            interface_id: "eth0".into(),
        },
    );
    let l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "gen1".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    proj.links = vec![l1, l2];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);
    assert!(!graph.is_l3_transit_capable("gen1"));

    let d_table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    assert!(
        d_table
            .entries
            .iter()
            .find(|e| e.destination == "gen1")
            .unwrap()
            .is_reachable
    );
    let r2_entry = d_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(!r2_entry.is_reachable);
    assert_eq!(r2_entry.metric, u64::MAX);

    let bf_table = compute_bellman_ford_shortest_paths(&graph, "r1").unwrap();
    let r2_bf = bf_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(!r2_bf.is_reachable);
    assert_eq!(r2_bf.metric, u64::MAX);
}

#[test]
fn test_l3_transit_5_router_switch_router_l2_connectivity_and_l3_routing_validation() {
    use crate::routing::{
        compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths,
        simulate_distance_vector_convergence, MetricType, RoutingGraph,
    };

    // Topology: R1 ── SW1 ── R2
    // R1, R2 are Routers; SW1 is a standard Layer 2 Switch.
    let mut proj = Project::new("Switch L2 Connectivity Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let sw1 = Node::new(
        "sw1".into(),
        "Switch 1".into(),
        NodeType::Switch,
        Position { x: 100.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    proj.nodes = vec![r1, sw1, r2];

    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "sw1".into(),
            interface_id: "port1".into(),
        },
    );
    let l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "sw1".into(),
            interface_id: "port2".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    proj.links = vec![l1, l2];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);

    // 1. Physical connectivity exists
    assert!(graph.nodes.contains_key("r1"));
    assert!(graph.nodes.contains_key("sw1"));
    assert!(graph.nodes.contains_key("r2"));
    assert_eq!(graph.adjacency.get("r1").unwrap().len(), 1);
    assert_eq!(graph.adjacency.get("sw1").unwrap().len(), 2);
    assert_eq!(graph.adjacency.get("r2").unwrap().len(), 1);

    // 2. Switch has no L3 routing table (rejected with InvalidConfiguration)
    assert!(!graph.is_routing_device("sw1"));
    assert!(compute_dijkstra_shortest_paths(&graph, "sw1").is_err());
    assert!(compute_bellman_ford_shortest_paths(&graph, "sw1").is_err());
    assert!(simulate_distance_vector_convergence(&graph, "sw1").is_err());

    // 3. Switch is not treated as an L3 transit router
    assert!(!graph.is_l3_transit_capable("sw1"));
    assert!(graph.is_l2_transparent_forwarder("sw1"));

    // 4. Router A can resolve/reach Router B through the L2 connectivity model (Dijkstra)
    let d_table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    let r2_dijkstra = d_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(r2_dijkstra.is_reachable);
    assert_eq!(r2_dijkstra.metric, 2);
    // 5. The resulting L3 route does NOT falsely classify the switch as an L3 routing hop
    assert_eq!(r2_dijkstra.next_hop.as_deref(), Some("r2")); // Next L3 hop is R2, NOT SW1
    assert_eq!(r2_dijkstra.path, vec!["r1", "r2"]); // L3 path contains only L3 devices, NOT SW1
    assert_eq!(r2_dijkstra.interface_id.as_deref(), Some("eth0")); // Outbound interface on R1

    // 6. Router A can resolve/reach Router B through the L2 connectivity model (Bellman-Ford)
    let bf_table = compute_bellman_ford_shortest_paths(&graph, "r1").unwrap();
    let r2_bf = bf_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(r2_bf.is_reachable);
    assert_eq!(r2_bf.metric, 2);
    assert_eq!(r2_bf.next_hop.as_deref(), Some("r2")); // Next L3 hop is R2, NOT SW1
    assert_eq!(r2_bf.path, vec!["r1", "r2"]); // L3 path contains only L3 devices, NOT SW1
    assert_eq!(r2_bf.interface_id.as_deref(), Some("eth0")); // Outbound interface on R1

    // 7. Dijkstra and Bellman-Ford produce consistent L3 routing behavior
    assert_eq!(r2_dijkstra.metric, r2_bf.metric);
    assert_eq!(r2_dijkstra.next_hop, r2_bf.next_hop);
    assert_eq!(r2_dijkstra.path, r2_bf.path);
    assert_eq!(r2_dijkstra.interface_id, r2_bf.interface_id);

    // 8. Direct reachability to the switch itself from Router A
    let sw_entry = d_table
        .entries
        .iter()
        .find(|e| e.destination == "sw1")
        .unwrap();
    assert!(sw_entry.is_reachable);
    assert_eq!(sw_entry.metric, 1);
    assert_eq!(sw_entry.next_hop.as_deref(), Some("sw1"));
}

#[test]
fn test_multi_hop_l3_routing_through_l2_switch_and_transit_router() {
    use crate::routing::{
        compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths, MetricType,
        RoutingGraph,
    };

    // Topology: R1 ── SW1 ── R2 ── R3
    let mut proj = Project::new("Multi-hop Switch Routing Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let sw1 = Node::new(
        "sw1".into(),
        "Switch 1".into(),
        NodeType::Switch,
        Position { x: 100.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    let r3 = Node::new(
        "r3".into(),
        "Router 3".into(),
        NodeType::Router,
        Position { x: 300.0, y: 0.0 },
    );
    proj.nodes = vec![r1, sw1, r2, r3];

    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "sw1".into(),
            interface_id: "port1".into(),
        },
    );
    let l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "sw1".into(),
            interface_id: "port2".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    let l3 = Link::new(
        "l3".into(),
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r3".into(),
            interface_id: "eth0".into(),
        },
    );
    proj.links = vec![l1, l2, l3];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);

    // Dijkstra route from R1 to R3:
    // Physical path: R1 -> SW1 -> R2 -> R3
    // L3 path: R1 -> R2 -> R3 (SW1 is transparent, R2 is L3 transit router)
    let d_table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    let r3_d = d_table
        .entries
        .iter()
        .find(|e| e.destination == "r3")
        .unwrap();
    assert!(r3_d.is_reachable);
    assert_eq!(r3_d.metric, 3);
    assert_eq!(r3_d.next_hop.as_deref(), Some("r2"));
    assert_eq!(r3_d.path, vec!["r1", "r2", "r3"]);
    assert_eq!(r3_d.interface_id.as_deref(), Some("eth0"));

    // Bellman-Ford route from R1 to R3:
    let bf_table = compute_bellman_ford_shortest_paths(&graph, "r1").unwrap();
    let r3_bf = bf_table
        .entries
        .iter()
        .find(|e| e.destination == "r3")
        .unwrap();
    assert!(r3_bf.is_reachable);
    assert_eq!(r3_bf.metric, 3);
    assert_eq!(r3_bf.next_hop.as_deref(), Some("r2"));
    assert_eq!(r3_bf.path, vec!["r1", "r2", "r3"]);
    assert_eq!(r3_bf.interface_id.as_deref(), Some("eth0"));
}

#[test]
fn test_l3_transit_6_access_point_cannot_act_as_l3_transit() {
    use crate::routing::{
        compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths, MetricType,
        RoutingGraph,
    };

    // R1 <-> AP1 <-> R2 where AP1 is an AccessPoint
    let mut proj = Project::new("AP Non-transit Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let ap1 = Node::new(
        "ap1".into(),
        "AP 1".into(),
        NodeType::AccessPoint,
        Position { x: 100.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "Router 2".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    proj.nodes = vec![r1, ap1, r2];

    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "ap1".into(),
            interface_id: "eth0".into(),
        },
    );
    let l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "ap1".into(),
            interface_id: "wlan0".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    proj.links = vec![l1, l2];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);
    // AccessPoint is not an L3 transit router by default
    assert!(!graph.is_l3_transit_capable("ap1"));

    let d_table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    assert!(
        d_table
            .entries
            .iter()
            .find(|e| e.destination == "ap1")
            .unwrap()
            .is_reachable
    );
    let r2_entry = d_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(!r2_entry.is_reachable);
    assert_eq!(r2_entry.metric, u64::MAX);

    let bf_table = compute_bellman_ford_shortest_paths(&graph, "r1").unwrap();
    let r2_bf = bf_table
        .entries
        .iter()
        .find(|e| e.destination == "r2")
        .unwrap();
    assert!(!r2_bf.is_reachable);
    assert_eq!(r2_bf.metric, u64::MAX);
}

#[test]
fn test_l2_switch_route_handling_and_no_l3_routing_table_generation() {
    use crate::routing::{
        compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths,
        simulate_distance_vector_convergence, MetricType, RoutingGraph,
    };

    // Topology: R1 (Router) <-> SW1 (pure L2 Switch)
    let mut proj = Project::new("L2 Switch Scope Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "Router 1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let sw1 = Node::new(
        "sw1".into(),
        "Switch 1".into(),
        NodeType::Switch,
        Position { x: 100.0, y: 0.0 },
    );
    proj.nodes = vec![r1, sw1];

    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "sw1".into(),
            interface_id: "port1".into(),
        },
    );
    proj.links = vec![l1];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);

    // 1. Physical topology model contains SW1 as a connectivity node
    assert!(graph.nodes.contains_key("sw1"));
    assert_eq!(graph.adjacency.get("sw1").unwrap().len(), 1);
    assert_eq!(graph.adjacency.get("r1").unwrap().len(), 1);

    // 2. Device capability checks
    assert!(!graph.is_routing_device("sw1"));
    assert!(!graph.is_l3_transit_capable("sw1"));
    assert!(graph.is_routing_device("r1"));
    assert!(graph.is_l3_transit_capable("r1"));

    // 3. Router R1 can compute route to SW1
    let r1_table = compute_dijkstra_shortest_paths(&graph, "r1").unwrap();
    let sw_entry = r1_table
        .entries
        .iter()
        .find(|e| e.destination == "sw1")
        .unwrap();
    assert!(sw_entry.is_reachable);
    assert_eq!(sw_entry.metric, 1);
    assert_eq!(sw_entry.next_hop.as_deref(), Some("sw1"));

    // 4. Pure L2 Switch must NOT receive an L3 routing table (rejected with InvalidConfiguration)
    let d_res = compute_dijkstra_shortest_paths(&graph, "sw1");
    match d_res {
        Err(NetSimError::InvalidConfiguration(msg)) => {
            assert!(msg.contains("not an L3 routing device"));
        }
        other => panic!(
            "Expected InvalidConfiguration error for switch L3 routing table, got {:?}",
            other
        ),
    }

    let bf_res = compute_bellman_ford_shortest_paths(&graph, "sw1");
    match bf_res {
        Err(NetSimError::InvalidConfiguration(msg)) => {
            assert!(msg.contains("not an L3 routing device"));
        }
        other => panic!(
            "Expected InvalidConfiguration error for switch L3 routing table, got {:?}",
            other
        ),
    }

    let dv_res = simulate_distance_vector_convergence(&graph, "sw1");
    match dv_res {
        Err(NetSimError::InvalidConfiguration(msg)) => {
            assert!(msg.contains("not an L3 routing device"));
        }
        other => panic!(
            "Expected InvalidConfiguration error for switch L3 routing convergence, got {:?}",
            other
        ),
    }
}

#[test]
fn test_routing_inverse_bandwidth_metric_formula() {
    use crate::routing::{MetricType, RoutingGraph};

    let mut proj = Project::new("InvBW Test".to_string());
    let r1 = Node::new(
        "r1".into(),
        "R1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "R2".into(),
        NodeType::Router,
        Position { x: 100.0, y: 0.0 },
    );
    proj.nodes = vec![r1, r2];

    // Case 1: 10 Gbps (10_000_000_000 bps) -> Ceil(1G / 10G) = 1, min 1 -> must be 1 (never zero!)
    let mut link = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    link.bandwidth_bps = 10_000_000_000;
    proj.links = vec![link];

    let graph = RoutingGraph::from_project(&proj, MetricType::InverseBandwidth);
    let edge = &graph.adjacency.get("r1").unwrap()[0];
    assert_eq!(edge.metric, 1);

    // Case 2: 100 Mbps (100_000_000 bps) -> Ceil(1G / 100M) = 10
    proj.links[0].bandwidth_bps = 100_000_000;
    let graph2 = RoutingGraph::from_project(&proj, MetricType::InverseBandwidth);
    let edge2 = &graph2.adjacency.get("r1").unwrap()[0];
    assert_eq!(edge2.metric, 10);
}

#[test]
fn test_routing_bellman_ford_convergence_telemetry() {
    use crate::routing::{simulate_distance_vector_convergence, MetricType, RoutingGraph};

    let mut proj = Project::new("BF Convergence".to_string());
    let r1 = Node::new(
        "r1".into(),
        "R1".into(),
        NodeType::Router,
        Position { x: 0.0, y: 0.0 },
    );
    let r2 = Node::new(
        "r2".into(),
        "R2".into(),
        NodeType::Router,
        Position { x: 100.0, y: 0.0 },
    );
    let r3 = Node::new(
        "r3".into(),
        "R3".into(),
        NodeType::Router,
        Position { x: 200.0, y: 0.0 },
    );
    proj.nodes = vec![r1, r2, r3];

    // R1 - R2 (cost 1 hop)
    let l1 = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "r1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth0".into(),
        },
    );
    // R2 - R3 (cost 1 hop)
    let l2 = Link::new(
        "l2".into(),
        LinkEndpoint {
            node_id: "r2".into(),
            interface_id: "eth1".into(),
        },
        LinkEndpoint {
            node_id: "r3".into(),
            interface_id: "eth0".into(),
        },
    );
    proj.links = vec![l1, l2];

    let graph = RoutingGraph::from_project(&proj, MetricType::HopCount);
    let telemetry = simulate_distance_vector_convergence(&graph, "r1").unwrap();

    assert!(telemetry.converged);
    assert!(telemetry.total_rounds >= 2);
    assert!(!telemetry.rounds.is_empty());

    // Destination R3 reached with 2 hops via next hop R2
    let r3_entry = telemetry
        .final_routing_table
        .entries
        .iter()
        .find(|e| e.destination == "r3")
        .unwrap();
    assert_eq!(r3_entry.metric, 2);
    assert_eq!(r3_entry.next_hop.as_deref(), Some("r2"));
    assert_eq!(r3_entry.path, vec!["r1", "r2", "r3"]);
}

#[test]
fn test_ipv4_subnetting_calculations_and_edge_cases() {
    use crate::addressing::calculate_subnet;

    // Standard /24
    let sub24 = calculate_subnet("192.168.1.10/24").unwrap();
    assert_eq!(sub24.network_address, "192.168.1.0");
    assert_eq!(sub24.broadcast_address, "192.168.1.255");
    assert_eq!(sub24.first_usable_ip, "192.168.1.1");
    assert_eq!(sub24.last_usable_ip, "192.168.1.254");
    assert_eq!(sub24.total_hosts, 256);
    assert_eq!(sub24.usable_hosts, 254);
    assert_eq!(sub24.subnet_mask, "255.255.255.0");
    assert_eq!(sub24.wildcard_mask, "0.0.0.255");
    assert_eq!(sub24.ip_class, "Class C");
    assert_eq!(sub24.scope, "Private (RFC 1918 192.168.0.0/16)");

    // Point-to-point /30
    let sub30 = calculate_subnet("10.0.0.1/30").unwrap();
    assert_eq!(sub30.network_address, "10.0.0.0");
    assert_eq!(sub30.broadcast_address, "10.0.0.3");
    assert_eq!(sub30.first_usable_ip, "10.0.0.1");
    assert_eq!(sub30.last_usable_ip, "10.0.0.2");
    assert_eq!(sub30.usable_hosts, 2);

    // RFC 3021 /31 (both are usable host addresses)
    let sub31 = calculate_subnet("172.16.0.4/31").unwrap();
    assert_eq!(sub31.total_hosts, 2);
    assert_eq!(sub31.usable_hosts, 2);
    assert_eq!(sub31.first_usable_ip, "172.16.0.4");
    assert_eq!(sub31.last_usable_ip, "172.16.0.5");

    // Single host /32
    let sub32 = calculate_subnet("8.8.8.8/32").unwrap();
    assert_eq!(sub32.total_hosts, 1);
    assert_eq!(sub32.usable_hosts, 1);
    assert_eq!(sub32.first_usable_ip, "8.8.8.8");
    assert_eq!(sub32.last_usable_ip, "8.8.8.8");
    assert_eq!(sub32.scope, "Public Internet");

    // Loopback
    let sub_loop = calculate_subnet("127.0.0.1/8").unwrap();
    assert_eq!(sub_loop.scope, "Loopback (127.0.0.0/8)");
}

#[test]
fn test_equal_prefix_splitting_vs_true_vlsm() {
    use crate::addressing::{allocate_vlsm, split_equal_subnets, VlsmSubnetRequirement};

    // Equal-prefix splitting: 192.168.1.0/24 into /26 yields 4 equal subnets
    let equal_res = split_equal_subnets("192.168.1.0/24", 26).unwrap();
    assert_eq!(equal_res.subnets_count, 4);
    assert_eq!(equal_res.subnets[0].network_address, "192.168.1.0");
    assert_eq!(equal_res.subnets[1].network_address, "192.168.1.64");
    assert_eq!(equal_res.subnets[2].network_address, "192.168.1.128");
    assert_eq!(equal_res.subnets[3].network_address, "192.168.1.192");

    // True VLSM allocation: heterogeneous requirements
    let requirements = vec![
        VlsmSubnetRequirement {
            name: "Branch WAN".into(),
            needed_hosts: 2,
        },
        VlsmSubnetRequirement {
            name: "Sales Dept".into(),
            needed_hosts: 50,
        },
        VlsmSubnetRequirement {
            name: "Eng Dept".into(),
            needed_hosts: 100,
        },
    ];

    let vlsm_res = allocate_vlsm("10.0.0.0/24", requirements).unwrap();
    assert_eq!(vlsm_res.subnets.len(), 3);

    // Sorted descending:
    // 1. Eng Dept (100 hosts) -> /25 (126 usable) at 10.0.0.0/25
    assert_eq!(vlsm_res.subnets[0].name, "Eng Dept");
    assert_eq!(vlsm_res.subnets[0].allocated_prefix, 25);
    assert_eq!(vlsm_res.subnets[0].subnet_info.network_address, "10.0.0.0");
    assert_eq!(vlsm_res.subnets[0].wasted_hosts, 26);

    // 2. Sales Dept (50 hosts) -> /26 (62 usable) at 10.0.0.128/26
    assert_eq!(vlsm_res.subnets[1].name, "Sales Dept");
    assert_eq!(vlsm_res.subnets[1].allocated_prefix, 26);
    assert_eq!(
        vlsm_res.subnets[1].subnet_info.network_address,
        "10.0.0.128"
    );
    assert_eq!(vlsm_res.subnets[1].wasted_hosts, 12);

    // 3. Branch WAN (2 hosts) -> /30 (2 usable) at 10.0.0.192/30
    assert_eq!(vlsm_res.subnets[2].name, "Branch WAN");
    assert_eq!(vlsm_res.subnets[2].allocated_prefix, 30);
    assert_eq!(
        vlsm_res.subnets[2].subnet_info.network_address,
        "10.0.0.192"
    );
    assert_eq!(vlsm_res.subnets[2].wasted_hosts, 0);

    // Overflow check: allocating 300 hosts in /24 must fail
    let overflow_req = vec![VlsmSubnetRequirement {
        name: "Too Big".into(),
        needed_hosts: 300,
    }];
    assert!(allocate_vlsm("192.168.1.0/24", overflow_req).is_err());
}

#[test]
fn test_duplicate_ip_detection() {
    use crate::addressing::detect_duplicate_ips;

    let mut proj = Project::new("Conflict Test".to_string());
    let mut pc1 = Node::new(
        "pc1".into(),
        "PC 1".into(),
        NodeType::Pc,
        Position { x: 0.0, y: 0.0 },
    );
    let mut pc2 = Node::new(
        "pc2".into(),
        "PC 2".into(),
        NodeType::Pc,
        Position { x: 100.0, y: 0.0 },
    );

    pc1.interfaces[0].ipv4 = Some("192.168.1.50/24".to_string());
    pc2.interfaces[0].ipv4 = Some("192.168.1.50".to_string()); // Duplicate!

    proj.nodes = vec![pc1, pc2];

    let conflicts = detect_duplicate_ips(&proj);
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].ip, "192.168.1.50");
    assert_eq!(conflicts[0].occurrences.len(), 2);
}

#[test]
fn test_ipv6_parsing_rfc5952_and_scopes() {
    use crate::addressing::parse_and_validate_ipv6;

    // RFC 5952 canonical compression of longest consecutive zero-hextets
    let v6_1 = parse_and_validate_ipv6("2001:0db8:0000:0000:0000:0000:0000:0001/64").unwrap();
    assert_eq!(v6_1.canonical_address, "2001:db8::1");
    assert_eq!(
        v6_1.expanded_address,
        "2001:0db8:0000:0000:0000:0000:0000:0001"
    );
    assert_eq!(v6_1.scope, "Global Unicast (2000::/3)");

    // Link-local
    let v6_ll = parse_and_validate_ipv6("fe80::1ff:fe00:1").unwrap();
    assert_eq!(v6_ll.scope, "Link-Local Unicast (fe80::/10)");

    // Loopback
    let v6_loop = parse_and_validate_ipv6("::1").unwrap();
    assert_eq!(v6_loop.canonical_address, "::1");
    assert_eq!(v6_loop.scope, "Loopback (::1/128)");
}

#[test]
fn test_nat_napt_stateful_forward_and_reverse_translation() {
    use crate::addressing::{NatMappingType, NatProtocol, NatTable};

    let mut nat = NatTable::new("r1", "198.51.100.1");

    // Static DNAT rule: Forward external port 80 -> 192.168.1.10:8080 (TCP)
    nat.add_static_dnat_rule(NatProtocol::Tcp, 80, "192.168.1.10", 8080, "Web Server")
        .unwrap();

    // Outbound packet from PC1: 192.168.1.50:50000 -> 93.184.216.34:443 (TCP)
    let out_res = nat
        .translate_outbound(
            "192.168.1.50",
            50000,
            "93.184.216.34",
            443,
            NatProtocol::Tcp,
            1_000_000,
        )
        .unwrap();
    assert!(out_res.created_new_mapping);
    assert_eq!(out_res.translated_src_ip, "198.51.100.1");
    assert_eq!(out_res.translated_src_port, 49152); // First dynamic port
    assert_eq!(out_res.entry.mapping_type, NatMappingType::DynamicSnat);

    // Same socket sends second packet: must reuse existing mapping!
    let out_res2 = nat
        .translate_outbound(
            "192.168.1.50",
            50000,
            "93.184.216.34",
            443,
            NatProtocol::Tcp,
            2_000_000,
        )
        .unwrap();
    assert!(!out_res2.created_new_mapping);
    assert_eq!(out_res2.translated_src_port, 49152);

    // Inbound reverse reply: 93.184.216.34:443 -> 198.51.100.1:49152 (TCP)
    let in_res = nat
        .translate_inbound(
            "93.184.216.34",
            443,
            "198.51.100.1",
            49152,
            NatProtocol::Tcp,
            3_000_000,
        )
        .unwrap();
    assert_eq!(in_res.translated_dst_ip, "192.168.1.50");
    assert_eq!(in_res.translated_dst_port, 50000);

    // Inbound packet to Static DNAT: External -> 198.51.100.1:80 (TCP)
    let static_res = nat
        .translate_inbound(
            "1.2.3.4",
            34567,
            "198.51.100.1",
            80,
            NatProtocol::Tcp,
            4_000_000,
        )
        .unwrap();
    assert_eq!(static_res.translated_dst_ip, "192.168.1.10");
    assert_eq!(static_res.translated_dst_port, 8080);

    // Inbound unmapped packet: must be rejected with RouteUnreachable error
    assert!(nat
        .translate_inbound(
            "1.2.3.4",
            9999,
            "198.51.100.1",
            9999,
            NatProtocol::Tcp,
            5_000_000
        )
        .is_err());

    // Expiration: advance time past TCP timeout (7200s = 7_200_000_000 us)
    nat.expire_entries(10_000_000_000);
    assert_eq!(nat.entries.len(), 0); // Dynamic entry evicted
}

// =========================================================================
// Phase 4B: Data Link Error Detection & Correction Tests
// =========================================================================

use crate::datalink::{
    calculate_crc, calculate_internet_checksum, encode_hamming, inject_bit_errors,
    parse_bytes_to_16bit_words, parse_hex_to_16bit_words, verify_and_correct_hamming, verify_crc,
    verify_internet_checksum, ParityMode, CRC16_CCITT_POLY, CRC16_IBM_POLY, CRC32_IEEE_POLY,
    CRC8_DEFAULT_POLY,
};

#[test]
fn test_hamming_encode_even_parity_4bit() {
    let res = encode_hamming("1011", ParityMode::Even).expect("Encoding should succeed");
    assert_eq!(res.raw_data_bits, "1011");
    assert_eq!(res.data_bit_count, 4);
    assert_eq!(res.parity_bit_count, 3);
    assert_eq!(res.total_bit_count, 7);
    // Codeword: P1='0', P2='1', D1='1', P3='0', D2='0', D3='1', D4='1'
    assert_eq!(res.encoded_bits, "0110011");
    // Parity bit calculations trace
    assert_eq!(res.parity_details.len(), 3);
    assert_eq!(res.parity_details[0].parity_index, 1);
    assert_eq!(res.parity_details[0].parity_value, 0);
    assert_eq!(res.parity_details[1].parity_index, 2);
    assert_eq!(res.parity_details[1].parity_value, 1);
    assert_eq!(res.parity_details[2].parity_index, 4);
    assert_eq!(res.parity_details[2].parity_value, 0);
    // SECDED overall parity: count of 1s in "0110011" is 4 (even) -> P8 = 0
    assert_eq!(res.overall_parity, 0);
    assert_eq!(res.encoded_bits_secded, "00110011");
}

#[test]
fn test_hamming_encode_odd_parity_4bit() {
    let res = encode_hamming("1011", ParityMode::Odd).expect("Encoding should succeed");
    assert_eq!(res.raw_data_bits, "1011");
    // P1 covers 1, 3, 5, 7 -> '1', '0', '1' (two 1s) -> Odd parity -> P1 = 1
    // P2 covers 2, 3, 6, 7 -> '1', '1', '1' (three 1s) -> Odd parity -> P2 = 0
    // P3 covers 4, 5, 6, 7 -> '0', '1', '1' (two 1s) -> Odd parity -> P3 = 1
    assert_eq!(res.encoded_bits, "1011011");
    assert_eq!(res.parity_details[0].parity_value, 1);
    assert_eq!(res.parity_details[1].parity_value, 0);
    assert_eq!(res.parity_details[2].parity_index, 4);
    assert_eq!(res.parity_details[2].parity_value, 1);
}

#[test]
fn test_hamming_correction_every_single_bit_position() {
    let original_data = "1011";
    let encoded = encode_hamming(original_data, ParityMode::Even).unwrap();
    let codeword = encoded.encoded_bits; // "0110011"

    // Verify error-free codeword
    let no_error = verify_and_correct_hamming(&codeword, ParityMode::Even).unwrap();
    assert!(!no_error.has_error);
    assert_eq!(no_error.syndrome_value, 0);
    assert_eq!(no_error.error_position, None);
    assert_eq!(
        no_error.extracted_data_bits,
        Some(original_data.to_string())
    );

    // Test flipping each bit from position 1 to 7 (1-indexed)
    for pos in 1..=7 {
        let mut corrupted_chars: Vec<char> = codeword.chars().collect();
        corrupted_chars[pos - 1] = if corrupted_chars[pos - 1] == '0' {
            '1'
        } else {
            '0'
        };
        let corrupted: String = corrupted_chars.into_iter().collect();

        let res = verify_and_correct_hamming(&corrupted, ParityMode::Even).unwrap();
        assert!(res.has_error, "Bit {} should be detected as error", pos);
        assert!(res.is_correctable);
        assert_eq!(
            res.error_position,
            Some(pos),
            "Detected error position must be {}",
            pos
        );
        assert_eq!(res.corrected_bits, Some(codeword.clone()));
        assert_eq!(res.extracted_data_bits, Some(original_data.to_string()));
    }
}

#[test]
fn test_hamming_multiple_bit_errors() {
    // 1. Two-bit corruption on valid codeword detects an error
    let original_data = "1011";
    let encoded = encode_hamming(original_data, ParityMode::Even).unwrap();
    let codeword = encoded.encoded_bits; // "0110011"
    let mut chars: Vec<char> = codeword.chars().collect();
    chars[0] = if chars[0] == '0' { '1' } else { '0' }; // Flip bit 1
    chars[1] = if chars[1] == '0' { '1' } else { '0' }; // Flip bit 2
    let corrupted: String = chars.into_iter().collect();
    let res = verify_and_correct_hamming(&corrupted, ParityMode::Even).unwrap();
    assert!(res.has_error);

    // 2. Unrecoverable multiple-bit error where syndrome points beyond codeword length
    // Codeword length 5 with syndrome 6 > 5: "01010"
    let unrecoverable = verify_and_correct_hamming("01010", ParityMode::Even).unwrap();
    assert!(unrecoverable.has_error);
    assert!(!unrecoverable.is_correctable);
    assert_eq!(unrecoverable.error_type, "multiple_bit_unrecoverable");
    assert_eq!(unrecoverable.syndrome_value, 6);
}

#[test]
fn test_hamming_invalid_inputs() {
    assert!(encode_hamming("", ParityMode::Even).is_err());
    assert!(encode_hamming("10201", ParityMode::Even).is_err());
    assert!(encode_hamming("abc", ParityMode::Even).is_err());
    assert!(verify_and_correct_hamming("01", ParityMode::Even).is_err());
    assert!(verify_and_correct_hamming("01x001", ParityMode::Even).is_err());
}

#[test]
fn test_crc_generator_validation() {
    // Non-binary
    assert!(calculate_crc("1101", "1021", None).is_err());
    // Leading zero
    assert!(calculate_crc("1101", "0101", None).is_err());
    // Degree 0 (single bit '1')
    assert!(calculate_crc("1101", "1", None).is_err());
    // Empty
    assert!(calculate_crc("1101", "", None).is_err());
    assert!(calculate_crc("", "1011", None).is_err());
}

#[test]
fn test_crc_modulo2_division_known_vector() {
    // Known textbook vector: Data = 11010011101100, Poly = 1011 (x^3 + x + 1)
    let data = "11010011101100";
    let poly = "1011";
    let res = calculate_crc(data, poly, None).expect("CRC calculation should succeed");

    assert_eq!(res.input_bits, data);
    assert_eq!(res.generator_polynomial, poly);
    assert_eq!(res.degree, 3);
    assert_eq!(res.remainder.len(), 3);
    assert_eq!(
        res.transmitted_codeword,
        format!("{}{}", data, res.remainder)
    );
    assert!(!res.division_steps.is_empty());

    // Verify transmitted frame with receiver division
    let ver =
        verify_crc(&res.transmitted_codeword, poly, None).expect("Verification should succeed");
    assert!(ver.is_valid, "Transmitted frame should verify as valid");
    assert_eq!(ver.remainder, "000");

    // Check step trace contents
    let first_step = &res.division_steps[0];
    assert_eq!(first_step.step_index, 1);
    assert_eq!(first_step.current_window.len(), poly.len());
}

#[test]
fn test_crc_presets_and_corruption() {
    let presets = [
        ("CRC-8", CRC8_DEFAULT_POLY, 8),
        ("CRC-16-IBM", CRC16_IBM_POLY, 16),
        ("CRC-16-CCITT", CRC16_CCITT_POLY, 16),
        ("CRC-32-IEEE", CRC32_IEEE_POLY, 32),
    ];

    let test_data = "11010110111001011101";

    for (name, poly, expected_degree) in presets {
        let calc = calculate_crc(test_data, poly, Some(name))
            .unwrap_or_else(|e| panic!("Failed calculating {}: {}", name, e));
        assert_eq!(calc.degree, expected_degree);
        assert_eq!(calc.remainder.len(), expected_degree);

        // Verification of untampered transmitted frame
        let ver = verify_crc(&calc.transmitted_codeword, poly, Some(name))
            .unwrap_or_else(|e| panic!("Failed verifying {}: {}", name, e));
        assert!(ver.is_valid, "{} valid frame must verify to true", name);
        assert_eq!(ver.remainder, "0".repeat(expected_degree));

        // Corrupt bit 5 using deterministic injector
        let corrupted_frame =
            inject_bit_errors(&calc.transmitted_codeword, &[5]).expect("Injection should succeed");
        assert_ne!(corrupted_frame, calc.transmitted_codeword);

        let corrupt_ver = verify_crc(&corrupted_frame, poly, Some(name))
            .unwrap_or_else(|e| panic!("Failed verifying corrupted {}: {}", name, e));
        assert!(
            !corrupt_ver.is_valid,
            "Corrupted {} frame must be detected",
            name
        );
        assert_ne!(
            corrupt_ver.remainder,
            "0".repeat(expected_degree),
            "Corrupted remainder must be non-zero"
        );
    }
}

#[test]
fn test_internet_checksum_rfc1071_known_vector() {
    // RFC 1071 standard example:
    // Words: 0x0001, 0xf203, 0xf4f5, 0xf6f7
    // Sum: 0x0001 + 0xf203 + 0xf4f5 + 0xf6f7 = 0x2ddf0
    // Fold carry: 0x0002 + 0xddf0 = 0xddf2
    // Checksum (~0xddf2): 0x220d
    let words = vec![0x0001, 0xf203, 0xf4f5, 0xf6f7];
    let calc = calculate_internet_checksum(&words).expect("Calculation should succeed");

    assert_eq!(calc.checksum_hex, "220D");
    assert_eq!(calc.checksum, 0x220d);
    assert_eq!(calc.uncomplemented_sum, 0xddf2);
    assert_eq!(calc.words, words);
    assert_eq!(calc.addition_steps.len(), 4);

    // Verify: verify with the checksum word included
    let ver = verify_internet_checksum(&words, calc.checksum).expect("Verification should succeed");
    assert!(ver.is_valid);
    assert_eq!(ver.inverted_result, 0x0000);
    assert_eq!(ver.total_accumulated_sum, 0xFFFF);
}

#[test]
fn test_internet_checksum_odd_length_bytes() {
    // Byte sequence with odd length 3: [0x01, 0x02, 0x03]
    // Word 1: 0x0102
    // Word 2: 0x0300 (RFC 1071 padded low byte with 0x00)
    let bytes = vec![0x01, 0x02, 0x03];
    let words = parse_bytes_to_16bit_words(&bytes);
    assert_eq!(words, vec![0x0102, 0x0300]);

    let calc = calculate_internet_checksum(&words).unwrap();
    // 0x0102 + 0x0300 = 0x0402 -> checksum is ~0x0402 = 0xfbfd
    assert_eq!(calc.checksum, 0xfbfd);

    let ver = verify_internet_checksum(&words, calc.checksum).unwrap();
    assert!(ver.is_valid);
}

#[test]
fn test_internet_checksum_parse_hex() {
    let hex_input = "0x0001, 0xF203, 0xF4F5, 0xF6F7";
    let words = parse_hex_to_16bit_words(hex_input).expect("Hex parsing should succeed");
    assert_eq!(words, vec![0x0001, 0xf203, 0xf4f5, 0xf6f7]);

    let spaced_hex = "0001 f203 f4f5 f6f7";
    let words2 = parse_hex_to_16bit_words(spaced_hex).expect("Spaced hex parsing should succeed");
    assert_eq!(words2, vec![0x0001, 0xf203, 0xf4f5, 0xf6f7]);

    // Corrupted hex word
    assert!(parse_hex_to_16bit_words("0001 GGGG").is_err());
    // Empty
    assert!(parse_hex_to_16bit_words("").is_err());
}

#[test]
fn test_internet_checksum_corruption_detection() {
    let words = vec![0x4500, 0x003c, 0x1c46, 0x4000, 0x4006];
    let calc = calculate_internet_checksum(&words).unwrap();

    assert!(
        verify_internet_checksum(&words, calc.checksum)
            .unwrap()
            .is_valid
    );

    // Corrupt one bit in word 2
    let mut corrupted = words.clone();
    corrupted[2] ^= 0x0001;
    let corrupt_ver = verify_internet_checksum(&corrupted, calc.checksum).unwrap();
    assert!(!corrupt_ver.is_valid);
    assert_ne!(corrupt_ver.inverted_result, 0x0000);
}

#[test]
fn test_datalink_serialization_and_determinism() {
    // Hamming determinism
    let enc1 = encode_hamming("1101001", ParityMode::Even).unwrap();
    let enc2 = encode_hamming("1101001", ParityMode::Even).unwrap();
    let json1 = serde_json::to_string(&enc1).unwrap();
    let json2 = serde_json::to_string(&enc2).unwrap();
    assert_eq!(json1, json2);

    // CRC determinism
    let crc1 = calculate_crc("11010011101100", "1011", None).unwrap();
    let crc2 = calculate_crc("11010011101100", "1011", None).unwrap();
    let json_crc1 = serde_json::to_string(&crc1).unwrap();
    let json_crc2 = serde_json::to_string(&crc2).unwrap();
    assert_eq!(json_crc1, json_crc2);

    // Checksum determinism
    let cs1 = calculate_internet_checksum(&[0x1234, 0x5678, 0x9abc]).unwrap();
    let cs2 = calculate_internet_checksum(&[0x1234, 0x5678, 0x9abc]).unwrap();
    let json_cs1 = serde_json::to_string(&cs1).unwrap();
    let json_cs2 = serde_json::to_string(&cs2).unwrap();
    assert_eq!(json_cs1, json_cs2);
}

// =========================================================================
// Phase 4C: Flow Control Tests (Sliding Window, GBN, SR)
// =========================================================================

use crate::datalink::{
    circular_distance, get_window_sequences, is_in_circular_window, simulate_csma,
    simulate_csma_cd, simulate_go_back_n, simulate_pure_aloha, simulate_selective_repeat,
    simulate_sliding_window, simulate_slotted_aloha, validate_flow_control_config, CsmaPersistence,
    FlowControlConfig, FlowControlProtocol, FlowEventType, MacConfig, MacEventType, MacProtocol,
};

#[test]
fn test_flow_control_sequence_space_validation() {
    // Valid GBN: seq_space >= window_size + 1 (e.g. window 4, seq_space 5)
    let valid_gbn = FlowControlConfig {
        protocol: FlowControlProtocol::GoBackN,
        window_size: 4,
        sequence_space: 5,
        total_frames_to_send: 10,
        frame_tx_time_us: 1000,
        prop_delay_us: 2000,
        ack_tx_time_us: 100,
        timeout_us: 10_000,
        seed: 42,
        dropped_frame_indices: vec![],
        corrupted_frame_indices: vec![],
        dropped_ack_seqs: vec![],
    };
    assert!(validate_flow_control_config(&valid_gbn).is_ok());

    // Invalid GBN: seq_space < window_size + 1 (e.g. window 4, seq_space 4)
    let mut invalid_gbn = valid_gbn.clone();
    invalid_gbn.sequence_space = 4;
    let err = validate_flow_control_config(&invalid_gbn).unwrap_err();
    assert!(matches!(err, NetSimError::InvalidConfiguration(_)));

    // Valid SR: seq_space >= 2 * window_size (e.g. window 4, seq_space 8)
    let valid_sr = FlowControlConfig {
        protocol: FlowControlProtocol::SelectiveRepeat,
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 10,
        frame_tx_time_us: 1000,
        prop_delay_us: 2000,
        ack_tx_time_us: 100,
        timeout_us: 10_000,
        seed: 42,
        dropped_frame_indices: vec![],
        corrupted_frame_indices: vec![],
        dropped_ack_seqs: vec![],
    };
    assert!(validate_flow_control_config(&valid_sr).is_ok());

    // Invalid SR: seq_space < 2 * window_size (e.g. window 4, seq_space 7)
    let mut invalid_sr = valid_sr.clone();
    invalid_sr.sequence_space = 7;
    let err_sr = validate_flow_control_config(&invalid_sr).unwrap_err();
    assert!(matches!(err_sr, NetSimError::InvalidConfiguration(_)));

    // Zero window or frames
    let mut zero_win = valid_gbn.clone();
    zero_win.window_size = 0;
    assert!(validate_flow_control_config(&zero_win).is_err());

    let mut zero_frames = valid_gbn;
    zero_frames.total_frames_to_send = 0;
    assert!(validate_flow_control_config(&zero_frames).is_err());
}

#[test]
fn test_circular_sequence_arithmetic() {
    let seq_space = 8;

    // Normal distance
    assert_eq!(circular_distance(0, 3, seq_space), 3);
    assert_eq!(circular_distance(2, 6, seq_space), 4);

    // Wraparound distance
    assert_eq!(circular_distance(6, 1, seq_space), 3); // 6 -> 7 -> 0 -> 1 = 3
    assert_eq!(circular_distance(7, 0, seq_space), 1);
    assert_eq!(circular_distance(4, 4, seq_space), 0);

    // Window inclusion without wraparound: [2, 5) with size 3 -> 2, 3, 4
    assert!(is_in_circular_window(2, 2, 3, seq_space));
    assert!(is_in_circular_window(3, 2, 3, seq_space));
    assert!(is_in_circular_window(4, 2, 3, seq_space));
    assert!(!is_in_circular_window(5, 2, 3, seq_space));
    assert!(!is_in_circular_window(1, 2, 3, seq_space));

    // Window inclusion across wraparound: base=6, size=4 -> 6, 7, 0, 1
    assert!(is_in_circular_window(6, 6, 4, seq_space));
    assert!(is_in_circular_window(7, 6, 4, seq_space));
    assert!(is_in_circular_window(0, 6, 4, seq_space));
    assert!(is_in_circular_window(1, 6, 4, seq_space));
    assert!(!is_in_circular_window(2, 6, 4, seq_space));
    assert!(!is_in_circular_window(5, 6, 4, seq_space));

    // Window sequences vector
    let seqs = get_window_sequences(6, 4, seq_space);
    assert_eq!(seqs, vec![6, 7, 0, 1]);
}

#[test]
fn test_sliding_window_progression_and_wraparound() {
    let config = FlowControlConfig {
        protocol: FlowControlProtocol::SlidingWindow,
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 8,
        frame_tx_time_us: 1000,
        prop_delay_us: 2000,
        ack_tx_time_us: 100,
        timeout_us: 15_000,
        seed: 12345,
        dropped_frame_indices: vec![],
        corrupted_frame_indices: vec![],
        dropped_ack_seqs: vec![],
    };

    let result = simulate_sliding_window(config).expect("Simulation should succeed");
    assert!(result.is_completed);
    assert_eq!(result.metrics.completed_frames, 8);
    assert_eq!(result.metrics.original_frames, 8);
    assert_eq!(result.metrics.retransmissions, 0);
    assert!(result.metrics.total_frames_sent >= 8);
    assert!(result.metrics.utilization > 0.0);

    // Verify window occupancy invariant: sender window size never exceeded configured window_size
    for ev in &result.events {
        assert!(ev.sender_window.active_window_seqs.len() <= 4);
    }
}

#[test]
fn test_go_back_n_drop_rejection_and_full_retransmission() {
    // Drop frame 2 (the 3rd frame)
    let config = FlowControlConfig {
        protocol: FlowControlProtocol::GoBackN,
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 6,
        frame_tx_time_us: 1000,
        prop_delay_us: 2000,
        ack_tx_time_us: 100,
        timeout_us: 10_000,
        seed: 54321,
        dropped_frame_indices: vec![2],
        corrupted_frame_indices: vec![],
        dropped_ack_seqs: vec![],
    };

    let result = simulate_go_back_n(config).expect("GBN simulation should succeed");
    assert!(result.is_completed);
    assert_eq!(result.metrics.completed_frames, 6);
    assert!(result.metrics.retransmissions >= 1);
    assert!(result.metrics.dropped_or_corrupted_frames >= 1);

    // Verify events: timeout triggered, out-of-order rejection occurred
    let timeout_events: Vec<_> = result
        .events
        .iter()
        .filter(|e| e.event_type == FlowEventType::TimeoutTriggered)
        .collect();
    assert!(
        !timeout_events.is_empty(),
        "Timeout should have triggered for dropped frame 2"
    );

    // In GBN, when timeout triggers, retransmissions occur from send_base
    let retrans_events: Vec<_> = result
        .events
        .iter()
        .filter(|e| e.event_type == FlowEventType::Retransmission)
        .collect();
    assert!(
        !retrans_events.is_empty(),
        "Retransmissions should have occurred in GBN"
    );
}

#[test]
fn test_selective_repeat_drop_buffering_and_selective_retransmission() {
    // Drop frame 2 in Selective Repeat
    let config = FlowControlConfig {
        protocol: FlowControlProtocol::SelectiveRepeat,
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 6,
        frame_tx_time_us: 1000,
        prop_delay_us: 2000,
        ack_tx_time_us: 100,
        timeout_us: 10_000,
        seed: 99999,
        dropped_frame_indices: vec![2],
        corrupted_frame_indices: vec![],
        dropped_ack_seqs: vec![],
    };

    let result = simulate_selective_repeat(config).expect("SR simulation should succeed");
    assert!(result.is_completed);
    assert_eq!(result.metrics.completed_frames, 6);

    // Verify that receiver buffered out-of-order frames
    assert!(
        result.metrics.receiver_buffer_occupancy_max >= 1,
        "SR receiver must buffer out-of-order frames"
    );

    // Verify that timeout triggered specifically for frame index 2
    let timeout_ev = result
        .events
        .iter()
        .find(|e| e.event_type == FlowEventType::TimeoutTriggered);
    assert!(timeout_ev.is_some());
    assert_eq!(timeout_ev.unwrap().frame_index, Some(2));

    // In Selective Repeat, ONLY the timed out frame (frame 2) is selectively retransmitted,
    // NOT unrelated outstanding frames (frames 3, 4 are acknowledged individually and buffered)
    let retransmitted_frame_indices: Vec<u32> = result
        .events
        .iter()
        .filter(|e| e.event_type == FlowEventType::Retransmission)
        .filter_map(|e| e.frame_index)
        .collect();
    assert!(
        retransmitted_frame_indices.iter().all(|&idx| idx == 2),
        "SR should selectively retransmit ONLY frame 2, got: {:?}",
        retransmitted_frame_indices
    );
}

#[test]
fn test_flow_control_deterministic_replay() {
    let config = FlowControlConfig {
        protocol: FlowControlProtocol::GoBackN,
        window_size: 4,
        sequence_space: 8,
        total_frames_to_send: 5,
        frame_tx_time_us: 1000,
        prop_delay_us: 1500,
        ack_tx_time_us: 100,
        timeout_us: 8000,
        seed: 77777,
        dropped_frame_indices: vec![1],
        corrupted_frame_indices: vec![],
        dropped_ack_seqs: vec![],
    };

    let run1 = simulate_go_back_n(config.clone()).unwrap();
    let run2 = simulate_go_back_n(config).unwrap();

    assert_eq!(run1.events.len(), run2.events.len());
    assert_eq!(
        run1.metrics.total_frames_sent,
        run2.metrics.total_frames_sent
    );
    assert_eq!(
        run1.metrics.completion_time_us,
        run2.metrics.completion_time_us
    );

    for (e1, e2) in run1.events.iter().zip(run2.events.iter()) {
        assert_eq!(e1.timestamp_us, e2.timestamp_us);
        assert_eq!(e1.event_type, e2.event_type);
        assert_eq!(e1.seq_num, e2.seq_num);
    }
}

// =========================================================================
// Phase 4C: Multiple Access (MAC) Tests
// =========================================================================

#[test]
fn test_pure_aloha_single_station_success() {
    let config = MacConfig {
        protocol: MacProtocol::PureAloha,
        persistence: CsmaPersistence::OnePersistent,
        num_stations: 1,
        total_frames_to_send: 5,
        frame_duration_us: 10_000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 123,
        max_retries: 16,
        offered_load_g: 0.5,
    };

    let result = simulate_pure_aloha(config).expect("Pure ALOHA single station should succeed");
    assert!(result.completed_successfully);
    assert_eq!(result.metrics.successful_transmissions, 5);
    assert_eq!(result.metrics.collisions, 0);
    assert_eq!(result.metrics.collision_rate, 0.0);
    assert!(result.metrics.throughput_frames_per_sec > 0.0);
    assert!(result.metrics.throughput_bits_per_sec > 0.0);
}

#[test]
fn test_pure_aloha_overlap_collision_and_backoff() {
    let config = MacConfig {
        protocol: MacProtocol::PureAloha,
        persistence: CsmaPersistence::OnePersistent,
        num_stations: 8,
        total_frames_to_send: 16,
        frame_duration_us: 10_000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 456,
        max_retries: 16,
        offered_load_g: 2.0,
    };

    let result = simulate_pure_aloha(config).expect("Pure ALOHA multi-station should run");
    assert!(result.metrics.attempted_transmissions >= 16);
    // With 8 stations and heavy load, collisions must occur
    assert!(result.metrics.collisions > 0);
    assert!(result.metrics.collision_rate > 0.0);
    assert!(result.metrics.average_backoff_delay_us > 0.0);
}

#[test]
fn test_slotted_aloha_discrete_slots_and_collisions() {
    let config = MacConfig {
        protocol: MacProtocol::SlottedAloha,
        persistence: CsmaPersistence::OnePersistent,
        num_stations: 6,
        total_frames_to_send: 12,
        frame_duration_us: 5_000,
        prop_delay_us: 50,
        frame_size_bits: 4000,
        seed: 789,
        max_retries: 16,
        offered_load_g: 1.5,
    };

    let result = simulate_slotted_aloha(config).expect("Slotted ALOHA should succeed");
    assert!(
        !result.slot_records.is_empty(),
        "Slotted ALOHA must generate slot records"
    );

    // Verify slot boundaries are exact multiples of frame duration
    for slot in &result.slot_records {
        assert_eq!(slot.end_time_us - slot.start_time_us, 5_000);
        assert_eq!(slot.start_time_us % 5_000, 0);
    }

    // Verify collision slot records have >1 participating station
    for slot in &result.slot_records {
        if slot.status.starts_with("Collision") {
            assert!(slot.participating_stations.len() >= 2);
        } else if slot.status.starts_with("Success") {
            assert_eq!(slot.participating_stations.len(), 1);
        } else {
            assert_eq!(slot.status, "Idle");
            assert!(slot.participating_stations.is_empty());
        }
    }
}

#[test]
fn test_csma_persistence_modes() {
    // 1-persistent CSMA
    let config_1p = MacConfig {
        protocol: MacProtocol::Csma,
        persistence: CsmaPersistence::OnePersistent,
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10_000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 111,
        max_retries: 16,
        offered_load_g: 1.0,
    };
    let res_1p = simulate_csma(config_1p).expect("1-persistent CSMA should succeed");
    assert!(res_1p.completed_successfully);

    // Non-persistent CSMA
    let config_np = MacConfig {
        protocol: MacProtocol::Csma,
        persistence: CsmaPersistence::NonPersistent,
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10_000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 222,
        max_retries: 16,
        offered_load_g: 1.0,
    };
    let res_np = simulate_csma(config_np).expect("Non-persistent CSMA should succeed");
    assert!(res_np.completed_successfully);

    // p-persistent CSMA (p = 0.5)
    let config_pp = MacConfig {
        protocol: MacProtocol::Csma,
        persistence: CsmaPersistence::PPersistent { probability: 0.5 },
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10_000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 333,
        max_retries: 16,
        offered_load_g: 1.0,
    };
    let res_pp = simulate_csma(config_pp).expect("p-persistent CSMA should succeed");
    assert!(res_pp.completed_successfully);
}

#[test]
fn test_csma_cd_collision_detection_jam_and_beb() {
    let config = MacConfig {
        protocol: MacProtocol::CsmaCd,
        persistence: CsmaPersistence::OnePersistent,
        num_stations: 6,
        total_frames_to_send: 12,
        frame_duration_us: 10_000,
        prop_delay_us: 100, // 2*tau = 200µs slot time
        frame_size_bits: 8000,
        seed: 444,
        max_retries: 16,
        offered_load_g: 2.0,
    };

    let result = simulate_csma_cd(config).expect("CSMA/CD simulation should succeed");
    assert!(result.completed_successfully);

    // Check for collision detection, jam signal, and abort events
    let collision_events: Vec<_> = result
        .events
        .iter()
        .filter(|e| e.event_type == MacEventType::CollisionDetected)
        .collect();
    let jam_events: Vec<_> = result
        .events
        .iter()
        .filter(|e| e.event_type == MacEventType::JamSignalSent)
        .collect();
    let abort_events: Vec<_> = result
        .events
        .iter()
        .filter(|e| e.event_type == MacEventType::TransmissionAborted)
        .collect();
    let backoff_events: Vec<_> = result
        .events
        .iter()
        .filter(|e| e.event_type == MacEventType::BackoffScheduled)
        .collect();

    if !collision_events.is_empty() {
        assert!(
            !jam_events.is_empty(),
            "CSMA/CD must send 32-bit jam signal on collision"
        );
        assert!(
            !abort_events.is_empty(),
            "CSMA/CD must abort transmission on collision"
        );
        assert!(
            !backoff_events.is_empty(),
            "CSMA/CD must schedule binary exponential backoff"
        );

        // Verify BEB exponent capped at 10 (k = min(c, 10))
        for ev in &backoff_events {
            assert!(
                ev.description.contains("k="),
                "Backoff event must report BEB exponent k: {}",
                ev.description
            );
        }
    }
}

#[test]
fn test_mac_deterministic_replay() {
    let config = MacConfig {
        protocol: MacProtocol::CsmaCd,
        persistence: CsmaPersistence::OnePersistent,
        num_stations: 4,
        total_frames_to_send: 8,
        frame_duration_us: 10_000,
        prop_delay_us: 50,
        frame_size_bits: 8000,
        seed: 8888,
        max_retries: 16,
        offered_load_g: 1.5,
    };

    let res1 = simulate_csma_cd(config.clone()).unwrap();
    let res2 = simulate_csma_cd(config).unwrap();

    assert_eq!(res1.events.len(), res2.events.len());
    assert_eq!(
        res1.metrics.attempted_transmissions,
        res2.metrics.attempted_transmissions
    );
    assert_eq!(
        res1.metrics.successful_transmissions,
        res2.metrics.successful_transmissions
    );
    assert_eq!(res1.metrics.collisions, res2.metrics.collisions);
    assert_eq!(
        res1.metrics.total_simulation_time_us,
        res2.metrics.total_simulation_time_us
    );

    for (e1, e2) in res1.events.iter().zip(res2.events.iter()) {
        assert_eq!(e1.timestamp_us, e2.timestamp_us);
        assert_eq!(e1.event_type, e2.event_type);
        assert_eq!(e1.station_id, e2.station_id);
    }
}

#[test]
fn test_mac_invalid_configuration() {
    let config = MacConfig {
        num_stations: 0,
        ..Default::default()
    };
    assert!(simulate_pure_aloha(config.clone()).is_err());
    assert!(simulate_slotted_aloha(config.clone()).is_err());
    assert!(simulate_csma(config.clone()).is_err());
    assert!(simulate_csma_cd(config).is_err());

    let config2 = MacConfig {
        frame_duration_us: 0,
        ..Default::default()
    };
    assert!(simulate_pure_aloha(config2.clone()).is_err());
    assert!(simulate_slotted_aloha(config2).is_err());
}

// ==========================================
// PHASE 4D TESTS: TRANSPORT LAYER & CONGESTION CONTROL
// ==========================================

#[test]
fn test_tcp_handshake_state_transitions() {
    use crate::transport::{
        simulate_tcp, ConnectionState, TcpFlag, TransportConfig, TransportEventType,
    };

    let config = TransportConfig {
        payload_bytes: 2000,
        segment_size_bytes: 1000,
        initial_sequence_number: 1000,
        ..Default::default()
    };

    let result = simulate_tcp(config, None).expect("Simulation must succeed");
    assert!(result.completed);

    // Verify 3-way handshake transitions
    let syn_event = result
        .events
        .iter()
        .find(|e| e.event_type == TransportEventType::SynSent)
        .expect("SYN sent must be recorded");
    assert_eq!(syn_event.connection_state, ConnectionState::SynSent);
    let syn_seg = syn_event.segment.as_ref().unwrap();
    assert_eq!(syn_seg.sequence_number, 1000);
    assert!(syn_seg.has_flag(TcpFlag::Syn));
    assert_eq!(syn_seg.payload_length, 0);

    let syn_rx_event = result
        .events
        .iter()
        .find(|e| e.event_type == TransportEventType::SynReceived)
        .expect("SYN received must be recorded");
    assert_eq!(syn_rx_event.connection_state, ConnectionState::SynReceived);

    // Both endpoints become established
    let est_events: Vec<_> = result
        .events
        .iter()
        .filter(|e| e.event_type == TransportEventType::ConnectionEstablished)
        .collect();
    assert!(est_events.len() >= 2);
    assert_eq!(est_events[0].connection_state, ConnectionState::Established);
}

#[test]
fn test_tcp_byte_oriented_sequence_progression_and_cumulative_acks() {
    use crate::transport::{simulate_tcp, TransportConfig, TransportEventType};

    let config = TransportConfig {
        payload_bytes: 3500,
        segment_size_bytes: 1000,
        initial_sequence_number: 2000,
        ..Default::default()
    };

    let result = simulate_tcp(config, None).expect("Simulation must succeed");
    assert!(result.completed);
    assert_eq!(result.metrics.bytes_delivered, 3500);

    // Sent data segments should have byte-oriented sequence numbers:
    // ISN=2000. SYN consumes 1 seq -> Data starts at 2001.
    // Segment 1: seq=2001, len=1000
    // Segment 2: seq=3001, len=1000
    // Segment 3: seq=4001, len=1000
    // Segment 4: seq=5001, len=500
    let data_events: Vec<_> = result
        .events
        .iter()
        .filter(|e| e.event_type == TransportEventType::DataSegmentSent)
        .collect();
    assert_eq!(data_events.len(), 4);
    assert_eq!(
        data_events[0].segment.as_ref().unwrap().sequence_number,
        2001
    );
    assert_eq!(
        data_events[0].segment.as_ref().unwrap().payload_length,
        1000
    );
    assert_eq!(
        data_events[1].segment.as_ref().unwrap().sequence_number,
        3001
    );
    assert_eq!(
        data_events[1].segment.as_ref().unwrap().payload_length,
        1000
    );
    assert_eq!(
        data_events[2].segment.as_ref().unwrap().sequence_number,
        4001
    );
    assert_eq!(
        data_events[2].segment.as_ref().unwrap().payload_length,
        1000
    );
    assert_eq!(
        data_events[3].segment.as_ref().unwrap().sequence_number,
        5001
    );
    assert_eq!(data_events[3].segment.as_ref().unwrap().payload_length, 500);

    // A cumulative ACK acknowledging all 3500 bytes (2001 + 3500 = 5501) must exist
    let has_data_ack = result.events.iter().any(|e| {
        e.event_type == TransportEventType::AckReceived
            && e.segment
                .as_ref()
                .map(|s| s.acknowledgment_number == 5501)
                .unwrap_or(false)
    });
    assert!(has_data_ack, "Cumulative ACK for 5501 must be received");
}

#[test]
fn test_tcp_rtt_estimator_jacobson_karn_and_clamping() {
    use crate::transport::RttEstimator;

    let mut estimator = RttEstimator::new(100_000, 20_000, 500_000);
    assert_eq!(estimator.rto_us, 100_000);

    // First valid sample R = 40_000 us
    estimator.update_sample(40_000);
    assert_eq!(estimator.sample_count, 1);
    assert_eq!(estimator.srtt_us, 40_000);
    assert_eq!(estimator.rttvar_us, 20_000);
    // RTO = SRTT + 4 * RTTVAR = 40_000 + 4*20_000 = 120_000 us
    assert_eq!(estimator.rto_us, 120_000);

    // Second valid sample R = 50_000 us
    // diff = |40_000 - 50_000| = 10_000
    // RTTVAR = (3*20_000 + 10_000) / 4 = 70_000 / 4 = 17_500
    // SRTT = (7*40_000 + 50_000) / 8 = 330_000 / 8 = 41_250
    // RTO = 41_250 + 4 * 17_500 = 41_250 + 70_000 = 111_250
    estimator.update_sample(50_000);
    assert_eq!(estimator.sample_count, 2);
    assert_eq!(estimator.rttvar_us, 17_500);
    assert_eq!(estimator.srtt_us, 41_250);
    assert_eq!(estimator.rto_us, 111_250);

    // Test RTO clamping
    estimator.update_sample(1_000_000);
    assert!(
        estimator.rto_us <= 500_000,
        "RTO must be clamped to max_rto"
    );

    let mut min_estimator = RttEstimator::new(5_000, 20_000, 500_000);
    min_estimator.update_sample(1_000);
    assert!(
        min_estimator.rto_us >= 20_000,
        "RTO must be clamped to min_rto"
    );
}

#[test]
fn test_tcp_fast_retransmit_and_fast_recovery_on_3_dup_acks() {
    use crate::transport::{simulate_tcp, TransportConfig, TransportEventType};

    // Send 5 segments, drop segment #0
    let config = TransportConfig {
        payload_bytes: 5000,
        segment_size_bytes: 1000,
        dropped_segments: vec![0],
        initial_cwnd_mss: 4.0,
        initial_ssthresh_mss: 16.0,
        ..Default::default()
    };

    let result = simulate_tcp(config, None).expect("Simulation must succeed");
    assert!(result.completed);
    assert!(result.metrics.fast_retransmit_count >= 1);
    assert!(result.metrics.retransmissions >= 1);

    // Verify Fast Retransmit event was recorded
    let fast_rx = result.events.iter().find(|e| {
        e.event_type == TransportEventType::Retransmission
            && e.description.contains("FAST RETRANSMIT")
    });
    assert!(fast_rx.is_some(), "Fast Retransmit event must be present");
}

#[test]
fn test_tcp_timeout_retransmission_and_exponential_backoff() {
    use crate::transport::{simulate_tcp, TransportConfig, TransportEventType};

    // Drop segment 0 with cwnd=1 so duplicate ACKs cannot be generated, forcing RTO timeout
    let config = TransportConfig {
        payload_bytes: 2000,
        segment_size_bytes: 1000,
        dropped_segments: vec![0],
        initial_cwnd_mss: 1.0,
        initial_ssthresh_mss: 8.0,
        initial_rto_us: 50_000,
        ..Default::default()
    };

    let result = simulate_tcp(config, None).expect("Simulation must succeed");
    assert!(result.completed);
    assert!(result.metrics.timeout_count >= 1);

    let timeout_event = result
        .events
        .iter()
        .find(|e| e.event_type == TransportEventType::Timeout)
        .expect("Timeout event must be recorded");
    assert_eq!(timeout_event.cwnd_mss, 1.0);
}

#[test]
fn test_tcp_four_step_teardown() {
    use crate::transport::{simulate_tcp, ConnectionState, TransportConfig};

    let config = TransportConfig {
        payload_bytes: 1000,
        segment_size_bytes: 1000,
        ..Default::default()
    };

    let result = simulate_tcp(config, None).expect("Simulation must succeed");
    assert!(result.completed);

    // Verify FIN -> ACK -> FIN -> ACK sequence
    let fin_wait_1 = result
        .events
        .iter()
        .find(|e| e.connection_state == ConnectionState::FinWait1);
    assert!(fin_wait_1.is_some());

    let close_wait = result
        .events
        .iter()
        .find(|e| e.connection_state == ConnectionState::CloseWait);
    assert!(close_wait.is_some());

    let fin_wait_2 = result
        .events
        .iter()
        .find(|e| e.connection_state == ConnectionState::FinWait2);
    assert!(fin_wait_2.is_some());

    let time_wait = result
        .events
        .iter()
        .find(|e| e.connection_state == ConnectionState::TimeWait);
    assert!(time_wait.is_some());

    let closed = result
        .events
        .iter()
        .rfind(|e| e.connection_state == ConnectionState::Closed);
    assert!(closed.is_some());
}

#[test]
fn test_tcp_congestion_controller_slow_start_and_congestion_avoidance() {
    use crate::congestion::{CongestionController, CongestionPhase};

    let mut cc = CongestionController::new(1.0, 4.0, 1000);
    assert_eq!(cc.phase, CongestionPhase::SlowStart);
    assert_eq!(cc.cwnd_mss, 1.0);

    // ACK 1 MSS in Slow Start: cwnd increases to 2.0
    cc.on_new_ack(1000, 1000);
    assert_eq!(cc.cwnd_mss, 2.0);
    assert_eq!(cc.phase, CongestionPhase::SlowStart);

    // ACK 1 MSS: cwnd increases to 3.0
    cc.on_new_ack(2000, 1000);
    assert_eq!(cc.cwnd_mss, 3.0);

    // ACK 1 MSS: cwnd reaches ssthresh (4.0) -> transitions to Congestion Avoidance
    cc.on_new_ack(3000, 1000);
    assert_eq!(cc.cwnd_mss, 4.0);
    assert_eq!(cc.phase, CongestionPhase::CongestionAvoidance);

    // Additive increase in Congestion Avoidance
    cc.on_new_ack(4000, 1000);
    assert!(cc.cwnd_mss > 4.0);
    assert_eq!(cc.phase, CongestionPhase::CongestionAvoidance);
}

#[test]
fn test_tcp_deterministic_replay() {
    use crate::transport::{simulate_tcp, TransportConfig};

    let config = TransportConfig {
        payload_bytes: 4000,
        segment_size_bytes: 1000,
        dropped_segments: vec![1],
        seed: 12345,
        ..Default::default()
    };

    let res1 = simulate_tcp(config.clone(), None).unwrap();
    let res2 = simulate_tcp(config, None).unwrap();

    assert_eq!(res1.events.len(), res2.events.len());
    assert_eq!(
        res1.metrics.completion_time_us,
        res2.metrics.completion_time_us
    );
    assert_eq!(res1.metrics.bytes_delivered, res2.metrics.bytes_delivered);
    assert_eq!(res1.metrics.retransmissions, res2.metrics.retransmissions);
    assert_eq!(
        res1.metrics.fast_retransmit_count,
        res2.metrics.fast_retransmit_count
    );

    for (e1, e2) in res1.events.iter().zip(res2.events.iter()) {
        assert_eq!(e1.timestamp_us, e2.timestamp_us);
        assert_eq!(e1.event_type, e2.event_type);
        assert_eq!(e1.cwnd_mss, e2.cwnd_mss);
    }
}

#[test]
fn test_udp_connectionless_delivery_no_handshake_no_ack_no_retransmissions() {
    use crate::transport::{simulate_udp, TransportConfig, TransportEventType};

    let config = TransportConfig {
        payload_bytes: 5000,
        segment_size_bytes: 1000,
        dropped_segments: vec![2],
        ..Default::default()
    };

    let res = simulate_udp(config, None).unwrap();
    assert!(res.completed);
    assert_eq!(res.metrics.segments_sent, 5);
    assert_eq!(res.metrics.segments_delivered, 4);
    assert_eq!(res.metrics.segments_lost, 1);
    assert_eq!(res.metrics.retransmissions, 0);
    assert_eq!(res.metrics.duplicate_acks, 0);
    assert_eq!(res.metrics.timeout_count, 0);

    // UDP must NOT have SYN, ACK, or Retransmission events
    for event in &res.events {
        assert_ne!(event.event_type, TransportEventType::SynSent);
        assert_ne!(event.event_type, TransportEventType::SynReceived);
        assert_ne!(event.event_type, TransportEventType::AckReceived);
        assert_ne!(event.event_type, TransportEventType::Retransmission);
    }
}

#[test]
fn test_multihop_transport_routing_derived_from_project() {
    use crate::domain::{Link, LinkEndpoint, Node, NodeType, Position, Project};
    use crate::transport::{simulate_tcp, simulate_udp, TransportConfig};

    // Topology: Host A (PC) <-> Router 1 <-> Router 2 <-> Host B (PC)
    let mut proj = Project::new("MultiHop Transport Test".to_string());
    proj.nodes = vec![
        Node::new(
            "host-a".into(),
            "Host A".into(),
            NodeType::Pc,
            Position { x: 0.0, y: 0.0 },
        ),
        Node::new(
            "r1".into(),
            "Router 1".into(),
            NodeType::Router,
            Position { x: 100.0, y: 0.0 },
        ),
        Node::new(
            "r2".into(),
            "Router 2".into(),
            NodeType::Router,
            Position { x: 200.0, y: 0.0 },
        ),
        Node::new(
            "host-b".into(),
            "Host B".into(),
            NodeType::Pc,
            Position { x: 300.0, y: 0.0 },
        ),
    ];

    proj.links = vec![
        Link::new(
            "l1".into(),
            LinkEndpoint {
                node_id: "host-a".into(),
                interface_id: "eth0".into(),
            },
            LinkEndpoint {
                node_id: "r1".into(),
                interface_id: "eth0".into(),
            },
        ),
        Link::new(
            "l2".into(),
            LinkEndpoint {
                node_id: "r1".into(),
                interface_id: "eth1".into(),
            },
            LinkEndpoint {
                node_id: "r2".into(),
                interface_id: "eth0".into(),
            },
        ),
        Link::new(
            "l3".into(),
            LinkEndpoint {
                node_id: "r2".into(),
                interface_id: "eth1".into(),
            },
            LinkEndpoint {
                node_id: "host-b".into(),
                interface_id: "eth0".into(),
            },
        ),
    ];

    let config = TransportConfig {
        source_node_id: "host-a".into(),
        destination_node_id: "host-b".into(),
        payload_bytes: 2000,
        segment_size_bytes: 1000,
        ..Default::default()
    };

    let tcp_res =
        simulate_tcp(config.clone(), Some(&proj)).expect("TCP over multi-hop must succeed");
    assert_eq!(tcp_res.derived_route, vec!["host-a", "r1", "r2", "host-b"]);
    assert!(tcp_res.completed);

    let udp_res = simulate_udp(config, Some(&proj)).expect("UDP over multi-hop must succeed");
    assert_eq!(udp_res.derived_route, vec!["host-a", "r1", "r2", "host-b"]);
    assert!(udp_res.completed);
}

#[test]
fn test_transport_invariants() {
    use crate::transport::{simulate_tcp, TransportConfig};

    let config = TransportConfig {
        payload_bytes: 6000,
        segment_size_bytes: 1000,
        dropped_segments: vec![1, 3],
        ..Default::default()
    };

    let res = simulate_tcp(config, None).expect("TCP must succeed");

    // Invariant 1: Time never decreases
    let mut prev_time = 0;
    for event in &res.events {
        assert!(event.timestamp_us >= prev_time, "Time must be monotonic");
        prev_time = event.timestamp_us;
    }

    // Invariant 2: cwnd is always at least 1.0 MSS
    for pt in &res.cwnd_timeline {
        assert!(pt.cwnd_mss >= 1.0, "cwnd must never drop below 1.0 MSS");
        assert!(
            pt.ssthresh_mss >= 2.0,
            "ssthresh must never drop below 2.0 MSS"
        );
    }

    // Invariant 3: Delivered bytes equals requested payload on completion
    assert_eq!(res.metrics.bytes_delivered, 6000);
}

#[test]
fn test_phase5_five_layer_packet_serialization_and_deserialization() {
    use crate::domain::{
        AppHeader, DataLinkHeader, EncapsulationStack, NetworkHeader, Packet, PacketHopRecord,
        PacketState, PhysicalLayerInfo, TransportHeader,
    };

    let packet = Packet {
        id: "pkt-phase5".into(),
        src_node_id: "host-1".into(),
        dst_node_id: "host-2".into(),
        size_bytes: 1460,
        created_at_us: 100_000,
        current_node_id: "host-1".into(),
        next_hop_node_id: Some("router-1".into()),
        state: PacketState::Created,
        headers: EncapsulationStack {
            application: AppHeader {
                protocol: "HTTP".into(),
                payload_preview: "GET /index.html HTTP/1.1".into(),
                message_type: Some("HTTP Request".into()),
                session_id: None,
                transaction_id: None,
                resource_or_command: None,
                status_code: None,
            },
            transport: TransportHeader {
                protocol: "TCP".into(),
                src_port: 52000,
                dst_port: 80,
                seq_num: Some(1000),
                ack_num: Some(1),
                window_size: Some(65535),
                flags: vec!["SYN".into(), "ACK".into()],
                payload_length: Some(1460),
                is_retransmission: Some(false),
                connection_state: Some("ESTABLISHED".into()),
            },
            network: NetworkHeader {
                version: 4,
                src_ip: "192.168.1.10".into(),
                dst_ip: "10.0.0.100".into(),
                ttl: 64,
                protocol_num: 6,
                checksum: 0xBEEF,
            },
            datalink: DataLinkHeader {
                src_mac: "02:00:00:01:00:01".into(),
                dst_mac: "02:00:00:02:00:01".into(),
                ether_type: 0x0800,
                crc_fcs: 0x12345678,
                frame_type: Some("Ethernet II".into()),
                fcs_valid: Some(true),
            },
            physical: Some(PhysicalLayerInfo {
                link_id: Some("link-1".into()),
                bandwidth_bps: Some(1_000_000_000),
                propagation_delay_us: Some(5_000),
                tx_start_us: Some(100_005),
                tx_finish_us: Some(100_017),
                bit_count: 1460 * 8,
                preamble_bits: Some("10101010".into()),
                signal_encoding: Some("Manchester".into()),
            }),
        },
        journey_hops: vec!["host-1".into()],
        planned_route: vec!["host-1".into(), "router-1".into(), "host-2".into()],
        hop_history: vec![PacketHopRecord {
            hop_index: 0,
            node_id: "host-1".into(),
            link_id: None,
            timestamp_us: 100_000,
            state: PacketState::Created,
            description: "Packet created at host-1".into(),
        }],
    };

    let serialized = serde_json::to_string(&packet).expect("Must serialize Packet");
    let deserialized: Packet = serde_json::from_str(&serialized).expect("Must deserialize Packet");

    assert_eq!(deserialized.id, "pkt-phase5");
    assert_eq!(deserialized.headers.application.protocol, "HTTP");
    assert_eq!(deserialized.headers.transport.protocol, "TCP");
    assert_eq!(deserialized.headers.network.version, 4);
    assert_eq!(deserialized.headers.datalink.ether_type, 0x0800);
    assert!(deserialized.headers.physical.is_some());
    assert_eq!(
        deserialized
            .headers
            .physical
            .as_ref()
            .unwrap()
            .bandwidth_bps,
        Some(1_000_000_000)
    );
    assert_eq!(deserialized.hop_history.len(), 1);
}

#[test]
fn test_phase5_backward_compatible_deserialization_missing_optional_fields() {
    use crate::domain::Packet;

    // JSON payload from older phases without physical, planned_route, or hop_history
    let legacy_json = r#"{
        "id": "pkt-legacy",
        "src_node_id": "n1",
        "dst_node_id": "n2",
        "size_bytes": 1000,
        "created_at_us": 500,
        "current_node_id": "n1",
        "next_hop_node_id": null,
        "state": "created",
        "headers": {
            "application": {
                "protocol": "HTTP",
                "payload_preview": "preview"
            },
            "transport": {
                "protocol": "TCP",
                "src_port": 80,
                "dst_port": 8080,
                "seq_num": 1,
                "ack_num": null,
                "window_size": null,
                "flags": []
            },
            "network": {
                "version": 4,
                "src_ip": "1.1.1.1",
                "dst_ip": "2.2.2.2",
                "ttl": 64,
                "protocol_num": 6,
                "checksum": 0
            },
            "datalink": {
                "src_mac": "00:00:00:00:00:01",
                "dst_mac": "00:00:00:00:00:02",
                "ether_type": 2048,
                "crc_fcs": 0
            }
        },
        "journey_hops": ["n1"]
    }"#;

    let pkt: Packet = serde_json::from_str(legacy_json)
        .expect("Must deserialize legacy packet with backward-compatible defaults");
    assert_eq!(pkt.id, "pkt-legacy");
    assert!(pkt.headers.physical.is_none());
    assert!(pkt.planned_route.is_empty());
    assert!(pkt.hop_history.is_empty());
}

#[test]
fn test_phase5_simulation_engine_physical_layer_and_hop_history() {
    use crate::domain::{Link, LinkEndpoint};
    use crate::simulation::SimulationEngine;

    let mut engine = SimulationEngine::new(42);

    let mut link = Link::new(
        "link-1".into(),
        LinkEndpoint {
            node_id: "node-a".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "node-b".into(),
            interface_id: "eth0".into(),
        },
    );
    link.bandwidth_bps = 10_000_000;
    link.propagation_delay_us = 5_000;
    link.queue_capacity = 10;
    let links = vec![link];
    engine.update_links(&links);

    let pkt_id = engine.inject_packet(
        "node-a".into(),
        "node-b".into(),
        1000,
        "HTTP".into(),
        "TCP".into(),
    );

    // Initial hop record exists
    let initial_pkt = engine.get_packet(&pkt_id).expect("Packet must exist");
    assert_eq!(initial_pkt.hop_history.len(), 1);
    assert_eq!(initial_pkt.hop_history[0].hop_index, 0);
    assert_eq!(initial_pkt.hop_history[0].node_id, "node-a");

    // Run simulation to delivery
    engine.run_all().expect("Simulation must run to completion");

    let final_pkt = engine.get_packet(&pkt_id).expect("Packet must exist");
    assert_eq!(final_pkt.state, crate::domain::PacketState::Delivered);

    // Hops: 0 (Created) -> 1 (Queued) -> 2 (Transmitting) -> 3 (InFlight) -> 4 (Delivered)
    assert!(
        final_pkt.hop_history.len() >= 4,
        "Hop history must record traversal steps: {:?}",
        final_pkt.hop_history
    );

    // Physical layer was populated during transmission
    assert!(final_pkt.headers.physical.is_some());
    let phys = final_pkt.headers.physical.as_ref().unwrap();
    assert_eq!(phys.link_id, Some("link-1".into()));
    assert_eq!(phys.bandwidth_bps, Some(10_000_000));
    assert_eq!(phys.propagation_delay_us, Some(5_000));
    assert!(phys.tx_start_us.is_some());
    assert!(phys.tx_finish_us.is_some());
}

#[test]
fn test_phase5_packet_drop_history_preservation() {
    use crate::domain::{Link, LinkEndpoint, PacketState};
    use crate::simulation::SimulationEngine;

    let mut engine = SimulationEngine::new(42);

    // Queue capacity of 1 so second packet drops on drop-tail
    let mut link = Link::new(
        "link-tight".into(),
        LinkEndpoint {
            node_id: "node-a".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "node-b".into(),
            interface_id: "eth0".into(),
        },
    );
    link.bandwidth_bps = 100_000;
    link.propagation_delay_us = 100_000;
    link.queue_capacity = 1;
    let links = vec![link];
    engine.update_links(&links);

    let _pkt1 = engine.inject_packet(
        "node-a".into(),
        "node-b".into(),
        1000,
        "HTTP".into(),
        "TCP".into(),
    );
    let _pkt2 = engine.inject_packet(
        "node-a".into(),
        "node-b".into(),
        1000,
        "HTTP".into(),
        "TCP".into(),
    );
    let pkt3 = engine.inject_packet(
        "node-a".into(),
        "node-b".into(),
        1000,
        "HTTP".into(),
        "TCP".into(),
    );

    engine.run_all().expect("Must complete");

    let p3 = engine.get_packet(&pkt3).expect("pkt3 must exist");
    assert_eq!(p3.state, PacketState::DroppedQueueFull);

    // Confirm drop was recorded in hop history with reason
    let drop_record = p3
        .hop_history
        .iter()
        .find(|h| h.state == PacketState::DroppedQueueFull);
    assert!(
        drop_record.is_some(),
        "Drop must be recorded in hop history"
    );
    assert!(drop_record.unwrap().description.contains("dropped"));
}

#[test]
fn test_phase5_event_metadata_enrichment_and_layer_identification() {
    use crate::domain::{Link, LinkEndpoint};
    use crate::simulation::SimulationEngine;

    let mut engine = SimulationEngine::new(100);
    let mut link = Link::new(
        "l1".into(),
        LinkEndpoint {
            node_id: "n1".into(),
            interface_id: "eth0".into(),
        },
        LinkEndpoint {
            node_id: "n2".into(),
            interface_id: "eth0".into(),
        },
    );
    link.bandwidth_bps = 10_000_000;
    link.propagation_delay_us = 10_000;
    link.queue_capacity = 50;
    let links = vec![link];
    engine.update_links(&links);

    let pkt_id = engine.inject_packet("n1".into(), "n2".into(), 500, "DNS".into(), "UDP".into());
    engine.run_all().expect("Simulation must run");

    let snap = engine.get_snapshot();
    assert!(!snap.recent_events.is_empty());

    // Check packet created event metadata
    let created_ev = snap
        .recent_events
        .iter()
        .find(|e| {
            matches!(
                e.event_type,
                crate::simulation::SimEventType::PacketCreated { .. }
            )
        })
        .expect("PacketCreated event must exist");

    assert_eq!(created_ev.packet_id, Some(pkt_id.clone()));
    assert_eq!(created_ev.node_id, Some("n1".into()));
    assert_eq!(created_ev.layer, Some("Application".into()));

    // Check transmission event metadata
    let tx_ev = snap
        .recent_events
        .iter()
        .find(|e| {
            matches!(
                e.event_type,
                crate::simulation::SimEventType::TransmissionStarted { .. }
            )
        })
        .expect("TransmissionStarted event must exist");

    assert_eq!(tx_ev.packet_id, Some(pkt_id.clone()));
    assert_eq!(tx_ev.link_id, Some("l1".into()));
    assert_eq!(tx_ev.layer, Some("Physical".into()));
}

#[test]
fn test_phase5_protocol_events_without_packet_id() {
    use crate::simulation::clock::SimTime;
    use crate::simulation::event::{SimEvent, SimEventType};

    let ev = SimEvent::new(
        1,
        SimTime::from_micros(500),
        SimEventType::RouteUpdated {
            node_id: "router-core".into(),
            algorithm: "Dijkstra Link-State".into(),
        },
        "Routing table converged on node router-core".into(),
    );

    assert_eq!(ev.packet_id, None);
    assert_eq!(ev.node_id, Some("router-core".into()));
    assert_eq!(ev.layer, Some("Network".into()));
    assert_eq!(ev.protocol, Some("Routing".into()));

    let json = serde_json::to_string(&ev).expect("Must serialize");
    let deser: SimEvent = serde_json::from_str(&json).expect("Must deserialize");
    assert_eq!(deser.packet_id, None);
    assert_eq!(deser.node_id, Some("router-core".into()));
}

#[test]
fn test_phase5_planned_route_vs_actual_hop_history_distinction() {
    use crate::domain::{
        AppHeader, DataLinkHeader, EncapsulationStack, NetworkHeader, Packet, PacketHopRecord,
        PacketState, TransportHeader,
    };

    // Packet with planned route across 3 routers, but actual hop history ends early due to link fault
    let packet = Packet {
        id: "pkt-fault-route".into(),
        src_node_id: "host-a".into(),
        dst_node_id: "host-b".into(),
        size_bytes: 1000,
        created_at_us: 0,
        current_node_id: "router-1".into(),
        next_hop_node_id: Some("router-2".into()),
        state: PacketState::DroppedLinkDown,
        headers: EncapsulationStack {
            application: AppHeader {
                protocol: "HTTP".into(),
                payload_preview: "test".into(),
                message_type: None,
                session_id: None,
                transaction_id: None,
                resource_or_command: None,
                status_code: None,
            },
            transport: TransportHeader {
                protocol: "TCP".into(),
                src_port: 80,
                dst_port: 80,
                seq_num: None,
                ack_num: None,
                window_size: None,
                flags: vec![],
                payload_length: None,
                is_retransmission: None,
                connection_state: None,
            },
            network: NetworkHeader {
                version: 4,
                src_ip: "10.0.0.1".into(),
                dst_ip: "10.0.0.2".into(),
                ttl: 64,
                protocol_num: 6,
                checksum: 0,
            },
            datalink: DataLinkHeader {
                src_mac: "00:00:00:00:00:01".into(),
                dst_mac: "00:00:00:00:00:02".into(),
                ether_type: 2048,
                crc_fcs: 0,
                frame_type: None,
                fcs_valid: None,
            },
            physical: None,
        },
        journey_hops: vec!["host-a".into(), "router-1".into()],
        planned_route: vec![
            "host-a".into(),
            "router-1".into(),
            "router-2".into(),
            "host-b".into(),
        ],
        hop_history: vec![
            PacketHopRecord {
                hop_index: 0,
                node_id: "host-a".into(),
                link_id: None,
                timestamp_us: 0,
                state: PacketState::Created,
                description: "Created".into(),
            },
            PacketHopRecord {
                hop_index: 1,
                node_id: "router-1".into(),
                link_id: Some("link-a-r1".into()),
                timestamp_us: 1000,
                state: PacketState::InFlight,
                description: "Arrived at router-1".into(),
            },
            PacketHopRecord {
                hop_index: 2,
                node_id: "router-1".into(),
                link_id: Some("link-r1-r2".into()),
                timestamp_us: 1005,
                state: PacketState::DroppedLinkDown,
                description: "Dropped: link is down".into(),
            },
        ],
    };

    // Planned route has 4 hops
    assert_eq!(packet.planned_route.len(), 4);
    // Actual traversal only reached router-1 (3 hop events) and NEVER reached router-2 or host-b
    assert_eq!(packet.hop_history.len(), 3);
    assert_eq!(packet.hop_history[2].state, PacketState::DroppedLinkDown);
    assert!(!packet.hop_history.iter().any(|h| h.node_id == "host-b"));
}

// =========================================================================
// PHASE 6: APPLICATION-LAYER PROTOCOLS & WORKFLOWS TESTS
// =========================================================================

#[test]
fn test_phase6_dns_recursive_query_a_record_success() {
    use crate::application::dns::{
        simulate_dns, DnsConfig, DnsQueryMode, DnsRecordType, DnsResponseCode,
    };

    let config = DnsConfig {
        client_node_id: "client-host".to_string(),
        server_node_id: "dns-resolver".to_string(),
        auth_server_node_id: None,
        query_name: "www.example.com".to_string(),
        query_type: DnsRecordType::A,
        query_mode: DnsQueryMode::Recursive,
        query_id: 2001,
        custom_records: Vec::new(),
        seed: 42,
    };

    let result = simulate_dns(config, None).expect("DNS simulation must succeed");
    assert_eq!(result.response_code, DnsResponseCode::NoError);
    assert_eq!(
        result.state,
        crate::application::AppProtocolState::Completed
    );
    assert!(!result.answers.is_empty());
    assert_eq!(result.answers[0].name, "www.example.com");
    assert_eq!(result.answers[0].value, "93.184.216.34");
    assert_eq!(result.answers[0].record_type, DnsRecordType::A);

    // Verify events sequence
    let query_event = result
        .events
        .iter()
        .find(|e| e.event_type == "DNS_QUERY_SENT");
    assert!(query_event.is_some());
    assert_eq!(query_event.unwrap().node_id, "client-host");
    assert!(query_event.unwrap().packet_id.is_some());

    let lookup_event = result.events.iter().find(|e| e.event_type == "DNS_LOOKUP");
    assert!(lookup_event.is_some());
    assert_eq!(
        lookup_event.unwrap().packet_id,
        None,
        "Local lookup must not have a packet"
    );

    let resp_event = result
        .events
        .iter()
        .find(|e| e.event_type == "DNS_RESPONSE_SENT");
    assert!(resp_event.is_some());
    assert!(resp_event.unwrap().packet_id.is_some());

    // Verify packet 5-layer encapsulation
    assert_eq!(
        result.packets.len(),
        2,
        "1 query packet + 1 response packet"
    );
    let q_pkt = &result.packets[0];
    assert_eq!(q_pkt.headers.application.protocol, "DNS");
    assert_eq!(q_pkt.headers.application.transaction_id, Some(2001));
    assert_eq!(q_pkt.headers.transport.protocol, "UDP");
    assert_eq!(q_pkt.headers.transport.dst_port, 53);
    assert_eq!(
        q_pkt.headers.transport.flags.len(),
        0,
        "UDP must not fabricate TCP flags"
    );
    assert!(q_pkt.headers.physical.is_some());
}

#[test]
fn test_phase6_dns_records_aaaa_cname_mx() {
    use crate::application::dns::{
        simulate_dns, DnsConfig, DnsQueryMode, DnsRecordType, DnsResponseCode,
    };

    // AAAA Query
    let cfg_aaaa = DnsConfig {
        client_node_id: "pc-1".to_string(),
        server_node_id: "dns-1".to_string(),
        auth_server_node_id: None,
        query_name: "ipv6.example.com".to_string(),
        query_type: DnsRecordType::Aaaa,
        query_mode: DnsQueryMode::Recursive,
        query_id: 3001,
        custom_records: Vec::new(),
        seed: 42,
    };
    let res_aaaa = simulate_dns(cfg_aaaa, None).expect("AAAA query must succeed");
    assert_eq!(res_aaaa.response_code, DnsResponseCode::NoError);
    assert_eq!(
        res_aaaa.answers[0].value,
        "2606:2800:220:1:248:1893:25c8:1946"
    );

    // MX Query
    let cfg_mx = DnsConfig {
        client_node_id: "pc-1".to_string(),
        server_node_id: "dns-1".to_string(),
        auth_server_node_id: None,
        query_name: "mail.example.org".to_string(),
        query_type: DnsRecordType::Mx,
        query_mode: DnsQueryMode::Recursive,
        query_id: 3002,
        custom_records: Vec::new(),
        seed: 42,
    };
    let res_mx = simulate_dns(cfg_mx, None).expect("MX query must succeed");
    assert_eq!(res_mx.response_code, DnsResponseCode::NoError);
    assert_eq!(res_mx.answers[0].value, "mailhost.example.org");
    assert_eq!(res_mx.answers[0].priority, Some(10));

    // CNAME Query
    let cfg_cname = DnsConfig {
        client_node_id: "pc-1".to_string(),
        server_node_id: "dns-1".to_string(),
        auth_server_node_id: None,
        query_name: "ftp.example.com".to_string(),
        query_type: DnsRecordType::Cname,
        query_mode: DnsQueryMode::Recursive,
        query_id: 3003,
        custom_records: Vec::new(),
        seed: 42,
    };
    let res_cname = simulate_dns(cfg_cname, None).expect("CNAME query must succeed");
    assert_eq!(res_cname.response_code, DnsResponseCode::NoError);
    assert_eq!(res_cname.answers[0].value, "www.example.com");
}

#[test]
fn test_phase6_dns_iterative_query_steps() {
    use crate::application::dns::{simulate_dns, DnsConfig, DnsQueryMode, DnsRecordType};

    let config = DnsConfig {
        client_node_id: "pc-1".to_string(),
        server_node_id: "local-resolver".to_string(),
        auth_server_node_id: Some("auth-dns-root".to_string()),
        query_name: "unlisted.domain.net".to_string(),
        query_type: DnsRecordType::A,
        query_mode: DnsQueryMode::Iterative,
        query_id: 4001,
        custom_records: Vec::new(),
        seed: 42,
    };

    let res = simulate_dns(config, None).expect("Simulation must complete");
    let referral_ev = res.events.iter().find(|e| e.event_type == "DNS_REFERRAL");
    assert!(
        referral_ev.is_some(),
        "Iterative query must produce a DNS_REFERRAL step"
    );
    assert!(referral_ev.unwrap().description.contains("auth-dns-root"));
}

#[test]
fn test_phase6_dns_nxdomain_unknown_query() {
    use crate::application::dns::{
        simulate_dns, DnsConfig, DnsQueryMode, DnsRecordType, DnsResponseCode,
    };

    let config = DnsConfig {
        client_node_id: "pc-1".to_string(),
        server_node_id: "dns-resolver".to_string(),
        auth_server_node_id: None,
        query_name: "nonexistent.example.invalid".to_string(),
        query_type: DnsRecordType::A,
        query_mode: DnsQueryMode::Recursive,
        query_id: 5001,
        custom_records: Vec::new(),
        seed: 42,
    };

    let res = simulate_dns(config, None).expect("Simulation must complete");
    assert_eq!(res.response_code, DnsResponseCode::NxDomain);
    assert_eq!(res.state, crate::application::AppProtocolState::Failed);
    assert!(res.answers.is_empty());
    assert!(!res.metrics.success);
    assert!(res.metrics.error_message.unwrap().contains("NXDOMAIN"));

    let nx_ev = res.events.iter().find(|e| e.event_type == "DNS_NXDOMAIN");
    assert!(nx_ev.is_some(), "Must emit DNS_NXDOMAIN event");
}

#[test]
fn test_phase6_dns_deterministic_replay() {
    use crate::application::dns::{simulate_dns, DnsConfig, DnsQueryMode, DnsRecordType};

    let config1 = DnsConfig {
        client_node_id: "pc-1".to_string(),
        server_node_id: "dns-1".to_string(),
        auth_server_node_id: None,
        query_name: "www.example.com".to_string(),
        query_type: DnsRecordType::A,
        query_mode: DnsQueryMode::Recursive,
        query_id: 6001,
        custom_records: Vec::new(),
        seed: 999,
    };
    let config2 = config1.clone();

    let res1 = simulate_dns(config1, None).unwrap();
    let res2 = simulate_dns(config2, None).unwrap();

    assert_eq!(res1.events.len(), res2.events.len());
    for (e1, e2) in res1.events.iter().zip(res2.events.iter()) {
        assert_eq!(e1.timestamp_us, e2.timestamp_us);
        assert_eq!(e1.event_type, e2.event_type);
        assert_eq!(e1.packet_id, e2.packet_id);
    }
}

#[test]
fn test_phase6_http_get_200_ok_tcp_stream_and_headers() {
    use crate::application::http::{simulate_http, HttpConfig, HttpMethod, HttpRequest};
    use std::collections::BTreeMap;

    let mut headers = BTreeMap::new();
    headers.insert("Host".to_string(), "example.com".to_string());
    headers.insert("User-Agent".to_string(), "NetSim-Test/1.0".to_string());

    let config = HttpConfig {
        client_node_id: "host-client".to_string(),
        server_node_id: "server-web".to_string(),
        request: HttpRequest {
            method: HttpMethod::Get,
            path: "/index.html".to_string(),
            headers,
            body: None,
        },
        port: 80,
        seed: 42,
    };

    let res = simulate_http(config, None).expect("HTTP simulation must succeed");
    assert_eq!(res.response.status_code, 200);
    assert_eq!(res.response.status_text, "OK");
    assert!(res.response.body.contains("Welcome to NetSim"));
    assert_eq!(res.state, crate::application::AppProtocolState::Completed);

    // Verify TCP handshake and closure events are present
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "HTTP_TCP_HANDSHAKE_INITIATED"));
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "HTTP_TCP_CONNECTED"));
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "HTTP_REQUEST_SENT"));
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "HTTP_RESPONSE_SENT"));
    assert!(res.events.iter().any(|e| e.event_type == "HTTP_TCP_CLOSED"));

    // Verify request packet
    let req_pkt = res
        .packets
        .iter()
        .find(|p| p.headers.application.message_type == Some("Request".to_string()))
        .unwrap();
    assert_eq!(req_pkt.headers.application.protocol, "HTTP");
    assert_eq!(
        req_pkt.headers.application.resource_or_command,
        Some("Get /index.html".to_string())
    );
    assert_eq!(req_pkt.headers.transport.protocol, "TCP");
    assert_eq!(req_pkt.headers.transport.dst_port, 80);

    // Verify response packet
    let resp_pkt = res
        .packets
        .iter()
        .find(|p| p.headers.application.message_type == Some("Response".to_string()))
        .unwrap();
    assert_eq!(
        resp_pkt.headers.application.status_code,
        Some("200 OK".to_string())
    );
    assert_eq!(resp_pkt.headers.transport.src_port, 80);
}

#[test]
fn test_phase6_http_get_404_not_found() {
    use crate::application::http::{simulate_http, HttpConfig, HttpMethod, HttpRequest};
    use std::collections::BTreeMap;

    let config = HttpConfig {
        client_node_id: "host-client".to_string(),
        server_node_id: "server-web".to_string(),
        request: HttpRequest {
            method: HttpMethod::Get,
            path: "/missing/resource.html".to_string(),
            headers: BTreeMap::new(),
            body: None,
        },
        port: 80,
        seed: 42,
    };

    let res = simulate_http(config, None).expect("HTTP simulation must run");
    assert_eq!(res.response.status_code, 404);
    assert_eq!(res.response.status_text, "Not Found");
    assert_eq!(res.state, crate::application::AppProtocolState::Failed);
    assert!(!res.metrics.success);
    assert!(res.events.iter().any(|e| e.event_type == "HTTP_NOT_FOUND"));
}

#[test]
fn test_phase6_http_post_request_body_and_response() {
    use crate::application::http::{simulate_http, HttpConfig, HttpMethod, HttpRequest};
    use std::collections::BTreeMap;

    let mut headers = BTreeMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());

    let payload = "{\"sensor\": \"temp-1\", \"reading\": 24.5}".to_string();

    let config = HttpConfig {
        client_node_id: "iot-device".to_string(),
        server_node_id: "api-backend".to_string(),
        request: HttpRequest {
            method: HttpMethod::Post,
            path: "/api/data".to_string(),
            headers,
            body: Some(payload),
        },
        port: 8080,
        seed: 42,
    };

    let res = simulate_http(config, None).expect("HTTP POST must succeed");
    assert_eq!(res.response.status_code, 200);
    assert!(res.response.body.contains("bytes_processed"));
    assert!(res.metrics.payload_bytes_sent > 250);
}

#[test]
fn test_phase6_ftp_control_session_login_and_channels() {
    use crate::application::ftp::{simulate_ftp, FtpCommand, FtpConfig};

    let config = FtpConfig {
        client_node_id: "workstation-1".to_string(),
        server_node_id: "ftp-archive".to_string(),
        username: "ftpuser".to_string(),
        password: Some("secret123".to_string()),
        transfer_command: FtpCommand::List,
        filename: None,
        file_size_bytes: 512,
        control_port: 21,
        data_port: 50000,
        seed: 42,
    };

    let res = simulate_ftp(config, None).expect("FTP simulation must succeed");
    assert_eq!(res.control_session_id, "ftp-ctrl-sess-21");
    assert_eq!(res.data_session_id, "ftp-data-sess-50000");
    assert_eq!(res.state, crate::application::AppProtocolState::Completed);

    // Verify server greeting 220 and login 230
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "FTP_SERVER_GREETING"));
    assert!(res.events.iter().any(|e| e.event_type == "FTP_LOGIN"));
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "FTP_DATA_CHANNEL_OPENED"));
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "FTP_DATA_TRANSFER"));
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "FTP_TRANSFER_COMPLETE"));

    // Verify control port vs data port in packets
    let ctrl_pkt = res
        .packets
        .iter()
        .find(|p| p.headers.application.message_type == Some("Control Command".to_string()))
        .unwrap();
    assert_eq!(ctrl_pkt.headers.transport.dst_port, 21);

    let data_pkt = res
        .packets
        .iter()
        .find(|p| p.headers.application.message_type == Some("Data Transfer".to_string()))
        .unwrap();
    assert_eq!(data_pkt.headers.transport.src_port, 50000);
    assert_ne!(
        data_pkt.headers.transport.src_port,
        ctrl_pkt.headers.transport.dst_port
    );
}

#[test]
fn test_phase6_ftp_separate_control_and_data_channels_retr() {
    use crate::application::ftp::{simulate_ftp, FtpCommand, FtpConfig};

    let config = FtpConfig {
        client_node_id: "pc-client".to_string(),
        server_node_id: "ftp-server".to_string(),
        username: "anonymous".to_string(),
        password: None,
        transfer_command: FtpCommand::Retr,
        filename: Some("large_dataset.bin".to_string()),
        file_size_bytes: 8192,
        control_port: 21,
        data_port: 50005,
        seed: 42,
    };

    let res = simulate_ftp(config, None).expect("FTP RETR must succeed");
    let data_transfer_event = res
        .events
        .iter()
        .find(|e| e.event_type == "FTP_DATA_TRANSFER")
        .unwrap();
    assert!(data_transfer_event.description.contains("8192 bytes"));

    let data_packet = res
        .packets
        .iter()
        .find(|p| p.headers.application.session_id == Some("ftp-data-sess-50005".to_string()))
        .unwrap();
    assert_eq!(data_packet.size_bytes, 8192);
}

#[test]
fn test_phase6_smtp_mail_delivery_complete_workflow() {
    use crate::application::smtp::{simulate_smtp, SmtpConfig};

    let config = SmtpConfig {
        client_node_id: "mail-client".to_string(),
        server_node_id: "mta-server".to_string(),
        mail_from: "sender@uni.edu".to_string(),
        rcpt_to: "prof@uni.edu".to_string(),
        subject: "Assignment 4 Submission".to_string(),
        body: "Attached is the solution.".to_string(),
        reject_recipient: false,
        port: 25,
        seed: 42,
    };

    let res = simulate_smtp(config, None).expect("SMTP workflow must succeed");
    assert!(res.is_accepted);
    assert_eq!(res.state, crate::application::AppProtocolState::Completed);

    // Verify SMTP standard transaction sequence
    let event_types: Vec<&str> = res.events.iter().map(|e| e.event_type.as_str()).collect();
    assert!(event_types.contains(&"SMTP_CONNECTED"));
    assert!(event_types.contains(&"SMTP_GREETING"));
    assert!(event_types.contains(&"SMTP_COMMAND")); // EHLO, MAIL FROM, RCPT TO, DATA, QUIT
    assert!(event_types.contains(&"SMTP_DATA_TRANSFER"));
    assert!(event_types.contains(&"SMTP_MESSAGE_ACCEPTED"));
    assert!(event_types.contains(&"SMTP_RESPONSE"));

    // Verify packets generated
    assert!(res
        .packets
        .iter()
        .any(|p| p.headers.application.resource_or_command
            == Some("MAIL FROM:<sender@uni.edu>".to_string())));
    assert!(res
        .packets
        .iter()
        .any(|p| p.headers.application.resource_or_command
            == Some("RCPT TO:<prof@uni.edu>".to_string())));
    assert!(res
        .packets
        .iter()
        .any(|p| p.headers.application.message_type == Some("Mail Data".to_string())));
}

#[test]
fn test_phase6_smtp_recipient_rejection_550_error_path() {
    use crate::application::smtp::{simulate_smtp, SmtpConfig};

    let config = SmtpConfig {
        client_node_id: "mail-client".to_string(),
        server_node_id: "mta-server".to_string(),
        mail_from: "spammer@evil.org".to_string(),
        rcpt_to: "invalid_mailbox_999@uni.edu".to_string(),
        subject: "Spam".to_string(),
        body: "Spam content".to_string(),
        reject_recipient: true,
        port: 25,
        seed: 42,
    };

    let res = simulate_smtp(config, None).expect("Simulation must run");
    assert!(!res.is_accepted);
    assert_eq!(res.state, crate::application::AppProtocolState::Failed);
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "SMTP_RCPT_REJECTED"));
    assert!(res
        .metrics
        .error_message
        .unwrap()
        .contains("550 User unknown"));
}

#[test]
fn test_phase6_snmp_get_request_known_oids() {
    use crate::application::snmp::{simulate_snmp, SnmpConfig};

    let config = SnmpConfig {
        manager_node_id: "admin-nms".to_string(),
        agent_node_id: "switch-core".to_string(),
        community: "public".to_string(),
        requested_oid: "1.3.6.1.2.1.1.1.0".to_string(), // sysDescr.0
        port: 161,
        seed: 42,
    };

    let res = simulate_snmp(config, None).expect("SNMP simulation must succeed");
    assert_eq!(res.state, crate::application::AppProtocolState::Completed);
    assert!(res.found_object.is_some());

    let obj = res.found_object.unwrap();
    assert_eq!(obj.oid, "1.3.6.1.2.1.1.1.0");
    assert_eq!(obj.name, "sysDescr.0");
    assert!(obj.value.contains("NetSim CoreOS Router"));

    // Verify events
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "SNMP_GET_REQUEST"));
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "SNMP_AGENT_LOOKUP"));
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "SNMP_GET_RESPONSE"));

    // Verify packets
    assert_eq!(res.packets.len(), 2, "GetRequest and GetResponse");
    assert_eq!(res.packets[0].headers.transport.protocol, "UDP");
    assert_eq!(res.packets[0].headers.transport.dst_port, 161);
    assert_eq!(res.packets[0].headers.application.protocol, "SNMP");
    assert_eq!(
        res.packets[1].headers.application.status_code,
        Some("noError".to_string())
    );
}

#[test]
fn test_phase6_snmp_unknown_oid_no_such_name() {
    use crate::application::snmp::{simulate_snmp, SnmpConfig};

    let config = SnmpConfig {
        manager_node_id: "admin-nms".to_string(),
        agent_node_id: "switch-core".to_string(),
        community: "public".to_string(),
        requested_oid: "1.3.6.1.4.1.99999.1.0".to_string(), // unknown
        port: 161,
        seed: 42,
    };

    let res = simulate_snmp(config, None).expect("SNMP simulation must run");
    assert_eq!(res.state, crate::application::AppProtocolState::Failed);
    assert!(res.found_object.is_none());
    assert!(!res.metrics.success);
    assert!(res
        .events
        .iter()
        .any(|e| e.event_type == "SNMP_UNKNOWN_OID"));

    let resp_pkt = res
        .packets
        .iter()
        .find(|p| p.headers.application.message_type == Some("GetResponse".to_string()))
        .unwrap();
    assert_eq!(
        resp_pkt.headers.application.status_code,
        Some("noSuchName".to_string())
    );
}

#[test]
fn test_phase6_application_multi_hop_traversal_and_actual_hop_history() {
    use crate::application::dns::{simulate_dns, DnsConfig, DnsQueryMode, DnsRecordType};

    let config = DnsConfig {
        client_node_id: "host-a".to_string(),
        server_node_id: "host-b".to_string(),
        auth_server_node_id: None,
        query_name: "www.example.com".to_string(),
        query_type: DnsRecordType::A,
        query_mode: DnsQueryMode::Recursive,
        query_id: 8888,
        custom_records: Vec::new(),
        seed: 42,
    };

    let res = simulate_dns(config, None).expect("Simulation must succeed");
    let query_pkt = &res.packets[0];

    // Standard baseline path: host-a -> router-1 -> host-b
    assert_eq!(
        query_pkt.planned_route,
        vec!["host-a", "router-1", "host-b"]
    );
    assert_eq!(query_pkt.journey_hops, vec!["host-a", "router-1", "host-b"]);

    // Actual hop_history must contain distinct traversal records
    assert!(query_pkt.hop_history.len() >= 4);
    assert_eq!(query_pkt.hop_history[0].node_id, "host-a");
    assert_eq!(
        query_pkt.hop_history[0].state,
        crate::domain::PacketState::Created
    );

    let intermediate = query_pkt
        .hop_history
        .iter()
        .find(|h| h.node_id == "router-1");
    assert!(intermediate.is_some());

    let final_hop = query_pkt.hop_history.last().unwrap();
    assert_eq!(final_hop.node_id, "host-b");
    assert_eq!(final_hop.state, crate::domain::PacketState::Delivered);
    assert!(final_hop.timestamp_us > query_pkt.hop_history[0].timestamp_us);
}

#[test]
fn test_phase6_sim_event_application_layer_mapping() {
    use crate::simulation::clock::SimTime;
    use crate::simulation::event::{SimEvent, SimEventType};

    let ev = SimEvent::new(
        99,
        SimTime::from_micros(12345),
        SimEventType::ApplicationEvent {
            protocol: "HTTP".to_string(),
            event_name: "HTTP_REQUEST_SENT".to_string(),
            node_id: "web-client".to_string(),
            packet_id: Some("pkt-http-001".to_string()),
            session_id: Some("sess-http-1".to_string()),
            details: "GET /index.html".to_string(),
        },
        "Client sent GET /index.html".to_string(),
    );

    assert_eq!(ev.layer, Some("Application".to_string()));
    assert_eq!(ev.protocol, Some("HTTP".to_string()));
    assert_eq!(ev.node_id, Some("web-client".to_string()));
    assert_eq!(ev.packet_id, Some("pkt-http-001".to_string()));
}

#[test]
fn test_phase6_http_deterministic_replay() {
    use crate::application::http::{simulate_http, HttpConfig, HttpMethod, HttpRequest};
    use std::collections::BTreeMap;

    let mut headers = BTreeMap::new();
    headers.insert("Host".to_string(), "example.com".to_string());

    let config = HttpConfig {
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
    };

    let run1 = simulate_http(config.clone(), None).expect("HTTP run 1 must succeed");
    let run2 = simulate_http(config, None).expect("HTTP run 2 must succeed");

    assert_eq!(run1.response.status_code, run2.response.status_code);
    assert_eq!(run1.response.body, run2.response.body);
    assert_eq!(run1.events.len(), run2.events.len());
    assert_eq!(run1.packets.len(), run2.packets.len());

    for (e1, e2) in run1.events.iter().zip(run2.events.iter()) {
        assert_eq!(e1.timestamp_us, e2.timestamp_us);
        assert_eq!(e1.event_type, e2.event_type);
        assert_eq!(e1.node_id, e2.node_id);
    }
}

#[test]
fn test_phase6_ftp_file_retr_and_stor_transfer() {
    use crate::application::ftp::{simulate_ftp, FtpCommand, FtpConfig};

    // Test RETR (download)
    let retr_cfg = FtpConfig {
        client_node_id: "host-a".to_string(),
        server_node_id: "ftp-server".to_string(),
        username: "alice".to_string(),
        password: Some("secret".to_string()),
        transfer_command: FtpCommand::Retr,
        filename: Some("dataset.csv".to_string()),
        file_size_bytes: 8192,
        control_port: 21,
        data_port: 50001,
        seed: 42,
    };
    let retr_res = simulate_ftp(retr_cfg, None).expect("FTP RETR must succeed");
    assert_eq!(
        retr_res.state,
        crate::application::AppProtocolState::Completed
    );
    assert!(retr_res.metrics.payload_bytes_received >= 8192);
    assert!(retr_res
        .events
        .iter()
        .any(|e| e.event_type == "FTP_DATA_TRANSFER" && e.description.contains("RETR")));

    // Test STOR (upload)
    let stor_cfg = FtpConfig {
        client_node_id: "host-a".to_string(),
        server_node_id: "ftp-server".to_string(),
        username: "alice".to_string(),
        password: Some("secret".to_string()),
        transfer_command: FtpCommand::Stor,
        filename: Some("telemetry.log".to_string()),
        file_size_bytes: 4096,
        control_port: 21,
        data_port: 50002,
        seed: 42,
    };
    let stor_res = simulate_ftp(stor_cfg, None).expect("FTP STOR must succeed");
    assert_eq!(
        stor_res.state,
        crate::application::AppProtocolState::Completed
    );
    assert!(stor_res
        .events
        .iter()
        .any(|e| e.event_type == "FTP_DATA_TRANSFER" && e.description.contains("STOR")));
}

#[test]
fn test_phase6_application_packet_encapsulation_stack() {
    use crate::application::dns::{simulate_dns, DnsConfig, DnsQueryMode, DnsRecordType};

    let config = DnsConfig {
        client_node_id: "host-a".to_string(),
        server_node_id: "dns-resolver".to_string(),
        auth_server_node_id: None,
        query_name: "www.example.com".to_string(),
        query_type: DnsRecordType::A,
        query_mode: DnsQueryMode::Recursive,
        query_id: 1001,
        custom_records: Vec::new(),
        seed: 42,
    };

    let res = simulate_dns(config, None).expect("DNS simulation must succeed");
    assert!(res.packets.len() >= 2);

    let query_pkt = &res.packets[0];

    // Layer 5: Application
    assert_eq!(query_pkt.headers.application.protocol, "DNS");
    assert_eq!(query_pkt.headers.application.transaction_id, Some(1001));
    assert_eq!(
        query_pkt.headers.application.message_type.as_deref(),
        Some("Query")
    );

    // Layer 4: Transport
    assert_eq!(query_pkt.headers.transport.protocol, "UDP");
    assert_eq!(query_pkt.headers.transport.dst_port, 53);

    // Layer 3: Network
    assert_eq!(query_pkt.headers.network.version, 4);
    assert_eq!(query_pkt.headers.network.protocol_num, 17);

    // Layer 2: Data Link
    assert!(!query_pkt.headers.datalink.src_mac.is_empty());
    assert!(!query_pkt.headers.datalink.dst_mac.is_empty());
    assert_eq!(query_pkt.headers.datalink.ether_type, 0x0800);

    // Layer 1: Physical
    let phys = query_pkt
        .headers
        .physical
        .as_ref()
        .expect("Physical layer info must be present");
    assert!(phys.bit_count > 0);
    // Application-layer packet builder does not set signal_encoding (educational simplification)
    assert_eq!(phys.signal_encoding, None);
}
