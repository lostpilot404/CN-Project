# NetSim — Interactive Computer Network Simulation and Performance Analysis Platform

NetSim is an educational computer-network simulator: a discrete-event simulation core written in
**Python 3.11+** and a **React 18 + TypeScript** front-end that renders what the core returns.

## Educational contribution and implementation audit

NetSim targets students and instructors exploring how networking algorithms respond to controlled
inputs. Its defensible contribution is an integrated, inspectable teaching workflow—not a new
networking algorithm or demonstrated superiority over Packet Tracer.

See the [implementation-aware novelty audit](docs/IMPLEMENTATION_NOVELTY_AUDIT.md) for the
feature evidence, related-tool comparison, limitations and prioritized changes. The existing
**Flow Control comparison mode** already compares Go-Back-N and Selective Repeat using matched
inputs. A [reproducible example](examples/compare_flow_control.py) exports both traces and metrics:

```bash
PYTHONPATH=python python examples/compare_flow_control.py > flow-comparison.json
```

**Current boundary:** the general runner explicitly dispatches topology packets (`network`), TCP
bulk transfer and UDP bulk transfer. Other targets and unsupported parameter combinations fail
clearly. Sweep/A-B downloads include full configuration, topology and per-run evidence; see
[the workflow and replay guide](docs/EXPERIMENT_WORKFLOW.md) for supported settings and model
limitations. The [project report](PROJECT_REPORT.md) now describes the Python-backed runtime.
The dated novelty audit records the pre-fix baseline, not the current completion status.

## Architecture and ownership

**Python is the sole simulation authority.** All simulation state, protocol execution, packet
processing, routing, timing, metrics, event generation and experiment results are produced by
`python/netsim/`. The front-end is a presentation and input layer: it renders the results it is
given and never computes or fabricates a simulation result. When the service is unreachable the UI
says so instead of substituting data.

```text
┌──────────────────────────────────────────────────────────────┐
│  Presentation (React 18 · TypeScript · Tailwind · xyflow)    │
│  src/          — UI only, no simulation logic                │
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
│  qos/         throughput · goodput · IPDV jitter · loss mix  │
│  faults/      link down/restore · BER · queue resize         │
│  experiments/ parameter sweeps · multi-seed · A/B comparison │
└──────────────────────────────────────────────────────────────┘
```

There is no second engine and no alternative runtime. The front-end has no fallback that could
produce a simulation result on its own: an unreachable backend raises an error that the UI displays.

## Prerequisites

