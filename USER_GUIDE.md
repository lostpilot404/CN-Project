# NetSim — User Guide

This guide describes the application that exists in this repository. It is a **web** application:
a Python simulation service plus a browser front-end. There is no desktop build.

> **Note on earlier revisions.** This file used to describe a desktop application with a dashboard,
> "Demo Scenarios", "Learning Mode", "Exam Mode" and "Reports". Those screens do not exist. The
> navigation described below is the real one.

## 1. Starting NetSim

Two processes, in two terminals:

```bash
# terminal 1 — the simulation service
.venv/bin/python python/netsim/server.py 8765

# terminal 2 — the user interface
npm install    # first run only
npm run dev
```

Open <http://127.0.0.1:1420>.

The top-right badge tells you the state of the service:

| Badge | Meaning |
|---|---|
| **Python Authoritative** (green) | Connected. Every result you see comes from the Python engine. |
| **Backend Offline** (red) | The service is unreachable. Start it with the command above and reload. |

The sidebar footer shows the same state as `ONLINE` / `CHECKING` / `OFFLINE`.

**If the badge is red, nothing on screen is a simulation result.** NetSim deliberately refuses to
invent data when the engine is down.

## 2. Workspaces

The sidebar lists ten workspaces. Each is a view onto the same project and the same engine.

| Workspace | What it is for |
|---|---|
| **Topology Canvas** | Build the network: add nodes, drag to reposition, connect them |
| **Routing Studio** | Routing tables, link-state vs distance-vector convergence |
| **Addressing & NAT** | IPv4 subnetting, VLSM, IPv6 validation, static/dynamic NAT |
| **Simulation & Events** | Inject packets, step the clock, run to completion, read the timeline |
| **Algorithm Studio** | Error control: Hamming, CRC, internet checksum, flow control, MAC |
| **Transport Layer** | TCP, UDP, congestion window, side-by-side comparison |
| **Application Layer** | DNS, HTTP, FTP, SMTP, SNMP |
| **Circuit Switching** | Connection setup with per-link bandwidth admission, teardown, utilisation |
| **QoS Performance** | Throughput, goodput, latency, jitter, loss, queue occupancy |
| **Batch Experiments** | Parameter sweeps across seeds, and A/B comparisons |

The navbar (always visible) has **New**, **Import JSON**, **Export JSON** and **Reset**, and
displays the virtual clock. The clock advances as the engine runs; it is simulation time in microseconds, not wall-clock
time.

## 3. Building a topology

1. Open **Topology Canvas**.
2. Add nodes with the palette (host, router, switch).
3. Move a node by dragging its body.
4. **Connect two nodes by dragging from a node's connection handle to another node's handle.** The
   drop target must be a handle, not the node body.
5. Select a node to edit its label, state and interfaces in the inspector.

Links carry bandwidth, propagation delay, loss probability, bit error rate and queue capacity.
`add_link` provisions a new interface when all existing ports are occupied; naming a port that is
already in use is rejected.

## 4. Running a simulation

In **Simulation & Events**:

| Control | Effect |
|---|---|
| **Inject Packet** | Creates a packet from a source to a destination node |
| **Step Event** | Processes exactly one scheduled event |
| **Run** | Advances the virtual clock by the given duration |
| **Run All** | Drains the queue until no events remain |
| **Pause** / **Reset** | Stops advancing / clears simulation state |

The event timeline shows engine events with their type, layer and timestamp. The first events of a
freshly injected packet occur at `t = 0`, so the clock may not change on the very first step.

**Reset** clears simulation state. **New** (navbar) starts a fresh project and also clears NAT
tables, so port forwards never leak between projects.

## 5. Packet inspector

Select a packet to inspect it. The inspector shows the five protocol layers the engine actually
produced for that packet — L1 through L5 — with header fields: addresses, ports, TTL, MAC
addresses, EtherType, and the link the frame travelled over. Addresses and ports are packet
identity for the simulation; MAC addresses in the frame view are illustrative identifiers (there
is no ARP or MAC learning — see the scope table in `README.md`).

Two tabs accompany it:

- **Encapsulation** — how each layer wraps the one above it
- **Journey** — the packet's path hop by hop

