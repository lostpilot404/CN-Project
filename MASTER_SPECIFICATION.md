# NetSim — Current Implementation Specification

This is the current submission index, replacing the obsolete desktop-engine design.

## Runtime contract

```text
Browser React/TypeScript UI → HTTP JSON → Python simulation service
                                         ├─ topology event engine
                                         ├─ dedicated algorithm studios
                                         └─ experiment dispatch: network / TCP / UDP
```

Python is the sole simulation authority. No Rust engine, Tauri bridge or SQLite persistence is
part of the supported runtime. React does not calculate fallback simulation results. Project and
experiment evidence are JSON. Optional Python analysis/chart scripts consume saved outputs.

## Authoritative current documents

- [README.md](README.md): setup, runtime and contribution boundary.
- [ARCHITECTURE.md](ARCHITECTURE.md): component ownership and HTTP boundary.
- [PROJECT_REPORT.md](PROJECT_REPORT.md): problem, objectives, implementation, measured demonstration,
  limitations and novelty boundary.
- [PRD.md](PRD.md): product scope, users and non-goals.
- [SRS.md](SRS.md): execution, validation and evidence requirements.
- [docs/EXPERIMENT_WORKFLOW.md](docs/EXPERIMENT_WORKFLOW.md): supported execution and replay contract.
- [docs/IMPLEMENTATION_NOVELTY_AUDIT.md](docs/IMPLEMENTATION_NOVELTY_AUDIT.md): dated pre-fix findings,
  source references and comparative-evidence gaps; not a claim that those gaps remain unchanged.

## Implementation constraints

Preserve working algorithms and inspectable model events. Unsupported general experiment requests
must fail, not route to a different protocol. Broader studio integration is not required to make the
current scope truthful. Add features only when a real teaching or correctness gap justifies them.

## Submission evidence

Use the controlled GBN/SR demonstration and exported experiment snapshots. Do not substitute
wall-clock timing for simulated completion time, call repeatability a correctness proof, or assert
comparative accuracy/novelty without directly collected evidence. Earlier design prompts and the
historical quality audit describe their own dates and must not override current source behavior.
