# NetSim --- Algorithms and Protocol Models

## 1. Purpose

Define the algorithms and educational protocol models implemented by the simulator. These formulas
are the reference the Python implementation in `python/netsim/` is written against, and the values
in `python/tests/test_independent_validation.py` were derived from them by hand.

> **Note on earlier revisions.** This document once described these algorithms as belonging to a
> Rust core. The Rust engine has been removed; `python/netsim/` is the sole implementation. The
> formulas themselves are unchanged and remain authoritative.

> **Reading this document.** Sections list the algorithm requirements NetSim was designed to.
> Each section that involves modelling scope carries a **Status** line stating what the current
> Python implementation actually does — *Implemented*, *Partial* (real behaviour with documented
> boundaries), or *Illustrative* (model output that does not claim production protocol behaviour).
> The consolidated scope table lives in `README.md` (§ Implementation scope).

## 2. Routing

### 2.1 Dijkstra / Link State

Input:

-   weighted graph
-   source router

Output:

-   shortest paths
-   routing table
-   path cost
-   next hop

Requirements:

-   deterministic
-   correct path reconstruction
-   disconnected-node handling
-   equal-cost path behavior documented

### 2.2 Distance Vector

Use Bellman-Ford-style iterative distance-vector updates.

Each router maintains:

``` text
destination
next hop
cost
```

The simulation should expose update rounds and convergence.

## 3. IPv4

Implement:

-   address parsing
-   prefix parsing
-   network calculation
-   broadcast calculation
-   usable host range
-   host count
-   subnet generation
-   duplicate-address detection

## 4. IPv6

Provide basic:

-   address validation
-   prefix representation
-   address formatting
-   header visualization

**Status — Partial.** Validation, RFC 5952 canonical formatting, expansion/compression and
scope classification are implemented (`python/netsim/addressing/ipv6.py`). Header visualisation
exists in the packet inspector. IPv6 addresses are text labels only: the forwarding engine uses
IPv4-style headers, so there is no IPv6 routing, neighbour discovery or dual-stack behaviour.

## 5. NAT

Model translation entries:

``` text
private address:port
→
public address:port
```

**Status — Partial.** The model is implemented (`python/netsim/addressing/nat.py`): dynamic SNAT
with per-router port pools, static DNAT rules, timeout tracking, and strict isolation between
routers and projects. Packet translation is shown in the address inspector. Not modelled: ALGs,
ICMP error rewriting, and port-preservation heuristics beyond the pool.

Visualize packet translation.

## 6. Hamming Code

Implement:

1.  determine parity-bit count
2.  place parity bits
3.  calculate parity
4.  encode data
5.  inject supported errors
6.  calculate syndrome
7.  identify/correct supported single-bit errors

Tests must cover valid input and single-bit corruption.

## 7. CRC

Implement:

1.  validate data
2.  validate generator
3.  append zero bits
4.  modulo-2 division
5.  calculate remainder
6.  construct transmitted frame
7.  verify received frame

The UI should expose intermediate values for learning.

## 8. Checksum

Implement one's-complement arithmetic:

1.  split words
2.  add
3.  fold carries
4.  complement
5.  verify

## 9. Sliding Window

Track:

-   sender window
-   sequence numbers
-   ACKs
-   timeout
-   retransmission
-   window movement

**Status — Partial (applies to §9–§11).** All three protocols are implemented as a receding-window
time-step model (`python/netsim/datalink/flow_control.py`) with real window/sequence/ACK/timeout
bookkeeping: in-order delivery for the base sliding window, cumulative ACK rewind for Go-Back-N,
and per-sequence buffering for Selective Repeat. Simplifications: discrete rounds, simplified ACK
timing, no delayed ACKs and no ACK loss.

## 10. Go-Back-N

When a loss/timeout occurs, retransmit according to the Go-Back-N model.

The implementation must make its assumptions explicit, including ACK
semantics and timeout behavior.

## 11. Selective Repeat

Allow independent ACKs and retransmission of missing packets only.

## 12. ALOHA

Model:

-   transmission attempts
-   collisions
-   retries
-   successful frames

Collect:

-   throughput
-   collision count
-   success rate

## 13. Slotted ALOHA

Restrict transmission attempts to simulation slots.

## 14. CSMA

Model:

``` text
sense channel
↓
idle?
├── yes → transmit
└── no → wait/backoff
```

## 15. CSMA/CD

Educational model:

``` text
sense
↓
transmit
↓
collision?
├── no → success
└── yes → abort → backoff → retry
```

