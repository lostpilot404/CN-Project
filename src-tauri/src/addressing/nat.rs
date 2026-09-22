use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum NatProtocol {
    Tcp,
    Udp,
    Icmp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NatMappingType {
    DynamicSnat,
    StaticDnat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatEntry {
    pub id: String,
    pub protocol: NatProtocol,
    pub private_ip: String,
    pub private_port: u16,
    pub public_ip: String,
    pub public_port: u16,
    pub mapping_type: NatMappingType,
    pub created_at_us: u64,
    pub last_used_at_us: u64,
    pub timeout_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticDnatRule {
    pub id: String,
    pub protocol: NatProtocol,
    pub public_port: u16,
    pub private_ip: String,
    pub private_port: u16,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatTranslationResult {
    pub original_src_ip: String,
    pub original_src_port: u16,
    pub original_dst_ip: String,
    pub original_dst_port: u16,
    pub translated_src_ip: String,
    pub translated_src_port: u16,
    pub translated_dst_ip: String,
    pub translated_dst_port: u16,
    pub entry: NatEntry,
    pub created_new_mapping: bool,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatTable {
    pub router_node_id: String,
    pub public_ip: String,
    pub port_range_start: u16,
    pub port_range_end: u16,
    pub next_dynamic_port: u16,
    pub entries: Vec<NatEntry>,
    pub static_rules: Vec<StaticDnatRule>,
    pub next_entry_id: u64,
}

impl NatTable {
    pub fn new(router_node_id: &str, public_ip: &str) -> Self {
        Self {
            router_node_id: router_node_id.to_string(),
            public_ip: public_ip.to_string(),
            port_range_start: 49152,
            port_range_end: 65535,
            next_dynamic_port: 49152,
            entries: Vec::new(),
            static_rules: Vec::new(),
            next_entry_id: 1,
        }
    }

    /// Adds a static port forwarding / DNAT rule.
    pub fn add_static_dnat_rule(
        &mut self,
        protocol: NatProtocol,
        public_port: u16,
        private_ip: &str,
        private_port: u16,
        description: &str,
    ) -> Result<()> {
        // Check for collision with existing static rules
        if self
            .static_rules
            .iter()
            .any(|r| r.protocol == protocol && r.public_port == public_port)
        {
            return Err(NetSimError::InvalidConfiguration(format!(
                "Static DNAT port collision: port {} already mapped for {:?}",
                public_port, protocol
            )));
        }

        let rule_id = format!("dnat-rule-{}", self.static_rules.len() + 1);
        self.static_rules.push(StaticDnatRule {
            id: rule_id,
            protocol,
            public_port,
            private_ip: private_ip.to_string(),
            private_port,
            description: description.to_string(),
        });

        Ok(())
    }

    /// Removes expired dynamic NAT entries based on the current simulation timestamp.
    pub fn expire_entries(&mut self, current_time_us: u64) {
        self.entries.retain(|e| {
            if e.mapping_type == NatMappingType::StaticDnat {
                true
            } else {
                current_time_us.saturating_sub(e.last_used_at_us) <= e.timeout_us
            }
        });
    }

    /// Finds a collision-free dynamic port in the range [port_range_start, port_range_end].
    fn allocate_dynamic_port(&mut self, protocol: NatProtocol) -> Result<u16> {
        let total_ports = (self.port_range_end - self.port_range_start + 1) as usize;

        for _ in 0..total_ports {
            let port = self.next_dynamic_port;

            // Advance sequential pointer with wrap-around
            if self.next_dynamic_port >= self.port_range_end {
                self.next_dynamic_port = self.port_range_start;
            } else {
                self.next_dynamic_port += 1;
            }

            // Check if port is in use by a static rule
            let collides_static = self
                .static_rules
                .iter()
                .any(|r| r.protocol == protocol && r.public_port == port);
            if collides_static {
                continue;
            }

            // Check if port is in use by an active dynamic entry
            let collides_dynamic = self
                .entries
                .iter()
                .any(|e| e.protocol == protocol && e.public_port == port);
            if collides_dynamic {
                continue;
            }

            return Ok(port);
        }

        Err(NetSimError::InvalidConfiguration(
            "NAT dynamic port pool exhausted (no available ports)".to_string(),
        ))
    }

    /// Translates an outbound packet (Private -> Public / SNAT).
    /// Rewrites Source IP and Source Port to the router's Public IP and allocated Public Port.
    pub fn translate_outbound(
        &mut self,
        src_ip: &str,
        src_port: u16,
        dst_ip: &str,
        dst_port: u16,
        protocol: NatProtocol,
        current_time_us: u64,
    ) -> Result<NatTranslationResult> {
        self.expire_entries(current_time_us);

        // Check for existing active mapping
        let existing_index = self.entries.iter().position(|e| {
            e.protocol == protocol && e.private_ip == src_ip && e.private_port == src_port
        });

        if let Some(idx) = existing_index {
            self.entries[idx].last_used_at_us = current_time_us;
            let entry = self.entries[idx].clone();

            return Ok(NatTranslationResult {
                original_src_ip: src_ip.to_string(),
                original_src_port: src_port,
                original_dst_ip: dst_ip.to_string(),
                original_dst_port: dst_port,
                translated_src_ip: entry.public_ip.clone(),
                translated_src_port: entry.public_port,
                translated_dst_ip: dst_ip.to_string(),
                translated_dst_port: dst_port,
                entry,
                created_new_mapping: false,
                direction: "outbound (SNAT)".to_string(),
            });
        }

        // Allocate a new collision-free dynamic port
        let public_port = self.allocate_dynamic_port(protocol)?;
        let timeout_us = match protocol {
            NatProtocol::Tcp => 7_200_000_000u64, // 2 hours in microseconds
            NatProtocol::Udp => 300_000_000u64,   // 5 minutes in microseconds
            NatProtocol::Icmp => 30_000_000u64,   // 30 seconds in microseconds
        };

        let entry_id = format!("nat-{}", self.next_entry_id);
        self.next_entry_id += 1;

        let entry = NatEntry {
            id: entry_id,
            protocol,
            private_ip: src_ip.to_string(),
            private_port: src_port,
            public_ip: self.public_ip.clone(),
            public_port,
            mapping_type: NatMappingType::DynamicSnat,
            created_at_us: current_time_us,
            last_used_at_us: current_time_us,
            timeout_us,
        };

        self.entries.push(entry.clone());

        Ok(NatTranslationResult {
            original_src_ip: src_ip.to_string(),
            original_src_port: src_port,
            original_dst_ip: dst_ip.to_string(),
            original_dst_port: dst_port,
            translated_src_ip: entry.public_ip.clone(),
            translated_src_port: entry.public_port,
            translated_dst_ip: dst_ip.to_string(),
            translated_dst_port: dst_port,
            entry,
            created_new_mapping: true,
            direction: "outbound (SNAT)".to_string(),
        })
    }

    /// Translates an inbound packet (Public -> Private / DNAT / Reverse NAPT).
    /// Rewrites Destination IP and Destination Port to the mapped Private IP and Private Port.
    pub fn translate_inbound(
        &mut self,
        src_ip: &str,
        src_port: u16,
        dst_ip: &str,
        dst_port: u16,
        protocol: NatProtocol,
        current_time_us: u64,
    ) -> Result<NatTranslationResult> {
        self.expire_entries(current_time_us);

        // 1. Check static DNAT rules first
        if let Some(rule) = self
            .static_rules
            .iter()
            .find(|r| r.protocol == protocol && r.public_port == dst_port)
            .cloned()
        {
            let entry = NatEntry {
                id: format!("static-{}", rule.id),
                protocol,
                private_ip: rule.private_ip.clone(),
                private_port: rule.private_port,
                public_ip: dst_ip.to_string(),
                public_port: dst_port,
                mapping_type: NatMappingType::StaticDnat,
                created_at_us: 0,
                last_used_at_us: current_time_us,
                timeout_us: u64::MAX,
            };

            return Ok(NatTranslationResult {
                original_src_ip: src_ip.to_string(),
                original_src_port: src_port,
                original_dst_ip: dst_ip.to_string(),
                original_dst_port: dst_port,
                translated_src_ip: src_ip.to_string(),
                translated_src_port: src_port,
                translated_dst_ip: rule.private_ip,
                translated_dst_port: rule.private_port,
                entry,
                created_new_mapping: false,
                direction: "inbound (Static DNAT)".to_string(),
            });
        }

        // 2. Check dynamic SNAT table for reverse match
        let existing_index = self.entries.iter().position(|e| {
            e.protocol == protocol
                && e.public_port == dst_port
                && (e.public_ip == dst_ip || dst_ip == "0.0.0.0")
        });

        if let Some(idx) = existing_index {
            self.entries[idx].last_used_at_us = current_time_us;
            let entry = self.entries[idx].clone();

            return Ok(NatTranslationResult {
                original_src_ip: src_ip.to_string(),
                original_src_port: src_port,
                original_dst_ip: dst_ip.to_string(),
                original_dst_port: dst_port,
                translated_src_ip: src_ip.to_string(),
                translated_src_port: src_port,
                translated_dst_ip: entry.private_ip.clone(),
                translated_dst_port: entry.private_port,
                entry,
                created_new_mapping: false,
                direction: "inbound (Dynamic Reverse NAPT)".to_string(),
            });
        }

        Err(NetSimError::RouteUnreachable(format!(
            "Inbound NAT translation rejected: no matching entry or static rule for {}:{} ({:?})",
            dst_ip, dst_port, protocol
        )))
    }
}
