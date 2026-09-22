# NetSim --- Architecture

## 1. Architecture Decision

NetSim uses a Rust-first desktop architecture.

``` text
┌────────────────────────────────────┐
│             Tauri 2.x              │
│                                    │
│  React + TypeScript + Tailwind     │
└────────────────┬───────────────────┘
                 │ Tauri Commands
                 ▼
┌────────────────────────────────────┐
│             Rust Core              │
│                                    │
│ Project Manager                    │
│ Network Model                      │
│ Discrete-Event Simulator           │
│ Routing                            │
│ Data Link                          │
│ Transport                          │
│ Congestion                         │
│ Queueing                           │
│ Metrics                            │
│ Persistence                        │
└────────────────┬───────────────────┘
                 │
          JSON / CSV / SQLite
                 │
                 ▼
       Optional Python Toolkit
```

## 2. Design Principles

1.  Rust is the authoritative source of simulation truth.
2.  UI does not implement networking algorithms.
3.  Simulation time is separate from wall-clock time.
4.  Core simulations are deterministic when given a seed.
5.  Python is optional.
6.  Project format is versioned.
7.  Algorithms are independently testable.
8.  Protocols are modular.

## 3. Frontend

Use:

-   React
-   TypeScript
-   Vite
-   Tailwind CSS
-   XYFlow/React Flow
-   Recharts

Responsibilities:

-   visualization
-   user interaction
-   configuration forms
-   animation
-   charts
-   dashboards

The frontend should request state/results from Rust rather than
calculate authoritative simulation outcomes.

## 4. Tauri Layer

Tauri commands expose controlled operations:

``` text
create_project
load_project
save_project
add_node
remove_node
add_link
remove_link
configure_node
configure_link
calculate_routes
create_packet
run_simulation
step_simulation
pause_simulation
reset_simulation
run_experiment
get_metrics
export_results
```

The command API should use explicit request/response types.

## 5. Rust Workspace

Recommended:

``` text
src-tauri/
├── src/
│   ├── main.rs
│   ├── commands/
│   ├── domain/
│   ├── simulation/
│   ├── routing/
│   ├── datalink/
│   ├── transport/
│   ├── congestion/
│   ├── metrics/
│   ├── experiments/
│   ├── persistence/
│   └── faults/
└── tests/
```

For a larger implementation, split into workspace crates:

``` text
crates/
├── netsim-domain
├── netsim-sim
├── netsim-routing
├── netsim-protocols
├── netsim-metrics
└── netsim-experiments
```

Use the simpler structure initially and split only when justified.

## 6. Network Domain Model

### Node

``` text
id
name
type
position
interfaces
state
```

### Interface

``` text
id
node_id
ipv4
ipv6
link_id
status
```

### Link

``` text
id
endpoint_a
endpoint_b
bandwidth
latency
propagation_delay
loss_probability
error_probability
queue_capacity
status
```

### Packet

``` text
id
source
destination
protocol
size
sequence
ttl
created_at
current_node
next_hop
state
headers
```

### Route

``` text
destination
next_hop
cost
hop_count
path
```

## 7. Discrete-Event Engine

The core should use a priority event queue.

``` text
Simulation Clock
       │
       ▼
Priority Queue
       │
       ├── PacketCreated
       ├── QueueEntered
       ├── TransmissionStarted
       ├── TransmissionFinished
       ├── PacketArrived
       ├── PacketDropped
       ├── ACKReceived
       ├── Timeout
       ├── Retransmission
       ├── RouteUpdated
       └── FaultInjected
```

Events are ordered by simulation timestamp.

## 8. Simulation Time

Never use real sleeping to represent network latency.

Example:

``` text
Simulation time = 0 ms
Packet sent
Simulation time = 30 ms
Packet arrives
```

The UI controls animation speed independently.

Supported modes:

-   real-time
-   0.25x
-   0.5x
-   1x
-   2x
-   5x
-   10x
-   instant

## 9. Randomness

Use an explicit seeded RNG.

Project configuration:

``` text
randomSeed: 42891
```

Random events such as loss and collisions must use the simulation RNG
rather than UI randomness.

## 10. Packet Stack

Represent encapsulation:

``` text
Application Data
       ↓
Transport Segment
       ↓
Network Packet
       ↓
Data-Link Frame
       ↓
Physical Transmission
```

This allows packet inspection and OSI/TCP-IP demonstrations.

## 11. Protocol Architecture

Protocols should implement shared Rust traits/interfaces where
appropriate.

Conceptually:

``` text
Protocol
├── TCP
├── UDP
├── GoBackN
├── SelectiveRepeat
└── future protocols
```

The simulation engine should not contain protocol-specific branching
everywhere.

## 12. Fault System

Faults should be explicit simulation events/configuration.

Examples:

-   LinkDown
-   NodeDown
-   PacketLoss
-   BitError
-   BandwidthChange
-   LatencyChange
-   QueueOverflow

## 13. Metrics

The metrics engine consumes simulation events and calculates:

-   packet counts
-   delivery rate
-   loss
-   latency
-   throughput
-   RTT
-   jitter
-   retransmissions
-   queue delay
-   utilization
-   route cost
-   hop count

Metrics should be derived from events, not hard-coded.

## 14. Persistence

### Project JSON

Use versioned portable project files.

``` json
{
  "schemaVersion": 1,
  "project": {},
  "network": {},
  "simulation": {},
  "experiments": []
}
```

### SQLite

Use for:

-   project metadata
-   experiment history
-   result metadata
-   application settings

Do not make SQLite the only portable project representation.

## 15. Save Safety

Use atomic save behavior:

``` text
serialize
↓
validate
↓
write temporary file
↓
flush
↓
replace original
```

## 16. Python Toolkit

Python is optional.

It should consume exported Rust results.

``` text
Rust
 ↓
JSON/CSV
 ↓
Python
 ├── pandas
 ├── NumPy
 ├── matplotlib
 └── statistical analysis
```

Do not duplicate routing or protocol implementations in Python.

Do not require Python for the normal application.

## 17. Undo/Redo

Use command-based or snapshot-based history for topology/configuration
changes.

Support:

-   add/delete node
-   add/delete link
-   move node
-   configuration changes

## 18. Performance

Avoid rerendering the entire topology on every packet update.

Use:

-   memoized nodes
-   isolated simulation state
-   event batching
-   efficient packet visualization
-   bounded UI event history

## 19. Security

Tauri commands must validate inputs.

Do not expose arbitrary filesystem or process execution through frontend
commands.

## 20. Logging

Use structured Rust logging/tracing.

Support a developer console with categories:

-   simulation
-   routing
-   transport
-   errors
-   persistence

## 21. Testing Architecture

Rust:

-   unit tests
-   integration tests
-   property-based tests where useful
-   benchmarks

Frontend:

-   unit tests
-   component tests

Application:

-   Playwright E2E tests

## 22. CI

At minimum:

``` text
cargo fmt --check
cargo clippy
cargo test

npm run lint
npm test
npm run build

playwright tests
```
