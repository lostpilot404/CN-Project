# NetSim — Architecture

This document describes the architecture **as implemented today**. Python is the sole simulation
authority; the front-end is a presentation layer. For setup see the [README](../README.md).

## 1. Architecture decision

NetSim is a **two-process** application:

```text
┌──────────────────────────────────────────────────────────────┐
│  React 18 + TypeScript + Tailwind + xyflow        (src/)     │
│  Presentation and input only. No simulation logic.           │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP JSON: POST /api/<command>
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Python simulation service              (python/netsim/)     │
│  Sole authority for all simulation state and results.        │
└──────────────────────────────────────────────────────────────┘
```

There is no native shell, no IPC layer and no second engine. An earlier revision of this project
shipped a Rust engine behind a Tauri window; that runtime has been removed. The only supported
deployment is the browser front-end plus the Python service.

## 2. Design principles

1. **Python is the authoritative source of simulation truth.** Every number the UI shows originates
   in `python/netsim/`.
2. **The UI does not implement networking algorithms.** It formats and renders results.
3. **Simulation time is separate from wall-clock time.** The engine advances a virtual µs clock;
   results do not depend on how fast the host runs.
4. **Core simulations are reproducible when given a seed.** The same seed and configuration produce
   the same run.
5. **No silent fallbacks.** When the service is unreachable the UI reports it; it never substitutes
   a fabricated result.
6. **Project format is versioned** (`schemaVersion`).
7. **Algorithms are independently testable** — the Python modules are callable without HTTP.
8. **Protocols are modular** — one module per protocol family.

## 3. Front-end layer

React 18 + TypeScript, built by Vite. Responsibilities:

- render topology on an xyflow canvas and capture editing gestures
- collect parameters for the protocol studios and experiment workspaces
- issue commands and render the exact responses
- surface loading, empty, validation and backend-offline states

Two modules carry the integration:

| Module | Responsibility |
|---|---|
| `src/lib/apiClient.ts` | Endpoint resolution, `/health` probing, retry, and the two error types (`BackendUnavailableError`, `BackendCommandError`). Contains no simulation logic. |
| `src/lib/api.ts` | The typed command surface: one method per backend command, all dispatched through `callCommand`. |
| `src/lib/exportResults.ts` | Experiment result exports: JSON (the verbatim backend result consumed by `python-tools`) and tidy CSV with units in the column names; filename generation and browser download. No simulation logic. |
| `src/components/ui/ConfirmDialog.tsx` | The shared accessible confirmation dialog (role=dialog, focus management, Escape) used before any destructive/replace action such as project import. |

Endpoint resolution order: `VITE_NETSIM_API_URL` → `http://127.0.0.1:8765` → same-origin
`/netsim-api`. The dev server proxies the same-origin prefix to the Python service, so a proxied or
forwarded deployment needs no change to browser-facing URLs.

### The test double, and why it cannot leak

`src/lib/testDouble.ts` is an in-memory double used **only** by the vitest runner, so components can
be tested without a service. It cannot replace real results in a shipped build:

1. `vite.config.ts` aliases `@netsim/test-double` to `testDouble.stub.ts` unless `VITEST` is set.
   The stub rejects every command.
2. `src/lib/api.ts` reaches the double only when `window` is undefined. In a browser it always calls
   the service.
3. The production bundle was inspected and contains no double — only the rejecting stub.

## 4. Service layer

`python/netsim/server.py` is a standard-library `HTTPServer` bound to loopback. It exposes:

| Route | Purpose |
|---|---|
| `GET /health` | Liveness and authority metadata |
| `POST /api/<command>` | Every simulation, topology, algorithm and experiment command |

`dispatch_command(cmd, args)` is a single dispatch table of **60** commands. Command names accept
both `snake_case` and `camelCase` spellings.

### Response envelope

```json
{ "status": "ok", "result": <payload> }
```

### Error mapping

| Condition | Status | `code` |
|---|---|---|
| Malformed JSON body | 400 | `invalid_json` |
| Body not a JSON object | 400 | `invalid_request` |
| Validation failure (`CommandError`, `ValueError`) | 400 | `invalid_request` |
| Unknown command | 404 | `unknown_command` |
| Any other exception | 500 | `internal_error` |

`KeyError` and `TypeError` are deliberately **not** mapped to 400: they indicate a defect in the
core, so they surface as 500 rather than being mislabelled as bad user input. No response ever
contains a traceback; the detail goes to the server log.

Nested payload validation is centralised in `python/netsim/core/schema.py`
(`require_dict`, `require_list`, `require_int`, `require_non_empty`). Every `from_dict` factory is
reachable from the command surface, so nested values are validated rather than dereferenced —
otherwise a malformed payload would raise `AttributeError`/`KeyError` and be reported as a server
fault instead of a client error.

## 5. Simulation core

