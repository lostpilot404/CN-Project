use crate::domain::Packet;
use crate::error::{NetSimError, Result};
use crate::simulation::{SimEvent, SimulationStateSnapshot};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn get_simulation_state(state: State<'_, AppState>) -> Result<SimulationStateSnapshot> {
    let sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    Ok(sim.get_snapshot())
}

#[tauri::command]
pub fn step_simulation(state: State<'_, AppState>) -> Result<Option<SimEvent>> {
    let proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    sim.update_links(&proj.links);
    sim.step()
}

#[tauri::command]
pub fn run_simulation_micros(duration_us: u64, state: State<'_, AppState>) -> Result<usize> {
    let proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    sim.update_links(&proj.links);
    let target = sim.current_time().add_micros(duration_us);
    sim.run_until(target)
}

#[tauri::command]
pub fn run_simulation_until_empty(state: State<'_, AppState>) -> Result<usize> {
    let proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    sim.update_links(&proj.links);
    sim.run_all()
}

#[tauri::command]
pub fn pause_simulation(state: State<'_, AppState>) -> Result<SimulationStateSnapshot> {
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    sim.pause();
    Ok(sim.get_snapshot())
}

#[tauri::command]
pub fn reset_simulation(state: State<'_, AppState>) -> Result<SimulationStateSnapshot> {
    let proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    sim.update_links(&proj.links);
    sim.reset(proj.simulation_config.seed);
    Ok(sim.get_snapshot())
}

#[tauri::command]
pub fn inject_packet(
    src_node_id: String,
    dst_node_id: String,
    size_bytes: Option<usize>,
    app_protocol: Option<String>,
    transport_protocol: Option<String>,
    state: State<'_, AppState>,
) -> Result<String> {
    let proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    // Check if source and destination nodes exist in topology
    if !proj.nodes.iter().any(|n| n.id == src_node_id) {
        return Err(NetSimError::NodeNotFound(src_node_id));
    }
    if !proj.nodes.iter().any(|n| n.id == dst_node_id) {
        return Err(NetSimError::NodeNotFound(dst_node_id));
    }

    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    sim.update_links(&proj.links);

    let pkt_id = sim.inject_packet(
        src_node_id,
        dst_node_id,
        size_bytes.unwrap_or(1000),
        app_protocol.unwrap_or_else(|| "HTTP".to_string()),
        transport_protocol.unwrap_or_else(|| "TCP".to_string()),
    );

    Ok(pkt_id)
}

#[tauri::command]
pub fn get_packet_details(packet_id: String, state: State<'_, AppState>) -> Result<Option<Packet>> {
    let sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    Ok(sim.get_packet(&packet_id).cloned())
}

#[tauri::command]
pub fn schedule_demo_packet(
    src_node_id: String,
    dst_node_id: String,
    state: State<'_, AppState>,
) -> Result<u64> {
    inject_packet(
        src_node_id,
        dst_node_id,
        Some(1000),
        Some("HTTP".to_string()),
        Some("TCP".to_string()),
        state,
    )?;
    Ok(0)
}
