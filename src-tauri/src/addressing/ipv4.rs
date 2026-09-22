use crate::domain::Project;
use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::Ipv4Addr;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ipv4SubnetInfo {
    pub input: String,
    pub ip_address: String,
    pub prefix_length: u8,
    pub subnet_mask: String,
    pub wildcard_mask: String,
    pub network_address: String,
    pub broadcast_address: String,
    pub first_usable_ip: String,
    pub last_usable_ip: String,
    pub total_hosts: u64,
    pub usable_hosts: u64,
    pub ip_binary: String,
    pub mask_binary: String,
    pub ip_class: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubnetSplitResult {
    pub base_cidr: String,
    pub original_prefix: u8,
    pub new_prefix: u8,
    pub subnets_count: usize,
    pub subnets: Vec<Ipv4SubnetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateIpConflict {
    pub ip: String,
    pub occurrences: Vec<DuplicateIpOccurrence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateIpOccurrence {
    pub node_id: String,
    pub node_label: String,
    pub interface_id: String,
    pub interface_name: String,
}

pub fn u32_to_ipv4_string(val: u32) -> String {
    format!(
        "{}.{}.{}.{}",
        (val >> 24) & 0xff,
        (val >> 16) & 0xff,
        (val >> 8) & 0xff,
        val & 0xff
    )
}

pub fn u32_to_binary_dotted(val: u32) -> String {
    format!(
        "{:08b}.{:08b}.{:08b}.{:08b}",
        (val >> 24) & 0xff,
        (val >> 16) & 0xff,
        (val >> 8) & 0xff,
        val & 0xff
    )
}

pub fn prefix_to_mask(prefix: u8) -> u32 {
    if prefix == 0 {
        0
    } else if prefix >= 32 {
        u32::MAX
    } else {
        !0u32 << (32 - prefix)
    }
}

pub fn mask_to_prefix(mask: u32) -> Option<u8> {
    let mut p = 0u8;
    let mut seen_zero = false;
    for i in (0..32).rev() {
        let bit = (mask >> i) & 1;
        if bit == 1 {
            if seen_zero {
                return None; // Non-contiguous mask
            }
            p += 1;
        } else {
            seen_zero = true;
        }
    }
    Some(p)
}

pub fn parse_ipv4(s: &str) -> Result<u32> {
    let addr: Ipv4Addr = s
        .trim()
        .parse()
        .map_err(|_| NetSimError::InvalidConfiguration(format!("Invalid IPv4 address: '{}'", s)))?;
    Ok(u32::from(addr))
}

pub fn parse_cidr_or_ip_mask(s: &str) -> Result<(u32, u8)> {
    let s = s.trim();
    if let Some((ip_part, prefix_part)) = s.split_once('/') {
        let ip = parse_ipv4(ip_part)?;
        let prefix: u8 = prefix_part.trim().parse().map_err(|_| {
            NetSimError::InvalidConfiguration(format!("Invalid prefix length: '{}'", prefix_part))
        })?;
        if prefix > 32 {
            return Err(NetSimError::InvalidConfiguration(format!(
                "Prefix length {} must be between 0 and 32",
                prefix
            )));
        }
        Ok((ip, prefix))
    } else if let Some((ip_part, mask_part)) = s.split_once(' ') {
        let ip = parse_ipv4(ip_part)?;
        let mask = parse_ipv4(mask_part)?;
        let prefix = mask_to_prefix(mask).ok_or_else(|| {
            NetSimError::InvalidConfiguration(format!(
                "Non-contiguous subnet mask: '{}'",
                mask_part
            ))
        })?;
        Ok((ip, prefix))
    } else {
        // Default to /32 if no prefix/mask provided
        let ip = parse_ipv4(s)?;
        Ok((ip, 32))
    }
}

pub fn classify_ip(ip_u32: u32) -> (String, String) {
    let first_octet = (ip_u32 >> 24) & 0xff;

    let class = if first_octet < 128 {
        "Class A"
    } else if first_octet < 192 {
        "Class B"
    } else if first_octet < 224 {
        "Class C"
    } else if first_octet < 240 {
        "Class D (Multicast)"
    } else {
        "Class E (Experimental)"
    }
    .to_string();

    let octet1 = first_octet;
    let octet2 = (ip_u32 >> 16) & 0xff;

    let scope = if octet1 == 127 {
        "Loopback (127.0.0.0/8)"
    } else if octet1 == 10 {
        "Private (RFC 1918 10.0.0.0/8)"
    } else if octet1 == 172 && (16..=31).contains(&octet2) {
        "Private (RFC 1918 172.16.0.0/12)"
    } else if octet1 == 192 && octet2 == 168 {
        "Private (RFC 1918 192.168.0.0/16)"
    } else if octet1 == 169 && octet2 == 254 {
        "Link-Local (169.254.0.0/16)"
    } else if (224..=239).contains(&octet1) {
        "Multicast (224.0.0.0/4)"
    } else if ip_u32 == u32::MAX {
        "Limited Broadcast (255.255.255.255)"
    } else if ip_u32 == 0 {
        "Current Network / Default Route (0.0.0.0)"
    } else {
        "Public Internet"
    }
    .to_string();

    (class, scope)
}

pub fn calculate_subnet(input: &str) -> Result<Ipv4SubnetInfo> {
    let (ip_u32, prefix) = parse_cidr_or_ip_mask(input)?;
    let mask = prefix_to_mask(prefix);
    let wildcard = !mask;
    let network = ip_u32 & mask;
    let broadcast = ip_u32 | wildcard;

    let total_hosts = if prefix == 0 {
        4_294_967_296u64
    } else {
        1u64 << (32 - prefix)
    };

    let (usable_hosts, first_usable, last_usable) = match prefix {
        32 => (1u64, network, network),
        31 => (2u64, network, broadcast), // RFC 3021
        0 => (
            total_hosts.saturating_sub(2),
            network.saturating_add(1),
            broadcast.saturating_sub(1),
        ),
        _ => (
            total_hosts.saturating_sub(2),
            network.saturating_add(1),
            broadcast.saturating_sub(1),
        ),
    };

    let (ip_class, scope) = classify_ip(ip_u32);

    Ok(Ipv4SubnetInfo {
        input: input.to_string(),
        ip_address: u32_to_ipv4_string(ip_u32),
        prefix_length: prefix,
        subnet_mask: u32_to_ipv4_string(mask),
        wildcard_mask: u32_to_ipv4_string(wildcard),
        network_address: u32_to_ipv4_string(network),
        broadcast_address: u32_to_ipv4_string(broadcast),
        first_usable_ip: u32_to_ipv4_string(first_usable),
        last_usable_ip: u32_to_ipv4_string(last_usable),
        total_hosts,
        usable_hosts,
        ip_binary: u32_to_binary_dotted(ip_u32),
        mask_binary: u32_to_binary_dotted(mask),
        ip_class,
        scope,
    })
}

/// Splits a base CIDR block into equal-prefix subnets.
/// Distinct from true VLSM (see vlsm.rs).
pub fn split_equal_subnets(base_cidr: &str, new_prefix: u8) -> Result<SubnetSplitResult> {
    let (base_ip, orig_prefix) = parse_cidr_or_ip_mask(base_cidr)?;

    if new_prefix <= orig_prefix {
        return Err(NetSimError::InvalidConfiguration(format!(
            "New prefix /{} must be greater than original prefix /{}",
            new_prefix, orig_prefix
        )));
    }
    if new_prefix > 32 {
        return Err(NetSimError::InvalidConfiguration(
            "Prefix cannot exceed 32".to_string(),
        ));
    }

    let orig_mask = prefix_to_mask(orig_prefix);
    let base_network = base_ip & orig_mask;

    let delta_bits = new_prefix - orig_prefix;
    let num_subnets = 1usize << delta_bits;
    let subnet_size = 1u64 << (32 - new_prefix);

    let mut subnets = Vec::with_capacity(num_subnets);
    for i in 0..num_subnets {
        let sub_net_u32 = base_network + ((i as u64 * subnet_size) as u32);
        let cidr_str = format!("{}/{}", u32_to_ipv4_string(sub_net_u32), new_prefix);
        let info = calculate_subnet(&cidr_str)?;
        subnets.push(info);
    }

    Ok(SubnetSplitResult {
        base_cidr: base_cidr.to_string(),
        original_prefix: orig_prefix,
        new_prefix,
        subnets_count: num_subnets,
        subnets,
    })
}

/// Scans the entire project topology and detects any duplicate IPv4 addresses across all interfaces.
pub fn detect_duplicate_ips(project: &Project) -> Vec<DuplicateIpConflict> {
    let mut ip_map: HashMap<String, Vec<DuplicateIpOccurrence>> = HashMap::new();

    for node in &project.nodes {
        for iface in &node.interfaces {
            if let Some(ref ip) = iface.ipv4 {
                let trimmed = ip.trim();
                if !trimmed.is_empty() && trimmed != "0.0.0.0" {
                    // Normalize: strip CIDR prefix if included in interface ip string
                    let clean_ip = trimmed.split('/').next().unwrap_or(trimmed).to_string();
                    ip_map
                        .entry(clean_ip)
                        .or_default()
                        .push(DuplicateIpOccurrence {
                            node_id: node.id.clone(),
                            node_label: node.label.clone(),
                            interface_id: iface.id.clone(),
                            interface_name: iface.name.clone(),
                        });
                }
            }
        }
    }

    let mut conflicts = Vec::new();
    for (ip, occurrences) in ip_map {
        if occurrences.len() > 1 {
            conflicts.push(DuplicateIpConflict { ip, occurrences });
        }
    }
    conflicts.sort_by(|a, b| a.ip.cmp(&b.ip));
    conflicts
}
