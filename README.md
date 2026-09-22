# NetSim — Interactive Computer Network Simulation Platform

NetSim is an interactive computer network simulation and performance analysis platform built for learning, experimentation, and academic demonstrations. It features an authoritative discrete-event simulation core written in **Rust**, an engineering desktop application powered by **Tauri 2.x**, and a frontend built with **React 18**, **TypeScript**, **Tailwind CSS**, **@xyflow/react**, and **Recharts**.

---

## Key Capabilities

- **Authoritative Rust Core**: All networking models, priority event queues, deterministic PRNG, routing algorithms, protocol state machines, and QoS metrics calculations are strictly computed in Rust.
- **Interactive Topology Designer**: Visual network canvas using `@xyflow/react` supporting Workstation PCs, Core Routers, L2 Switches, Web Servers, and Wireless Access Points with dynamic link parameterization (bandwidth, propagation delay, loss rate, error rate, queue size).
- **Virtual Simulation Clock**: Discrete-event timing strictly decoupled from wall-clock time, allowing deterministic event-by-event stepping and high-speed batch executions.
- **Authoritative Algorithm Suite**:
  - Routing: Dijkstra Link State & Bellman-Ford Distance Vector
  - Data Link Error Control: Hamming Code (parity, single-bit correction), CRC (modulo-2 division, polynomials), Internet Checksum (1s complement)
  - Flow Control: Sliding Window, Go-Back-N, Selective Repeat
  - Multiple Access: ALOHA, Slotted ALOHA, CSMA, CSMA/CD
  - Switching: Circuit Switching vs Packet Switching
  - Transport & Congestion: Educational TCP (handshake, sequence, timeouts, RTT, cwnd) and UDP
- **Full Packet Encapsulation**: 5-layer OSI / TCP-IP packet inspector displaying application, transport, network, data link, and physical layer fields.
- **Fault Injection & Experiments**: Controlled link drops, packet loss sweeps, and comparative metrics visualization.
- **Learning & Exam Modes**: Guided interactive step-by-step algorithmic breakdowns and syllabus-aligned challenges with automated verification.
- **Optional Python Analysis Toolkit**: Standalone statistical processing and publication-quality plotting scripts consuming exported JSON/CSV simulation data.

---

## Technology Architecture

```text
┌────────────────────────────────────────────────────────┐
│                       Tauri 2.x                        │
│                                                        │
│   React 18 + TypeScript + Tailwind CSS + @xyflow/react │
└───────────────────────────┬────────────────────────────┘
                            │ Tauri IPC Commands
                            ▼
┌────────────────────────────────────────────────────────┐
│                       Rust Core                        │
│                                                        │
│  Domain Model • Priority Event Queue • Virtual Clock   │
│  Routing • Flow Control • Error Control • Queues • QoS │
│  Deterministic Seeded PRNG • Versioned JSON Storage    │
└───────────────────────────┬────────────────────────────┘
                            │ Exported JSON / CSV
                            ▼
┌────────────────────────────────────────────────────────┐
│             Optional Python Analysis Toolkit           │
│       pandas • numpy • matplotlib (in python-tools/)   │
└────────────────────────────────────────────────────────┘
```

---

## Requirements & Prerequisites

1. **Node.js**: v18+ (tested with v24.18.0) and **npm** (tested with v11.16.0)
2. **Rust**: Rust 1.80+ (toolchain: `stable-x86_64-pc-windows-gnu` or `msvc`)
3. **C/C++ Compiler**: GCC (e.g. MSYS2 UCRT64 / MinGW) or Visual Studio C++ Build Tools
4. **Python** *(optional)*: Python 3.10+ for `python-tools/`

---

## Quickstart & Launch Instructions

### 1. Install Frontend Dependencies
```bash
npm install
```

### 2. Verify Foundation Builds & Tests
```bash
# Run Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Run Frontend tests & type checking
npm run typecheck
npm run test
npm run build
```

### 3. Launch the NetSim Desktop Application
```bash
npm run tauri dev
```

### 4. Or Run Frontend in Web Development Mode
```bash
npm run dev
```
Open `http://localhost:1420` in your browser.

---

## Project Structure

```text
NetSim/
├── Cargo.toml                  # Root workspace configuration
├── src-tauri/                  # Tauri 2.x Desktop Shell & Rust Core
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/           # Tauri desktop security capabilities
│   ├── icons/                  # Windows, macOS, and Linux application icons
│   ├── src/
│   │   ├── main.rs             # Application entry point
│   │   ├── lib.rs              # Library exports & IPC command registration
│   │   ├── error.rs            # Structured NetSimError types
│   │   ├── state.rs            # Thread-safe AppState (Project + SimulationEngine)
│   │   ├── commands/           # Tauri IPC handlers (project, topology, sim, algorithms)
│   │   ├── domain/             # Node, Link, Interface, Packet, Project models
│   │   └── simulation/         # SimTime, SimEvent, Priority Queue, DeterministicRng
│   └── tests/                  # Rust integration & algorithm test suite
├── src/                        # React 18 + TypeScript Desktop Interface
│   ├── index.css               # Engineering dark-mode design system
│   ├── types/                  # Typed interfaces matching Rust DTOs
│   ├── lib/                    # Tauri IPC bridge with browser mock fallback
│   └── components/             # Navbar, Sidebar, TopologyCanvas, ControlBar, TimelineDrawer
├── python-tools/               # Optional batch analysis & plotting scripts
│   ├── requirements.txt
│   ├── analyze_results.py
│   └── plot_metrics.py
└── dist/                       # Production frontend assets
```

---

## Verification & Testing Strategy

- **Rust Suite**: Validates serialization, SimTime arithmetic, min-heap chronological event dispatch, deterministic PRNG replay, and checksum correctness.
- **Frontend Suite**: Vitest tests verify unit formatting functions and typed IPC communication.
- **Static Analysis**: `cargo clippy`, `cargo fmt`, and `tsc --noEmit` ensure strict type safety and code quality.
