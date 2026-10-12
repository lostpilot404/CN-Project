# NetSim --- Algorithms and Protocol Models

## 1. Purpose

Define the algorithms and educational protocol models implemented by the simulator. These formulas
are the reference the Python implementation in `python/netsim/` is written against, and the values
in `python/tests/test_independent_validation.py` were derived from them by hand.

> **Note on earlier revisions.** This document once described these algorithms as belonging to a
> Rust core. The Rust engine has been removed; `python/netsim/` is the sole implementation. The
> formulas themselves are unchanged and remain authoritative.

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

Do not claim complete IPv6 routing unless implemented.

## 5. NAT

Model translation entries:

``` text
private address:port
→
public address:port
```

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

## 17. Packet Switching

Packets may experience:

-   different routes
-   queueing
-   delay
-   loss
-   independent delivery

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
