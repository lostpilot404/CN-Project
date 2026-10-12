# NetSim --- Testing Strategy

> **Historical document (superseded, quality audit 2026-10).** Parts of this document
> describe a Rust simulation core. The authoritative simulation and domain engine is now
> `python/netsim/` (Python 3.11+), reached over HTTP by the React front-end; `src-tauri/`
> is a native shell that contains no simulation logic and is not covered by the current
> test suites. See `README.md` for the current architecture and verification status and
> `QUALITY_AUDIT_REPORT.md` for audit evidence.

## 1. Objective

Ensure the Rust simulation core is correct, deterministic, testable and
robust while the desktop UI correctly exposes it.

## 2. Test Layers

``` text
Rust Unit Tests
      ↓
Rust Integration Tests
      ↓
Property-Based Tests
      ↓
Frontend Tests
      ↓
Tauri Integration
      ↓
Playwright E2E
      ↓
Performance Benchmarks
```

## 3. Rust Unit Tests

### Network Model

Test:

-   node creation
-   link creation
-   deletion
-   duplicate IDs
-   invalid endpoints

### IPv4

Test:

-   valid addresses
-   invalid addresses
-   CIDR
-   network address
-   broadcast
-   host count
-   subnet generation

### Routing

Test:

-   Dijkstra
-   Bellman-Ford
-   disconnected graphs
-   route reconstruction
-   route invalidation

### Hamming

Test:

-   encoding
-   parity
-   valid frames
-   single-bit error detection
-   supported correction

### CRC

Test:

-   valid frames
-   invalid frames
-   generator handling
-   injected errors

### Checksum

Test:

-   arithmetic
-   carry folding
-   checksum generation
-   validation

### Flow Control

Test:

-   normal transfer
-   packet loss
-   timeout
-   window movement
-   Go-Back-N retransmission
-   Selective Repeat retransmission

### Transport

Test:

-   TCP ACK behavior
-   timeout
-   retransmission
-   UDP delivery
-   loss behavior

### Metrics

Test:

-   latency
-   throughput
-   packet loss
-   RTT
-   jitter
-   utilization
-   queue delay

## 4. Property-Based Tests

Use Rust property-based testing where appropriate.

Examples:

``` text
Queue occupancy <= configured capacity
Simulation timestamps never decrease
Route paths only use existing links
Valid generated CRC frames validate
```

## 5. Integration Tests

### Basic Packet

``` text
topology
→ addresses
→ routing
→ packet creation
→ transmission
→ delivery
```

### Link Failure

Disable a link.

Verify:

-   affected route changes
-   unreachable destinations are handled
-   route event is recorded

### Loss

Configure loss.

Verify:

-   packets can be dropped
-   metrics change
-   only applicable protocols retransmit

### Error Detection

Inject an error.

Verify expected algorithm response.

## 6. Frontend Tests

Test:

-   topology controls
-   property panels
-   dialogs
-   packet inspector
-   event timeline
-   charts
-   experiment configuration
-   project save/load UI

## 7. Tauri Integration Tests

Verify frontend commands correctly communicate with Rust and handle
errors.

## 8. Playwright E2E

Main workflow:

``` text
launch
→ create project
→ add nodes
→ connect nodes
→ configure IPs
→ calculate routes
→ create packet
→ run
→ inspect packet
→ inspect metrics
→ save
→ reload
```

## 9. Determinism Test

Run identical experiment twice with the same seed.

Expected:

-   same event sequence
-   same packet outcomes
-   same aggregate metrics

Allow documented nondeterminism only where technically unavoidable.

## 10. Performance Benchmarks

Benchmark:

-   topology creation
-   route calculation
-   event processing
-   1,000 packets
-   10,000 packets
-   larger event queues

Track:

-   runtime
-   memory
-   events/sec

Do not invent performance numbers before benchmarking.

## 11. Failure Testing

Test:

-   malformed project file
-   incompatible schema version
-   invalid topology
-   invalid IP
-   invalid experiment configuration
-   interrupted save
-   unavailable destination

## 12. CI

Run:

``` text
cargo fmt --check
cargo clippy --all-targets --all-features
cargo test

frontend lint
frontend test
frontend build

playwright
```

## 13. Definition of Done

A feature is complete only when:

-   implementation exists
-   unit tests exist
-   integration behavior is verified
-   UI works
-   error handling exists
-   documentation is updated
