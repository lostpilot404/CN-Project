# NetSim — implementation-aware novelty audit, reconciled release evidence

**Date:** 2026-10-27. **Baseline inspected:** `d213648f3679b9c94b1326cc065d84640f1d5b9d`.
**Branch:** `arena/fd51edb2-cn-project`. This document supersedes the earlier pre-fix audit's current
status statements. Its original diagnosis is retained below as before/after evidence, not a claim
that the identified dispatch/export defects still exist.

## Contribution, problem and intended users

Undergraduate students and instructors need short tasks linking explicit algorithm inputs to
intermediate states, recovery behavior and calculated metrics without physical hardware. NetSim's
supported contribution is an **integrated Python-backed educational environment for selected
networking algorithms and controlled experiments, with inspectable results and reproducible JSON
snapshots**. Learning gains have not been measured. Neither network visualization nor seeded
experiments nor GBN/SR are new inventions.

## Implementation-aware findings and final categories

| Area | Baseline gap / actual implementation | Final category and evidence |
|---|---|---|
| Target dispatch | General runner accepted protocol targets but always used topology packet injection. `execute_run` now explicitly selects network, TCP or UDP. Omitted target retains legacy network behavior. | **Implemented and verified.** Three targets × sweep/A-B browser downloads record matching model labels, effective inputs and replay; backend dispatch tests. |
| Unsupported targets | Application/MAC/flow-control studios are separate; their general-runner selectors implied unsupported integration. | **Unsupported or out of scope** in the general runner. UI removes them; API rejects with a dedicated-studio message. Studios remain available separately. |
| Sweep parameters | Some settings were accepted but unwired. `sweep.py` now uses a target-specific allowlist; `runner.py` applies effective traffic inputs. | **Implemented and verified** by backend parameter-matrix tests. Bandwidth was exercised in Chromium for all three targets. **Implemented but not manually verified**: each non-bandwidth parameter has not been individually browser-exercised in this gate; code tests are not substituted for that check. |
| A/B overrides | Packet size/count/interval overrides could be accepted without affecting traffic. | **Implemented and verified** in regression tests. Browser acceptance covers bandwidth A/B, seeds and per-run outputs, not every traffic-override UI variant (UI exposes bandwidth). |
| Evidence export | API serialization existed but comparison screens had no downloads; A/B lacked seeds/config/per-run QoS. | **Implemented and verified.** Two available formats, both JSON: sweep and A/B; six actual browser downloads, screenshots, non-empty parsed files and CLI replays. There is no CSV download format. |
| Reproducibility | Aggregate results alone could not identify the full run. | **Implemented and verified** for saved acceptance inputs: embedded topology/config, effective per-run settings, seeds, source fingerprint, Python version and outputs. Replay matched excluding only `execution_time_ms`. Source hash is recorded but not enforced by the replay CLI. |
| GBN/SR workflow | Already used a common config and dedicated models; no new screen or algorithm was needed. | **Implemented and verified.** Chromium comparison reproduces 4 vs 1 retransmissions, 26,200 vs 21,100 μs, 8 frames completed each. UI-triggered response captures are not mislabeled as studio downloads. |
| Topology/event inspection and routing/addressing | Existing Python model and browser studios. | **Implemented and verified** within browser tests' tasks. **Comparable capability found in Packet Tracer**, established by official help, not local Packet Tracer use. |
| Saved network scenarios | NetSim JSON snapshots and replay; Packet Tracer documents save/open and rerunnable PDU scenarios. | **Comparable capability found in Packet Tracer.** Saving or repeating a scenario is not unique to NetSim. Exact outcome-schema and determinism parity is unverified. |
| Matched-loss GBN/SR plus educational experiment-evidence packaging | Demonstrated in NetSim; inspected Packet Tracer pages do not establish an equivalent exact workflow. | **Candidate differentiator requiring further evidence**, not a proven absence in Packet Tracer. Direct version-recorded application comparison remains outstanding. |
| Submission architecture | Earlier report/specifications described removed components. | **Implemented and verified by source/document reconciliation.** Current report/requirements describe the Python service, React UI and JSON persistence, not an active Rust/Tauri engine. |

