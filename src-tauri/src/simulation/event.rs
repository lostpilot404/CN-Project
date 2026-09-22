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