Nothing in the inspector is synthesised in the browser; it all comes from the engine's packet record.

## 6. Error control (Algorithm Studio)

| Tool | What to enter | What you get |
|---|---|---|
| **Hamming** | data bits, parity mode | the codeword, and with SECDED the extended codeword |
| **CRC** | data bits, generator polynomial | the remainder and the transmitted frame |
| **Internet checksum** | hex words (RFC 1071) | the folded sum and the checksum |

Worked examples you can reproduce:

- Hamming(7,4) + SECDED, input `1011` → codeword `0110011`, extended `00110011`
- CRC `1101011011` ÷ `10011` → remainder `1110`, frame `11010110111110`
- Checksum `0001 F203 F4F5 F6F7` → folded sum `0xDDF2`, checksum `0x220D`

There is also a **Verify** path for each: corrupt a codeword and watch the verifier detect and, where
the code allows, correct it.

## 7. Flow control and multiple access

Choose a flow-control mode — **Sliding Window (Base)**, **Go-Back-N ARQ**, **Selective Repeat ARQ**
or a **GBN vs SR comparison** — and configure the window size, sequence space, timeout, loss and
corruption. The result shows the sequence of frames, ACKs, timeouts and retransmissions against the
virtual clock. Go-Back-N requires a sequence space of at least *window + 1*; Selective Repeat
requires at least *2 × window*. The studio validates this before sending the request.

The multiple-access tools simulate Pure ALOHA, Slotted ALOHA, CSMA and CSMA/CD and report
throughput against offered load.

*Scope:* the three flow-control protocols run in a receding-window time-step model — window
movement, ACKs, timeouts, GBN rewind and Selective Repeat buffering are real bookkeeping, but ACK
timing is simplified and there are no delayed ACKs or ACK losses.

## 8. Addressing and NAT

- **Subnet calculator** — enter an address in CIDR form (for example `192.168.1.130/26`) to get the
  network address, broadcast address, usable range and host count.
- **VLSM** — give a base network and per-subnet host requirements to get an allocation with
  utilisation.
- **IPv6** — validate and expand/compress an address. *Scope:* IPv6 support is text-level
  (validation, RFC 5952 formatting, scope classification). Packets are forwarded with IPv4-style
  headers only; there is no IPv6 routing or neighbour discovery.
- **NAT** — create a NAT table on a router, add static port forwards (DNAT), and simulate outbound
  and inbound translations. The protocol selector accepts the usual `TCP` / `UDP` spellings.
  *Scope:* a stateful NAPT model with per-router port pools and strict state isolation between
  routers and projects; no ALGs or ICMP error rewriting.

## 9. Transport layer

| Tab | Purpose |
|---|---|
| **TCP Studio** | Three-way handshake, slow start, congestion avoidance, fast retransmit, timeouts, RTT estimation |
| **UDP Studio** | Connectionless datagrams, no retransmission |
| **Congestion** | The congestion-window timeline across the run |
| **Comparison** | TCP and UDP on the same topology, side by side |

Each studio has its own **Run** button; the result panel appears after a run. Before that it shows a
ready state — that is not an error.

*Scope:* the TCP model is an educational simulation over the real routed topology — handshake,
slow start, congestion avoidance, fast retransmit and timeout recovery are all exercised, and the
metrics distinguish wire throughput from goodput. It is not a production stack: no SACK, window
scaling or delayed ACKs, and the receive window is not a modelled bottleneck.

## 10. Circuit switching

The **Circuit Switching** workspace is the connection-oriented counterpart to packet switching.
Pick two nodes and a reserved capacity, then **Establish Circuit**: the service resolves the same
authoritative routing path used for live packet forwarding and checks that **every** link on the
path can carry the full rate. Admission is all-or-nothing — a request that cannot be satisfied is
blocked with the precise reason (insufficient capacity on a named link, or no path) and reserves
nothing. Accepted circuits appear in the circuits table with their reserved rate and path; each
active circuit can be torn down, which releases the capacity for reuse. The side panel shows
per-link reservations and admission metrics (requests, acceptance rate, blocking rate).