The implementation should clearly state that this is a simulation model.

## 16. Circuit Switching

Model:

``` text
setup
↓
reserved path
↓
data transfer
↓
teardown
```

Measure setup and transmission effects.

**Status — Partial (educational admission-control model).** Implemented in
`python/netsim/switching/circuit.py` and exposed as `request_circuit` / `teardown_circuit` /
`get_circuit_state` plus the dedicated Circuit Switching workspace:

-   **setup** resolves the path with the same authoritative routing graph used for live packet
    forwarding (hop-count shortest path) and validates the requested rate on **every** link of
    the path before reserving anything — all-or-nothing admission;
-   **blocking** is a first-class outcome: an unsatisfiable request is rejected with a precise
    reason (insufficient capacity on a named link, or no path) and leaves no partial reservations;
-   **teardown** releases every reservation on the circuit's links; capacity is reusable;
-   **resource accounting** reports per-link reserved/available bps and utilisation, plus
    acceptance and blocking rates;
-   topology mutations (link removal, bandwidth/status changes, node removal) release affected
    circuits; project create/import clears all circuit state.

Not modelled: call signalling protocols, holding-time traffic patterns, or cross-connect
hardware behaviour.

## 17. Packet Switching

Packets may experience:

-   different routes
-   queueing
-   delay
-   loss
-   independent delivery

**Status — Implemented.** Forwarding is table-driven per hop (Dijkstra/Bellman-Ford next hop) with
an enforced TTL/hop limit, a loop guard, and exactly-once drop accounting. **Related scope note
(MAC/Ethernet):** interface MAC addresses are generated identifiers and the L2 header view shows
Ethernet II fields, but there is no MAC learning, bridging or ARP — MACs are display identifiers,
not forwarding state.

## 18. TCP Educational Model

Implement only the behavior required by NetSim experiments:

-   sequence numbers
-   ACKs
-   retransmission
-   timeout
-   RTT
-   congestion window
-   simplified congestion response

This is not a complete production TCP implementation.

**Status — Partial.** Implemented in `python/netsim/transport/tcp.py` over the real routed
topology: three-way handshake, slow start, congestion avoidance, fast retransmit, timeout
recovery, and Jacobson-style RTT estimation. Simplifications: no SACK, no window scaling, no
delayed ACKs, simplified congestion response, and the receive window is not modelled as a
bottleneck.

## 19. UDP Educational Model

Model:

-   connectionless transmission
-   delivery
-   loss
-   delay
-   throughput

Do not add transport-layer retransmission to UDP.

## 20. Congestion Control

Provide an educational model of:

-   Slow Start
-   Congestion Avoidance
-   loss response
-   congestion-window changes

Display cwnd over simulation time.

**Status — Implemented (educational).** `python/netsim/congestion/cwnd.py` drives the slow-start
and congestion-avoidance phases shown in the Transport workspace's congestion timeline; the
response to loss is the simplified AIMD behaviour described above.

## 21. Queueing

Each link may contain a finite queue.

``` text
packet
 ↓
queue full?
 ├── no → enqueue
 └── yes → drop
```

Measure queue length and drops.

## 22. QoS

### Latency

``` text
arrival_time - creation_time
```

### Throughput

``` text
delivered_bits / elapsed_simulation_time
```

### Loss Ratio

``` text
dropped_packets / generated_packets
```

### RTT

Based on packet/ACK timestamps.

### Jitter

Use a documented variation-of-delay calculation.

### Utilization

``` text
busy_time / observation_time
```

## 23. Routing Fault Recovery

When a link or router fails:

1.  modify topology state
2.  invalidate affected routes
3.  recompute routes according to the selected model
4.  record route changes
5.  continue or drop traffic according to reachability

## 24. Determinism

All random algorithms must use the simulation's seeded RNG.

Given identical:

-   topology
-   parameters
-   seed
-   simulation version

the simulator should produce reproducible results.

## 25. Property-Based Testing

Where useful, test invariants such as:

-   valid subnet ranges
-   route paths contain valid edges
-   delivered packet has a valid source/destination
-   generated CRC frames validate
-   queue occupancy never exceeds capacity
-   simulation time never decreases

## 26. Application-Layer Models

### DNS

Client → Query → Server → Response.

### HTTP

Request → Server → Response.

### FTP

Separate conceptual control and data flows.

### SMTP

Model mail transfer between systems.

### SNMP

Model manager-agent request/response.

These are educational models, not complete production protocol
implementations.
