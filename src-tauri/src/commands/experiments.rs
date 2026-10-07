use crate::error::{NetSimError, Result};
use crate::experiments::{
    run_comparative_experiment, run_parameter_sweep, ComparativeExperimentConfig,
    ComparativeExperimentResult, SweepConfig, SweepExperimentResult,
};
use crate::faults::FaultScheduleEntry;
use crate::qos::{compute_network_qos, QosMetrics};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn run_parameter_sweep_command(
    config: SweepConfig,
    state: State<'_, AppState>,
) -> Result<SweepExperimentResult> {
    let proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    run_parameter_sweep(&config, &proj)
}

#[tauri::command]
pub fn run_comparative_experiment_command(
    config: ComparativeExperimentConfig,
    state: State<'_, AppState>,
) -> Result<ComparativeExperimentResult> {
    let proj = state
        .project
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;
    run_comparative_experiment(&config, &proj)
}

#[tauri::command]
pub fn get_current_qos_metrics(state: State<'_, AppState>) -> Result<QosMetrics> {
    let sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    let queue_snapshots: Vec<_> = sim
        .link_queues()
        .values()
        .map(|q| q.get_snapshot())
        .collect();

    let elapsed = sim.current_time().as_micros().max(1);
    let qos = compute_network_qos(
        sim.metrics(),
        &sim.all_packets(),
        sim.processed_events(),
        &queue_snapshots,
        elapsed,
    );

    Ok(qos)
}

#[tauri::command]
pub fn schedule_fault_command(entry: FaultScheduleEntry, state: State<'_, AppState>) -> Result<()> {
    let mut sim = state
        .simulation
        .lock()
        .map_err(|e| NetSimError::SimulationError(e.to_string()))?;

    sim.schedule_fault(&entry.fault_id, entry.timestamp_us, entry.fault_type);
    Ok(())
}
