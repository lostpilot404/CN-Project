# NetSim — Interactive Computer Network Simulation Platform

NetSim is an educational computer-network simulator: a discrete-event simulation core written in
**Python 3.11+**, a **React 18 + TypeScript** front-end, and an optional **Tauri 2.x** desktop
shell.

## Architecture and ownership

The Python core is the single source of simulation truth. The UI renders what the core returns
and never fabricates results: when the service is unreachable the UI reports it instead of
falling back to stub data.

```text
┌──────────────────────────────────────────────────────────────┐
│  Presentation (React 18 · TypeScript · Tailwind · xyflow)    │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP JSON  (POST /api/<command>)
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Authoritative Python simulation core  (python/netsim/)      │
│  core/        μs virtual clock · priority event queue · PRNG │
│  models/      nodes · interfaces · links · packets · projects│
│  routing/     Dijkstra link-state · Bellman-Ford DV          │
│  addressing/  IPv4/IPv6 · CIDR · VLSM · stateful NAT         │
│  datalink/    Hamming(7,4)+SECDED · CRC · RFC 1071 checksum  │
│               sliding window · Go-Back-N · Selective Repeat  │
│               ALOHA · Slotted ALOHA · CSMA · CSMA/CD         │
│  transport/   TCP (slow start, congestion avoidance, fast    │
│               retransmit, timeouts, Jacobson/Karn RTT), UDP  │
│  application/ DNS · HTTP · FTP · SMTP · SNMP                 │
│  qos/         throughput · goodput · IPDV jitter · loss mix   │
│  faults/      link down/restore · BER · queue resize          │
│  experiments/ parameter sweeps · multi-seed · A/B comparison │
└───────────────────────────┬──────────────────────────────────┘
                            │ optional native shell
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  src-tauri/  Tauri window, packaging and IPC command shims   │
│  (native-shell only: it contains no simulation logic)        │
└──────────────────────────────────────────────────────────────┘
```

`src-tauri/` still exposes an IPC compatibility layer for the historical Rust engine, but no
simulation model lives there and it is not exercised by any test in this repository. On hosts
without a Rust toolchain it is inert; the browser front-end talks to the Python service.

## Quickstart

```bash
# 1. Python service (authoritative simulation core)
python3 -m venv .venv && .venv/bin/pip install pytest ruff
.venv/bin/python python/netsim/server.py 8765      # http://127.0.0.1:8765/health

# 2. Front-end
npm install
npm run dev                                        # http://127.0.0.1:1420
```

The dev server also proxies `/netsim-api/*` to the Python service, so the UI works when it is
reached through a forwarded host instead of loopback. Point it elsewhere with
`NETSIM_API_TARGET=http://host:port npm run dev`.

## Verification status

Counts below are from the audit run recorded in
[`QUALITY_AUDIT_REPORT.md`](QUALITY_AUDIT_REPORT.md). Anything that could not be executed in the
audit environment is listed as *not verified* rather than assumed to pass.

| Suite | Command | Result |
|---|---|---|
| Python tests | `.venv/bin/python -m pytest python/tests -q` | **137 passed** |
| Python lint + format | `.venv/bin/ruff check python/ && .venv/bin/ruff format --check python/` | clean (67 files) |
| Front-end typecheck | `npx tsc --noEmit` | clean |
| Front-end unit/component tests | `npx vitest run` | **93 passed, 7 skipped** (live suite opt-in) |
| Front-end ↔ service integration | `NETSIM_LIVE_API=1 npx vitest run src/integration` | **11 passed** (real service) |
| Production build | `npm run build` | succeeds |
| Browser end-to-end | `npx playwright test` | 21 tests defined — **not executed in the audit sandbox** (no browser available) |
| Rust shell | `cargo test` | **not verified** (no Rust toolchain; the shell holds no simulation logic) |

Optional live/end-to-end runs require the Python service to be up:

```bash
.venv/bin/python python/netsim/server.py 8765          # terminal 1
NETSIM_LIVE_API=1 npx vitest run src/integration       # integration against the real service
npx playwright install chromium && npx playwright test # browser E2E (starts both servers)
```

## Command surface

Every command is a POST with a JSON object body: `POST /api/<command>`.
Representative commands:

| Area | Commands |
|---|---|
| Project | `get_project`, `create_project`, `save_project_json`, `load_project_json` |
| Topology | `add_node`, `update_node`, `remove_node`, `add_link`, `update_link`, `remove_link`, `update_interface`, `undo_topology`, `redo_topology` |
| Simulation | `get_simulation_state`, `step_simulation`, `run_simulation_micros`, `run_simulation_until_empty`, `reset_simulation`, `inject_packet`, `get_packet_details` |
| Algorithms | `calculate_routing_table`, `simulate_routing_convergence`, `calculate_ipv4_subnet`, `split_ipv4_subnet`, `allocate_vlsm_subnets`, `validate_ipv6_address`, NAT commands |
| Data link | `calculate_hamming_encode`, `verify_and_correct_hamming`, `calculate_crc`, `verify_crc`, `calculate_internet_checksum`, `verify_internet_checksum`, `simulate_sliding_window`, `simulate_go_back_n`, `simulate_selective_repeat`, `simulate_pure_aloha`, `simulate_slotted_aloha`, `simulate_csma`, `simulate_csma_cd` |
| Transport / application | `simulate_tcp`, `simulate_udp`, `simulate_tcp_congestion`, `simulate_dns`, `simulate_http`, `simulate_ftp`, `simulate_smtp`, `simulate_snmp` |
| QoS, faults, experiments | `get_current_qos_metrics`, `schedule_fault_command`, `run_parameter_sweep_command`, `run_comparative_experiment_command` |

Errors are structured: HTTP 400 with `{ "status": "error", "code": "invalid_request", "message": ... }`
for rejected input, 404 for an unknown command, 500 for a genuine internal fault. A rejected
command never returns a substitute result.

## Known limitations

- **Parity is semantic, not bit-exact.** The Python deterministic PRNG is an LCG with the same
  observable behaviour as the historical Rust `ChaCha8Rng` stream, but it is *not* a bit-exact
  reproduction; absolute values from the Rust era are not reproducible and the repository makes
  no claim that they are.
- **Interface limit.** Nodes hold up to 24 interfaces. `add_link` provisions a new port when all
  existing ports are occupied; an explicitly named busy port is still rejected.
- **Sweeps at very low offered load** show identical throughput across bandwidths because the
  traffic never saturates the link. Use ≥40 packets with a short inter-packet interval to observe
  a bandwidth effect.
- **`dropped_segments` drops the first transmission** of each listed segment index. The
  retransmission is delivered, so TCP recovers; UDP records the loss without recovery.
- **Rust desktop shell** is untested in this repository (no toolchain) and contains no simulation
  logic; the deployable, verified path today is the browser front-end plus the Python service.

## Further documentation

`ARCHITECTURE.md` (component detail), `ALGORITHMS.md` (formulas), `TESTING.md` (test strategy),
`USER_GUIDE.md` (walkthrough), `QUALITY_AUDIT_REPORT.md` (audit findings and evidence).
`PRD.md`, `SRS.md`, `MASTER_SPECIFICATION.md`, `ANTIGRAVITY_PROMPT.md` and `PROJECT_REPORT.md` are
historical planning documents; where they describe Rust as the simulation authority they are
superseded by this file.
