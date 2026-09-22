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
