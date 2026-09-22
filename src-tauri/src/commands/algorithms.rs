use crate::addressing::{
    allocate_vlsm, calculate_subnet, detect_duplicate_ips, parse_and_validate_ipv6,
    split_equal_subnets, DuplicateIpConflict, Ipv4SubnetInfo, Ipv6Info, NatProtocol, NatTable,
    NatTranslationResult, SubnetSplitResult, VlsmAllocationResult, VlsmSubnetRequirement,
};
use crate::error::{NetSimError, Result};
use crate::routing::{
    compute_bellman_ford_shortest_paths, compute_dijkstra_shortest_paths,
    simulate_distance_vector_convergence, ConvergenceTelemetry, MetricType, RoutingAlgorithm,
    RoutingGraph, RoutingTable,
};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecksumResult {
    pub input_hex: String,
    pub checksum_hex: String,
    pub is_valid: bool,
}

#[tauri::command]
pub fn calculate_simple_checksum(words: Vec<u16>) -> Result<ChecksumResult> {
    let mut sum: u32 = 0;
    for word in &words {
        sum += *word as u32;
    }
    while (sum >> 16) > 0 {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    let checksum = (!sum) as u16;

    Ok(ChecksumResult {
        input_hex: words
            .iter()
            .map(|w| format!("{:04X}", w))
            .collect::<Vec<_>>()
            .join(" "),
        checksum_hex: format!("{:04X}", checksum),
        is_valid: true,
    })
}

#[tauri::command]
pub fn calculate_routing_table(
    node_id: String,
    algorithm: RoutingAlgorithm,
    metric_type: MetricType,
    state: State<'_, AppState>,
) -> Result<RoutingTable> {
    let project = state
        .project
        .lock()
        .map_err(|e| NetSimError::Internal(format!("Project lock error: {}", e)))?;

    let graph = RoutingGraph::from_project(&project, metric_type);

    match algorithm {
        RoutingAlgorithm::Dijkstra => compute_dijkstra_shortest_paths(&graph, &node_id),
        RoutingAlgorithm::BellmanFord => compute_bellman_ford_shortest_paths(&graph, &node_id),
    }
}

#[tauri::command]
pub fn simulate_routing_convergence(
    source_node_id: String,
    metric_type: MetricType,
    state: State<'_, AppState>,
) -> Result<ConvergenceTelemetry> {
    let project = state
        .project
        .lock()
        .map_err(|e| NetSimError::Internal(format!("Project lock error: {}", e)))?;

    let graph = RoutingGraph::from_project(&project, metric_type);
    simulate_distance_vector_convergence(&graph, &source_node_id)
}

#[tauri::command]
pub fn calculate_ipv4_subnet(input: String) -> Result<Ipv4SubnetInfo> {
    calculate_subnet(&input)
}

#[tauri::command]
pub fn split_ipv4_subnet(base_cidr: String, new_prefix: u8) -> Result<SubnetSplitResult> {
    split_equal_subnets(&base_cidr, new_prefix)
}

#[tauri::command]
pub fn allocate_vlsm_subnets(
    base_cidr: String,
    requirements: Vec<VlsmSubnetRequirement>,
) -> Result<VlsmAllocationResult> {
    allocate_vlsm(&base_cidr, requirements)
}

#[tauri::command]
pub fn detect_duplicate_ips_command(
    state: State<'_, AppState>,
) -> Result<Vec<DuplicateIpConflict>> {
    let project = state
        .project
        .lock()
        .map_err(|e| NetSimError::Internal(format!("Project lock error: {}", e)))?;

    Ok(detect_duplicate_ips(&project))
}

#[tauri::command]
pub fn validate_ipv6_address(input: String) -> Result<Ipv6Info> {
    parse_and_validate_ipv6(&input)
}

#[tauri::command]
pub fn get_or_create_nat_table(
    router_node_id: String,
    public_ip: String,
    state: State<'_, AppState>,
) -> Result<NatTable> {
    let mut nat_tables = state
        .nat_tables
        .lock()
        .map_err(|e| NetSimError::Internal(format!("NAT tables lock error: {}", e)))?;

    let table = nat_tables
        .entry(router_node_id.clone())
        .or_insert_with(|| NatTable::new(&router_node_id, &public_ip));

    // Update public IP if router changed
    if !public_ip.is_empty() && table.public_ip != public_ip {
        table.public_ip = public_ip;
    }

    Ok(table.clone())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn add_static_dnat_rule(
    router_node_id: String,
    public_ip: String,
    protocol: NatProtocol,
    public_port: u16,
    private_ip: String,
    private_port: u16,
    description: String,
    state: State<'_, AppState>,
) -> Result<NatTable> {
    let mut nat_tables = state
        .nat_tables
        .lock()
        .map_err(|e| NetSimError::Internal(format!("NAT tables lock error: {}", e)))?;

    let table = nat_tables
        .entry(router_node_id.clone())
        .or_insert_with(|| NatTable::new(&router_node_id, &public_ip));

    table.add_static_dnat_rule(
        protocol,
        public_port,
        &private_ip,
        private_port,
        &description,
    )?;

    Ok(table.clone())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn simulate_nat_outbound(
    router_node_id: String,
    public_ip: String,
    src_ip: String,
    src_port: u16,
    dst_ip: String,
    dst_port: u16,
    protocol: NatProtocol,
    state: State<'_, AppState>,
) -> Result<NatTranslationResult> {
    let current_time_us = {
        let sim = state
            .simulation
            .lock()
            .map_err(|e| NetSimError::Internal(format!("Simulation lock error: {}", e)))?;
        sim.current_time().as_micros()
    };

    let mut nat_tables = state
        .nat_tables
        .lock()
        .map_err(|e| NetSimError::Internal(format!("NAT tables lock error: {}", e)))?;

    let table = nat_tables
        .entry(router_node_id.clone())
        .or_insert_with(|| NatTable::new(&router_node_id, &public_ip));

    table.translate_outbound(
        &src_ip,
        src_port,
        &dst_ip,
        dst_port,
        protocol,
        current_time_us,
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn simulate_nat_inbound(
    router_node_id: String,
    public_ip: String,
    src_ip: String,
    src_port: u16,
    dst_ip: String,
    dst_port: u16,
    protocol: NatProtocol,
    state: State<'_, AppState>,
) -> Result<NatTranslationResult> {
    let current_time_us = {
        let sim = state
            .simulation
            .lock()
            .map_err(|e| NetSimError::Internal(format!("Simulation lock error: {}", e)))?;
        sim.current_time().as_micros()
    };

    let mut nat_tables = state
        .nat_tables
        .lock()
        .map_err(|e| NetSimError::Internal(format!("NAT tables lock error: {}", e)))?;

    let table = nat_tables
        .entry(router_node_id.clone())
        .or_insert_with(|| NatTable::new(&router_node_id, &public_ip));

    table.translate_inbound(
        &src_ip,
        src_port,
        &dst_ip,
        dst_port,
        protocol,
        current_time_us,
    )
}

// =========================================================================
// Phase 4B: Data Link Error Detection & Correction Commands
// =========================================================================

use crate::datalink::{
    calculate_crc as calc_crc, calculate_internet_checksum as calc_checksum,
    encode_hamming as enc_hamming, parse_hex_to_16bit_words,
    verify_and_correct_hamming as ver_hamming, verify_crc as ver_crc,
    verify_internet_checksum as ver_checksum, ChecksumCalculationResult, ChecksumVerifyResult,
    CrcCalculationResult, CrcVerifyResult, HammingEncodeResult, HammingVerifyResult, ParityMode,
};

#[tauri::command]
pub fn calculate_hamming_encode(
    data_bits: String,
    parity_mode: ParityMode,
) -> Result<HammingEncodeResult> {
    enc_hamming(&data_bits, parity_mode)
}

#[tauri::command]
pub fn verify_and_correct_hamming(
    codeword: String,
    parity_mode: ParityMode,
) -> Result<HammingVerifyResult> {
    ver_hamming(&codeword, parity_mode)
}

#[tauri::command]
pub fn calculate_crc(
    data_bits: String,
    polynomial: String,
    poly_name: Option<String>,
) -> Result<CrcCalculationResult> {
    calc_crc(&data_bits, &polynomial, poly_name.as_deref())
}

#[tauri::command]
pub fn verify_crc(
    codeword: String,
    polynomial: String,
    poly_name: Option<String>,
) -> Result<CrcVerifyResult> {
    ver_crc(&codeword, &polynomial, poly_name.as_deref())
}

#[tauri::command]
pub fn calculate_internet_checksum(input_hex: String) -> Result<ChecksumCalculationResult> {
    let words = parse_hex_to_16bit_words(&input_hex)?;
    calc_checksum(&words)
}

#[tauri::command]
pub fn verify_internet_checksum(
    payload_hex: String,
    checksum_hex: String,
) -> Result<ChecksumVerifyResult> {
    let payload_words = parse_hex_to_16bit_words(&payload_hex)?;
    let clean_csum = checksum_hex.trim().trim_start_matches("0x");
    let checksum = u16::from_str_radix(clean_csum, 16)
        .map_err(|e| NetSimError::InvalidConfiguration(format!("Invalid checksum hex: {}", e)))?;
    ver_checksum(&payload_words, checksum)
}
