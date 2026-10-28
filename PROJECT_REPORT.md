# NetSim — Academic Project Report

## Abstract

NetSim is a Python-backed, browser-based educational network simulator with a React/TypeScript
interface. Its contribution is the integration of explicit algorithm inputs, intermediate-state
inspection, controlled comparisons, and reproducible experiment evidence. It does not introduce
new networking algorithms or demonstrate superiority over Cisco Packet Tracer.

## Problem and target users

Undergraduate students often calculate algorithm steps separately from observing their effects.
Instructors need short, repeatable tasks linking a controlled loss or parameter change to an
explainable trace and calculated metrics. NetSim supports these exercises without physical lab
hardware. Improved learning outcomes have not been measured.

## Objectives and scope

- Preserve dedicated algorithm studios and their inspectable intermediate states.
- Compare settings under common inputs and explain the metrics actually calculated.
- Ensure experiment targets dispatch to the selected model rather than substituting another one.
- Save enough configuration and per-run evidence to repeat a result.

NetSim is a collection of simplified educational models, not a hardware emulator or a claim of
research-grade fidelity. Standalone studios are not automatically integrated into the topology engine.

## Implemented architecture

```text
React / TypeScript / Tailwind / xyflow / Recharts
                     │ HTTP JSON commands
                     ▼
Python service (python/netsim/server.py)
  ├── topology models, discrete-event engine, queues, faults, QoS
  ├── routing and addressing algorithms
  ├── dedicated data-link, transport and application studios
  └── experiment runner → network packets | TCP model | UDP model
```

Python owns simulation state and outputs; React gathers inputs and renders responses. Projects
and experiment snapshots use JSON. There is no active Rust engine, Tauri shell or SQLite store.

## Trustworthy experiment workflow

The general runner supports:

| Target | Execution | Sweep parameters |
|---|---|---|
| `network` (also the legacy omitted target) | Timed topology-packet injection, duration plus 100,000 μs drain | bandwidth, propagation delay, queue capacity, BER, packet size, injection interval, packet count |
| `tcp` | Existing TCP bulk-transfer model to completion | bandwidth, propagation delay, segment size, segment count |
| `udp` | Existing UDP bulk-transfer model to completion | bandwidth, propagation delay, segment size, segment count |

Application, MAC and flow-control requests to the general runner are rejected with a dedicated-studio
message. Window, timeout and persistence sweeps are rejected rather than silently ignored. Transport
experiments reject scheduled faults, stochastic topology loss/BER and explicit injection intervals.
They require links at least 1 Mbps and 100 μs to avoid silent model-floor clamping. Duration is not a
transport cutoff; the UI disables that field for bulk transfers. Seeds are recorded but do not
randomize transport models. A parameter can change model inputs without changing an output in a
particular scenario; sensitivity is not guaranteed.

A/B comparisons use the same seed list and common traffic settings, with explicit scenario overrides.
Exports contain the request and topology snapshot, per-run evidence, effective model inputs,
per-seed QoS, source fingerprint, Python version, timing notes and aggregate results. Downloads use
the completed backend result, not the current editable form. See
[replay instructions](docs/EXPERIMENT_WORKFLOW.md).

## Controlled demonstration: Go-Back-N versus Selective Repeat

The dedicated Flow Control comparison uses matched inputs: window 4, sequence space 8,
8 frames, frame transmit time 1,000 μs, propagation 2,000 μs, ACK transmit time 100 μs,
timeout 10,000 μs, initial frame index 2 dropped, no ACK drops. Seed 42 is recorded but is not
used for random loss in this deterministic module.

```sh
PYTHONPATH=python python examples/compare_flow_control.py > flow-comparison.json
```

| Calculated output | Go-Back-N | Selective Repeat |
|---|---:|---:|
| Completed frames | 8 | 8 |
| Transmissions | 12 | 9 |
| Retransmissions | 4 | 1 |
| Virtual completion time (μs) | 26,200 | 21,100 |
| Useful-time utilization | 0.305344 | 0.379147 |
| Maximum receiver buffer (frames) | 0 | 3 |

