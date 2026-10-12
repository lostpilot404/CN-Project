# NetSim --- Antigravity Master Build Prompt

> **Historical document (superseded, quality audit 2026-10).** Parts of this document
> describe a Rust simulation core. The authoritative simulation and domain engine is now
> `python/netsim/` (Python 3.11+), reached over HTTP by the React front-end; `src-tauri/`
> is a native shell that contains no simulation logic and is not covered by the current
> test suites. See `README.md` for the current architecture and verification status and
> `QUALITY_AUDIT_REPORT.md` for audit evidence.

You are the lead architect and engineer responsible for building NetSim.

Read all project documents before implementing:

-   PRD.md
-   SRS.md
-   ARCHITECTURE.md
-   ALGORITHMS.md
-   TESTING.md
-   USER_GUIDE.md
-   PROJECT_REPORT.md
-   MASTER_SPECIFICATION.md

## Mission

Build a polished Windows 11 desktop application for interactive
computer-network simulation.

## Mandatory Architecture

Use:

``` text
Tauri 2.x
    ↓
React + TypeScript
    ↓
Tauri Commands
    ↓
Rust Core
```

Python is optional and external.

## Critical Rule

Rust is the single authoritative source of truth for:

-   network state
-   packet state
-   simulation time
-   routing
-   protocol behavior
-   metrics
-   experiments

Do not duplicate authoritative algorithms in React or Python.

## Python Rule

Do not add PyO3 to v1 unless there is a concrete requirement.

Python should initially consume exported JSON/CSV results for:

-   batch experiments
-   statistical analysis
-   advanced charts
-   report processing

The desktop application must run without Python installed.

## Development Rules

1.  Inspect the repository first.
2.  Preserve useful existing work.
3.  Establish architecture before implementing large features.
4.  Implement incrementally.
5.  Keep Rust core modular.
6.  Keep UI separate from simulation.
7.  Write tests with algorithms.
8.  Run tests after significant changes.
9.  Never fabricate metrics.
10. Never hard-code comparison winners.
11. Never hide networking algorithms inside UI components.
12. Do not introduce unnecessary dependencies.
13. Do not silently remove requirements.
14. Document assumptions.
15. Keep the project runnable after each phase.

## Phase 1 --- Project Foundation

Create:

-   Tauri application
-   React/TypeScript frontend
-   Rust backend
-   shared request/response types
-   navigation
-   design system
-   logging
-   error handling

## Phase 2 --- Rust Domain Model

Implement:

-   Project
-   Node
-   Interface
-   Link
-   Packet
-   Route
-   Queue
-   Simulation configuration
-   Experiment

Add serialization.

Add schema versioning.

## Phase 3 --- Topology Editor

Implement:

-   node creation
-   node deletion
-   node movement
-   links
-   properties
-   undo/redo
-   save/load
-   validation

Use XYFlow for visualization.

## Phase 4 --- Simulation Engine

Implement a deterministic discrete-event engine.

Required:

-   simulation clock
-   priority event queue
-   seeded RNG
-   packet lifecycle
-   queues
-   link delay
-   loss
-   errors
-   event log

Do not use wall-clock sleeps to model network latency.

## Phase 5 --- Routing

Implement and test:

-   Dijkstra / Link State
-   Distance Vector / Bellman-Ford-style logic

Add:

-   routing tables
-   path visualization
-   route changes
-   failure recovery

## Phase 6 --- Addressing

Implement:

-   IPv4
-   CIDR
-   subnetting
-   duplicate-address detection
-   NAT visualization
-   basic IPv6

## Phase 7 --- Data Link

Implement and test:

-   Hamming
-   CRC
-   Checksum
-   Sliding Window
-   Go-Back-N
-   Selective Repeat
-   ALOHA
-   Slotted ALOHA
-   CSMA
-   CSMA/CD

## Phase 8 --- Transport

Implement educational:

-   TCP
-   UDP
-   ACKs
-   sequence numbers
-   retransmissions
-   RTT
-   congestion window

Clearly label TCP as an educational simulation model.

## Phase 9 --- Congestion and QoS

Implement:

-   Slow Start
-   Congestion Avoidance
-   simplified loss response
-   finite queues

Calculate:

-   throughput
-   latency
-   RTT
-   jitter
-   packet loss
-   queue delay
-   utilization
-   retransmissions

## Phase 10 --- Fault Injection

Implement:

-   packet loss
-   bit errors
-   link failure
-   router failure
-   queue overflow
-   bandwidth changes
-   latency changes

## Phase 11 --- Packet Inspector

Implement an inspector showing:

-   application layer
-   transport layer
-   network layer
-   data-link layer
-   headers
-   source/destination
-   sequence
-   TTL
-   route
-   timestamps
-   state

## Phase 12 --- Event Timeline

Show simulation events.

Selecting an event should identify the relevant packet/node/link.

## Phase 13 --- Experiments

Implement:

-   experiment templates
-   parameter sweeps
-   repeated runs
-   seed management
-   result storage
-   comparison charts

## Phase 14 --- Learning Mode

Implement step-by-step educational explanations for:

-   routing
-   CRC
-   Hamming
-   flow control
-   congestion

## Phase 15 --- Exam Mode

Implement controlled exercises for:

-   subnetting
-   routing
-   CRC
-   Hamming
-   flow control
-   TCP/UDP concepts

## Phase 16 --- Application Layer

Implement educational demonstrations for:

-   DNS
-   HTTP
-   FTP
-   SMTP
-   SNMP

Do not overbuild these into full production protocols.

## Phase 17 --- Reporting

Generate:

-   experiment summary
-   configuration
-   seed
-   methodology
-   metrics
-   graphs
-   observations

Support JSON/CSV and PDF where practical.

## Phase 18 --- Python Toolkit

Create an optional `/python-tools` directory.

It should:

-   load exported NetSim results
-   perform batch analysis
-   calculate statistics
-   create advanced graphs
-   process reports

Do not reimplement routing or simulation logic in Python.

## Phase 19 --- Testing

Rust:

``` text
cargo fmt --check
cargo clippy
cargo test
```

Add:

-   unit tests
-   integration tests
-   property tests where useful
-   benchmarks

Frontend:

-   lint
-   component tests
-   build

E2E:

-   Playwright

## Phase 20 --- Performance

Benchmark:

-   route calculation
-   event processing
-   packet simulation
-   larger experiments

Record actual measured results.

## Phase 21 --- Final QA

Verify:

-   startup
-   navigation
-   topology
-   save/load
-   routing
-   packets
-   packet inspector
-   error control
-   flow control
-   TCP/UDP
-   congestion
-   QoS
-   fault injection
-   experiments
-   learning mode
-   exam mode
-   reporting
-   Python toolkit
-   tests
-   production build

## Final Standard

The application should be something a student can open during a Computer
Networks viva and demonstrate interactively from topology creation
through packet simulation, protocol analysis, measured results and
report generation.

Do not declare completion until the end-to-end academic demonstration
works without manual code modification.
