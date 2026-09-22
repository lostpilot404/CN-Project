use super::ipv4::{
    calculate_subnet, parse_cidr_or_ip_mask, prefix_to_mask, u32_to_ipv4_string, Ipv4SubnetInfo,
};
use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VlsmSubnetRequirement {
    pub name: String,
    pub needed_hosts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VlsmAllocatedSubnet {
    pub name: String,
    pub needed_hosts: u64,
    pub allocated_prefix: u8,
    pub subnet_info: Ipv4SubnetInfo,
    pub wasted_hosts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VlsmAllocationResult {
    pub base_cidr: String,
    pub base_network: String,
    pub base_prefix: u8,
    pub total_base_hosts: u64,
    pub total_needed_hosts: u64,
    pub total_allocated_hosts: u64,
    pub total_wasted_hosts: u64,
    pub utilization_percent: f64,
    pub subnets: Vec<VlsmAllocatedSubnet>,
    pub free_address_space: Vec<String>,
}

/// Computes a true VLSM (Variable Length Subnet Mask) allocation.
///
/// Features:
/// - Sorts requirements descending by needed host capacity.
/// - Computes minimal power-of-two block size (2^h - 2 >= needed_hosts).
/// - Aligns subnets to natural power-of-two boundaries.
/// - Calculates wasted host count and utilization percentage.
/// - Validates that requested subnets do not exceed base address space.
pub fn allocate_vlsm(
    base_cidr: &str,
    mut requirements: Vec<VlsmSubnetRequirement>,
) -> Result<VlsmAllocationResult> {
    if requirements.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "At least one subnet requirement is required for VLSM allocation".to_string(),
        ));
    }

    let (base_ip, base_prefix) = parse_cidr_or_ip_mask(base_cidr)?;
    let base_mask = prefix_to_mask(base_prefix);
    let base_network_u32 = base_ip & base_mask;
    let total_base_capacity = if base_prefix == 0 {
        4_294_967_296u64
    } else {
        1u64 << (32 - base_prefix)
    };
    let base_broadcast_u32 = base_network_u32 + ((total_base_capacity - 1) as u32);

    // Sort requirements descending by needed hosts (standard VLSM rule)
    requirements.sort_by_key(|a| std::cmp::Reverse(a.needed_hosts));

    let mut allocated_subnets = Vec::new();
    let mut current_ptr: u64 = base_network_u32 as u64;
    let mut total_needed = 0u64;
    let mut total_allocated = 0u64;
    let mut total_wasted = 0u64;

    for req in &requirements {
        total_needed = total_needed.saturating_add(req.needed_hosts);

        // Find minimal host bits h such that 2^h - 2 >= needed_hosts
        // Minimum subnet size is /30 (4 addresses, 2 usable)
        let mut h: u8 = 2;
        while h < 32 {
            let usable = (1u64 << h).saturating_sub(2);
            if usable >= req.needed_hosts {
                break;
            }
            h += 1;
        }

        if h > (32 - base_prefix) {
            return Err(NetSimError::InvalidConfiguration(format!(
                "Requirement '{}' requires {} hosts (prefix /{}), which exceeds base prefix /{}",
                req.name,
                req.needed_hosts,
                32 - h,
                base_prefix
            )));
        }

        let prefix = 32 - h;
        let block_size = 1u64 << h;

        // Align current_ptr to block_size boundary
        let remainder = current_ptr % block_size;
        if remainder != 0 {
            current_ptr += block_size - remainder;
        }

        let subnet_network_u32 = current_ptr as u32;
        let subnet_end = current_ptr + block_size - 1;

        if subnet_end > (base_broadcast_u32 as u64) {
            return Err(NetSimError::InvalidConfiguration(format!(
                "Address space exhausted! Cannot allocate {} hosts for '{}' within {}",
                req.needed_hosts, req.name, base_cidr
            )));
        }

        let cidr_str = format!("{}/{}", u32_to_ipv4_string(subnet_network_u32), prefix);
        let info = calculate_subnet(&cidr_str)?;
        let wasted = info.usable_hosts.saturating_sub(req.needed_hosts);

        total_allocated = total_allocated.saturating_add(info.usable_hosts);
        total_wasted = total_wasted.saturating_add(wasted);

        allocated_subnets.push(VlsmAllocatedSubnet {
            name: req.name.clone(),
            needed_hosts: req.needed_hosts,
            allocated_prefix: prefix,
            subnet_info: info,
            wasted_hosts: wasted,
        });

        current_ptr += block_size;
    }

    let mut free_ranges = Vec::new();
    if current_ptr <= (base_broadcast_u32 as u64) {
        let free_start = current_ptr as u32;
        let free_end = base_broadcast_u32;
        free_ranges.push(format!(
            "{} - {} ({} addresses available)",
            u32_to_ipv4_string(free_start),
            u32_to_ipv4_string(free_end),
            (free_end as u64 - free_start as u64 + 1)
        ));
    }

    let utilization = if total_base_capacity > 0 {
        ((total_allocated as f64) / (total_base_capacity as f64)) * 100.0
    } else {
        0.0
    };

    Ok(VlsmAllocationResult {
        base_cidr: base_cidr.to_string(),
        base_network: u32_to_ipv4_string(base_network_u32),
        base_prefix,
        total_base_hosts: total_base_capacity,
        total_needed_hosts: total_needed,
        total_allocated_hosts: total_allocated,
        total_wasted_hosts: total_wasted,
        utilization_percent: (utilization * 100.0).round() / 100.0,
        subnets: allocated_subnets,
        free_address_space: free_ranges,
    })
}