*Scope:* this is a resource-reservation teaching model. There is no call signalling protocol,
holding-time traffic pattern, or cross-connect hardware behaviour.

## 11. Application layer

Choose a protocol and its parameters, then run it:

- **DNS** — presets for A, AAAA, CNAME, MX and NXDOMAIN; shows the query, response and resolution
- **HTTP** — request method, path and headers; shows the request/response exchange
- **FTP** — control and data connections
- **SMTP** — envelope and message transfer
- **SNMP** — agent requests and responses

Application-layer results appear in the packet inspector with their own packet identifiers. They are
produced by the protocol model rather than travelling through the topology, so they will not appear
in the engine's general packet store.

## 12. QoS and experiments

**QoS Performance** reports metrics accumulated from the actual run: throughput, goodput, mean and
extreme latency, jitter, loss rate, retransmissions and queue occupancy. An idle project reports
zeros rather than `NaN`.

**Batch Experiments** offers:

- **Parameter sweep** — vary one link or traffic parameter across values and seeds
- **A/B comparison** — run two configurations and report the measured deltas

Sweeps are reproducible: the same seed set produces the same results. `execution_time_ms` varies
because it measures wall-clock execution, and is excluded from comparisons.

At very low offered load every bandwidth shows the same throughput — the traffic never saturates the
link. Use at least ~40 packets with a short inter-packet interval to see a bandwidth effect.

## 13. Faults

Link faults (down/restore), bit error rate, queue resizing and packet drops can be scheduled against
the virtual clock. When a fault fires, the engine emits an event and the timeline shows it. A
malformed fault is rejected with a message rather than being silently accepted.

## 14. Saving and loading

| Action | Result |
|---|---|
| **Export JSON** (navbar) | The whole project as versioned JSON |
| **Import JSON** (navbar) | Loads a `.netsim` / project JSON file — see below |
| **save_project_json** | The same document, via the API |
| **load_project_json** | Rebuilds topology, positions, interfaces, link parameters and node states |

**Importing.** Pick the file, then confirm the dialog — importing **replaces** the current
project, so nothing is touched until you confirm. The service validates the document (JSON
shape, schema version, duplicate identifiers, links that reference unknown nodes) before it
replaces anything: a rejected import leaves the current project exactly as it was and shows the
server's message. Success is reported only after the service has accepted the file. Accepted
schema version is 1; anything else is rejected by name. Importing also resets engine state, NAT
tables and circuit reservations, exactly like **New**.

Loading validates the document and reports what is wrong rather than partially applying it.

## 15. Analysing exported results

`python-tools/` contains two optional standalone scripts for exported experiment results:

```bash
pip install -r python-tools/requirements.txt
python python-tools/analyze_results.py sweep.json     # console summary table
python python-tools/plot_metrics.py sweep.json out.png # throughput/latency chart
```

They read the JSON produced by the parameter-sweep experiment and fail with a clear message if given
something else.

**Exporting from the UI.** Both the sweep and comparative result panels have **Export JSON** and
**Export CSV** buttons. The JSON export is the verbatim backend result — the file the two scripts
above consume unchanged. The CSV exports are tidy tables for spreadsheets: sweep CSVs carry one
row per run (with its seed) and one aggregate row per sweep point (run count, seed list,
stddev/min/max where measured), with units in the column names and empty cells where a value does
not apply; comparison CSVs carry one row per metric with both scenario values, the raw delta and
the percentage shift (empty when a percentage is not defined). Filenames identify the experiment
kind, name and timestamp.

## 16. When something goes wrong

| Symptom | Cause and fix |
|---|---|
| Badge says **Backend Offline** | The service is not running. Start it (§1) and reload. |
| Form rejects your input | The message states what is wrong (for example an invalid prefix length). Nothing is sent. |
| A studio shows its "ready" panel | That studio has not been run yet. Press its Run button. |
| A sweep shows flat throughput | Offered load is too low to saturate the link; see §11. |
| Port already in use | Another instance is running. Stop it, or start on a different port and point the UI at it with `VITE_NETSIM_API_URL`. |

Errors are reported as structured client errors (`HTTP 400` with a message) or, for an unknown
command, `HTTP 404`. A rejected command never returns a substitute result.
