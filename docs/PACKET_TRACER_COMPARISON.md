# NetSim / Cisco Packet Tracer: evidence-based educational-workflow comparison

**Comparison date:** 2026-10-27 (Asia/Calcutta). **Method:** NetSim source inspection plus real
Chromium-driven acceptance; Packet Tracer **official-documentation comparison only**.
No Packet Tracer application was executed. This is not a matched numerical benchmark.

## Availability, version and environment

The test host is Debian GNU/Linux 12, x86-64. `command -v packettracer PacketTracer`, the package
query, and searches under `/opt`, `/usr/local`, `/usr/share`, and `/home/user` (bounded to depth 4)
found no usable installation. These checks establish unavailability in this workspace, not absence
on the user's computer. See [environment evidence](evidence/2026-10-27/environment-and-repository.txt).

- **Installed Packet Tracer version/build/OS:** not available; no About dialog or executable to inspect.
- **Independently established advertised version:** Cisco's Resource Hub lists **9.0.1**, with
  MacOS, Ubuntu and Windows 64-bit downloads. Its requirements list Windows 11, macOS 12+, and
  Ubuntu 22.04/24.04 LTS. This establishes published availability, not an installed build. Exact
  9.0.1 build number was **not established**. [14](https://www.netacad.com/resources/lab-downloads)
- Cisco's announcement titled “Time to Download Cisco Packet Tracer 9.0.1” is dated **24 Jul 2026**.
  [1](https://www.netacad.com/articles/news/download-packet-tracer-9-0-1)
- Official help is a rolling documentation tree. Its feature descriptions must not be assumed to
  be an exhaustive, build-pinned 9.0.1 capability inventory. We do not borrow an older release's
  build number or describe search-engine snippets as an installed-version observation.

The Resource Hub requires login to download resources. No credentials were requested, no installer
was obtained from an unofficial mirror, and no Packet Tracer application test is claimed.
Short source excerpts and retrieval notes are in [the source register](evidence/2026-10-27/packet-tracer-sources.md).

## Matched educational tasks, with different models made explicit

| Educational task and inputs | NetSim evidence | Packet Tracer evidence (documentation, not hands-on) | Classification and limits |
|---|---|---|---|
| Build a small network; send traffic; inspect event order and packet layers | Browser suite `e2e/netsim.spec.ts` tests 3–7 creates/connects devices, injects traffic, steps events and inspects packets against the real service. | Official help documents logical topology creation, device connections, packet animation, global event list, OSI/detailed PDU views; Simulation Mode supports Capture/Forward, Back and filters. [3](https://tutorials.ptnetacad.net/help/default/intro.htm) [2](https://tutorials.ptnetacad.net/help/default/mode_simulation.htm) | **Comparable capability found in Packet Tracer.** NetSim's topology packets labeled HTTP/TCP are not a full ICMP/ARP/IOS simulation. Packet counts or virtual times are not cross-tool benchmarks. |
| Understand route choice and inspect addressing; configure a small IP network | Browser tests 8–10 run routing tables, convergence telemetry, CIDR and VLSM calculations. NetSim exposes Dijkstra/Bellman-Ford steps and standalone addressing calculations. | Official help lists static/default/RIP/EIGRP/OSPF/BGP routing, IPv4/IPv6 and NAT; the first lab sets host IPs, subnet mask/DNS and inspects device tables. [3](https://tutorials.ptnetacad.net/help/default/intro.htm) [1](https://tutorials.ptnetacad.net/help/default/myFirstPTLab.htm) | **Comparable capability found**, with different abstraction levels. An algorithm studio is not equivalent to configuring an IOS routing protocol. No claim that Packet Tracer lacks routing/addressing education or that NetSim has equivalent device coverage. |
| Explain GBN vs SR recovery: window 4, sequence space 8, 8 frames, third initial frame lost, frame Tx 1,000 μs, propagation 2,000 μs, ACK Tx 100 μs, timeout 10,000 μs | Real UI comparison test records both complete responses, identical configs except protocol, GBN 4 retransmissions/26,200 μs, SR 1/21,100 μs, both complete 8. Screenshot and traces: `browser/gbn-sr-*`. | The inspected official pages do **not establish** a direct matched GBN/SR loss-index comparison. Documented TCP support is not evidence for or against a dedicated GBN/SR teaching exercise. [3](https://tutorials.ptnetacad.net/help/default/intro.htm) | **Candidate differentiator requiring further evidence.** An equivalent may exist through activities, scripting/extensions or other versions. No absence or exclusivity claim; direct application search remains outstanding. |
| Change bandwidth under controlled inputs; inspect metrics | Six real UI runs cover network/TCP/UDP × bandwidth sweep/A-B. Values 1 Mbps/10 Mbps, seeds 42/101; each export includes model config, effective inputs, per-run QoS and aggregates. | Packet Tracer documents user-created packet scenarios, scheduled/periodic PDUs, PDU success/failure/time and event timing. Multiple scenarios can correspond to different test conditions. [8](https://tutorials.ptnetacad.net/help/default/mode_simulation_Scenarios.htm) [2](https://tutorials.ptnetacad.net/help/default/mode_simulation.htm) | **Comparable scenario experimentation found.** Equivalent built-in multi-seed sweeps, six-metric A/B deltas and a portable raw-metric export schema are **not established** by these pages, not proven unavailable. NetSim's exact packaging remains a candidate distinction, not novelty proof. |
| Save configuration/outcomes and reproduce the exercise | All six browser downloads were parsed and replayed through `examples/replay_experiment.py`; full deterministic results match, excluding only top-level `execution_time_ms`. Changing form labels before download leaves the completed snapshot unchanged. | Official help documents PKT/PKZ save/open, bundling external assets, saving scenarios with a network, and re-running scheduled PDUs after scenario restart. [6](https://tutorials.ptnetacad.net/help/default/interfaceOverview.htm) [1](https://tutorials.ptnetacad.net/help/default/myFirstPTLab.htm) [8](https://tutorials.ptnetacad.net/help/default/mode_simulation_Scenarios.htm) | **Comparable saving/re-running capability found.** Do not claim Packet Tracer cannot save or repeat experiments. Exact numerical determinism, seed control and machine-readable outcome/config export parity remain unverified. |

Source identifiers are the retrieval tools' numeric result identifiers; URLs disambiguate reused
numbers across searches. The source register separates fetched text from our interpretation.

## Model and metric boundaries

NetSim's general `network` target is a simplified topology event engine with timed packet injection
and a drain period. TCP/UDP targets use existing standalone bulk-transfer models, not the network
engine with different labels. They do not support scheduled faults, stochastic link loss/BER or
injection intervals. TCP shared latency is an RTT/2 estimate; UDP latency and transport jitter are
unavailable zero placeholders. Network goodput and throughput currently share a delivered-byte
formula. The standalone flow-control model uses virtual times and explicit initial losses, not real
Ethernet/TCP device configuration.

Cisco describes Packet Tracer itself as a simplified, medium-fidelity learning environment, and
notes substantial modeling limitations for some protocols. Simulation Mode may use transmission,
propagation and randomly injected process delays unless Constant Delay is selected. These documented
differences preclude treating two tools' default times as the same physical measurement.
[3](https://tutorials.ptnetacad.net/help/default/intro.htm) [2](https://tutorials.ptnetacad.net/help/default/mode_simulation.htm)

## Precise supported contribution

**NetSim integrates selected networking-algorithm studios, a Python-authoritative simulation service,
controlled model-specific experiments, and inspectable JSON evidence/replay in one educational
browser interface.** The demonstrated GBN/SR comparison and verified experiment downloads make that
integration observable. They do not establish that the workflows are first, unique, faster, more
accurate, superior, or more educationally effective than Packet Tracer or other simulators.

## Required next evidence for an exclusive/differential claim

On an authorized Packet Tracer installation, record About version/build, OS and date. Repeat the
network-inspection and IP/routing tasks; search for direct GBN/SR controls and activity/extension
solutions; test scenarios, parameter study automation, numeric metrics and exports; reopen saved
work and test reproducibility. Preserve screenshots/files and distinguish manual setup from built-in
capability. Use identical inputs only for comparable models. Until then, direct comparison remains
outstanding and **no exclusive novelty claim passes the release gate**.
