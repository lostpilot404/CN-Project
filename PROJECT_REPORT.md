# NetSim --- Academic Project Report

> **Historical document (superseded).** This was written for an earlier design in which a Rust
> engine was the simulation authority. That engine and its `src-tauri/` tree have since been
> removed: **Python (`python/netsim/`) is the sole simulation authority**, reached over HTTP by the
> React front-end. Parts of this document therefore describe components, layers and test commands
> that no longer exist, and any statement naming Rust or Tauri as authoritative is obsolete.
> See `README.md` for the current architecture and `QUALITY_AUDIT_REPORT.md` for audit evidence.

## 1. Abstract

NetSim is an interactive computer-network simulation and
performance-analysis platform developed for educational use. It combines
a memory-safe Rust simulation core, a Tauri desktop application and a
React/TypeScript interface. The platform allows users to construct
network topologies, configure network parameters, simulate packet
transmission, execute networking algorithms, inject controlled faults
and analyze measured performance.

## 2. Introduction

Computer networking involves multiple interacting mechanisms across
layered architectures. NetSim provides a single environment for
demonstrating and experimenting with these mechanisms.

## 3. Problem Statement

Networking topics are frequently learned as separate theoretical
concepts. Students require an environment where routing, addressing,
error control, flow control, transport and congestion can be observed
together.

## 4. Objectives

1.  Build an interactive topology editor.
2.  Implement a deterministic network simulation engine.
3.  Implement routing algorithms.
4.  Implement error and flow-control mechanisms.
5.  Simulate TCP and UDP behavior.
6.  Demonstrate congestion and QoS.
7.  Provide controlled fault injection.
8.  Provide reproducible experiments.
9.  Generate academic reports.

## 5. Proposed Architecture

``` text
Tauri
├── React/TypeScript UI
└── Rust Core
      ├── Network Model
      ├── Discrete-Event Engine
      ├── Routing
      ├── Protocols
      ├── Metrics
      └── Persistence

Optional Python Toolkit
      └── Analysis / Batch Experiments
```

## 6. Technologies

-   Rust
-   Tauri 2.x
-   React
-   TypeScript
-   Tailwind CSS
-   XYFlow
-   Recharts
-   SQLite
-   JSON
-   Python
-   pandas/NumPy/matplotlib where required
-   Vitest
-   Playwright
-   Rust testing ecosystem

## 7. Modules

### 7.1 Topology

Describe nodes, links and configuration.

### 7.2 Simulation

Describe the discrete-event engine and simulation clock.

### 7.3 Data Link

Describe:

-   Hamming
-   CRC
-   Checksum
-   Sliding Window
-   Go-Back-N
-   Selective Repeat
-   ALOHA
-   CSMA/CD

### 7.4 Network Layer

Describe:

-   IPv4
-   subnetting
-   CIDR
-   NAT
-   IPv6

### 7.5 Routing

Describe:

-   Dijkstra
-   Distance Vector

### 7.6 Transport

Describe:

-   TCP model
-   UDP model
-   RTT
-   retransmission
-   congestion

### 7.7 QoS

Describe:

-   throughput
-   latency
-   jitter
-   packet loss
-   utilization
-   queue delay

### 7.8 Fault Injection

Describe controlled:

-   loss
-   errors
-   link failure
-   router failure
-   queue overflow
-   bandwidth/latency changes

## 8. Experiments

Recommended experiments:

### Experiment 1

Distance Vector vs Link State.

### Experiment 2

CRC under controlled bit errors.

### Experiment 3

Go-Back-N vs Selective Repeat.

### Experiment 4

TCP vs UDP under packet loss.

### Experiment 5

Packet loss versus throughput.

### Experiment 6

Queue size versus packet loss.

## 9. Results

Insert actual measured results.

Do not fabricate benchmark or simulation values.

For each experiment include:

-   topology
-   parameters
-   seed
-   algorithm
-   results
-   graph
-   observation

## 10. Testing

Document:

-   Rust unit tests
-   integration tests
-   property-based tests
-   frontend tests
-   E2E tests
-   performance benchmarks
-   deterministic replay

## 11. Limitations

Only document limitations present in the actual implementation.

Potential examples:

-   simplified physical layer
-   educational TCP model
-   limited IPv6 behavior
-   limited application-layer protocol behavior

## 12. Future Work

Potential extensions:

-   additional routing protocols
-   richer IPv6
-   larger-scale simulation
-   packet capture integration
-   more application protocols
-   advanced statistical analysis

## 13. Conclusion

NetSim provides an integrated environment for learning and
experimentally analyzing computer-network concepts through an
interactive, deterministic simulation platform.

## 14. References

Use the institution's prescribed Computer Networks textbook and
reference books, plus official technical documentation for libraries and
frameworks actually used.
