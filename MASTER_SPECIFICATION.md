# NetSim --- Master Specification

> **Historical document (superseded).** This was written for an earlier design in which a Rust
> engine was the simulation authority. That engine and its `src-tauri/` tree have since been
> removed: **Python (`python/netsim/`) is the sole simulation authority**, reached over HTTP by the
> React front-end. Parts of this document therefore describe components, layers and test commands
> that no longer exist, and any statement naming Rust or Tauri as authoritative is obsolete.
> See `README.md` for the current architecture and `QUALITY_AUDIT_REPORT.md` for audit evidence.

## 1. Purpose

This is the single source of truth for the NetSim implementation.

## 2. Architecture

The application shall use:

``` text
Tauri 2.x
    ↓
React + TypeScript UI
    ↓
Tauri Commands
    ↓
Rust Core
    ↓
JSON / SQLite / CSV
    ↓
Optional Python Analysis Toolkit
```

## 3. Core Principle

**Rust is authoritative.**

All networking algorithms, simulation state, event processing and
authoritative metrics must be implemented in Rust.

The frontend must not independently calculate authoritative results.

Python must not duplicate the networking engine.

## 4. Python Principle

Python is optional.

It is intended for:

-   batch experiments
-   statistical analysis
-   advanced charting
-   data processing
-   report processing

Python must not be required for:

-   application startup
-   topology editing
-   routing
-   ordinary simulation
-   packet inspection
-   core reporting

## 5. Desktop

Use Tauri 2.x.

Target Windows 11.

## 6. Frontend

Use:

-   React
-   TypeScript
-   Vite
-   Tailwind CSS
-   XYFlow
-   Recharts

## 7. Rust Core

Use Rust for:

-   domain model
-   discrete-event simulation
-   routing
-   addressing
-   data-link algorithms
-   transport models
-   congestion
-   queues
-   metrics
-   fault injection
-   experiment execution
-   persistence

## 8. Simulation Engine

Use a priority event queue.

Events include:

-   packet creation
-   queue entry
-   transmission
-   arrival
-   loss
-   ACK
-   timeout
-   retransmission
-   route update
-   fault injection

Simulation time must be independent from wall-clock time.

## 9. Deterministic RNG

Every stochastic experiment must support a seed.

The seed must be saved with experiment configuration.

## 10. Network Model

Support:

-   nodes
-   interfaces
-   links
-   IPv4
-   IPv6
-   queues
-   routing state
-   packets
-   protocol state

## 11. Required Algorithms

### Routing

-   Dijkstra / Link State
-   Bellman-Ford-style Distance Vector

### Addressing

-   IPv4
-   CIDR
-   subnetting
-   NAT
-   basic IPv6

### Error

-   Hamming
-   CRC
-   Checksum

### Flow

-   Sliding Window
-   Go-Back-N
-   Selective Repeat

### Multiple Access

-   ALOHA
-   Slotted ALOHA
-   CSMA
-   CSMA/CD

### Switching

-   circuit switching
-   packet switching

### Transport

-   educational TCP
-   UDP

### Congestion

-   Slow Start
-   Congestion Avoidance
-   simplified loss response

### Queueing

-   finite queues
-   overflow

## 12. Required Visualization

-   topology
-   packet animation
-   packet inspector
-   OSI/TCP-IP encapsulation
-   routing tables
-   event timeline
-   queues
-   congestion window
-   QoS charts
-   experiment comparison

## 13. Fault Injection

Support:

-   packet loss
-   bit error
-   link failure
-   router failure
-   queue overflow
-   latency change
-   bandwidth change

## 14. Experiments

Support:

-   parameter sweeps
-   repeated runs
-   deterministic seeds
-   result storage
-   comparison charts

## 15. Learning Mode

Explain algorithm steps during simulation.

## 16. Exam Mode

Provide controlled exercises for syllabus topics.

## 17. Persistence

Use:

-   versioned JSON project files
-   SQLite for local application metadata/history

## 18. Testing

Require:

-   Rust unit tests
-   Rust integration tests
-   property-based tests where useful
-   frontend tests
-   Tauri integration tests
-   Playwright E2E
-   performance benchmarks

## 19. Quality

Do not:

-   fake results
-   hard-code rankings
-   duplicate algorithms in frontend
-   require Python for core functionality
-   require cloud services
-   expose unsafe filesystem/process commands
-   silently remove requirements

## 20. Completion Workflow

``` text
Architecture
→ Tauri shell
→ Topology
→ Rust domain model
→ Event engine
→ Routing
→ Packet transmission
→ Addressing
→ Data Link
→ Transport
→ Congestion/QoS
→ Faults
→ Experiments
→ Learning/Exam modes
→ Reporting
→ Testing
→ Performance
→ Documentation
```

## 21. Final Acceptance

The complete demonstration must work:

``` text
Create topology
→ Configure IPv4
→ Calculate route
→ Generate packet
→ Run/step simulation
→ Inspect packet
→ Inject fault
→ Observe protocol response
→ View metrics
→ Compare algorithms
→ Save
→ Reload
→ Generate report
```