- **Python 3.11 or newer** (the core and the service).
- **Node.js 22.x LTS, 22.22.2 or newer within 22.x** with npm (the front-end build and tests). `package.json` declares `^22.22.2`; CI pins 22.22.2 and the audit environment ran 22.22.3. Other majors are untested — and several dependencies exclude Node 23.x/25.x outright, while the jsdom 30 stack cannot run on Node 20.
- A Chromium browser for the browser test suite. Playwright can install one itself, or you can
  point it at an existing binary — see [Browser tests](#browser-tests).

## Quickstart

```bash
# 1. Python service (authoritative simulation core) — terminal 1
python3 -m venv .venv
.venv/bin/pip install pytest ruff mypy   # pytest-cov is optional, for coverage reports
# Required for the supported verification commands: the python-tools test suite and the
# mypy check both import python-tools/plot_metrics.py, which needs matplotlib.
# Install it in every environment where you intend to run the full test gate.
.venv/bin/pip install -r python-tools/requirements.txt
.venv/bin/python python/netsim/server.py 8765      # http://127.0.0.1:8765/health

# 2. Front-end — terminal 2
npm install
npm run dev                                        # http://127.0.0.1:1420
```

The front-end resolves the service in this order:

1. `VITE_NETSIM_API_URL` when set (for example `http://127.0.0.1:8765`).
2. `http://127.0.0.1:8765` — the default for local development.
3. Same-origin `/netsim-api` — used when the UI is reached through a forwarded host rather than
   loopback. The Vite dev server proxies that prefix to the Python service, so the UI works behind
   a proxy without any change to the browser-facing URLs.

Point the proxy somewhere else with `NETSIM_API_TARGET=http://host:port npm run dev`.

### Ports

| Component | Default port | How to change |
|---|---|---|
| Python simulation service | `8765` | `python python/netsim/server.py <port>` |
| Vite dev server | `1420` | `vite.config.ts` → `server.port` |
| Vite API proxy target | `http://127.0.0.1:8765` | `NETSIM_API_TARGET` env var |

The Python service binds loopback (`127.0.0.1`) only. Starting a second instance on the same port
fails loudly with the operating system's bind error rather than silently serving on a different one.

## Verification status

Verified **2026-10-28** on the consolidated `main` (all work branches merged; binary audit
evidence removed — see the consolidation notes in the audit reports). Detailed historical
results and limitations are recorded in [the final release gate](docs/FINAL_VERIFICATION.md),
[`FINAL_ENGINEERING_REPORT.md`](FINAL_ENGINEERING_REPORT.md) and
[`SUBMISSION_READINESS_REVIEW.md`](SUBMISSION_READINESS_REVIEW.md). The older
`QUALITY_AUDIT_REPORT.md` is a historical baseline, not the current test-count source.

| Suite | Command | Consolidated result (2026-10-28) |
|---|---|---|
| Python backend tests | `.venv/bin/python -m pytest python/tests -q` | **267 passed** |
| Utility tests (`python-tools/`) | `.venv/bin/pytest python-tools/tests -q` | **83 passed** |
| Python lint + format | `.venv/bin/ruff check .` and format check | clean, 81 formatted Python files |
| Python static types | `.venv/bin/mypy` | clean, 67 source files |
| Frontend typecheck | `npm run typecheck` | clean |
| Frontend unit/component | `npm test` | **126 passed, 11 skipped** (opt-in live suite) |
| Frontend ↔ service integration | `npm run test:live` | **11 passed** (real service) |
| Production build | `npm run build` | succeeds; code-split chunks, largest ≈ 379 kB; bundle contains only the inert test-double stub |
| Real Chromium E2E | `npx playwright test` | run by CI (`e2e-gate`: functional + accessibility, cold start) on every PR |

### Evidence categories and novelty boundary

- **Implemented and verified:** three supported experiment targets, bandwidth sweep/A-B browser
  downloads and replay, matched-loss GBN/SR task; broader wiring is regression-tested.
- **Implemented but not manually verified:** individual non-bandwidth browser sweeps, wider inputs,
  human usability and cross-platform replay.
- **Comparable capability found in Packet Tracer:** topology/packet inspection, routing/addressing,
  saving/rerunning scenarios, established by official documentation—not a local application test.
- **Candidate differentiator requiring further evidence:** the exact integrated GBN/SR and experiment
  evidence workflow relative to a named Packet Tracer build; no verified exclusivity.
- **Unsupported or out of scope:** other protocol targets in the general runner, full device
  emulation and unsupported transport faults/loss/timed injection.

Packet Tracer was unavailable; its advertised version 9.0.1 is established from official sources,
but its exact installed build and direct workflow parity remain unverified. See the
[source-backed comparison](docs/PACKET_TRACER_COMPARISON.md). NetSim's contribution is integration
for selected educational tasks, not a first/unique/faster/more-accurate/superior claim. The release
is **not unconditionally ready for exclusive novelty claims**. Live jsdom tests retain `act(...)`
warnings; recorded download flows had no first-party console/service errors.

### Running the tests

```bash
# Python — no service required
.venv/bin/python -m pytest python/tests -q
.venv/bin/pytest python-tools/tests -q
.venv/bin/ruff check . && .venv/bin/ruff format --check python/ python-tools/
.venv/bin/mypy

# Front-end — no service required
npx tsc --noEmit
npx vitest run
npm run build

# Integration against the real Python service (service must be running)
.venv/bin/python python/netsim/server.py 8765 &        # terminal 1
NETSIM_LIVE_API=1 npx vitest run src/integration       # terminal 2

# Browser end-to-end (starts both servers itself via playwright.config.ts)
npx playwright test
npx playwright test e2e/a11y.spec.ts        # accessibility audit alone
```

The integration suite is skipped unless `NETSIM_LIVE_API=1` is set, which is why `npx vitest run`
reports 11 skipped tests. They are not disabled — they require a running service.

CI (`.github/workflows/ci.yml`) runs the same gate on every push and pull request: Python tests
and tool tests, ruff, mypy, tsc, vitest, a production build with a double-free bundle check, and
the browser suites from a cold start.

### Browser tests

`npx playwright test` starts both the Python service and the Vite dev server itself and drives a
real Chromium. Playwright's own browser download is the normal way to get one:

```bash
npx playwright install chromium
npx playwright test
```

#### Running the browser suite where downloads are blocked

Some sandboxes (including CI containers with restricted egress) cannot reach `cdn.playwright.dev`,
so `npx playwright install` fails with `ECONNRESET`. Two workarounds:

**1. Use a browser that is already on the machine**

```bash
NETSIM_CHROMIUM_PATH=/path/to/chromium npx playwright test
```

**2. Use the self-contained Chromium published to npm**

`@sparticuz/chromium` ships a Chromium build *and* the shared libraries it needs, compressed with
Brotli, so it works on a host with no browser and no browser-CDN access:

```bash
mkdir -p /tmp/browser && cd /tmp/browser && npm init -y && npm install @sparticuz/chromium
node -e "
const z = require('zlib'), fs = require('fs');
fs.mkdirSync('out', { recursive: true });
for (const name of ['chromium', 'al2023.tar']) {
  const buf = z.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/' + name + '.br'));
  fs.writeFileSync('out/' + name, buf);
}"
chmod +x out/chromium && mkdir -p libs && tar -xf out/al2023.tar -C libs

cd -    # back to the repository
LD_LIBRARY_PATH=/tmp/browser/libs/lib NETSIM_CHROMIUM_PATH=/tmp/browser/out/chromium npx playwright test
```

`playwright.config.ts` reads `NETSIM_CHROMIUM_PATH` and passes it to Chromium as `executablePath`
with `--no-sandbox --disable-dev-shm-usage --disable-gpu`. The E2E harness also stubs
`fonts.googleapis.com` (the only third-party request the app makes) so an offline run does not
report a resource error that has nothing to do with the application.

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
| Circuit switching | `request_circuit`, `teardown_circuit`, `get_circuit_state` |

Errors are structured: HTTP 400 with `{ "status": "error", "code": "invalid_request", "message": ... }`
for rejected input, 404 for an unknown command, 500 for a genuine internal fault. A rejected
command never returns a substitute result.

## Implementation scope

NetSim is an educational simulator. The table below states honestly what each area does today —
**Implemented** (fully exercised by tests), **Partial** (real behaviour with documented
boundaries), and **Illustrative** (visual or model output that does not claim production
protocol behaviour).

| Area | Status | What it does and does not do |
|---|---|---|
| Packet switching engine | Implemented | Discrete-event store-and-forward engine with per-hop table-driven forwarding (Dijkstra/Bellman-Ford next hop), enforced TTL/hop limit, loop guard, explicit per-packet drop causes, and deterministic per-seed replay. |
| Circuit switching | Partial | Educational admission-control model in the Circuit Switching workspace: setup resolves the same authoritative routing path and reserves the requested rate on **every** link (all-or-nothing), blocked requests get a precise reason, teardown releases capacity, and per-link utilisation/blocking metrics are reported. It is a resource-reservation model — there is no call signalling, no holding-time traffic pattern, and no cross-connect hardware behaviour. |
| IPv4 / subnetting | Implemented | Subnet calculation, VLSM allocation and validation are real arithmetic. |
| IPv6 | Partial | Validation, RFC 5952 canonical formatting, expansion/compression and scope classification are real. IPv6 addresses are **text labels**: the packet engine forwards IPv4-style headers only, and no IPv6 routing, neighbour discovery or dual-stack behaviour is simulated. |
| NAT | Partial | Real stateful NAPT model: dynamic SNAT with per-router port pools, static DNAT rules, timeout tracking, and strict per-router/per-project state isolation. Prefix handling normalises wildcarded `0.x` octets. It is not a full NAT traversal story: no ALGs, no port-preservation heuristics beyond the pool, no ICMP error rewriting. |
| MAC / Ethernet | Illustrative | Interfaces carry generated MAC identifiers and the L2 header visualisation shows Ethernet II fields (with FCS). There is **no** MAC learning, bridging, ARP/ND resolution or switch forwarding — MACs are display identifiers, and the L2 header addresses on packets are fixed illustrative values, not learned from the topology. |
| Sliding window / GBN / Selective Repeat | Partial | A receding-window time-step model with real window/sequence/ACK/timeout/retransmission bookkeeping per protocol (in-order delivery, GBN rewind, SR buffering). It is a teaching model: discrete rounds, simplified ACK timing, no delayed ACKs or ACK loss. |
| Hamming / CRC / checksum | Implemented | Real algorithms with intermediate values exposed for learning (parity placement, syndrome-based single-bit correction, modulo-2 division, one's-complement arithmetic). |
| TCP | Partial | Educational transport simulation over the real routed topology: three-way handshake, slow start, congestion avoidance, fast retransmit, timeout recovery, Jacobson-style RTT estimation, and wire-vs-goodput accounting. It is **not** a production stack: no SACK, no window scaling, no delayed ACKs, simplified congestion response, and the receiver window is not modelled as a bottleneck. |
| UDP | Implemented | Single-phase datagram path over the same routed engine, with loss recorded without recovery. |
| Application models (DNS/HTTP/FTP/SMTP/SNMP) | Illustrative | Request/response event timelines with realistic field visualisation (e.g. DNS record types, HTTP methods/status). No real application payloads, caches or server state machines are executed. |
| QoS metrics | Implemented | Throughput and goodput are distinct documented quantities (wire rate vs unique delivered payload; see the QoS metric definitions), with hand-calculated regression coverage. |
| Faults | Implemented | Scheduled link down/restore events with downstream rerouting through the forwarding table and exactly-once drop accounting. |
| Experiments (sweeps, A/B comparisons) | Implemented | Seeded, deterministic batch runs over the real engine with aggregated statistics, raw deltas, and JSON/CSV exports consumable by `python-tools`. |

The same distinctions are restated next to the affected features in `USER_GUIDE.md`, and the
algorithm-level boundaries are documented in `ALGORITHMS.md`.

## Known limitations

- **Determinism is reproducible for a given seed, but is not a bit-exact reproduction of the
  pre-Python era.** The engine seeds CPython's `random.Random` (`python/netsim/core/rng.py`), so the
  same seed produces the same run — verified: two runs at seed 1234 yield the identical sequence
  `0.966454, 0.440733, 0.007491, ...`, and a different seed diverges. Absolute values recorded
  against the historical Rust `ChaCha8Rng` stream are **not** reproducible and no claim is made
  that they are.
- **Interface limit.** Nodes hold up to 24 interfaces. `add_link` provisions a new port when all
  existing ports are occupied; an explicitly named busy port is still rejected.
- **Sweeps at very low offered load** show identical throughput across bandwidths because the
  traffic never saturates the link. Use ≥40 packets with a short inter-packet interval to observe
  a bandwidth effect.
- **`dropped_segments` drops the first transmission** of each listed segment index. The
  retransmission is delivered, so TCP recovers; UDP records the loss without recovery.
- **NAT state is per-project.** `create_project` and `load_project_json` clear the static and
  dynamic NAT tables so a new project cannot inherit port forwards from a previous one.

## Repository layout

| Path | Contents |
|---|---|
| `python/netsim/` | Authoritative simulation core and HTTP command surface |
| `python/tests/` | Python test suite (unit + in-process HTTP integration) |
| `src/` | React front-end (UI only) |
| `src/lib/apiClient.ts` | Service endpoint resolution, health probing, retries |
| `src/lib/api.ts` | Typed command surface consumed by the UI |
| `src/lib/testDouble.ts` | In-memory double used **only** by the vitest runner |
| `e2e/` | Playwright browser suite (`netsim.spec.ts` functional, `a11y.spec.ts` axe-core audit) |
| `python-tools/` | Optional standalone scripts for analysing exported experiment JSON, with their own test suite. Not needed to run the simulator, but `pip install -r python-tools/requirements.txt` (matplotlib) is required before running the utility tests and `mypy` |

## Further documentation

`ARCHITECTURE.md` (component detail), `ALGORITHMS.md` (formulas), `TESTING.md` (test strategy),
`USER_GUIDE.md` (walkthrough), `QUALITY_AUDIT_REPORT.md` (audit findings and evidence).

`PRD.md`, `SRS.md`, `MASTER_SPECIFICATION.md`, `ANTIGRAVITY_PROMPT.md`, `PROJECT_REPORT.md` and
`walkthrough.md` are **historical planning documents** from an earlier Rust-based design. They are
kept for project history only. Where any of them describes Rust or Tauri as the simulation
authority, that description is obsolete: the authoritative engine is `python/netsim/`.
