pub mod commands;
pub mod domain;
pub mod error;
pub mod simulation;
pub mod state;

#[cfg(test)]
mod tests;

#[cfg(not(test))]
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Initializing NetSim Desktop Application...");

    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::project::get_project,
            commands::project::create_project,
            commands::project::save_project_json,
            commands::project::load_project_json,
            commands::topology::add_node,
            commands::topology::update_node,
            commands::topology::remove_node,
            commands::topology::add_link,
            commands::topology::update_link,
            commands::topology::remove_link,
            commands::topology::update_interface,
            commands::topology::undo_topology,
            commands::topology::redo_topology,
            commands::topology::get_topology_history_status,
            commands::simulation::get_simulation_state,
            commands::simulation::step_simulation,
            commands::simulation::run_simulation_micros,
            commands::simulation::run_simulation_until_empty,
            commands::simulation::pause_simulation,
            commands::simulation::reset_simulation,
            commands::simulation::inject_packet,
            commands::simulation::get_packet_details,
            commands::simulation::schedule_demo_packet,
            commands::algorithms::calculate_simple_checksum,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NetSim application");
}
