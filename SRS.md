# NetSim — Software Requirements Specification

## Architecture and ownership

The supported runtime is a Python 3.11+ simulation service and React/TypeScript frontend over HTTP
JSON. Python owns simulation state, algorithms, timing, events and metrics. React handles input,
rendering and JSON download. Projects and experiment snapshots are serialized as JSON. There is
no active desktop shell, second simulation engine or database dependency.

## Functional requirements

- Support topology creation and editing, project save/load, packet events and inspection.
- Retain dedicated addressing, routing, data-link, transport and application workspaces.
- Dispatch general experiment targets `network`, `tcp`, `udp` explicitly. Omitted target means
  legacy network execution. Other targets must fail with a dedicated-studio explanation.
- Support the parameter matrix in [PROJECT_REPORT.md](PROJECT_REPORT.md). Reject unsupported,
  non-finite and fractional count/time sweep settings. Preserve scenario-specific traffic overrides.
- Network execution uses timed injection and a 100,000 μs drain. Transport execution runs bulk
  transfers to completion; duration must not be advertised as a transport cutoff.
- Reject transport scheduled faults, stochastic link loss/BER, injection intervals and topology
  settings below effective model floors, rather than silently ignoring them.
- Export completed A/B and sweep results with versioned provenance, full config/topology,
  seed/scenario labels, effective per-run model inputs, QoS and raw transport metrics where applicable.
- Preserve working GBN/SR matched-input comparison in the dedicated Flow Control studio.

## Quality and validation

Errors must surface to the user; unavailable services must not produce fabricated results.
Repeatability applies to calculated outputs for the same implementation/configuration, not wall-clock
execution metadata. Tests must verify dispatch, parameter wiring, unsupported inputs and replay.
Exports must refer to the completed run rather than editable form values.

## Measurement boundaries

TCP shared latency is an RTT/2 estimate. UDP latency and transport jitter are unavailable; zero
compatibility fields must not be interpreted as observations. Network throughput/goodput currently
share a formula. Seeds do not randomize transport-model loss. See the
[workflow](docs/EXPERIMENT_WORKFLOW.md) for limitations and tests actually executed.
