use super::clock::SimTime;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SimEventType {
    PacketCreated {
        packet_id: String,
        node_id: String,
        size_bytes: usize,
    },
    QueueEntered {
        packet_id: String,
        link_id: String,
        queue_occupancy: usize,
        queue_capacity: usize,
    },
    TransmissionStarted {
        packet_id: String,
        link_id: String,
        tx_delay_us: u64,
    },
    TransmissionFinished {
        packet_id: String,
        link_id: String,
    },
    PacketArrived {
        packet_id: String,
        node_id: String,
        link_id: String,
    },
    PacketDropped {
        packet_id: String,
        reason: String,
        location_id: String,
    },
    AckReceived {
        packet_id: String,
        ack_num: u32,
        rtt_us: u64,
    },
    Timeout {
        packet_id: String,
        seq_num: u32,
    },
    Retransmission {
        packet_id: String,
        seq_num: u32,
        attempt: u32,
    },
    RouteUpdated {
        node_id: String,
        algorithm: String,
    },
    FaultInjected {
        target_id: String,
        fault_type: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimEvent {
    pub id: u64,
    pub timestamp: SimTime,
    pub event_type: SimEventType,
    pub description: String,
    #[serde(default)]
    pub packet_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub link_id: Option<String>,
    #[serde(default)]
    pub layer: Option<String>,
    #[serde(default)]
    pub protocol: Option<String>,
}

impl SimEvent {
    pub fn new(id: u64, timestamp: SimTime, event_type: SimEventType, description: String) -> Self {
        let (packet_id, node_id, link_id, layer, protocol) = match &event_type {
            SimEventType::PacketCreated {
                packet_id, node_id, ..
            } => (
                Some(packet_id.clone()),
                Some(node_id.clone()),
                None,
                Some("Application".to_string()),
                Some("Application".to_string()),
            ),
            SimEventType::QueueEntered {
                packet_id, link_id, ..
            } => (
                Some(packet_id.clone()),
                None,
                Some(link_id.clone()),
                Some("Data Link".to_string()),
                Some("Ethernet".to_string()),
            ),
            SimEventType::TransmissionStarted {
                packet_id, link_id, ..
            } => (
                Some(packet_id.clone()),
                None,
                Some(link_id.clone()),
                Some("Physical".to_string()),
                Some("Bitstream".to_string()),
            ),
            SimEventType::TransmissionFinished { packet_id, link_id } => (
                Some(packet_id.clone()),
                None,
                Some(link_id.clone()),
                Some("Physical".to_string()),
                Some("Bitstream".to_string()),
            ),
            SimEventType::PacketArrived {
                packet_id,
                node_id,
                link_id,
            } => (
                Some(packet_id.clone()),
                Some(node_id.clone()),
                Some(link_id.clone()),
                Some("Network".to_string()),
                Some("IPv4".to_string()),
            ),
            SimEventType::PacketDropped {
                packet_id,
                location_id,
                ..
            } => (
                Some(packet_id.clone()),
                None,
                Some(location_id.clone()),
                Some("Network".to_string()),
                None,
            ),
            SimEventType::AckReceived { packet_id, .. } => (
                Some(packet_id.clone()),
                None,
                None,
                Some("Transport".to_string()),
                Some("TCP".to_string()),
            ),
            SimEventType::Timeout { packet_id, .. } => (
                Some(packet_id.clone()),
                None,
                None,
                Some("Transport".to_string()),
                Some("TCP".to_string()),
            ),
            SimEventType::Retransmission { packet_id, .. } => (
                Some(packet_id.clone()),
                None,
                None,
                Some("Transport".to_string()),
                Some("TCP".to_string()),
            ),
            SimEventType::RouteUpdated { node_id, .. } => (
                None,
                Some(node_id.clone()),
                None,
                Some("Network".to_string()),
                Some("Routing".to_string()),
            ),
            SimEventType::FaultInjected { target_id, .. } => (
                None,
                Some(target_id.clone()),
                None,
                Some("Physical".to_string()),
                None,
            ),
        };

        Self {
            id,
            timestamp,
            event_type,
            description,
            packet_id,
            node_id,
            link_id,
            layer,
            protocol,
        }
    }
}

impl PartialEq for SimEvent {
    fn eq(&self, other: &Self) -> bool {
        self.timestamp == other.timestamp && self.id == other.id
    }
}

impl Eq for SimEvent {}

impl Ord for SimEvent {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reverse ordering so BinaryHeap acts as a min-heap (earliest time first).
        // Tie-breaker: Lower monotonic ID has higher priority.
        other
            .timestamp
            .cmp(&self.timestamp)
            .then_with(|| other.id.cmp(&self.id))
    }
}

impl PartialOrd for SimEvent {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
