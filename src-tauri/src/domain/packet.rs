use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PacketState {
    Created,
    Queued,
    Transmitting,
    InFlight,
    Delivered,
    DroppedQueueFull,
    DroppedBitError,
    DroppedLinkDown,
    DroppedTtlExpired,
    Retransmitted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppHeader {
    pub protocol: String, // "HTTP", "DNS", "FTP", "SMTP", "SNMP", "RAW"
    pub payload_preview: String,
    #[serde(default)]
    pub message_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportHeader {
    pub protocol: String, // "TCP", "UDP"
    pub src_port: u16,
    pub dst_port: u16,
    pub seq_num: Option<u32>,
    pub ack_num: Option<u32>,
    pub window_size: Option<u16>,
    pub flags: Vec<String>, // ["SYN"], ["ACK"], etc.
    #[serde(default)]
    pub payload_length: Option<usize>,
    #[serde(default)]
    pub is_retransmission: Option<bool>,
    #[serde(default)]
    pub connection_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkHeader {
    pub version: u8, // 4 or 6
    pub src_ip: String,
    pub dst_ip: String,
    pub ttl: u8,
    pub protocol_num: u8,
    pub checksum: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataLinkHeader {
    pub src_mac: String,
    pub dst_mac: String,
    pub ether_type: u16,
    pub crc_fcs: u32,
    #[serde(default)]
    pub frame_type: Option<String>,
    #[serde(default)]
    pub fcs_valid: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicalLayerInfo {
    pub link_id: Option<String>,
    pub bandwidth_bps: Option<u64>,
    pub propagation_delay_us: Option<u64>,
    pub tx_start_us: Option<u64>,
    pub tx_finish_us: Option<u64>,
    pub bit_count: usize,
    #[serde(default)]
    pub preamble_bits: Option<String>,
    #[serde(default)]
    pub signal_encoding: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncapsulationStack {
    pub application: AppHeader,
    pub transport: TransportHeader,
    pub network: NetworkHeader,
    pub datalink: DataLinkHeader,
    #[serde(default)]
    pub physical: Option<PhysicalLayerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketHopRecord {
    pub hop_index: usize,
    pub node_id: String,
    pub link_id: Option<String>,
    pub timestamp_us: u64,
    pub state: PacketState,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Packet {
    pub id: String,
    pub src_node_id: String,
    pub dst_node_id: String,
    pub size_bytes: usize,
    pub created_at_us: u64,
    pub current_node_id: String,
    pub next_hop_node_id: Option<String>,
    pub state: PacketState,
    pub headers: EncapsulationStack,
    pub journey_hops: Vec<String>,
    #[serde(default)]
    pub planned_route: Vec<String>,
    #[serde(default)]
    pub hop_history: Vec<PacketHopRecord>,
}
