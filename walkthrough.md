# NetSim Phase 7: QoS Metrics, Fault Injection & Experimentation Walkthrough

## 1. Overview & Project Status
- **Phase Status**: PHASE 7 IS COMPLETE.
- **Closure Commit**: `922c31e`
- **Current Head**: Audited and Verified.
- **Statement on Python Port**: The Python port has NOT started.
- **Statement on Simulation Phases**: Phase 7 is the final planned Rust simulation/analysis phase. No Phase 8 or further phases exist.
- **Educational Scope**: NetSim is an educational simulator designed for computer networking pedagogy, not a production-grade kernel-level network emulation tool.

---

## 2. QoS Metrics & Mathematical Formulas

All rate and utilization metrics use `measurement_interval_us` as the denominator, defined as the elapsed virtual `SimTime` from simulation start to the final event timestamp.

### 2.1 Metric Formulas and Units

| Metric | Formula | Units | Scope | Description |
|---|---|---|---|---|
| **Measurement Interval** | $\Delta t = t_{\text{end}} - t_{\text{start}}$ | microseconds ($\mu\text{s}$) | Network & Transport | Authoritative SimTime interval elapsed |
| **Throughput (bps)** | $\frac{\text{bytes\_delivered} \times 8 \times 1,000,000}{\Delta t}$ | bits per second (bps) | Network / Transport | Rate of delivered data bits over SimTime |
| **Throughput (Bps)** | $\frac{\text{bytes\_delivered} \times 1,000,000}{\Delta t}$ | Bytes per second (B/s) | Network / Transport | Rate of delivered bytes over SimTime |
| **Goodput (bps)** | $\frac{\text{app\_payload\_bytes} \times 8 \times 1,000,000}{\Delta t}$ | bits per second (bps) | Transport / App | Payload bits delivered without header overhead |
| **Per-Packet Latency** | $D_i = t_{\text{arrival}} - t_{\text{created}}$ | microseconds ($\mu\text{s}$) | Packet | End-to-end traversal delay |
| **Average Latency** | $\bar{D} = \frac{1}{N}\sum_{i=1}^N D_i$ | microseconds ($\mu\text{s}$) | Packet / Network | Mean end-to-end packet latency |
| **Min / Max Latency** | $\min(D_i), \max(D_i)$ | microseconds ($\mu\text{s}$) | Packet | Extreme packet latency values |
| **IPDV Jitter** | $J_i = \|D_i - D_{i-1}\|$ | microseconds ($\mu\text{s}$) | Flow (RFC 3393) | Consecutive inter-packet delay variation per flow |
| **Packet Loss Rate** | $\frac{\text{packets\_lost}}{\text{packets\_sent}}$ | dimensionless ($[0.0, 1.0]$) | Network | Fractional loss across all causes |
| **Queue Occupancy Avg**| $\frac{1}{K}\sum_{k=1}^K \text{occupancy}_k$ | packets | Link Queue | Mean instantaneous queue buffer occupancy |
| **Link Utilization** | $\min\left(1.0, \frac{\sum (t_{\text{tx\_finish}} - t_{\text{tx\_start}})}{\Delta t}\right)$ | dimensionless ($[0.0, 1.0]$) | Link | Transmission occupancy ratio over active time |
| **Average RTT** | Jacobson / Karn filter | microseconds ($\mu\text{s}$) | Transport | Round-trip time tracked per TCP connection |

### 2.2 Numerical Safety Guarantees
- Safe division guards: all divisors check $\text{denominator} > 0$; return $0.0$ on zero samples or zero duration.
- No `NaN`, no `Infinity`, no panics on empty or degenerate topologies.

### 2.3 Distinct Metric Scopes
- **Packet / Network Scope**: Tracks physical transmissions, queue entries/drops, bit errors, link down drops, and hop journey history.
- **Transport / Flow Scope**: Tracks end-to-end transport segments, sequence spaces, ACKs, retransmission counts, congestion window states, and RTT. Retransmissions are strictly recorded in the transport scope and never double-counted into packet loss.