The trace shows GBN recovering an outstanding group, whereas SR buffers out-of-order frames and
retransmits the missing one. For this case SR saves transmissions and virtual time, with receiver
buffering. This is not a universal ranking. Utilization here is completed frames × frame transmission
time / completion time, not hardware utilization. No bit-rate throughput is inferred from this model.
Complete event traces are in the generated JSON; no values are fabricated by the example.

## Metric interpretation and limitations

- Network throughput and goodput currently share the delivered-byte formula. Do not claim they
  isolate header overhead. Its measurement interval includes the drain period.
- Transport throughput/goodput come from transport model metrics and completion-time semantics.
  TCP latency in the shared QoS display is an RTT/2 estimate. UDP one-way latency and transport
  jitter are unavailable; zero fields are compatibility placeholders, not measured zero delay.
- Matched seeds do not prove matched random-loss events after changed event ordering.
- Protocol models have bounded recovery and simplified behavior. Byte-identical replay is evidence
  of repeatability under those inputs, not independent proof of correctness.
- No direct Packet Tracer run, learning-outcome study or comparative runtime benchmark was performed.
  Packet Tracer was unavailable; official sources establish advertised 9.0.1 but not an installed build.

## Related work, explicit evidence categories and novelty boundary

The [Packet Tracer comparison](docs/PACKET_TRACER_COMPARISON.md) compares matched educational tasks
using official documentation for Packet Tracer and source/browser evidence for NetSim. It records
version, OS, retrieval date and model differences; no Packet Tracer application was available.

| Category | Evidence-based conclusion |
|---|---|
| Implemented and verified | Network/TCP/UDP dispatch; bandwidth sweep and A/B downloads/replay for all three targets in real Chromium; dedicated matched-loss GBN/SR task; recorded topology/event/routing/addressing tests. |
| Implemented but not manually verified | Every non-bandwidth browser sweep, broader topology/input combinations, cross-platform replay and human usability; parameter wiring is regression-tested, not a substitute for these manual checks. |
| Comparable capability found in Packet Tracer | Official help documents topology/event inspection, IP/routing workflows, saved networks and scheduled-PDU scenarios/reruns. These are overlapping capabilities, not unique NetSim features. |
| Candidate differentiator requiring further evidence | The exact direct GBN/SR task and integrated multi-seed config/metric export workflow relative to a named Packet Tracer build. Direct verification is outstanding; unmentioned features are not presumed absent. |
| Unsupported or out of scope | Other studio protocols as general-runner targets, full device emulation, unsupported transport fault/loss/timing settings, exclusive novelty and comparative accuracy/speed/learning gains. |

The integration is observable; exclusive novelty is not established. The
[reconciled implementation audit](docs/IMPLEMENTATION_NOVELTY_AUDIT.md) links code findings and
current acceptance evidence. Seeded studies and metric collection are established simulator practices.

## Final-source validation

**197 backend + 80 utility = 277 Python tests passed; 95 frontend tests passed** (11 opt-in skips
in default suite), **11 live integration tests passed**, and **31 Chromium E2E tests passed**.
The browser suite includes six real download/replay cases and a dedicated GBN/SR comparison task,
as well as existing topology, packet, routing/addressing and accessibility checks. Lint/format,
Python/TypeScript types and production build pass. Vite's large-bundle warning and live jsdom
`act(...)` warnings remain recorded. The six download flows had no console/service errors.

[Final verification](docs/FINAL_VERIFICATION.md) records precise inputs, output paths, excluded
wall-clock field, test logs, source fingerprints and remaining limitations. Deterministic replay
uses the actual browser downloads, not a replacement API export. These are browser-driven automated
acceptance checks, not a human usability evaluation. The direct Packet Tracer comparison remains
unverified, so unconditional academic readiness for an exclusive novelty claim is not asserted.

## Conclusion

The useful contribution is an explainable educational experiment workflow. Keeping the working
models, correcting dispatch and validation, and preserving reproducibility evidence is more valuable
than expanding the feature count or changing the visual design solely to appear different.
