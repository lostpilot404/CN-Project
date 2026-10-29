# NetSim

[![CI](https://github.com/lostpilot404/CN-Project/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lostpilot404/CN-Project/actions/workflows/ci.yml)

NetSim is an educational computer-network simulator: a discrete-event simulation core written in
**Python 3.11+** with a **React 18 + TypeScript** front-end. Students and instructors can build
topologies, run protocol models under controlled inputs, inspect packets layer by layer, and run
reproducible batch experiments (parameter sweeps and A/B comparisons) over the same engine.

## Features

- **Topology canvas** — nodes, links, keyboard connection workflow, undo/redo, project
  save/load and validated import/export (`.netsim` JSON).
- **Packet simulation** — table-driven store-and-forward engine (Dijkstra / Bellman-Ford next
  hop, TTL and loop protection, explicit drop causes), event timeline, 5-layer packet inspector.
- **Routing studio** — link-state and distance-vector routing tables with convergence traces.
- **Addressing & NAT** — IPv4/CIDR/VLSM calculation, IPv6 validation/formatting, stateful NAT.
- **Algorithm studio** — Hamming(7,4)+SECDED, CRC, RFC 1071 checksum, sliding-window /
  Go-Back-N / Selective Repeat, and ALOHA / CSMA / CSMA-CD medium-access models.
- **Transport studio** — TCP (handshake, slow start, congestion avoidance, fast retransmit,
  Jacobson/Karn RTT estimation) and UDP over the routed topology.
- **Application studio** — DNS, HTTP, FTP, SMTP and SNMP request/response timelines.
- **Circuit switching** — admission-control model with all-or-nothing rate reservation.
- **QoS & faults** — throughput/goodput/jitter/loss metrics, scheduled link faults with rerouting.
- **Batch experiments** — seeded deterministic sweeps and A/B comparisons with JSON/CSV export
  and offline replay (`examples/`, `python-tools/`).

## Architecture

**Python is the sole simulation authority.** All simulation state, protocol execution, routing,
timing, metrics and experiment results are produced by `python/netsim/`. The front-end is a
presentation and input layer only: it renders what the service returns and never computes a
simulation result. When the service is unreachable the UI says so instead of substituting data.

```text
┌──────────────────────────────────────────────────────────────┐
│  Presentation (React 18 · TypeScript · Tailwind · xyflow)    │
│  src/          — UI only, no simulation logic                │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP JSON  (POST /api/<command>)
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Authoritative Python simulation core  (python/netsim/)      │
│  core/        µs virtual clock · priority event queue · PRNG │
│  models/      nodes · interfaces · links · packets · projects│
│  routing/     Dijkstra link-state · Bellman-Ford DV          │
│  addressing/  IPv4/IPv6 · CIDR · VLSM · stateful NAT         │
│  datalink/    Hamming · CRC · checksum · flow control · MAC  │
│  transport/   TCP · UDP · congestion                         │
│  application/ DNS · HTTP · FTP · SMTP · SNMP                 │
│  switching/   circuit admission control                      │
│  qos/         throughput · goodput · jitter · loss           │
│  faults/      link down/restore · BER · queue resize         │
│  experiments/ parameter sweeps · multi-seed · A/B comparison │
└──────────────────────────────────────────────────────────────┘
```

See [docs/architecture.md](docs/architecture.md) for component detail.

## Getting started

### Prerequisites

- **Python 3.11+**
- **Node.js 22.22.2 or later within 22.x (LTS)** with npm — `package.json` declares `^22.22.2`; the front-end
  test stack does not run on Node 20.
- A Chromium browser for the browser tests (Playwright can install one).

### Run

```bash
# 1. Python service (authoritative simulation core) — terminal 1
python3 -m venv .venv
.venv/bin/pip install pytest ruff mypy
.venv/bin/pip install -r python-tools/requirements.txt
.venv/bin/python python/netsim/server.py 8765      # http://127.0.0.1:8765/health

# 2. Front-end — terminal 2
npm install
npm run dev                                        # http://127.0.0.1:1420
```

| Component | Default port | How to change |
|---|---|---|
| Python simulation service | `8765` | `python python/netsim/server.py <port>` |
| Vite dev server | `1420` | `vite.config.ts` → `server.port` |
| Vite API proxy target | `http://127.0.0.1:8765` | `NETSIM_API_TARGET` env var |

The service binds loopback only. The UI resolves it via `VITE_NETSIM_API_URL` when set,
otherwise `http://127.0.0.1:8765`, otherwise the same-origin `/netsim-api` proxy.

## Usage

The app is organised into workspaces: Topology Canvas, Routing Studio, Addressing & NAT,
Simulation & Events, Algorithm Studio, Transport Layer, Application Layer, Circuit Switching,
QoS Performance and Batch Experiments. See [docs/user-guide.md](docs/user-guide.md) for a
walkthrough and [docs/experiment-workflow.md](docs/experiment-workflow.md) for running,
downloading and replaying experiments.

```bash
# Reproducible examples (no UI/service needed)
PYTHONPATH=python python examples/compare_flow_control.py > flow-comparison.json
PYTHONPATH=python python examples/replay_experiment.py netsim-sweep.json > replay.json
```

### HTTP API

Every command is a JSON POST to `/api/<command>` on the Python service. Representative
commands: `get_project`, `add_node`, `inject_packet`, `step_simulation`,
`calculate_routing_table`, `calculate_crc`, `simulate_tcp`, `simulate_dns`,
`get_current_qos_metrics`, `request_circuit`, `run_parameter_sweep_command`. Errors are
structured: HTTP 400 (`invalid_request`) for rejected input, 404 for an unknown command,
500 for an internal fault — a rejected command never returns a substitute result.

## Testing

```bash
# Python (no service required)
.venv/bin/python -m pytest python/tests -q
.venv/bin/pytest python-tools/tests -q
.venv/bin/ruff check . && .venv/bin/ruff format --check python/ python-tools/
.venv/bin/mypy

# Front-end (no service required)
npm run typecheck
npm test
npm run build

# Live integration (Python service running on :8765)
npm run test:live

# Browser end-to-end (starts both servers itself)
npx playwright install chromium   # or: NETSIM_CHROMIUM_PATH=/path/to/chromium
npx playwright test
```

CI (`.github/workflows/ci.yml`) runs on pushes to `main`, pull requests, and manual dispatch — Python
tests, ruff, mypy, typecheck, unit tests, production build (verified free of the test
double), and the Playwright suites from a cold start. The separate live-integration command is not a CI step.
The 11 live-integration tests report
as skipped unless `NETSIM_LIVE_API=1` is set. See [docs/testing.md](docs/testing.md).

## Scope and limitations

NetSim is an educational simulator; the following states plainly what each area does and
does not model. Algorithm-level detail is in [docs/algorithms.md](docs/algorithms.md).

| Area | Scope |
|---|---|
| Packet engine | Implemented: discrete-event store-and-forward, per-hop forwarding, deterministic per-seed replay. |
| Circuit switching | Partial: reservation/admission model only — no call signalling or holding-time traffic. |
| IPv4 / VLSM | Implemented arithmetic (subnetting, allocation, validation). |
| IPv6 | Partial: validation and RFC 5952 formatting; addresses are labels — no IPv6 forwarding/ND. |
| NAT | Partial: stateful dynamic SNAT + static DNAT with per-project isolation; no ALGs or ICMP rewriting. |
| MAC / Ethernet | Illustrative: generated MAC identifiers and header visualisation; no learning, bridging or ARP. |
| Flow control | Partial: teaching model with real window/ACK/timeout bookkeeping; discrete rounds, simplified ACK timing. |
| Error control | Implemented: Hamming/SECDED, CRC and checksum with intermediate values exposed. |
| TCP | Partial: handshake, slow start, congestion avoidance, fast retransmit, RTT estimation; no SACK/window scaling/delayed ACK. |
| UDP | Implemented datagram path over the routed engine; loss recorded without recovery. |
| Application protocols | Illustrative request/response timelines; no real payloads, caches or server state machines. |
| QoS / faults / experiments | Implemented: documented metric definitions, scheduled faults with rerouting, seeded batch runs with JSON/CSV export. |

Additional notes:

- Nodes hold up to 24 interfaces; `add_link` provisions a free port automatically, while an
  explicitly named busy port is rejected.
- Sweeps at very low offered load show identical throughput across bandwidths (the link never
  saturates); use ≥ 40 packets with a short interval to observe a bandwidth effect.
- `dropped_segments` drops the first transmission of each listed segment, so TCP recovers and
  UDP records the loss.
- NAT tables are per-project and are cleared on `create_project` / `load_project_json`.

## Project structure

| Path | Contents |
|---|---|
| `python/netsim/` | Authoritative simulation core and HTTP command surface |
| `python/tests/` | Python test suite |
| `src/` | React front-end (UI only) |
| `src/lib/apiClient.ts` · `src/lib/api.ts` | Endpoint resolution and typed command surface |
| `e2e/` | Playwright browser suites (functional, accessibility, experiment downloads) |
| `python-tools/` | Standalone analysis of exported experiment JSON, with its own tests |
| `examples/` | Reproducible command-line examples |
| `docs/` | Architecture, testing, user guide, algorithms, experiment workflow |
| `evidence/final-iceberg-audit/` | Historical audit report, defect register and retained captures (see provenance note) |
| `.github/workflows/ci.yml` · `ci/` | CI gate and reporting helper |

## Documentation

- [Architecture](docs/architecture.md)
- [User guide](docs/user-guide.md)
- [Algorithms](docs/algorithms.md)
- [Experiment workflow](docs/experiment-workflow.md)
- [Testing](docs/testing.md)
- [Cleanup inventory](docs/cleanup-inventory.md)