### 2.4 Jitter Flow Grouping
Per RFC 3393 educational implementation, jitter is calculated strictly **per flow**, grouped by `(src_node_id, dst_node_id, protocol)`. Delays from distinct flows are never mixed or interleaved when calculating IPDV.

---

## 3. Runtime Fault Injection Semantics

Faults are scheduled into the authoritative discrete-event queue at a defined virtual `SimTime` ($\mu\text{s}$):
$$\text{FaultSchedule} \longrightarrow \text{SimTime Event} \longrightarrow \text{SimulationEngine Execution} \longrightarrow \text{Live State Mutation} \longrightarrow \text{Routing / Queue Observation}$$

### Supported Fault Types:
1. **LinkDown**: Administratively changes link status to `Down`. Subsequent packets attempting queue entry or transmission are dropped with `DroppedLinkDown`.
2. **LinkRestore**: Restores link status to `Up`. Future transmissions succeed; routing graphs dynamically adapt.
3. **BandwidthDegradation**: Adjusts `bandwidth_bps`. Affects future transmission serialization delay ($\frac{\text{size} \times 8 \times 1,000,000}{\text{bandwidth}}$) without rewriting in-flight packet timers.
4. **QueueCapacityChange**: Adjusts link queue buffer capacity. Packets already queued are preserved; subsequent packets enforce the new Drop-Tail limit.
5. **NodeFailure**: Marks all links incident to the node as `Down`. Saves the previous link states in `node_pre_fault_link_states`.
6. **NodeRecovery**: Restores all incident links to their specific pre-fault state (preserving links that were already Down prior to node failure).
7. **PacketDrop**: Marks live packet state as `DroppedBitError`. Dropped packets are prevented from resurrecting upon pre-scheduled transmission or arrival events.
8. **BitError**: Updates link bit error rate (`BER`). Deterministic PRNG determines corruption during serialization.

### Immutability of History:
Historical `hop_history` records are **never rewritten**. Injected faults append new hop records or drop records to the packet journey without mutating previous hops.

---

## 4. Dynamic Routing Observation

When link or node faults occur:
1. `RoutingGraph` is recomputed from the live project topology using Dijkstra's shortest path algorithm (or Bellman-Ford).
2. If the converged shortest path between source and destination has changed, a `RouteChangeRecord` is emitted:
   - `timestamp_us`: SimTime of route change
   - `source_node_id` & `destination_node_id`
   - `before_path`: e.g. `["r1", "r2", "r4"]`
   - `after_path`: e.g. `["r1", "r3", "r4"]`
   - `affected_links`
   - `fault_id`
3. Subsequent packets traverse the updated path.
4. On fault restoration, the graph recalculates and restores the optimal path.

---

## 5. Experimentation Architecture & Deterministic Sweeps

### 5.1 Explicit Experiment Targets
Experiments are targeted across discrete networking layers rather than forcing all parameters through a monolithic transport config:
- `Tcp`: Transport Layer (TCP Flow Control, Congestion Control, Retransmissions, Window Size, Timeouts, Network Parameters)
- `Udp`: Datagram Layer (Connectionless, Unreliable, Network Parameters; rejects WindowSize/Timeouts)
- `Application`: Application Layer (HTTP, DNS, FTP, SNMP over simulated transport; rejects WindowSize)
- `FlowControl`: Data Link / Transport Flow Control (Stop-and-Wait, Go-Back-N, Selective Repeat)
- `Mac`: Medium Access Control (Pure ALOHA, Slotted ALOHA, CSMA/CD; rejects QueueCapacity, WindowSize)

### 5.2 Deterministic Parameter Sweeps
- **Sweep Parameters**: `LinkBandwidth`, `PropagationDelay`, `QueueCapacity`, `BitErrorRate`, `PacketSizeBytes`, `TrafficIntervalUs`, `PacketCount`, `WindowSize`, `TimeoutUs`, `MacPersistence`.
- **Reproducibility**: Simulations seeded via explicit PRNG seeds (e.g. `seeds = [42, 101, 2024]`). Identical seed + identical config produces identical bit-for-bit results.
- **Aggregation**: Multi-seed runs compute `mean`, `stddev`, `min`, `max`, `median`, and `p95` across runs without outlier removal.
- **Comparative A/B Experiments**: Compares Scenario A vs Scenario B with deterministic deltas (absolute difference and percentage change).