| Module | Contents |
|---|---|
| `core/clock.py` | `SimTime`, an integer µs virtual clock with ms/s helpers |
| `core/events.py` | Event types and the `SimEvent` record |
| `core/engine.py` | The discrete-event engine: event queue, drain/step, status, metrics wiring |
| `core/queue.py` | Bounded link queue with drop accounting |
| `core/delays.py` | Transmission and propagation delay computation |
| `core/rng.py` | `DeterministicRng`, seeding CPython's `random.Random` |
| `core/metrics.py` | Metric accumulation |
| `core/schema.py` | Payload validation helpers |
| `models/` | `node`, `interface`, `link`, `packet`, `project`, `history` |
| `routing/` | `graph` (path search dispatches on the engine forwarding algorithm — Dijkstra or Bellman-Ford, one shared deterministic tie-break), `dijkstra`, `bellman_ford`, `table` |
| `addressing/` | `ipv4`, `ipv6`, `vlsm`, `nat` |
| `switching/` | `circuit` — educational circuit-switching admission model |
| `datalink/` | `hamming`, `crc`, `checksum`, `flow_control`, `mac` |
| `transport/` | `tcp`, `udp`, congestion control |
| `application/` | `dns`, `http`, `ftp`, `smtp`, `snmp` |
| `qos/` | `metrics`, `aggregation` |
| `faults/` | Fault model and schedule |
| `experiments/` | `config`, `runner`, `sweep`, `results` |

### Simulation time

The engine advances a virtual microsecond clock. An event scheduled at time *t* is processed
exactly at *t*, independent of wall-clock duration. Stepping is exposed as single-event
(`step_simulation`), bounded-duration (`run_simulation_micros`) and drain-to-empty
(`run_simulation_until_empty`).

### Randomness

`core/rng.py` wraps CPython's `random.Random(seed)`. Two runs at the same seed produce the identical
draw sequence; different seeds diverge. Wall-clock fields such as `execution_time_ms` are excluded
from determinism comparisons.

### Packet stack

Packets carry five protocol layers (L1–L5). The inspector renders exactly the layers the engine
produced for that packet; nothing is synthesised in the front-end.

## 6. Domain model

- **Node** — id, label, type (host/router/switch), state, position, interfaces.
- **Interface** — id, IPv4/IPv6 address, MAC, `up`/`down` status. Nodes hold up to 24 interfaces.
- **Link** — id, endpoints (node + interface), bandwidth, propagation delay, loss probability, bit
  error rate, queue capacity, status.
- **Packet** — id, size, endpoints, per-layer headers, outcome (delivered / dropped / retransmitted).

Identifiers are stable and explicit: topology updates preserve node ids, link ids and interface ids
rather than reassigning them.

## 7. Persistence

Projects serialise to a versioned JSON document (`schemaVersion`). Export is
`save_project_json`; import is `load_project_json`, which validates the document and rebuilds the
topology, positions, interface configuration and link parameters.

`create_project` and `load_project_json` also clear the NAT tables, which are per-project
configuration — a new project must not inherit port forwards from the one it replaced.

## 8. Undo/redo

`models/history.py` holds a topology snapshot stack bounded at 50 entries (`max_depth`). Mutating
topology commands push a snapshot first, so a failed mutation cannot leave a half-applied state
behind. `get_topology_history_status` reports `can_undo`, `can_redo` and both stack depths.

## 9. QoS and metrics

All metrics are accumulated from actual simulation data:

- throughput and goodput (bits/s and bytes/s)
- end-to-end latency samples, with mean/min/max and standard deviation
- IPDV jitter
- loss and retransmission counts
- queue occupancy and link utilisation

An idle project reports zeros, not `NaN`.

## 10. Faults

`faults/model.py` models link down/restore, bit error rate, queue resize and packet drop. Faults are
scheduled against the virtual clock and produce engine events, so the UI reflects engine state
rather than a UI-side fiction. Malformed fault payloads and unknown targets are rejected.

## 11. Experiments

`experiments/` supports parameter sweeps across multiple seeds and A/B comparison of two
configurations. A sweep returns `points[]`, each aggregating `runs[]` per seed with an
`aggregated_qos` summary. Results are reproducible for a given seed set.

## 12. Security

- The service binds **loopback only** (`127.0.0.1`), never `0.0.0.0`.
- A second instance on the same port fails loudly with the OS bind error.
- No shell is invoked from user input; no credentials are stored in the repository.
- Internal exception detail is logged server-side and never returned to the client.

## 13. Testing

See [testing.md](testing.md) for the layers and commands. In summary: Python unit and API-contract
tests, front-end unit/component tests, integration tests against a running service, and Playwright
browser tests against the real application.

## 14. Retired components

The following no longer exist and must not be reintroduced:

| Component | Why it was removed |
|---|---|
| `src-tauri/` (Rust engine, 12,353 lines across 45 files) | A second, complete simulation engine — a duplicate source of simulation truth |
| Root `Cargo.toml`, `.cargo/` | Workspace manifest for the removed Rust tree |
| `@tauri-apps/api`, `@tauri-apps/cli` | Runtime and CLI for the removed shell |
| `TAURI_ENV_*` build variables | Drove the Vite build target for the removed shell |
| Front-end IPC fallback | Could silently switch the simulation engine away from Python when the service was unreachable |

## Experiment execution boundary

`experiments/runner.py` explicitly dispatches `network` (legacy omitted target), `tcp` and `udp`.
Only supported parameters pass validation. Dedicated flow-control, MAC and application studios
remain separate and are not substituted through the general runner. Exported results include a
versioned configuration/topology snapshot, per-run evidence and an engine-source fingerprint.
See [the workflow contract](experiment-workflow.md) for model timing, metric limitations,
replay and the supported parameter matrix. There is no new simulation engine in the frontend.
