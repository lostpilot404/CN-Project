use crate::domain::Project;
use crate::error::Result;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn get_project(state: State<'_, AppState>) -> Result<Project> {
    let proj = state
        .project
        .lock()
        .map_err(|e| crate::error::NetSimError::SimulationError(e.to_string()))?;
    Ok(proj.clone())
}

#[tauri::command]
pub fn create_project(name: String, state: State<'_, AppState>) -> Result<Project> {
    let mut proj = state
        .project
        .lock()
        .map_err(|e| crate::error::NetSimError::SimulationError(e.to_string()))?;
    let new_project = Project::new(name);
    *proj = new_project.clone();

    // Reset simulation engine to project seed
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| crate::error::NetSimError::SimulationError(e.to_string()))?;
    sim.reset(proj.simulation_config.seed);

    Ok(new_project)
}

#[tauri::command]
pub fn save_project_json(state: State<'_, AppState>) -> Result<String> {
    let proj = state
        .project
        .lock()
        .map_err(|e| crate::error::NetSimError::SimulationError(e.to_string()))?;
    let json = serde_json::to_string_pretty(&*proj)?;
    Ok(json)
}

#[tauri::command]
pub fn load_project_json(json_content: String, state: State<'_, AppState>) -> Result<Project> {
    let loaded: Project = serde_json::from_str(&json_content)?;
    let mut proj = state
        .project
        .lock()
        .map_err(|e| crate::error::NetSimError::SimulationError(e.to_string()))?;
    *proj = loaded.clone();

    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| crate::error::NetSimError::SimulationError(e.to_string()))?;
    sim.reset(proj.simulation_config.seed);

    Ok(loaded)
}