---

## 6. Verification Results

### 6.1 Automated Verification Command Matrix

| Command | Status | Output Details |
|---|---|---|
| `cargo fmt --check` | **PASS** | 0 formatting discrepancies |
| `cargo check --all` | **PASS** | 0 compilation errors |
| `cargo clippy --all-targets --all-features -- -D warnings` | **PASS** | 0 linter warnings |
| `cargo test --all` | **PASS** | **120 / 120 tests passed** (including 11 Phase 7 tests) |
| `npm run typecheck` | **PASS** | 0 TypeScript errors (`tsc --noEmit`) |
| `npm run test` | **PASS** | **79 / 79 tests passed** across 9 test files |
| `npm run build` | **PASS** | Vite production bundle built in 6.08s |
| `npm run tauri dev` | **PASS** | Vite ready at `http://localhost:1420/`, native `netsim.exe` initialized |

### 6.2 All 18 Authoritative Manual Scenarios

| # | Scenario | Authoritative Result Recorded | Status |
|---|---|---|---|
| 1 | Baseline QoS | delivered=5, lost=0, avg_lat=10805.0 $\mu\text{s}$, throughput=266666.7 bps | **PASS** |
| 2 | Bandwidth Increase | avg_lat=10085.0 $\mu\text{s}$ (serialization delay reduced by 720 $\mu\text{s}$) | **PASS** |
| 3 | Bandwidth Decrease | avg_lat=18005.0 $\mu\text{s}$ (serialization delay increased by 7200 $\mu\text{s}$) | **PASS** |
| 4 | Queue Saturation | delivered=3, dropped_overflow=3 (Drop-Tail queue capacity = 2 enforced) | **PASS** |
| 5 | Link Failure + Route Change | route_changes=1, path changed from `["r1", "r2", "r4"]` to `["r1", "r3", "r4"]` | **PASS** |
| 6 | Link Restoration | route_changes=2, restored back to `["r1", "r2", "r4"]` | **PASS** |
| 7 | Node Failure / Recovery | pre-down link remained `Down`, pre-up link restored to `Up` | **PASS** |
| 8 | TCP Loss & Retransmission | live packet dropped (`DroppedBitError`), retransmissions accounted | **PASS** |
| 9 | UDP Loss | datagram lost=1, transport retransmissions=0 (connectionless) | **PASS** |
| 10 | HTTP Under Fault | request encountering broken link dropped with `DroppedLinkDown` | **PASS** |
| 11 | DNS Under Loss | query packet dropped (`DroppedBitError`), resolution timed out | **PASS** |
| 12 | FTP Isolation | control channel remained `Up`, data channel dropped (`Down`) | **PASS** |
| 13 | SNMP Loss | UDP GetRequest dropped with `DroppedBitError`, no response generated | **PASS** |
| 14 | Parameter Sweep | 3 points executed, throughput monotonically increased with bandwidth | **PASS** |
| 15 | Multi-Seed | 3 seeds executed, mean throughput=400000.0 bps, stddev=0.0 bps | **PASS** |
| 16 | Comparison A/B | Scenario A (10M) vs B (1M): latency delta=+7200.0 $\mu\text{s}$ (+66.6%) | **PASS** |
| 17 | Fault Timeline Sync | exact SimTime dispatch at 20,000 $\mu\text{s}$; early packet delivered, late dropped | **PASS** |
| 18 | PacketJourney Hop Immutability | initial hops preserved (len 1 -> 4), prior hops immutable | **PASS** |

---

## 7. Known Educational Limitations & Build Notices

1. **Educational Simulation**:
   - Simulation uses discrete-event virtual microseconds rather than physical operating system socket interfaces.
   - Designed for academic exploration of packet queuing, latency, flow control, and protocol headers.
2. **Vite Chunk Size Notice**:
   - Production build outputs `index-*.js` (~1.17 MB) due to comprehensive bundling of diagramming (`@xyflow/react`), icons (`lucide-react`), and charting (`recharts`). This is expected for desktop Tauri applications where assets are served locally from disk without network latency.
