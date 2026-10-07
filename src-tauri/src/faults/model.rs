use serde::{Deserialize, Serialize};

/// Fault types that can be injected into the simulation at a specific SimTime.
///
/// Every fault is enqueued as a `SimEventType::FaultInjected` event and
/// executed by the SimulationEngine when it processes that event, ensuring
/// deterministic (SimTime, event_id) ordering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FaultType {
    /// Set a link to Down status. Routing excludes it; future packets are dropped.
    LinkDown { link_id: String },

    /// Restore a link to Up status. Routing can use it again.
    LinkRestore { link_id: String },

    /// Change a link's bandwidth. Only affects FUTURE transmission scheduling.
    BandwidthDegradation {
        link_id: String,
        new_bandwidth_bps: u64,
    },

    /// Change a link queue's capacity. Preserves already-enqueued packets.
    QueueCapacityChange {
        link_id: String,
        new_capacity: usize,
    },

    /// Disable a node. All connected links are saved and set to Down.
    NodeFailure { node_id: String },

    /// Recover a node. Connected links are restored to their pre-failure state.
    NodeRecovery { node_id: String },

    /// Drop a specific packet if it is still eligible (in-transit/queued).
    PacketDrop { packet_id: String },

    /// Change a link's bit error rate. Deterministic RNG controls corruption.
    BitError { link_id: String, error_rate: f64 },
}

/// A single scheduled fault entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaultScheduleEntry {
    pub fault_id: String,
    /// SimTime in microseconds when this fault should be applied.
    pub timestamp_us: u64,
    pub fault_type: FaultType,
    pub description: String,
}

/// A schedule of faults to inject, ordered by SimTime.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FaultSchedule {
    pub entries: Vec<FaultScheduleEntry>,
}

impl FaultSchedule {
    /// Return entries sorted by timestamp for deterministic execution order.
    pub fn sorted_entries(&self) -> Vec<FaultScheduleEntry> {
        let mut sorted = self.entries.clone();
        sorted.sort_by_key(|e| e.timestamp_us);
        sorted
    }
}

/// Result of applying a fault, including routing consequences.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaultResult {
    pub fault_id: String,
    pub timestamp_us: u64,
    pub applied: bool,
    pub description: String,
    pub route_change: Option<RouteChangeRecord>,
    pub error_message: Option<String>,
}

/// Records how a route changed as a consequence of a fault.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteChangeRecord {
    pub source_node_id: String,
    pub destination_node_id: String,
    pub before_path: Option<Vec<String>>,
    pub after_path: Option<Vec<String>>,
    pub reachable_before: bool,
    pub reachable_after: bool,
    pub affected_links: Vec<String>,
    pub fault_id: String,
    pub timestamp_us: u64,
}

/// Returns the target_id string for a FaultType, used in SimEventType::FaultInjected.
pub fn fault_target_id(ft: &FaultType) -> String {
    match ft {
        FaultType::LinkDown { link_id } => link_id.clone(),
        FaultType::LinkRestore { link_id } => link_id.clone(),
        FaultType::BandwidthDegradation { link_id, .. } => link_id.clone(),
        FaultType::QueueCapacityChange { link_id, .. } => link_id.clone(),
        FaultType::NodeFailure { node_id } => node_id.clone(),
        FaultType::NodeRecovery { node_id } => node_id.clone(),
        FaultType::PacketDrop { packet_id } => packet_id.clone(),
        FaultType::BitError { link_id, .. } => link_id.clone(),
    }
}

/// Returns a descriptive fault_type string for SimEventType::FaultInjected.
pub fn fault_type_label(ft: &FaultType) -> String {
    match ft {
        FaultType::LinkDown { .. } => "link_down".to_string(),
        FaultType::LinkRestore { .. } => "link_restore".to_string(),
        FaultType::BandwidthDegradation {
            new_bandwidth_bps, ..
        } => {
            format!("bandwidth_degradation:{}", new_bandwidth_bps)
        }
        FaultType::QueueCapacityChange { new_capacity, .. } => {
            format!("queue_capacity_change:{}", new_capacity)
        }
        FaultType::NodeFailure { .. } => "node_failure".to_string(),
        FaultType::NodeRecovery { .. } => "node_recovery".to_string(),
        FaultType::PacketDrop { .. } => "packet_drop".to_string(),
        FaultType::BitError { error_rate, .. } => format!("bit_error:{:.6}", error_rate),
    }
}
