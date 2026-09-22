use crate::domain::{Project, TopologyHistory};
use crate::simulation::SimulationEngine;
use std::sync::Mutex;

pub struct AppState {
    pub project: Mutex<Project>,
    pub simulation: Mutex<SimulationEngine>,
    pub history: Mutex<TopologyHistory>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        let initial_project = Project::new("Default NetSim Topology".to_string());
        let mut initial_sim = SimulationEngine::new(initial_project.simulation_config.seed);
        initial_sim.update_links(&initial_project.links);
        Self {
            project: Mutex::new(initial_project),
            simulation: Mutex::new(initial_sim),
            history: Mutex::new(TopologyHistory::new(50)),
        }
    }
}
