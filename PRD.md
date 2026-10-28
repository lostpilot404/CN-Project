# NetSim — Product Requirements

Current implementation baseline: Python service + browser-based React/TypeScript UI.
This replaces the superseded desktop-engine proposal; requirements below describe the supported
product boundary, not a list of unimplemented feature promises.

## Users and problem

Undergraduate networking students need to connect algorithm steps to observable consequences.
Instructors need repeatable, short experiments with explicit inputs and inspectable outputs.
NetSim focuses on those tasks, not certification-device emulation or measured superiority over
other simulators.

## Product objectives

1. Preserve topology construction, packet inspection and dedicated algorithm studios.
2. Execute the model selected by an experiment target; reject unsupported combinations.
3. Compare parameter settings under common inputs and record the differences explicitly.
4. Export complete run snapshots and per-seed evidence for independent reproduction.
5. Explain simplified-model scope and distinguish computed metrics from unavailable ones.

## Current experiment scope

The general runner supports network packets, TCP bulk transfer and UDP bulk transfer.
Flow-control GBN/SR comparison remains in its dedicated studio. Application and MAC studios
remain separate; selecting them through the experiment API fails clearly. Supported parameters,
timing semantics and reproducibility are specified in [PROJECT_REPORT.md](PROJECT_REPORT.md)
and [docs/EXPERIMENT_WORKFLOW.md](docs/EXPERIMENT_WORKFLOW.md).

## Acceptance

- Each exposed target reaches its model, never a fallback simulator.
- Every accepted sweep parameter reaches effective model inputs or fails validation.
- A/B overrides affect execution, not just labels.
- A saved result includes inputs/topology, seeds, effective settings and per-run outputs.
- Editing the form after a run does not change the downloadable result.
- The controlled GBN/SR demonstration remains reproducible without changing its simulation logic.

## Non-goals and evaluation gaps

No visual redesign solely to differ from Packet Tracer. No protocol rewrite or added protocol
family for feature-count novelty. No accuracy, speed, exclusivity or learning-outcome claim without
comparative evidence. Direct version-recorded comparison and classroom evaluation remain unperformed.
