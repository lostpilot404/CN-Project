use crate::error::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteEntry {
    pub destination: String,
    pub next_hop: String,
    pub cost: u32,
    pub path: Vec<String>,
}

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
    // Fold carries
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
