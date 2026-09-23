pub mod addressing;
pub mod commands;
pub mod congestion;
pub mod datalink;
pub mod domain;
pub mod error;
pub mod routing;
pub mod simulation;
pub mod state;
pub mod transport;

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
            commands::algorithms::calculate_routing_table,
            commands::algorithms::simulate_routing_convergence,
            commands::algorithms::calculate_ipv4_subnet,
            commands::algorithms::split_ipv4_subnet,
            commands::algorithms::allocate_vlsm_subnets,
            commands::algorithms::detect_duplicate_ips_command,
            commands::algorithms::validate_ipv6_address,
            commands::algorithms::get_or_create_nat_table,
            commands::algorithms::add_static_dnat_rule,
            commands::algorithms::simulate_nat_outbound,
            commands::algorithms::simulate_nat_inbound,
            commands::algorithms::calculate_hamming_encode,
            commands::algorithms::verify_and_correct_hamming,
            commands::algorithms::calculate_crc,
            commands::algorithms::verify_crc,
            commands::algorithms::calculate_internet_checksum,
            commands::algorithms::verify_internet_checksum,
            commands::algorithms::simulate_sliding_window,
            commands::algorithms::simulate_go_back_n,
            commands::algorithms::simulate_selective_repeat,
            commands::algorithms::simulate_pure_aloha,
            commands::algorithms::simulate_slotted_aloha,
            commands::algorithms::simulate_csma,
            commands::algorithms::simulate_csma_cd,
            commands::algorithms::simulate_tcp,
            commands::algorithms::simulate_udp,
            commands::algorithms::simulate_tcp_congestion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NetSim application");
}
