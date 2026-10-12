# NetSim --- Software Requirements Specification

> **Historical document (superseded).** This was written for an earlier design in which a Rust
> engine was the simulation authority. That engine and its `src-tauri/` tree have since been
> removed: **Python (`python/netsim/`) is the sole simulation authority**, reached over HTTP by the
> React front-end. Parts of this document therefore describe components, layers and test commands
> that no longer exist, and any statement naming Rust or Tauri as authoritative is obsolete.
> See `README.md` for the current architecture and `QUALITY_AUDIT_REPORT.md` for audit evidence.

## 1. Purpose

Define the functional, non-functional and technical requirements for
NetSim.

## 2. Scope

NetSim is a desktop educational network simulator using Tauri,
React/TypeScript and a Rust simulation engine, with an optional Python
analysis toolkit.

## 3. System Requirements

### SR-001 Desktop

The application shall run as a Windows 11 desktop application.

### SR-002 Local-First

Core simulation shall operate without an external backend.

### SR-003 UI

The frontend shall use React and TypeScript.

### SR-004 Core

Networking algorithms and simulation shall be implemented in Rust.

### SR-005 Python

Python shall be optional and shall not be required to launch or perform
core simulations.

## 4. Functional Requirements

### FR-001 Project Management

Users shall be able to:

-   create
-   open
-   save
-   duplicate
-   rename
-   reset
-   export

projects.

### FR-002 Topology

Users shall be able to create and configure nodes and links.

### FR-003 Nodes

Support:

-   PC
-   Server
-   Router
-   Switch
-   Wireless Access Point
-   Generic Node

### FR-004 Links

Configure:

-   bandwidth
-   latency
-   propagation delay
-   loss
-   error rate
-   queue capacity
-   operational status

### FR-005 Addressing

Support IPv4, CIDR, subnetting, classless addressing, NAT visualization
and basic IPv6.

### FR-006 Routing

Implement:

-   Dijkstra-based Link State
-   Bellman-Ford-style Distance Vector

### FR-007 Packets

Users shall generate traffic by specifying source, destination,
protocol, size and packet count.

### FR-008 Simulation

The simulator shall support:

-   run
-   pause
-   resume
-   stop
-   reset
-   step
-   accelerated execution
-   batch execution

### FR-009 Determinism

Users shall be able to specify a random seed.

Identical configuration and seed should produce reproducible outcomes.

### FR-010 Error Control

Implement:

-   Hamming
-   CRC
-   Checksum

### FR-011 Flow Control

Implement:

-   Sliding Window
-   Go-Back-N
-   Selective Repeat

### FR-012 Multiple Access

Implement educational models of:

-   ALOHA
-   Slotted ALOHA
-   CSMA
-   CSMA/CD

### FR-013 Switching

Simulate circuit switching and packet switching.

### FR-014 Transport

Provide educational TCP and UDP models.

### FR-015 Congestion

Provide a simplified congestion-control model with congestion-window
visualization.

### FR-016 Queues

Links shall support finite queues and queue overflow.

### FR-017 QoS

Calculate actual:

-   throughput
-   latency
-   RTT
-   jitter
-   packet loss
-   retransmission count
-   queue delay
-   utilization

### FR-018 Fault Injection

Allow controlled:

-   packet loss
-   bit errors
-   link failures
-   router failures
-   bandwidth changes
-   latency changes
-   queue overflow

### FR-019 Packet Inspector

Display packet encapsulation and current state.

### FR-020 Event Timeline

Display ordered simulation events.

### FR-021 Experiments

Support parameterized repeated simulations.

### FR-022 Comparison

Compare measured results without hard-coded winners or rankings.

### FR-023 Learning Mode

Explain algorithm execution step-by-step.

### FR-024 Exam Mode

Provide academic practice scenarios.

### FR-025 Application Layer

Provide conceptual demonstrations of:

-   DNS
-   HTTP
-   FTP
-   SMTP
-   SNMP

### FR-026 Reporting

Export structured results and reports.

## 5. Non-Functional Requirements

### NFR-001 Performance

Target approximately:

-   100+ nodes
-   200+ links
-   1,000+ packets
-   larger event counts for batch experiments

The implementation should be benchmarked rather than assuming a fixed
maximum.

### NFR-002 Determinism

The core must support deterministic random seeds.

### NFR-003 Reliability

Invalid configurations must be handled without crashing the simulation.

### NFR-004 Maintainability

The Rust core shall use modular crates/modules and clear domain
boundaries.

### NFR-005 Testability

Core algorithms must be independently testable.

### NFR-006 Privacy

No external account or telemetry is required.

### NFR-007 Usability

The common simulation workflow should be discoverable without reading
source code.

## 6. Data Requirements

Projects shall contain:

-   schema version
-   metadata
-   nodes
-   interfaces
-   links
-   addressing
-   routing configuration
-   simulation configuration
-   experiments
-   results

## 7. Validation

Validate:

-   IP addresses
-   CIDR
-   duplicate addresses
-   topology connections
-   routing availability
-   protocol parameters
-   experiment ranges

## 8. Error Handling

Errors must be user-readable and should identify the affected object and
corrective action where possible.

## 9. Compatibility

The project format shall be versioned to permit future migrations.

## 10. Requirement Traceability

Each major requirement shall map to:

-   implementation module
-   test suite
-   UI feature
-   documentation
