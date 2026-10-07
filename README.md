# NetSim — Interactive Computer Network Simulation Platform

NetSim is an interactive computer network simulation and performance analysis platform built for learning, experimentation, and academic demonstrations. It features an authoritative discrete-event simulation core implemented in **Python 3.12**, an engineering desktop host application powered by **Tauri 2.x**, and a frontend built with **React 18**, **TypeScript**, **Tailwind CSS**, **@xyflow/react**, and **Recharts**.

---

## Authoritative Architecture

Following the Phase 8 Python port, the authoritative simulation and domain engine is implemented in Python with guaranteed behavioural parity against the historical Rust implementation.

```text
┌────────────────────────────────────────────────────────┐
│             Presentation Frontend (React 18)           │
│                                                        │
│   TypeScript • Tailwind CSS • @xyflow/react • Recharts │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP JSON RPC / Tauri IPC
                            ▼
┌────────────────────────────────────────────────────────┐
│              Python Simulation Core (netsim/)          │
│                                                        │
│  • Discrete-Event Engine & Microsecond Virtual Clock   │
│  • Priority Event Queue (SimTime, event_id)            │
│  • Deterministic Seeded PRNG                           │
│  • Topology, Bidirectional Links & Drop-Tail Queues   │
│  • Routing: Dijkstra Link-State & Bellman-Ford DV      │
│  • Addressing: IPv4/IPv6, CIDR Splitting, Stateful NAT │
│  • Data Link: Hamming (SECDED), CRC Modulo-2, Checksum │
│  • Flow Control: Sliding Window, Go-Back-N, Sel-Repeat │
│  • Multiple Access: ALOHA, Slotted ALOHA, CSMA, CSMA/CD│
│  • Transport: TCP Reno (RTT/RTO, Tahoe/Reno cwnd), UDP │
│  • Application: DNS, HTTP 1.1, FTP, SMTP, SNMP v2c     │
│  • QoS: Throughput, IPDV Jitter (RFC 3393), Latency    │
│  • Faults: Link down/restore, Bit errors, Queue shifts │
│  • Experiments: Parameter sweeps, Multi-seed, A/B test │
└───────────────────────────┬────────────────────────────┘
                            │ Native Shell (Desktop)
                            ▼
┌────────────────────────────────────────────────────────┐
│             Tauri 2.x Rust Desktop Shell               │
│         Windowing • Native OS Menus • Packaging        │
└────────────────────────────────────────────────────────┘
```

---

## Key Capabilities

- **Authoritative Python Core**: Full networking models, priority event queues, deterministic PRNG, routing algorithms, protocol state machines, and QoS metrics calculations strictly computed in Python.
- **Interactive Topology Designer**: Visual network canvas using `@xyflow/react` supporting Workstation PCs, Core Routers, L2 Switches, Web Servers, and Wireless Access Points with dynamic link parameterization.
- **Virtual Simulation Clock**: Discrete-event timing strictly decoupled from wall-clock time, allowing deterministic event-by-event stepping and high-speed batch executions.
- **Authoritative Algorithm Suite**:
  - Routing: Dijkstra Link State & Bellman-Ford Distance Vector with convergence telemetry
  - Data Link Error Control: Hamming Code (parity, single-bit correction), CRC (modulo-2 division, polynomials), Internet Checksum (RFC 1071)
  - Flow Control: Sliding Window, Go-Back-N, Selective Repeat
  - Multiple Access: Pure ALOHA, Slotted ALOHA, CSMA, CSMA/CD with binary exponential backoff
  - Transport & Congestion: TCP Reno (handshake, Jacobson/Karn RTT, retransmission, fast recovery) and UDP
  - Application Layer: DNS (recursive/iterative), HTTP (GET/POST 200/404), FTP (control/data channels), SMTP (mail transaction/550 error), SNMP (GET/GETNEXT/walk)
- **Full Packet Encapsulation**: 5-layer OSI / TCP-IP packet inspector displaying application, transport, network, data link, and physical layer fields with complete hop history.
- **Fault Injection & Experiments**: Controlled link drops, packet loss sweeps, multi-seed Monte Carlo simulations, and comparative A/B studies.
- **QoS Telemetry**: RFC 3393 IPDV jitter calculation, throughput/goodput accounting, and loss breakdown without double counting.

---

## Verification & Testing Matrix

The platform is comprehensively verified across four automated testing suites:

| Test Suite | Framework | Count | Status | Description |
|---|---|---|---|---|
| **Python Unit & Parity** | `pytest` | 35 | PASS | All 24 golden parity scenarios + domain & API tests |
| **Python Code Quality** | `ruff check` & `format` | 53 files | PASS | Strict PEP 8 and formatting standards |
| **Frontend Unit Tests** | `vitest` | 79 | PASS | Components, state transitions, UI formatters |
| **End-to-End UI Matrix** | `playwright` | 10 | PASS | Real browser automation across all 10 workspaces |
| **Frontend Type Safety**| `tsc --noEmit` | - | PASS | Strict TypeScript compiler check |
| **Frontend Production** | `vite build` | - | PASS | Bundles cleanly for production distribution |
| **Rust Shell Tests** | `cargo test --all` | 120 | PASS | Shell integrity & host regression tests |
| **Rust Shell Linter** | `cargo clippy` | - | PASS | Zero warnings with `-D warnings` |

---

## Quickstart & Launch Instructions

### 1. Set Up Python Environment
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r python-tools/requirements.txt pytest ruff
```

### 2. Run Authoritative Simulation Server
```bash
python python/netsim/server.py 8765
```

### 3. Launch Frontend in Development Mode
```bash
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

### 4. Run Desktop App via Tauri
```bash
npm run tauri dev
```

### 5. Run Verification Suites
```bash
# Python parity and unit tests
pytest python/tests/ -v

# Python lint and formatting
ruff check python/
ruff format --check python/

# Frontend unit tests and typecheck
npm run typecheck
npm run test

# End-to-end browser tests
npx playwright test

# Rust host verification
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```
