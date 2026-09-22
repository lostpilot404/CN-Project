# NetSim --- Product Requirements Document

## 1. Product

**Name:** NetSim\
**Full Name:** Interactive Computer Network Simulation and Performance
Analysis Platform\
**Type:** B.Tech CSE academic project\
**Primary platform:** Windows 11 desktop\
**Desktop shell:** Tauri 2.x\
**Frontend:** React + TypeScript\
**Core engine:** Rust\
**Optional analysis toolkit:** Python

## 2. Product Vision

NetSim is a local-first educational computer-network simulator that lets
students build network topologies, configure devices, simulate packet
transmission, inspect protocol behavior, inject faults, run controlled
experiments, and analyze measured network performance.

The application should demonstrate the major concepts in the supplied
BCSE308L Computer Networks syllabus rather than functioning as a
collection of unrelated calculators.

## 3. Problem

Networking concepts such as routing, error detection, flow control,
addressing, transport protocols and congestion control are commonly
studied separately. Students need an environment in which these
mechanisms can be observed together and tested under controlled
conditions.

## 4. Goals

### Primary

1.  Provide an interactive topology designer.
2.  Build a deterministic discrete-event simulation engine.
3.  Implement major networking algorithms in Rust.
4.  Visualize packets and protocol state.
5.  Measure actual simulation results.
6.  Support reproducible experiments.
7.  Compare algorithms using measured results.
8.  Generate academic reports.
9.  Provide learning and demonstration modes.

### Secondary

-   Work locally without accounts.
-   Avoid cloud dependencies for core functionality.
-   Provide a polished desktop interface.
-   Keep simulation and UI code independent.
-   Allow future protocols to be added without rewriting the core.

## 5. Non-Goals

NetSim is not intended to be:

-   a real router OS
-   a production TCP/IP implementation
-   a packet sniffer
-   a replacement for enterprise network-management software
-   a cloud collaboration system
-   a real hardware configuration platform
-   a complete replacement for Cisco Packet Tracer

## 6. Target Users

### Student

Build networks, learn concepts, run experiments and prepare
demonstrations.

### Faculty

Inspect the implementation, run predefined demonstrations and review
measured results.

## 7. Syllabus Mapping

The supplied BCSE308L syllabus covers networking principles and layered
architecture, circuit/packet switching, data-link error and flow
control, IPv4/IPv6 and NAT, routing, TCP/UDP and congestion control,
QoS, and application-layer protocols.

NetSim maps these to:

  Course area             NetSim capability
  ----------------------- ------------------------------------------------
  Networking principles   Topology, OSI/TCP-IP visualization
  Switching               Circuit and packet switching
  Data link               Hamming, CRC, Checksum
  Flow control            Sliding Window, Go-Back-N, Selective Repeat
  Multiple access         ALOHA, Slotted ALOHA, CSMA, CSMA/CD
  Network layer           IPv4, CIDR, subnetting, NAT, IPv6
  Routing                 Distance Vector, Link State
  Transport               TCP and UDP educational models
  Congestion              Congestion-window visualization
  QoS                     Latency, jitter, throughput, loss, utilization
  Application             DNS, HTTP, FTP, SMTP, SNMP demonstrations

## 8. Core Product Flow

``` text
Create/Open Project
       ↓
Build Topology
       ↓
Configure Interfaces
       ↓
Configure Links
       ↓
Calculate Routes
       ↓
Generate Traffic
       ↓
Run / Step Simulation
       ↓
Inspect Packets and Events
       ↓
Inject Faults if Required
       ↓
Collect Metrics
       ↓
Run Experiments
       ↓
Compare Results
       ↓
Save / Export Report
```

## 9. Main Features

### Dashboard

-   recent projects
-   demo scenarios
-   experiment templates
-   learning modules
-   project status

### Topology Designer

Support:

-   PC
-   Server
-   Router
-   Switch
-   Wireless Access Point
-   Generic Node

Operations:

-   create
-   delete
-   rename
-   move
-   connect
-   duplicate
-   configure
-   zoom
-   pan
-   auto-layout
-   undo/redo

### Network Links

Configurable:

-   bandwidth
-   latency
-   propagation delay
-   packet-loss probability
-   bit-error probability
-   queue capacity
-   status

### Simulation

Modes:

-   real-time
-   step-by-step
-   accelerated
-   instant/batch

Simulation time must be independent of wall-clock time.

### Packet Inspector

Display:

-   packet ID
-   application protocol
-   transport protocol
-   source/destination
-   sequence
-   TTL
-   current node
-   state
-   timestamps
-   route

### Event Timeline

Show simulation events chronologically and allow selecting an event to
highlight its packet/node/link.

### Routing

Implement:

-   Link State / Dijkstra
-   Distance Vector / Bellman-Ford-style logic

Display routing tables, paths, costs, hop counts and route changes.

### Addressing

Implement:

-   IPv4 validation
-   CIDR
-   subnetting
-   classless addressing
-   NAT visualization
-   basic IPv6 representation

### Error Control

Implement:

-   Hamming Code
-   CRC
-   Checksum

Support controlled error injection.

### Flow Control

Implement:

-   Sliding Window
-   Go-Back-N
-   Selective Repeat

### Multiple Access

Provide educational simulations for:

-   ALOHA
-   Slotted ALOHA
-   CSMA
-   CSMA/CD

### Transport

Educational models for:

-   TCP
-   UDP
-   ACKs
-   sequence numbers
-   retransmission
-   RTT
-   congestion window

### Congestion and QoS

Collect:

-   throughput
-   latency
-   RTT
-   jitter
-   packet loss
-   queue delay
-   utilization
-   retransmissions

### Fault Injection

Support:

-   packet loss
-   bit errors
-   link failure
-   router failure
-   queue overflow
-   increased latency
-   bandwidth reduction

### Experiments

Allow parameter sweeps such as:

``` text
Packet loss: 0%, 2%, 5%, 10%, 20%
```

and automatically run equivalent simulations.

### Learning Mode

Explain algorithms step-by-step during simulation.

### Exam Mode

Provide controlled academic exercises for subnetting, routing, CRC,
Hamming, flow control and transport concepts.

## 10. Architecture Requirements

Rust is the authoritative simulation and domain layer.

React must not implement authoritative networking algorithms.

Python is optional and external to the core application.

Recommended structure:

``` text
Tauri
├── React + TypeScript UI
└── Rust Core
      ├── Network Model
      ├── Simulation Engine
      ├── Routing
      ├── Data Link
      ├── Transport
      ├── Congestion
      ├── Metrics
      └── Persistence

Optional Python Toolkit
      ├── Batch Experiments
      ├── Statistical Analysis
      ├── Advanced Charts
      └── Report Processing
```

## 11. Privacy

-   no account
-   no telemetry
-   no analytics
-   no cloud requirement
-   local project storage

## 12. Success Criteria

The final product must support an end-to-end academic demonstration:

``` text
Create topology
→ Configure IPv4
→ Calculate route
→ Send packet
→ Inspect packet
→ Inject fault
→ Observe response
→ Measure QoS
→ Compare algorithms
→ Save experiment
→ Generate report
```
