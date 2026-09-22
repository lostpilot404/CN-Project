use super::link::Link;
use super::node::Node;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata {
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationConfig {
    pub seed: u64,
    pub max_simulation_time_us: u64,
    pub default_bandwidth_bps: u64,
    pub default_propagation_delay_us: u64,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            seed: 42891,
            max_simulation_time_us: 10_000_000, // 10 seconds virtual time
            default_bandwidth_bps: 10_000_000,
            default_propagation_delay_us: 10_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    pub metadata: ProjectMetadata,
    pub nodes: Vec<Node>,
    pub links: Vec<Link>,
    pub simulation_config: SimulationConfig,
}

impl Project {
    pub fn new(name: String) -> Self {
        Self {
            schema_version: 1,
            metadata: ProjectMetadata {
                name,
                description: "NetSim Network Simulation Project".to_string(),
                created_at: chrono_now_string(),
                updated_at: chrono_now_string(),
                author: "NetSim User".to_string(),
            },
            nodes: Vec::new(),
            links: Vec::new(),
            simulation_config: SimulationConfig::default(),
        }
    }
}

fn chrono_now_string() -> String {
    // Simple ISO-8601 string without heavy chrono dependency
    "2026-09-22T12:00:00Z".to_string()
}