## Execution and metric boundaries

The supported matrix is in [PROJECT_REPORT.md](../PROJECT_REPORT.md). Network sweeps support
bandwidth/delay/queue/BER/packet size/injection interval/count. TCP/UDP support bandwidth/delay/
segment size/count; bulk transfer runs to completion, not a duration cutoff. Scheduled faults,
stochastic link loss/BER and explicit intervals are rejected for transport. Topology values below
transport model floors fail clearly. Window/timeout/persistence sweeps are unsupported.

Network throughput and goodput currently share the same delivered-byte formula. Transport shared
latency is TCP RTT/2; UDP latency and transport jitter are unavailable zero placeholders. The
flow-control utilization is completed frames × frame transmission time / completion time, not
physical utilization. Its overhead is a count ratio, not measured byte overhead (the UI displays it
scaled as a percentage). Seeds are recorded but do not randomize the standalone flow-control or
transport models. Model state/event ordering and bounded recovery remain simplified.

## Controlled demonstration and evidence

Window 4, sequence space 8, 8 frames, frame Tx 1,000 μs, propagation 2,000 μs, ACK Tx 100 μs,
timeout 10,000 μs, seed 42, drop initial frame index 2; no ACK drops. The browser comparison and
`examples/compare_flow_control.py` use these settings.

| Calculated output | GBN | SR |
|---|---:|---:|
| Completed frames | 8 | 8 |
| Total transmissions | 12 | 9 |
| Retransmissions | 4 | 1 |
| Completion time (μs) | 26,200 | 21,100 |
| Maximum receiver buffer (frames) | 0 | 3 |

GBN recovers an outstanding group; SR buffers out-of-order frames and retransmits the missing one.
This explains the result for this input, not a universal protocol ranking. Byte-identical replay
is evidence of repeatability, not independent proof of correctness.

See [browser evidence](evidence/2026-10-27/browser/) and [final verification](FINAL_VERIFICATION.md)
for screenshots, complete UI response traces, downloads/replays and final-source test logs.

## Related tools and claim boundary

The [source-backed Packet Tracer comparison](PACKET_TRACER_COMPARISON.md) records official sources,
version evidence, common educational tasks and model differences. No Packet Tracer installation
was available. Cisco advertises 9.0.1; exact installed build cannot be established without an
installation. Documentation proves substantial overlap, not that any unmentioned capability is absent.

Seeded parameter studies and metric collection are also established simulator practices: OMNeT++
documents parameter studies and `repeat`/`seed-set`; ns-3 documents FlowMonitor and flow probes.
[1](https://doc.omnetpp.org/omnetpp/manual/) [7](https://www.nsnam.org/docs/release/3.27/doxygen/group__flow-monitor.html)
These are prior documentation findings, not directly exercised competing-tool installations.

No evidence supports “first,” “unique,” “faster,” “more accurate,” “more advanced,” “superior” or
improved learning outcomes. The integration is demonstrable; exclusivity is not established.

## Final verification and release decision

Final-source results: **197 backend + 80 utility = 277 Python tests; 95 frontend tests (11 opt-in
skips in default suite); 11 separately executed live integration tests; 31 Chromium E2E tests**
(22 existing functional, 2 accessibility, 6 download/replay, 1 dedicated GBN/SR comparison).
Lint/format, Python static types, TypeScript check and build pass. See logs for warnings.

The NetSim browser-download acceptance gate is verified for the exercised matrix. A fair,
documentation-backed comparison is available under the unavailable-application fallback. Direct
Packet Tracer hands-on verification and any exclusive novelty/learning-effectiveness claim remain
**unverified**. The project is not unconditionally ready for those claims.
