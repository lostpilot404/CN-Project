use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};
use std::net::Ipv6Addr;
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ipv6Info {
    pub input: String,
    pub canonical_address: String,
    pub expanded_address: String,
    pub prefix_length: u8,
    pub scope: String,
    pub is_valid: bool,
    pub network_prefix: String,
    pub interface_identifier: String,
}

/// Formats IPv6 segments according to RFC 5952.
pub fn format_rfc5952_canonical(segs: &[u16; 8]) -> String {
    // Check for all-zeros
    if segs.iter().all(|&s| s == 0) {
        return "::".to_string();
    }

    // Find the longest run of consecutive zeros (length >= 2)
    let mut best_start = None;
    let mut best_len = 0;
    let mut curr_start = None;
    let mut curr_len = 0;

    for (i, &s) in segs.iter().enumerate() {
        if s == 0 {
            if curr_start.is_none() {
                curr_start = Some(i);
                curr_len = 1;
            } else {
                curr_len += 1;
            }
        } else {
            if let Some(start) = curr_start {
                if curr_len > best_len {
                    best_start = Some(start);
                    best_len = curr_len;
                }
                curr_start = None;
                curr_len = 0;
            }
        }
    }
    if let Some(start) = curr_start {
        if curr_len > best_len {
            best_start = Some(start);
            best_len = curr_len;
        }
    }

    // RFC 5952: Compression only applies if length >= 2
    if best_len >= 2 {
        let start = best_start.unwrap();
        let end = start + best_len;

        let left = segs[..start]
            .iter()
            .map(|s| format!("{:x}", s))
            .collect::<Vec<_>>()
            .join(":");
        let right = segs[end..]
            .iter()
            .map(|s| format!("{:x}", s))
            .collect::<Vec<_>>()
            .join(":");

        if start == 0 && end == 8 {
            "::".to_string()
        } else if start == 0 {
            format!("::{}", right)
        } else if end == 8 {
            format!("{}::", left)
        } else {
            format!("{}::{}", left, right)
        }
    } else {
        segs.iter()
            .map(|s| format!("{:x}", s))
            .collect::<Vec<_>>()
            .join(":")
    }
}

pub fn format_expanded(segs: &[u16; 8]) -> String {
    format!(
        "{:04x}:{:04x}:{:04x}:{:04x}:{:04x}:{:04x}:{:04x}:{:04x}",
        segs[0], segs[1], segs[2], segs[3], segs[4], segs[5], segs[6], segs[7]
    )
}

pub fn classify_ipv6_scope(segs: &[u16; 8]) -> String {
    if segs.iter().all(|&s| s == 0) {
        return "Unspecified (::/128)".to_string();
    }
    if segs[0..7].iter().all(|&s| s == 0) && segs[7] == 1 {
        return "Loopback (::1/128)".to_string();
    }
    if segs[0..5].iter().all(|&s| s == 0) && segs[5] == 0xffff {
        return "IPv4-Mapped (::ffff:0:0/96)".to_string();
    }
    if (segs[0] & 0xff00) == 0xff00 {
        return "Multicast (ff00::/8)".to_string();
    }
    if (segs[0] & 0xffc0) == 0xfe80 {
        return "Link-Local Unicast (fe80::/10)".to_string();
    }
    if (segs[0] & 0xfe00) == 0xfc00 {
        return "Unique Local Unicast (fc00::/7)".to_string();
    }
    if (segs[0] & 0xe000) == 0x2000 {
        return "Global Unicast (2000::/3)".to_string();
    }

    "Reserved / Special".to_string()
}

pub fn parse_and_validate_ipv6(input: &str) -> Result<Ipv6Info> {
    let trimmed = input.trim();
    let (ip_str, prefix_len) = if let Some((ip, prefix)) = trimmed.split_once('/') {
        let p: u8 = prefix.trim().parse().map_err(|_| {
            NetSimError::InvalidConfiguration(format!("Invalid IPv6 prefix length: '{}'", prefix))
        })?;
        if p > 128 {
            return Err(NetSimError::InvalidConfiguration(
                "IPv6 prefix length cannot exceed 128".to_string(),
            ));
        }
        (ip.trim(), p)
    } else {
        (trimmed, 64) // Default /64 SLAAC standard
    };

    let addr = Ipv6Addr::from_str(ip_str).map_err(|_| {
        NetSimError::InvalidConfiguration(format!("Invalid IPv6 address: '{}'", ip_str))
    })?;

    let segs = addr.segments();
    let canonical = format_rfc5952_canonical(&segs);
    let expanded = format_expanded(&segs);
    let scope = classify_ipv6_scope(&segs);

    // Compute network prefix and interface identifier strings
    // Standard /64 splits first 4 hextets as network prefix and last 4 as IID
    let prefix_segs = &segs[0..4];
    let iid_segs = &segs[4..8];

    let network_prefix = format!(
        "{:04x}:{:04x}:{:04x}:{:04x}::/64",
        prefix_segs[0], prefix_segs[1], prefix_segs[2], prefix_segs[3]
    );

    let interface_identifier = format!(
        "{:04x}:{:04x}:{:04x}:{:04x}",
        iid_segs[0], iid_segs[1], iid_segs[2], iid_segs[3]
    );

    Ok(Ipv6Info {
        input: input.to_string(),
        canonical_address: canonical,
        expanded_address: expanded,
        prefix_length: prefix_len,
        scope,
        is_valid: true,
        network_prefix,
        interface_identifier,
    })
}
