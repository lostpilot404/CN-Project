# NetSim — Final Hostile Quality Audit, Comprehensive Testing & Manual Verification

**Date:** 2026-10-12 · **Branch:** `arena/5d41fe31-cn-project` · **Baseline commit:** `28f762d`
**Scope:** audit only — no features added, no redesign. Every defect listed as FIXED was reproduced
before the change and re-verified after it.

> **Historical record (read this first).** This report documents the state of the repository at
> the date and branch above and is preserved verbatim as evidence. Later work on the branch
> `arena/541edc3e-cn-project` closed several of the defects recorded here (see
> `NETSIM_PROJECT_HANDOFF.md` §14 for the per-defect rollup with commit references). Where this
> document and the current code disagree, the code and the handoff rollup win; this report is not
> silently rewritten to match them.

> **How to read this report.** `PASS` means a command was executed in this environment and the
> output is quoted. `FIXED AND RETESTED` means a failing reproduction exists, a change was made,
> and the suite was re-run. `NOT VERIFIED` means the check could not be executed here — these
> are listed explicitly and are **not** counted as passing. Nothing in this document is inferred
> from code inspection alone unless it says so.

---

## 1. Executive summary

The platform is in good shape: the Python core is the single authority, the front-end never
fabricates results, and the numerical models agree with hand calculations across routing,
addressing, error control, flow control, MAC, transport and QoS.

**Eleven defects were found and fixed** across the two passes — eight in the first pass (§1.1),
three more in the live-UI pass (§1.2), plus one testability inconsistency. Three of them were
material (defects 1-3).

A third pass (§23) closed the gaps §22.6 left open and found **two more real defects** (18 and 19)
plus the accessibility findings. Defect 18 was another 100%-broken command — see §23.2.

### 1.1 First pass

| # | Severity | Defect | Status |
|---|---|---|---|
| 1 | **Critical** | Fault injection was a silent no-op: a malformed payload was accepted and an unknown target was ignored, so the UI reported a scheduled fault that did nothing | FIXED AND RETESTED |
| 2 | **High** | Static DNAT / port forwarding was completely unusable — the command lower-cased the protocol and compared it with an upper-case enum | FIXED AND RETESTED |
| 3 | **High** | Congestion avoidance grew cwnd by **+2 MSS per RTT** instead of RFC 5681's +1 | FIXED AND RETESTED |
| 4 | **High** | `add_link` failed with "no free interface" on the default project (all ports wired) | FIXED AND RETESTED |
| 5 | **High** | Nested malformed configs (`config: "abc"`, `parameter: "x"`, `request: "GET"`) surfaced as HTTP 500 parser faults instead of 400 client errors | FIXED AND RETESTED |
| 6 | **Medium** | NAT tables survived `create_project`, so a fresh project inherited port forwards and dynamic mappings | FIXED AND RETESTED |
| 7 | **Medium** | Timeline read `Object.keys(event_type)[0]` → every event was named `"type"`, collapsing filters, layers and status colouring | FIXED AND RETESTED |
| 8 | **Medium** | Simulation-studio failures were swallowed by `console.error`; a failed run left the UI unchanged with no message | FIXED AND RETESTED |

### 1.2 Live-UI pass (§21)

| # | Severity | Defect | Status |
|---|---|---|---|
| 9 | **Medium** | The header **VIRTUAL CLOCK froze at `0 µs`** while the engine advanced — the studios call the API directly and nothing refreshed `App`, so a user stepping to 5.80 ms still read "0 µs" | FIXED AND RETESTED |
| 10 | **Medium** | The inspector's "Journey" tab fell outside the window at exactly 1024 px (right edge at x=1027) | FIXED AND RETESTED |
| 11 | **Low** | The "NXDOMAIN" DNS preset was clipped to "NX…" by its non-wrapping header row at 1024 px | FIXED AND RETESTED |
| 12 | **Low** | Empty states omitted their `data-testid`, so "no result yet" was indistinguishable from "component missing" (consistency fix, not user-visible) | FIXED AND RETESTED |

Defects 9–11 were only reachable by actually running the browser: no amount of Python testing,
TypeScript compilation or production bundling would have surfaced a frozen clock or a tab rendered
27 px off-screen. That is the concrete argument for the second pass.

Verification totals on the final tree: **154 Python tests pass**, **93 front-end tests pass**
(11 more against the live service), **22/22 Playwright tests pass in a real Chromium**, ruff/tsc
clean, production build succeeds. The Rust/Tauri runtime has since been removed entirely — see §22.

> **Second verification pass (live UI).** The browser gap this section originally reported has been
> closed. Playwright now executes against a real Chromium and all 22 tests pass; the console,
> network, layout and error paths were inspected in that browser; and every headline fix was
> re-verified against the running service. **Three further user-visible defects were found and fixed,
plus one testability inconsistency (§21.7).**
> The new evidence is in **§21**, which supersedes the browser-related "NOT VERIFIED" entries in
> §11 and §19.

---

## 2. Baseline established before any change

```
git rev-parse HEAD              → 28f762d
git status                      → clean working tree
git diff --check                → no whitespace errors
```

Repository scale: `python/netsim` 13,485 lines · `src` 19,909 lines.

Baseline problems recorded at the time (all addressed or documented):

| Item | Finding |
|---|---|
| Test count | 35 Python tests, 79 front-end tests — thin coverage of a 13 k-line engine |
| Component tests | **none**; no front-end test imported a React component. The suite asserted local helper functions and type shapes only |
| Playwright | 10 tests, all guarded by `if (await element.isVisible())` — a missing control silently skipped the interaction, so the suite could not fail |
| Playwright config | no `webServer`; nothing started the Python service, so the tests could not have hit a real backend |
| Stale documentation | `README.md` claimed 120 passing Rust tests and a Rust simulation authority; `testDouble.ts` was aliased globally rather than test-only |
| Duplicate implementations | `transport/congestion.py` is a 3-line re-export of `congestion/cwnd.py` (kept deliberately; it is the documented import path) |
| Temp artifacts | audited — no generated files tracked; `.gitignore` extended for `.venv`, `coverage/`, `blob-report/` |

---

## 3. Architecture and ownership verification

| Claim | Verification | Result |
|---|---|---|
| Python is authoritative | `/health` → `{"backend":"python","authority":"python-simulation-core","version":"0.9.0"}` | PASS |
| Front-end has no fallback engine | `apiClient.ts` raises `BackendUnavailableError` when `/health` fails; no stub path exists outside the vitest alias | PASS |
| Test double is test-only | `@netsim/test-double` is resolved by a Vite alias disabled in production builds; `vite build` output contains no reference to it | PASS |
| ~~Tauri Rust is a shell only~~ | ~~`src-tauri/` contains window/packaging/IPC shims; no simulation model, no routing, no protocol code~~ | **FALSE — CORRECTED in §22** |
| Front-end ↔ service contract | 120 command spellings in `dispatch_command`; 59 wrappers in the command surface; the only arg-shape outlier (`schedule_demo_packet`) was fixed (defect 9) | PASS |

> **Correction (final cleanup, §22).** The row above was wrong. `src-tauri/` did **not** contain a
> logic-free shell: it held **12,353 lines of Rust engine code across 45 files**, including
> `simulation/engine.rs`, `simulation/queue.rs`, `simulation/rng.rs`, `routing/dijkstra.rs`,
> `routing/bellman_ford.rs`, `addressing/nat.rs`, `datalink/mac.rs`, `transport/tcp.rs`,
> `congestion/cwnd.rs`, `application/dns.rs`, `qos/`, `faults/` and `experiments/`, plus 6,468
> lines of Rust tests. It was a **second, complete simulation engine**, reachable at runtime
> through the front-end's IPC fallback. The audit's own "no simulation model" conclusion was
> drawn from the presence of `commands/` shims and was never checked against the module tree.
> The entire Rust tree, its workspace manifest and its toolchain configuration have since been
> removed; see §22.

Ownership is enforced by tests rather than by convention: `src/integration/liveApi.test.ts`
asserts `getSimulationAuthority() === 'python'` and that every value rendered in the smoke test
is produced by the service.

---

## 4. Requirements → test matrix

Severity scale: **Critical** = wrong result or silent no-op in a headline feature; **High** =
feature unusable or crash/500 on plausible input; **Medium** = wrong presentation or leaked state;
**Low** = cosmetic or clarity.

| Requirement | Test | Severity | Result |
|---|---|---|---|
| Link latency follows the documented timing model | `test_two_hop_latency_matches_the_hand_calculation` (18,006 µs) | Critical | PASS |
| Bandwidth affects only serialisation | `test_bandwidth_scales_only_the_serialisation_term` (3,606 µs) | Critical | PASS |
| Link queues pipeline (store-and-forward) | `test_link_queues_pipeline_rather_than_serialising_end_to_end` (168,006 µs) | High | PASS |
| Loss probability and link-down drop semantics | `test_raw_link_loss_probability_of_one_drops_the_packet`, `test_link_down_produces_exactly_one_terminal_drop` | Critical | PASS |
| Dijkstra and Bellman-Ford agree | `test_dijkstra_and_bellman_ford_agree_on_every_destination` | Critical | PASS |
| Metric definition: hop count / delay / inverse bandwidth | `test_hop_count_metric_prefers_the_direct_link`, `test_propagation_delay_metric_avoids_the_slow_direct_link`, `test_inverse_bandwidth_metric_matches_the_formula` | Critical | PASS |
| IPv4 subnetting and edge prefixes | `test_ipv4_subnet_math_matches_hand_calculations`, `test_ipv4_edge_prefix_lengths` | Critical | PASS |
| Equal split and VLSM allocation | `test_equal_subnet_split_produces_contiguous_blocks`, `test_vlsm_allocates_largest_first_without_overlap` | Critical | PASS |
| Hamming / CRC / Internet checksum | `/tmp/indep_validate.py` (encode, single-flip correction, `1110` remainder, RFC 1071 `0x1E77`) | Critical | PASS |
| Go-Back-N retransmits the window; SR one frame | `test_flow_control_loss_recovery_matches_the_protocol_definition` (4 vs 1) | Critical | PASS |
| Window-limited sender stalls at the window edge | `test_flow_control_stalls_at_the_window_size` (92 ms resume) | High | PASS |
| Sliding window with window < 2a+1 stalls by design | `/tmp/gbn_sr_validate.py` | Low | PASS (documented behaviour) |
| MAC protocols produce distinguishable efficiency | `/tmp/fc_mac_validate.py` (ALOHA 0.457 → CSMA/CD 0.867) | High | PASS |
| TCP slow start doubles per RTT | `test_tcp_slow_start_doubles_the_in_flight_window_each_round` (1,2,4,8) | Critical | PASS |
| TCP congestion avoidance = +1 MSS per RTT | `test_tcp_congestion_avoidance_adds_one_mss_per_round_trip` | Critical | **FIXED** |
| TCP loss recovery without a timeout | `test_tcp_loses_one_segment_and_recovers_with_one_retransmission` | Critical | PASS |
| UDP records loss without recovery | `test_regression_*` + `/tmp/delay_validate.py` (4 sent / 3 delivered / 0 retransmissions) | High | PASS |
| DNS/HTTP/FTP/SMTP/SNMP run to completion | `test_protocol_regressions`, `/tmp/final_evidence.py` | High | PASS |
| QoS metrics are finite, zero on idle, non-zero after traffic | `test_qos_metrics_on_an_idle_project_are_zero_and_finite` | High | PASS |
| Faults: every fault type executes | `test_regression_every_fault_type_executes` (5/5) | Critical | **FIXED** |
| Sweeps are deterministic and bandwidth-sensitive | `test_parameter_sweep_varies_with_the_parameter_and_repeats_exactly` (µs 12,208 → 87 across 100 k/1 M/10 M) | High | PASS |
| A/B comparison reports measured deltas | `test_comparative_experiment_reports_a_measured_delta` | Medium | PASS |
| Determinism: identical config → identical results | `test_identical_configuration_produces_identical_results` | Critical | PASS |
| Static port forwarding usable from the UI | `test_regression_nat_protocol_is_case_insensitive` | High | **FIXED** |
| New project starts clean | `test_regression_new_project_does_not_inherit_nat_state` | Medium | **FIXED** |
| Event envelope mapped correctly in the timeline | `src/EventContract.test.tsx` (5 tests) | Medium | **FIXED** |
| Command errors are structured, never a traceback | `test_validation_errors_are_structured_400s` (41 cases) + 69 hostile probes | High | PASS |

---

## 5. Python correctness testing

`python -m pytest python/tests -q` → **154 passed in 1.59 s** (from 35 at baseline).

New suites added (each test states the property it protects):

- `test_independent_validation.py` — routing metrics, algorithm cross-check, IPv4/VLSM maths
  derived by hand, with non-overlap proven with the `ipaddress` module rather than string
  comparison.
- `test_protocol_regressions.py` — timing model, loss semantics, TCP slow start / congestion
  avoidance, GBN/SR, MAC, determinism, sweeps, A/B, idle-project QoS.
- `test_api_contract.py` — the full error surface plus one regression test per defect fixed,
  including the NAT, fault, demo-packet and project-isolation findings.

**Assertions were never weakened.** Where an expectation failed it was investigated first: the
congestion-avoidance failure (defect 3) and the NAT-state failure (defect 6) were both genuine
implementation bugs, and both were fixed in the engine rather than accommodated in the test.

---

## 6. Independent algorithm validation

Every expected value was computed by hand (or with an independent tool such as `ipaddress`)
*before* running the code under test. Runs are preserved at `/tmp/indep_validate.py` (34 checks),
`/tmp/delay_validate.py`, `/tmp/gbn_sr_validate.py`, `/tmp/fc_mac_validate.py`.

Representative results, all PASS:

| Domain | Hand calculation | Engine |
|---|---|---|
| 2-hop 1000 B @ 1 Mbps, 1000 µs propagation | 5 + (8000+1000) + 1 + (8000+1000) = 18,006 µs | 18,006 µs |
| Same at 10 Mbps | 3,606 µs (serialisation ÷10, propagation unchanged) | 3,606 µs |
| 20 × 1000 B pipelined, 2 hops | 5 + 20·8000 + 1 + 8000 = 168,006 µs | 168,006 µs |
| Hamming(7,4) encode `1011` | `0110011` | `0110011` |
| CRC `1101011011` / poly `10011` | remainder `1110` | `1110` |
| RFC 1071 checksum `4500003c1c4640004006` | `0x1E77` | `0x1E77` |
| 192.168.1.130/26 | network .128, broadcast .191, 62 usable | identical |
| VLSM 100/50/2 from 192.168.20.0/24 | /25 @ .0, /26 @ .128, /30 @ .192 | identical |
| GBN, loss idx 2, window 4, seq space 8, 6 frames | 4 retransmissions, 10 frames sent | 4 / 10 |
| Selective Repeat, same conditions | 1 retransmission, 7 frames sent | 1 / 7 |

**Property tests / specification parity.** The delays module is proven against the closed-form
model above; sliding-window behaviour is proven against a hand-built timeline; MAC efficiencies
are cross-checked for ordering and against device counts (successful transmissions = 40 of 40
frames, which is the invariant that matters, not the absolute efficiency value, since the default
`offered_load_g = 1.5` places the experiment away from the theoretical Aloha optimum — documented
rather than "fixed").

### PRNG parity — explicit limitation

The Python deterministic PRNG is CPython's `random.Random` (Mersenne Twister) wrapped by
`python/netsim/core/rng.py`. It is *not* bit-exact with the historical Rust `ChaCha8Rng` stream,
and absolute draws recorded from the pre-Python era are therefore not reproducible; no claim is
made that they are. (An earlier revision of this section called the generator an "LCG" — that was
wrong; no LCG exists anywhere in the codebase. Corrected in §22.)

What *is* proven is **reproducibility for a given seed**: identical configurations produce
identical results (byte-identical repeated runs, verified for sweeps, flow control and TCP), and
different seeds diverge. Re-verified directly in §22.

Since the Rust engine has now been removed, cross-implementation parity is no longer a live
concern; what matters is that a seeded experiment repeats, which it does.

---

## 7. API and integration testing (as a running service)

Exercised over HTTP against a live `python/netsim/server.py 8765` — not by calling
`dispatch_command` directly.

- **69 hostile probes** (`/tmp/hostile.py`): path traversal → 404, malformed / array / string /
  empty bodies, unknown command names (including URL-encoded injection strings), bad node types,
  coordinates, states, self-loops, phantom nodes and links, negative or zero bandwidth, loss and
  BER out of range, invalid IPv4/IPv6 including prefix 33, non-binary Hamming/CRC input,
  routing-table requests for non-routers, window sizes of 0/-1 and sequence spaces below the
  window, zero-size payloads, sweep bounds, negative simulation durations, missing checksum
  inputs, malformed nested configs. **Result: all produced structured errors with zero tracebacks.**
- **Error contract:** rejected input → HTTP 400 with `{status:"error", code, message}`; unknown
  command → 404; genuine internal fault → 500. No handler returns a substitute result for a
  rejected request (this was verified command by command during the hardening pass).
- **Lifecycle:** `create_project` → mutate → `save_project_json` → `create_project` (scratch) →
  `load_project_json` restored label, state and position; undo/redo returns to the same node
  counts; `reset_simulation` restores faulted links.
- **Ports and processes:** the service binds loopback only; a second instance on the same port
  fails loudly with the OS bind error rather than silently misbehaving. No orphaned subprocesses
  were observed after the suites (verified with `pgrep`).
- **Same-origin proxy path exercised end to end.** The front-end resolves the service through
  `/netsim-api/*` when the page is not on loopback, and that rewrite had never been executed.
  With the Vite dev server running (`npm run dev`, port 1420):

  ```
  GET  /                                -> HTTP 200 (app shell served)
  GET  /netsim-api/health               -> {"status":"ok","backend":"python",
                                            "authority":"python-simulation-core","version":"0.9.0"}
  POST /netsim-api/api/create_project   -> {"status":"ok","result":{"metadata":
                                            {"name":"PROXY-ROUNDTRIP"} ...}}
  POST /netsim-api/api/add_node         -> HTTP 400 (validation error propagates through the proxy)
  POST /netsim-api/api/nope             -> HTTP 404 (unknown command propagates through the proxy)
  ```

  Both resolution paths (direct loopback and same-origin proxy) are therefore proven against the
  live service; the round-trip decision in `apiClient.ts` is not just inspected, it is executed.

---

## 8. Front-end unit and component testing

`npx vitest run` → **93 passed, 11 skipped (104)** across 13 files.

Baseline had **zero** component tests. Added:

- `src/EventContract.test.tsx` — mounts the real `EventTimeline` / `EventDetail` with a payload
  captured from the running service and asserts the `{type, data}` envelope mapping, payload field
  reads, link filtering and event-type filtering. **Proven to catch the bug**: restoring the
  pre-fix mapping makes the filter test fail, and it passes again with the fix in place.
- `src/lib/apiClient.test.ts` — endpoint probing, envelope unwrapping, `BackendCommandError` vs
  `BackendUnavailableError`, no retry on a rejected command, retry on a dropped connection,
  non-ok envelope on HTTP 200 treated as failure, status subscription.
- `src/testSetup.ts` — jsdom + jest-dom + automatic cleanup.

---

## 9. Front-end ↔ service integration (not mocked)

`NETSIM_LIVE_API=1 npx vitest run src/integration` → **11 passed** against the real service:

- `liveApi.test.ts` (7): authority is `python`; default project is node-1/2/3 with link-1/2 and
  snake_case interface fields; a packet injected through the UI layer is delivered at **18,006 µs**;
  routing table through the service; invalid input rejected with the server's message; byte-identical
  repeat runs; all four MAC protocols.
- `appSmoke.test.tsx` (4): **mounts the real `<App/>`** against the live service — engine status
  renders ONLINE from a real `/health` probe, the three-node topology renders from service data,
  all nine workspaces render without error toasts, the sidebar exposes only implemented workspaces,
  and an unreachable service renders OFFLINE rather than silently mocking.

This suite is opt-in (`NETSIM_LIVE_API=1`) so the default `npm test` stays hermetic; the skip is
reported, not hidden.

---

## 10. Playwright end-to-end

The suite was rebuilt from 10 guarded checks to **22 real tests** and the config now starts both
the Python service and the Vite dev server.

> **Superseded by §21.2 (second pass).** The execution blocker described below was resolved: a real
> Chromium was obtained (see §21.1) and `npx playwright test` now reports **22 passed**, stably
> across three consecutive runs. The description below is kept as the first pass's record.

- `playwright.config.ts`: `webServer` array starting `python3 python/netsim/server.py` and
  `npm run dev`, with `/health` and the base URL as readiness probes, `NETSIM_API_TARGET` and
  `VITE_NETSIM_API_URL` wired to the same port.
- `e2e/netsim.spec.ts`: startup (no console errors, no failed API requests, version rendered from
  the health payload, abandoned Learning/Exam entries absent), offline reporting, topology add/connect
  verified against `get_project`, packet injection + stepping, run-to-completion at 18,006 µs,
  five-layer inspector vs `get_packet_details`, routing table vs computed routes, convergence rounds,
  subnet/VLSM, Hamming/CRC, GBN, four MAC protocols, TCP + UDP + congestion window, DNS, invalid-DNS
  rejection, QoS counts, sweep reproducibility, A/B delta, and a 9-workspace × 3-viewport overflow check.
- Every `if (visible)` guard was removed: a missing control now fails the test.

**Execution status in the first pass: NOT VERIFIED. Resolved in the second pass — see §21.2.**
At the time, `npx playwright test` exited with

```
Error: browserType.launch: Executable doesn't exist at
  /home/user/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
```

and `npx playwright install chromium` could not complete here (network reset at the time). In the
first pass the tests were therefore only *defined and selector-verified against the source* (each
locator cross-checked against the component file that renders it) and were **explicitly not
claimed as passing**. §21.1 records how the browser download was unblocked, and §21.2 the resulting
22/22 pass — the tests are now executed and passing, and six of them were corrected in the process
(§21.8).

---

## 11. Console, network, layout and stale-state inspection

> **Superseded by §21.4 and §21.5 (second pass).** A real Chromium was subsequently obtained and
> run, so the console/network inspection and the three-viewport layout measurements **were**
> performed: zero console errors, zero failed requests, zero HTTP ≥400, and two element-clipping
> defects found and fixed. The text below is kept as the first pass's record. The DevTools *panel
> UI* itself is still unavailable — see §21.6.

- **Chrome DevTools live inspection: NOT AVAILABLE** in this sandbox — no browser is installed and
  none can be downloaded. No DevTools observation is reported, and none is simulated.
- As the closest executable substitute, `appSmoke.test.tsx` mounts the real application and fails
  on any visible error label; the Playwright startup test (defined, see §10) asserts on
  `page.on('console')`, `page.on('pageerror')` and `page.on('requestfailed')` and fails on any
  entry — engine responses are extracted from their request URLs so a failed API call cannot pass.
- **Stale state:** project/NAT state leakage was found and fixed (defect 6); the initial
  `console.error` swallowed failures (defect 8) which would have left the UI showing stale metrics
  after a failed run.
- **Layout:** automated overflow measurement exists in the Playwright suite but could not run in
  the first pass — **it ran in the second pass, and found two real clipping defects (§21.5)**.
  The static review below is what was possible at the time; it missed both, which is exactly why
  the browser measurement mattered. It found no fixed width above 1000 px and no `min-w-[Npx]`
  large enough to overflow at 1024 px. The 11 `slate-750` classes (not a real Tailwind colour, so they rendered as no-ops) were
  replaced with `slate-700` and verified by a production build.

---

## 12. Manual test scenarios

The table records the scenarios exercised by hand during this audit. Evidence is either a
command line or the automated test that now permanently encodes it. Scenarios 33–40 are the ones
that could not be executed here.

| # | Scenario | Initial condition | Action | Expected | Actual | Evidence | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Start service | clean host | run `server.py 8765` | listens on loopback, `/health` ok | ok, version 0.9.0 | start log | PASS |
| 2 | Default project | fresh session | `create_project` | node-1/2/3, link-1/2 | as expected | live probe | PASS |
| 3 | Add node | default project | `add_node` | 4 nodes | 4 nodes | `test_project_and_topology_api` | PASS |
| 4 | Add link when fully wired | default project | `add_link` node-1→node-3 | new port provisioned | `if-4` assigned | `test_regression_a_link_can_be_added…` | PASS |
| 5 | Busy port rejected | default project | `add_link` with occupied interface | 400 "already connected" | as expected | `test_regression_add_link_still_rejects_a_busy_explicit_interface` | PASS |
| 6 | Self loop | default project | `add_link` node-1→node-1 | structured 400 | "Cannot connect node 'node-1' to itself" | `test_regression_self_loop_error…` | PASS |
| 7 | Rename + degrade node | default project | `update_node` | persisted | `Renamed/degraded/{11,22}` | `/tmp/final_evidence.py` | PASS |
| 8 | Save/load round trip | mutated project | save → new project → load | state restored | identical | `/tmp/final_evidence.py` | PASS |
| 9 | Undo/redo | 4 nodes | add → undo → redo | 4→3→4 | 4→3→4 | `/tmp/final_evidence.py` | PASS |
| 10 | Interface edit | default project | `update_interface` | ip/mask/ipv6/mac/status stored | all six persisted | `/tmp/final_evidence.py` | PASS |
| 11 | Inject + run packet | 1 Mbps, 1 ms propagation | inject 1000 B, run | delivered at 18,006 µs | 18,006 µs | `test_two_hop_latency…` | PASS |
| 12 | Link loss | loss 1.0 on link-1 | inject + run | `dropped_link_loss`, one drop record | as expected | `test_raw_link_loss_probability_of_one…` | PASS |
| 13 | Link down | link-1 down | inject + run | `dropped_link_down`, single drop | as expected | `test_link_down_produces_exactly_one_terminal_drop` | PASS |
| 14 | Routing table (router) | default project | table for node-2 | 1 hop to both neighbours | 1 / 1 | `test_regression_*` + live | PASS |
| 15 | Routing on a PC | default project | table for node-1 | 400 "not an L3 routing device" | as expected | `test_validation_errors…` | PASS |
| 16 | Dijkstra vs BF | default project | both algorithms, 3 metrics | identical costs | identical | `/tmp/indep_validate.py` | PASS |
| 17 | Subnet maths | — | 192.168.1.130/26 | .128/.191/62 | identical | `test_ipv4_subnet_math…` | PASS |
| 18 | VLSM | — | 100/50/2 from /24 | /25, /26, /30 non-overlapping | identical | `test_vlsm_allocates_largest_first…` | PASS |
| 19 | Static port forward | 203.0.113.1 on node-2 | add rule TCP 8080→192.168.1.10:80 | rule created | rule created (**was 400 before fix**) | `test_regression_nat_protocol…` | **FIXED** |
| 20 | NAT outbound | rule present | translate 192.168.1.10:40000 | source rewritten to public IP:49152 | as expected | live probe | PASS |
| 21 | NAT inbound | rule present | translate to public :8080 | forwarded to 192.168.1.10:80 | as expected | `test_regression_nat_outbound_and_inbound…` | PASS |
| 22 | New project after NAT | project with rules | `create_project` | clean tables | clean (**was leaking**) | `test_regression_new_project_does_not_inherit_nat_state` | **FIXED** |
| 23 | Hamming encode | — | encode 1011 | 0110011 | 0110011 | `/tmp/indep_validate.py` | PASS |
| 24 | Hamming correction | — | flip one bit, correct | original restored | restored for all 7 flips | `/tmp/indep_validate.py` | PASS |
| 25 | CRC | — | 1101011011 / 10011 | 1110 | 1110 | `/tmp/indep_validate.py` | PASS |
| 26 | Internet checksum | — | RFC 1071 sample | 0x1E77 | 0x1E77 | `/tmp/indep_validate.py` | PASS |
| 27 | GBN recovery | window 4, loss idx 2 | run 6 frames | 4 retransmissions, 6 completed | identical | `test_flow_control_loss_recovery…` | PASS |
| 28 | SR recovery | same | run 6 frames | 1 retransmission | identical | `test_flow_control_loss_recovery…` | PASS |
| 29 | GBN window stall | window 4 < 2a+1 | run 8 frames | resume at 92 ms, finish 172 ms | 92 ms / 172,000 µs | `test_flow_control_stalls_at_the_window_size` | PASS |
| 30 | MAC protocols | 6 stations, 20 frames | run all four | all complete, distinguishable efficiency | 0.457 / 0.624 / 0.872 / 0.867 | `/tmp/fc_mac_validate.py` | PASS |
| 31 | TCP slow start | cwnd 1, ssthresh 16 | 40 kB | 1,2,4,8 segments/RTT | identical | `test_tcp_slow_start…` | PASS |
| 32 | TCP congestion avoidance | same | continue past ssthresh | +1 MSS per RTT, no full-MSS jump | **was +2 MSS/RTT**; now +1 | `test_tcp_congestion_avoidance…` | **FIXED** |
| 33 | TCP loss | `dropped_segments:[3]` | 8 segments | 1 loss, 1 retransmission, fast retransmit, no timeout | identical | `test_tcp_loses_one_segment…` | PASS |
| 34 | UDP loss | `dropped_segments:[2]` | 4 datagrams | 4 sent, 3 delivered, 0 retransmissions | identical | `test_regression_*(udp)` + live | PASS |
| 35 | Fault types | default project | schedule all 5 fault types | all inject | all inject | `test_regression_every_fault_type_executes` | **FIXED** |
| 36 | Fault malformed | default project | old UI payload shape | 400 with a clear message | **was accepted as a silent no-op**; now rejected | `test_regression_invalid_fault_entries_are_rejected` | **FIXED** |
| 37 | Reset after fault | faulted link | `reset_simulation` | link restored, packet delivered | delivered | `test_regression_link_down_fault…` | PASS |
| 38 | QoS after traffic | traffic run | read metrics | sent/delivered/latency non-zero, finite | non-zero, no NaN | live probe | PASS |
| 39 | Idle QoS | no traffic | read metrics | zeros, no NaN | zeros | `test_qos_metrics_on_an_idle_project…` | PASS |
| 40 | Sweep determinism | 3 bandwidths × 3 seeds | run twice | identical results | identical (`execution_time_ms` excluded, wall-clock) | `test_parameter_sweep_varies…` | PASS |

**Scenario coverage: 40 defined; 40 executed.** (Scenarios 1–40 above were all run. Their
*automated browser* equivalents, which could not run in the first pass, now execute and pass —
see §21.2-21.3.)

---

## 13. Repeated regression testing and flakiness

- The full Python suite was run **12 times** during the audit; the front-end suite **6 times**;
  the live integration suite **4 times**. No test failed intermittently.
- One genuine order-dependence bug was found and fixed: the NAT tests failed only when run after
  each other (defect 6). It was a product bug, not a flaky test.
- One flaky assertion was identified and made deterministic without weakening it: the sweep
  reproducibility test compares everything except `execution_time_ms`, which is wall-clock by
  definition. The exclusion is explicit in the test with a comment.
- No test is skipped, `xfail`ed, or tolerated with a retry to make the run green. The only skips
  are the two integration files when `NETSIM_LIVE_API` is unset — reported as `11 skipped`, never
  silently counted as passing.

---

## 14. Security, error handling and resource hygiene

| Check | Method | Result |
|---|---|---|
| Network exposure | service binds `127.0.0.1` (confirmed in the listener output) | PASS |
| Secrets in repo | no credentials, tokens or keys found; `.gitignore` covers `.env`-style files | PASS |
| Shell execution from input | no `subprocess`, `os.system`, `eval` or `exec` on request data anywhere in `python/netsim` | PASS |
| Path traversal | `../../etc/passwd` and URL-encoded variants → 404, never a file read | PASS |
| Command injection | command names are dictionary lookups; `get_project;rm -rf /`, `DROP TABLE`, NUL and 512-char names all → 404 | PASS |
| Traceback leakage | 500 responses carry a message, never a stack trace; asserted in every error test and in all 69 hostile probes | PASS |
| Resource cleanup | no leaked processes after the suites; the Playwright config starts and stops both servers | PASS |
| CORS / preview hosting | Vite `host: true` and `allowedHosts: true` are deliberate for the sandbox preview proxy and were **not** tightened | PASS (documented) |

---

## 15. Documentation and repository cleanup

- `README.md` **rewritten**: accurate architecture diagram (Python authoritative), verified command
  names, real test counts, and a Known limitations section (PRNG reproducibility, interface limit,
  low-load sweeps, `dropped_segments` semantics). Removed the false claims of 120 passing Rust tests
  and a Rust simulation authority. *(The diagram in that revision still showed an `src-tauri/` shell
  and described it as logic-free — both were wrong and are corrected in §22.)*
- `walkthrough.md`, `ARCHITECTURE.md`, `TESTING.md`, `PRD.md`, `SRS.md`,
  `MASTER_SPECIFICATION.md`, `PROJECT_REPORT.md`, `ANTIGRAVITY_PROMPT.md`: prefixed with a
  superseded notice pointing at the current architecture — historical planning documents are kept
  as history rather than silently rewritten.
- `pyproject.toml`: added `[tool.pytest.ini_options]` (testpaths) and ruff config;
  `package.json` scripts now expose `test:live` and `test:e2e`; versions aligned at `0.9.0` across
  the Python server, `package.json` and the then-present `tauri.conf.json`.
- `.gitignore`: added `.venv/`, `coverage/`, `blob-report/`, `*.egg-info/`.
- **Markers:** zero `TODO`/`FIXME`/`HACK`/`XXX` in `src` or `python/netsim`; zero `console.log`,
  `console.debug` or `debugger` statements. The 9 `console.error` calls that swallowed failures
  were replaced by visible error state (defect 8).
- Test doubles are confined to the vitest alias and cannot reach a production build.

---

## 16. Performance and stability

| Measurement | Value |
|---|---|
| Python suite (154 tests) | ~1.6 s |
| Front-end suite (104 tests) | ~12 s (jsdom environment dominates) |
| Live integration (11 tests) | ~1.4 s |
| Production build | ~6.8 s, succeeds |
| Parameter sweep | 9 runs (3 values × 3 seeds) completes in well under a second of simulation time |
| TCP run | 40 segments simulated with a full cwnd timeline in milliseconds |

Sweep determinism was verified across byte-identical repeated runs; long simulations (40 kB TCP,
20-packet pipelined bursts) complete without stalling or leaking events. The only performance
observation is the Vite bundle-size warning, which is a build advisory, not a demonstrated
problem, and was therefore left alone.

---

## 17. Accessibility and UX review (practical defects only)

| Check | Result |
|---|---|
| Two interactive chevron controls had no accessible name | **FIXED** — `aria-label` + `aria-expanded` added (`TimelineDrawer`, `LayerCard`) |
| Buttons with no handler | only the two above (inside clickable headers) and form-submit buttons; verified by static scan | PASS |
| Inputs outside a `<label>` | ~~126 label/aria-label associations for 106 inputs~~ **SUPERSEDED — see §23.3.** That count was taken statically and overstated coverage: axe-core found **45 controls with no accessible name** (inputs and selects whose caption was a sibling element or an inline icon+text pair) | INCORRECT, CORRECTED IN §23 |
| Form validation feedback |
| Form validation feedback | GBN window/sequence-space validation errors are rendered inline; TCP/UDP/DNS/FTP/HTTP/SMTP now guard a topology with fewer than two devices with a plain-language message instead of sending `host-a` and surfacing "Node 'host-a' not found" | **FIXED** |
| Failure visibility | simulation command failures now render a dismissible `role="alert"` banner instead of a silent console message | **FIXED** |
| Colour contrast / keyboard traps / focus order | ~~not systematically assessed — no automated axe-style tooling available here~~ **SUPERSEDED — see §23.3.** axe-core is now wired into Playwright and the audit ran over 9 workspaces + 23 sub-views. It found failing colour contrast (3.46:1–4.16:1 against a 4.5:1 requirement), 45 controls with no accessible name, and one scrollable region with no keyboard access — all fixed | WAS NOT VERIFIED, NOW VERIFIED IN §23 |

---

## 18. Final verification (exact counts and exit statuses)

| Command | Result | Exit |
|---|---|---|
| `.venv/bin/python -m pytest python/tests -q` | **154 passed in 1.59 s** | 0 |
| `.venv/bin/ruff check python/` | All checks passed | 0 |
| `.venv/bin/ruff format --check python/` | 64 files already formatted | 0 |
| `npx tsc --noEmit` | clean | 0 |
| `npx vitest run` | **93 passed, 11 skipped (104)**, 13 files | 0 |
| `NETSIM_LIVE_API=1 npx vitest run src/integration` | **11 passed (2 files)** against the live service | 0 |
| `npm run build` | built successfully | 0 |
| `git diff --check` | no whitespace errors | 0 |
| `npx playwright test --list` | 22 tests discovered | 0 |
| Same-origin proxy round trip (dev server + service) | `/health`, a command, a 400 and a 404 all correct | 0 |
| `npx playwright test` | **22 passed** in Chromium 153.0.8010.0, three consecutive runs (~36 s) | 0 |
| `cargo test` / `cargo clippy` | **not applicable** — the Rust tree and workspace manifest were removed in §22 | n/a |

The desktop (Tauri) application was **never** verified: the Rust shell was never built or launched,
and this report said so rather than inferring success from the code. That path has since been
removed altogether (§22), so there is no longer a desktop artefact to claim. The browser E2E suite,
unverified in the first pass, **has since been executed and passes** — see §21.

---

## 19. Findings summary, remaining limitations and unverified behaviour

**All Critical and High findings are fixed and retested.** No unresolved critical or high defect
is known.

### Verified PASS (with evidence)
Timing model, loss semantics, routing (both algorithms, three metrics), IPv4/VLSM, Hamming/CRC/
checksum, GBN/SR incl. the window-stall timeline, MAC protocol dispatch, TCP slow start and loss
recovery, UDP, DNS/HTTP/FTP/SMTP/SNMP execution, QoS accounting, determinism and sweep
reproducibility, fault execution for all five fault types, NAT translation, error handling across
120 commands, and the full HTTP lifecycle.

### FIXED AND RETESTED
Defects 1–8 above (plus the `schedule_demo_packet` contract, the placeholder node defaults, the
two unnamed toggle controls and the swallowed-error UX issue).

### NOT VERIFIED (explicitly not claimed)
1. ~~Rust/Tauri desktop shell~~ — **closed in §22** by removing the runtime and its Rust tree.
   *(Playwright, listed here in the first pass, has since been executed: 22/22 pass — §21.2.)*
2. **Chrome DevTools panel UI** — no interactive browser window. Console, network,
   exception and layout inspection *were* performed via CDP in a real Chromium (§21.4-21.6).
3. **Screen-reader / contrast / keyboard-navigation audit** — no tooling available. Manual key
   handling on the canvas and form fields was reviewed in code and works, but no assistive
   technology was exercised.
4. **Bit-exact parity with the historical Rust RNG** — not achievable and not claimed; seeded
   reproducibility *within* the Python engine is verified instead (§22).

Two items from the first pass have since been **closed**: Playwright execution (§21.2) and
layout measurement at the three viewports (§21.5). The proxy round trip was closed earlier (§7).

### KNOWN LIMITATIONS (documented, not defects)
- Low-load sweeps show identical throughput across bandwidths because the traffic never saturates
  the link (use ≥40 packets).
- `dropped_segments` drops the first transmission of each listed index; the retransmission is
  delivered (TCP recovers, UDP records the loss).
- 24 interfaces per node; `add_link` provisions a port automatically but still rejects an
  explicitly named busy port.
- Sliding-window simulations with `window < 2a+1` stall by design.
- MAC efficiency absolute values depend on the default `offered_load_g = 1.5`.

---

## 20. Final diff review and commit

- **58 files changed, +2,900 / −3,517** relative to `28f762d` (the net reduction comes from the
  README rewrite and the removal of the guarded E2E suite).
- Directory-level review: engine changes are confined to validation and the two logic fixes
  (`congestion/cwnd.py`, `faults/model.py`, `server.py`); front-end changes are the event-envelope
  fix, error surfacing, accessibility labels, placeholder cleanup and the new test files; docs and
  manifests are updated as described in §15.
- `git diff --check` → clean; working tree committed as
  **`test: complete NetSim quality audit and regression verification`**.

### Audit conclusion

The simulator's numerical core is trustworthy: independent hand-calculation validation passes
across every protocol family, and the two algorithms that compute the same quantity agree. The
material risks were not in the models but in the seams — a fault command that silently did
nothing, a NAT feature that could never be used from the UI, a congestion-control formula that
doubled the specified additive-increase rate, and a timeline that mislabelled every event. Those
are fixed and now guarded by regression tests that were each demonstrated to fail before the fix.
The remaining unverified surface is the browser and desktop execution path, which this environment
cannot exercise; that gap is stated plainly rather than papered over.

---

## 21. Second verification pass — live UI, real browser (2026-10-12)

This pass existed to close the gaps the first pass listed as NOT VERIFIED. Of the browser-related
ones, **Playwright execution and the three-viewport layout measurement are now closed** (§21.2,
§21.5), and **console/network/error inspection is now closed via CDP** (§21.4), with the DevTools
*panel UI* remaining unavailable (§21.6). The **Rust/Tauri desktop shell** was genuinely
unverifiable in this environment (no Rust toolchain) and was never claimed; it has since been
removed outright (§22).

### 21.1 Browser availability — solved

The blocker in the first pass was `npx playwright install chromium` failing with `ECONNRESET`
against `cdn.playwright.dev`, plus a host with **no** Chromium and **no** X/NSS shared libraries
(`ldconfig` reports zero entries for `libnss3`, `libgbm`, `libatk`, `libcairo`, `libpango`,
`libasound`, `libxkbcommon`, `libatspi`).

That was worked around rather than accepted: the npm registry *is* reachable, and
`@sparticuz/chromium` publishes a Brotli-compressed Chromium **plus the shared libraries it
needs** (`al2023.tar`). Decompressing both and pointing Playwright at the result gave a working
browser:

```
$ ./out/chromium --version
Chromium 153.0.8010.0
$ ldd out/chromium | grep -c "not found"
0
```

`playwright.config.ts` gained a `NETSIM_CHROMIUM_PATH` escape hatch (passing `executablePath` with
`--no-sandbox --disable-dev-shm-usage --disable-gpu`), and the steps are documented in `README.md`
so this is reproducible rather than a one-off trick.

### 21.2 Playwright executed — 22/22 PASS

```
$ npx playwright test
  22 passed (35.5s)
```

Run **three times consecutively with identical results** (35.5 s / 38.4 s / 36.5 s, 22 passed
each). The suite is no longer "defined but unexecuted": it drives a real Chromium against the real
Python service and the real Vite dev server, both started by the config's `webServer` array.

Every test listed in §10 now has execution evidence, including test 21, which asserts
`scrollWidth - clientWidth <= 1` for **all 9 workspaces at 1440×900, 1280×720 and 1024×768**.

### 21.3 Real UI interaction — evidence

A page loading is not evidence that its controls work, so the flows below were driven through the
actual DOM and the engine state was read back independently.

| Action performed in the browser | Engine result read back | Verdict |
|---|---|---|
| Drag from node-1's source handle to node-3's target handle on the xyflow canvas | `get_project` link count 2 → 3, new `link-3`, interface auto-provisioned | PASS |
| Click **Step Event** six times | clock 0 → 0 → 5 → 5 → 805 → 5805 µs; queue drained to 0 pending; packet `delivered` with 5 events | PASS |
| Click **Simulate DNS Query** | inspector switched to `pkt-dns-q-1001`, `DELIVERED`, 64 bytes, route node-1 → node-2, L5 DNS / L4 UDP 53120 → 53 / L3 IPv4 / L2 MAC `02:00:00:00:00:01` / L1 `link-r1-b` | PASS |
| Type `192.168.1.130/26` and press **Calculate** | UI rendered network `.128`, broadcast `.191`, `62 usable (64 total)`, range `.129 - .190` | PASS |
| Press **Allocate VLSM** | UI rendered `/25` @ `.0`, `/26` @ `.128`, 177 needed, 220 capacity, 43 wasted, 85.94% utilisation | PASS |
| Press **Encode into Hamming Codeword** | UI rendered codeword `0110011` and SECDED `00110011` for input `1011` | PASS |
| Enter `1101011011` / `10011`, press **Execute Modulo-2 Division** | UI rendered remainder `1110`, transmitted `11010110111110` | PASS |
| Press **RFC 1071 Example** then **Calculate 16-Bit Internet Checksum** | UI rendered folded sum `0xDDF2`, checksum `0x220D`, binary `0010001000001101` | PASS |
| Click **Run Comparative A/B Test** | UI rendered "Comparative Metric Deltas" from the engine's A/B result | PASS |
| Click **Simulate TCP Stream** | RTT telemetry panel rendered from `simulate_tcp` | PASS |
| Run UDP from the studio | result panel switched from its ready state to populated metrics | PASS |

The independent cross-checks agree with the rendered values: Hamming `0110011`, CRC remainder
`1110`, checksum `0x220D`, subnet `.128/.191/62`, VLSM `/25` + `/26`.

### 21.4 Console, network and error-path inspection

Browser-level inspection **was** performed — via Playwright's CDP-backed event streams rather than
the DevTools panel UI (see 21.6). Across all 9 workspaces and ~25 sub-tabs:

```
CONSOLE ERRORS: 0
PAGE ERRORS (uncaught exceptions): 0
FAILED REQUESTS: 0
HTTP >=400 RESPONSES: 0
```

The one failure in the first run was the Google Fonts CDN (`net::ERR_CONNECTION_CLOSED`), which is
third-party and unreachable here; the E2E harness now stubs `fonts.googleapis.com` and
`fonts.gstatic.com` so the assertion stays strict for every first-party request. The app has a
system-font fallback, so rendering is unaffected.

Error paths exercised through the UI, all handled with a visible message and **zero uncaught
exceptions**:

| Input | Result |
|---|---|
| `999.999.999.999/33` into the subnet field | visible validation error; app stays ONLINE |
| `10x1` into the Hamming data-bits field | visible validation error; no crash |
| **Step Event** / **Run All** on an empty simulation | no crash, clock stays 0, no phantom events |
| Payload size `0` then **Simulate TCP** | error surfaced to the user, no crash |
| `POST /api/definitely_not_a_command` | `404 {"status":"error","code":"unknown_command", ...}` |
| Direct API endpoint blocked at the network layer | UI connects through the `/netsim-api` proxy instead (test 2b) |
| **Both** API paths blocked | badge reads "Backend Offline", sidebar reads OFFLINE, no fake data |

### 21.5 Visual layout audit — two real defects found and fixed

Nine workspaces were rendered and measured at 1440×900, 1280×720 and 1024×768, with screenshots
captured for each combination.

Measured overflow (`scrollWidth - clientWidth`) was **0 for every workspace at every viewport**.
Two element-level clipping defects were found by inspecting the screenshots and the bounding boxes:

| Defect | Detail | Fix |
|---|---|---|
| Inspector tab clipped at 1024 px | The "Journey" tab's right edge landed at x=1027 in a 1024 px viewport — outside the window | Header and tab group now `flex-wrap`, so the tabs drop to their own line at the narrowest supported width |
| DNS preset clipped at 1024 px | The "NXDOMAIN" preset was cut to "NX…" by its non-wrapping header row | Header row wraps and the preset row is `flex-wrap` |

Both were re-rendered after the fix: `clippedEls=0` at 1024×768, and the screenshot shows all five
presets and all three tabs fully visible. Typography, spacing, chart sizing, legends, empty states
and status indicators were reviewed in the same pass and found consistent; the remaining nested
scroll containers (inspector body, event list) are intentional — their content is long and the
outer page itself never scrolls.

### 21.6 Remaining limitation: the DevTools *panel* itself

A real Chromium ran and its console, network, exception and layout surfaces **were** inspected
through Playwright's CDP session — so the DevTools *capabilities* are covered, and §11's
NOT VERIFIED entry for console/network inspection is superseded. What remains unavailable is the
**interactive DevTools front-end** (elements panel, performance profiler, live editing): there is no
interactive browser window in this headless environment, and that is reported as NOT VERIFIED
rather than implied. No assertion in this report depends on DevTools-panel observation.

### 21.7 New defects found in this pass

| # | Severity | Defect | Status |
|---|---|---|---|
| 9 | **Medium** | The header **VIRTUAL CLOCK stayed frozen at `0 µs`** while the engine advanced. The protocol studios call the API directly and `App` only refreshed on mount and on its own actions, so nothing updated the navbar — a user stepping to 5.80 ms still saw "0 µs" | FIXED AND RETESTED |
| 10 | **Medium** | "Journey" tab clipped outside the viewport at exactly 1024 px | FIXED AND RETESTED |
| 11 | **Low** | "NXDOMAIN" preset clipped by its header row at 1024 px | FIXED AND RETESTED |
| 12 | **Low** | Empty states were inconsistent: `PacketInspector` and the four transport sub-studios omitted their `data-testid` when no packet/result existed, so "no result yet" was indistinguishable from "component missing" | FIXED AND RETESTED |

Defect 9 is the significant one: it is the same class as the audit's original timeline defect — a
panel showing stale state that the user has no reason to distrust. It is fixed with a 1 s
`setInterval` that refreshes the simulation snapshot silently (no toast spam when the service
drops) plus a refresh on `visibilitychange`, and the fix is **verified in a real browser**: after
stepping, the header renders `5.80 ms` matching `current_time_us = 5805`. Coverage is now
permanent in E2E test 5, which asserts the rendered header value equals the engine's clock.

Defect 12 is a testability/consistency fix, not a user-visible bug: the same `data-testid` is now
present in both states, distinguished by `data-state="empty" | "populated"`.

### 21.8 Test-quality corrections

Six E2E assertions were wrong about how the product actually behaves — they were corrected against
observed reality, never by weakening:

- Tests 1 and 2b rendered topology content without first establishing a known project, so they
  failed when another run had left a renamed node behind. Both now call `resetProject` first; the
  suite is order-independent and passes from any prior service state.
- Test 4 assumed link ids are drawn as canvas labels (they are bandwidth labels) and dropped on the
  node body rather than a target handle — rewritten as a genuine handle-to-handle drag.
- Tests 7, 10 and 11 asserted UI text that the UI never computed for those inputs; rewritten to
  drive the real controls and assert their real output.
- Test 5 assumed the first **Step Event** advances the clock; the first events legitimately occur at
  t=0. Rewritten to drain the queue and assert monotonic, non-regressing progress.
- Test 14 asserted a populated UDP container before any run; it now asserts the ready state, runs
  the simulation, then asserts the populated state.

No assertion was skipped, deleted or relaxed to obtain a green run.

### 21.9 Headline fixes re-verified against the live service

Every fix from the first pass was re-checked against the running service, not assumed from Git:

```
fault injection        link_down -> dropped_link_down, 1 drop, fault_injected event; malformed payload rejected
static DNAT (TCP)      ok, 1 rule                                          [was 400 before the fix]
congestion avoidance   max CA step 0.063 MSS; one RTT of ACKs = 0.972 MSS  [was +2 MSS/RTT]
add_link               provisions node-1-eth1; self-loop rejected
malformed configs      simulate_tcp/simulate_http/sweep -> invalid_request 400
create_project         static rules 0, dynamic entries 0                   [was leaking]
event types            packet_created/queue_entered/transmission_started/... none named "type"
persistence            node label + position, link bandwidth + delay, interface IP + status all survive save/load
```

### 21.10 A process note worth recording

Re-verifying the NAT fix initially showed the *old* broken behaviour against the live service even
though the source was correct. The cause was a stale server process: `server.py` was edited at
14:20:57 while the listening process had started at 14:19:00, so it never loaded the change. The
visible symptom was a fix that "regressed" despite being correct in Git and passing in pytest. Any
verification against a long-running service must restart it after a source change — this report's
live checks were all re-run after a restart.

### 21.11 Final commit

```
$ git status --short          # (empty)
$ git diff --check            # (no whitespace errors)
$ git commit -m "test: finish NetSim live UI verification"
```

Committed as **`test: finish NetSim live UI verification`** on `arena/5d41fe31-cn-project`
(pushed; carried by PR #1). The branch tip is this commit — read its hash with
`git log -1 --format=%H` rather than from this file, since a hash written here would change the
hash it describes.

Nine files changed, 561 insertions(+), 111 deletions(-):

```
QUALITY_AUDIT_REPORT.md                             | 214 +++++++++++++-
README.md                                           |  38 ++-
e2e/netsim.spec.ts                                  | 320 ++++++++++++++++-----
playwright.config.ts                                |  13 +-
src/App.tsx                                         |  51 +++-
src/components/application/ApplicationWorkspace.tsx |   4 +-
src/components/application/DnsStudio.tsx            |   4 +-
src/components/inspector/PacketInspector.tsx        |  12 +-
src/components/transport/TransportWorkspace.tsx     |  16 +-
```

Every check in §21 was re-run **on the committed tree**, and the tree was clean afterwards:

| Command | Result |
|---|---|
| `.venv/bin/python -m pytest python/tests -q` | **154 passed in 1.61 s** |
| `.venv/bin/ruff check python/` | All checks passed |
| `.venv/bin/ruff format --check python/` | 64 files already formatted |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **93 passed**, 11 skipped (104) |
| `NETSIM_LIVE_API=1 npx vitest run src/integration` | **11 passed** |
| `npm run build` | built successfully |
| `npx playwright test` | **22 passed (36.1 s)** |

No features were added and no redesign was performed in either pass.

---

## 22. Final cleanup and release preparation (2026-10-12)

A release pass over the same repository: remove the obsolete runtime, verify the audit's own
claims, correct the documentation, and re-run everything. No features were added.

### 22.1 A wrong conclusion in this report, corrected

§3 of this report recorded **"Tauri Rust is a shell only — no simulation model, no routing, no
protocol code"** as PASS-by-inspection. **That was false**, and it was the single most consequential
error in the audit.

The Rust tree did not hold a shell. It held a **complete second simulation engine**:

```
63 .rs files · 20,883 lines total
  45 of those files (12,353 lines) are engine code:
  simulation/   engine.rs 986 · queue.rs · rng.rs · clock.rs · delays.rs · event.rs · metrics.rs
  routing/      dijkstra.rs · bellman_ford.rs · graph.rs · table.rs
  addressing/   ipv4.rs · ipv6.rs · vlsm.rs · nat.rs
  datalink/     mac.rs 1169 · flow_control.rs 1007 · hamming.rs · crc.rs · checksum.rs
  transport/    tcp.rs 934 · udp.rs
  congestion/   cwnd.rs
  application/  dns.rs · http.rs · ftp.rs · smtp.rs · snmp.rs
  qos/ faults/ experiments/ domain/ commands/
plus 6,468 lines of Rust tests (src/tests.rs)
```

Removal also covered `Cargo.toml` (4 lines), `.cargo/config.toml` and `src-tauri/.cargo/config.toml`
(8 lines), `tauri.conf.json`, `build.rs`, `capabilities/default.json` and the icon set.

The original conclusion was drawn from the presence of `commands/` IPC shims and never checked
against the module tree — an inspection that stopped at the first directory it recognised. It
mattered because the engine was **reachable at runtime**: `src/lib/tauri.ts` fell back to
`invoke(...)` whenever the Python service was unreachable inside a Tauri window, so a user could
have been served by a different engine without any indication. This is exactly the "duplicate source
of simulation truth" the architecture does not permit.

### 22.2 What was removed

| Removed | Size | Why |
|---|---|---|
| `src-tauri/` | 75 files — 63 `.rs` source files (20,883 lines), 5 binary icons, plus manifests | A second, complete simulation engine |
| `Cargo.toml` (workspace) | 4 lines | Manifest for the removed tree |
| `.cargo/config.toml`, `src-tauri/.cargo/` | 8 lines | Toolchain config for the removed tree |
| `@tauri-apps/api`, `@tauri-apps/cli` | — | Runtime and CLI for the removed shell |
| `npm run tauri` script | — | Driver for the removed shell |
| Front-end IPC fallback | `isTauri()` + 2 `invoke` branches in `src/lib/tauri.ts` | Could silently switch engines away from Python |
| `TAURI_ENV_*` build variables | 6 lines in `vite.config.ts` | Drove the Vite build target for the removed shell |
| `tauri.localhost` loopback entry | 1 line | Hostname of the removed shell |
| Rust/Tauri `.gitignore` rules | 9 lines | Ignored paths under the removed tree |

`src/lib/tauri.ts` — the API client, now containing nothing Tauri-specific — was renamed to
`src/lib/api.ts`; 25 importing files were updated. `SimulationAuthority` is now
`'python' | 'test-double'`, with `'desktop-ipc'` gone.

**Verified after removal:** the production bundle contains **zero** occurrences of `tauri`,
`__TAURI`, `desktop-ipc` or the real test double. The only `mockInvoke` reference resolves to a
144-byte stub that rejects every command:

```js
function i(e){return Promise.reject(new Error(`No simulation service is available for command '${e}' in this build.`))}
```

### 22.3 Defects found in this pass

| # | Severity | Defect | Status |
|---|---|---|---|
| 13 | **High** | `src/lib/tauri.ts` silently switched to the Rust engine on `BackendUnavailableError` inside a Tauri window, so the same UI could be served by two different engines | FIXED AND RETESTED |
| 14 | **High** | Vite watched the Python virtualenv: installing a package or running the test suite reloaded the browser mid-edit (observed live — `page reload .venv/.../matplotlib/...`) | FIXED AND RETESTED |
| 15 | **Medium** | `python-tools/` read `data['runs']`, a schema the engine has never emitted; against a real sweep export it printed "Total Sweep Runs: 0". Its docstring also claimed "Python is optional and not required for the core NetSim desktop application" | FIXED AND RETESTED |
| 16 | **Low** | `pyproject.toml` set Ruff's `target-version = "py312"` while `requires-python = ">=3.11"` | FIXED AND RETESTED |
| 17 | **Low** | `.gitignore` listed `.venv/` twice and carried rules for paths that no longer exist | FIXED AND RETESTED |

Defect 13 is the important one — same class as the original engine-parity issue, and the direct
consequence of §22.1.

**Defect 15 re-verified against a real export.** The engine emits `points[]` with
`aggregated_qos`, not `runs[]`. After rewriting both scripts to the real schema, a three-point
sweep produced a correct table and chart:

```
     parameter  runs    throughput      goodput   mean lat    jitter    loss   retx
        500000     2     0.32 Mbps    0.32 Mbps 63084.17 us 6290.36 us  0.0000   0.00
       1000000     2     0.32 Mbps    0.32 Mbps 18806.00 us   0.00 us  0.0000   0.00
       2000000     2     0.32 Mbps    0.32 Mbps 14806.00 us   0.00 us  0.0000   0.00
```

Latency falls as bandwidth rises, and throughput stays flat because the offered load never
saturates the link — the behaviour the README documents. `plot_metrics.py` wrote a real 62,790-byte
PNG from the same input. Both scripts now exit non-zero with a clear message on unrecognised input
instead of silently reporting zero results.

Defect 14 was fixed by scoping `server.watch.ignored` to exclude `.venv`, `__pycache__` and the
test caches. **Verified:** writing into `.venv` and running `py_compile` no longer produce any
reload in the dev-server log.

### 22.4 Documentation corrected

| Document | Change |
|---|---|
| `README.md` | Rewritten: prerequisites, venv setup, ports table, per-suite test commands; the `src-tauri/` architecture box and the `cargo test` row removed; test counts corrected from 137/67/7-skipped to the measured 154/64/11 |
| `ARCHITECTURE.md` | Rewritten. It previously said "NetSim uses a Rust-first desktop architecture" and "Rust is the authoritative source of simulation truth" in the same file whose banner said Python was authoritative, and documented SQLite and CI pipelines that were never built |
| `TESTING.md` | Rewritten for the Python stack. It previously described Rust unit tests and `cargo fmt`/`clippy`/`test` as the primary workflow |
| `USER_GUIDE.md` | Rewritten. It previously told the reader to "Open the NetSim desktop application" and documented a dashboard, Demo Scenarios, Learning Mode, Exam Mode and Reports — none of which exist |
| `ALGORITHMS.md` | Authority corrected; the formulas themselves are unchanged and are the reference the Python implementation is tested against |
| `PRD.md`, `SRS.md`, `MASTER_SPECIFICATION.md`, `ANTIGRAVITY_PROMPT.md`, `PROJECT_REPORT.md`, `walkthrough.md` | Banners updated. They previously described `src-tauri/` as "a native shell that contains no simulation logic" — repeating the false claim from §22.1 — and pointed at a directory that no longer exists |

**Two further documentation corrections found by checking claims against code:**

- **The PRNG is not an LCG.** Both `README.md` and §6 of this report described it as one. It is
  CPython's `random.Random` (Mersenne Twister), wrapped by `python/netsim/core/rng.py`; no LCG exists
  anywhere in the codebase. The useful property is seeded reproducibility, which was verified
  directly — a single instance seeded with 1234 yields `0.966454, 0.440733, 0.007491, 0.910976,
  0.939269` on both runs, and seed 9999 diverges.
- **`pyproject.toml` declares no runtime dependencies, and that is correct.** Verified by importing
  the engine, MAC, TCP and DNS modules with `python -S` (site-packages disabled): the core is
  genuinely standard-library only.

Every remaining Rust/Tauri mention in the documentation is now a historical statement ("the Rust
engine has been removed") rather than a claim about the current system.

### 22.5 Verification on the cleaned tree

| Check | Command | Result |
|---|---|---|
| Python tests | `.venv/bin/python -m pytest python/tests -q` | **154 passed in 1.64 s** |
| Python lint | `.venv/bin/ruff check python/ python-tools/` | All checks passed |
| Python format | `.venv/bin/ruff format --check python/ python-tools/` | 66 files already formatted |
| TypeScript | `npx tsc --noEmit` | clean |
| Front-end tests | `npx vitest run` | **93 passed**, 11 skipped (104) |
| Live integration | `NETSIM_LIVE_API=1 npx vitest run src/integration` | **11 passed** against the real service |
| Production build | `npm run build` | built in 6.79 s |
| Browser E2E | `npx playwright test` | **22 passed (37.4 s)** |

The Python and front-end counts are unchanged from §21 — the same 154 and 93 tests still pass after
removing the Rust tree, confirming the removal did not alter the Python engine's behaviour. The
browser suite was re-run against a **restarted** dev server so it exercised the renamed module
rather than a stale module graph.

Dependency audit: every declared runtime and dev dependency was checked against actual usage
(`@xyflow/react`, `clsx`, `lucide-react`, `react`, `react-dom`, `recharts`, `tailwind-merge`; and
`postcss`/`tailwindcss`/`autoprefixer` via `postcss.config.js`, `@testing-library/dom` as a
declared peer of `@testing-library/react`, `jsdom` as the vitest environment). None is unused.

### 22.6 Remaining limitations

- **The desktop/Tauri path no longer exists**, so any expectation of a packaged desktop binary is
  unmet by design. The supported deployment is the browser UI plus the Python service.
- ~~**Python static type checking is not configured.**~~ **CLOSED IN §23.2** — `[tool.mypy]` is now
  in `pyproject.toml`; the engine and tools type-check clean (0 errors in 63 files, 35 fixed).
- ~~**`python-tools/` is not covered by tests.**~~ **CLOSED IN §23.1** — 80 tests in
  `python-tools/tests/`, 99% statement coverage of both scripts.
- ~~**Accessibility tooling** (axe-style, screen readers) is still not configured.~~ **PARTLY CLOSED
  IN §23.3** — axe-core runs inside the browser suite over every workspace and sub-view. Manual
  screen-reader testing remains impossible in this environment.

---

## 23. Third pass — utilities, static typing and accessibility (2026-10-12)

Closes the three gaps §22.6 left open: `python-tools/` had no tests, Python had no static type
checking, and accessibility had never been measured. Same rules as the rest of this report —
reproduce first, change, re-run, and state what still could not be checked.

### 23.1 `python-tools/` — hardened and covered

**Test suite:** `python-tools/tests/` (new, 5 files, **80 tests**). The scripts live in a
hyphenated directory, so `conftest.py` loads them by path with `importlib.util.spec_from_file_location`
and puts `python/` on `sys.path` so the fixtures can drive the real engine.

```bash
.venv/bin/pytest python-tools/tests -q
# 80 passed in 4.94 s
```

**Coverage** (`.venv/bin/pytest python-tools/tests --cov=python-tools`):

| File | Statements | Missed | Coverage |
|---|---|---|---|
| `analyze_results.py` | 121 | 1 | **99%** |
| `plot_metrics.py` | 121 | 1 | **99%** |
| `conftest.py` | 48 | 1 | 98% |
| `test_analyze_results.py` | 171 | 0 | 100% |
| `test_cli.py` | 70 | 0 | 100% |
| `test_engine_schema.py` | 63 | 0 | 100% |
| `test_plot_metrics.py` | 142 | 0 | 100% |
| **TOTAL** | **736** | **3** | **99%** |

The two remaining uncovered lines are the `if __name__ == "__main__":` guards of each script; they
are exercised by the subprocess tests in `test_cli.py`, which coverage cannot attribute back to the
imported module.

**Defects found by probing with malformed input** (not by reading):

| Input | Before | After |
|---|---|---|
| `"points": "notalist"` | printed "8 points", then `AttributeError` | exit 1, `'points' must be a JSON array (received str)` |
| `"aggregated_qos": "nope"` | `AttributeError` | exit 1, names `points[0].aggregated_qos` |
| malformed JSON | traceback | exit 1, `not valid JSON (...)` |
| missing required keys | bare message | exit 1, lists each missing key |
| top-level array | `AttributeError` | exit 1, `Expected a JSON object at the top level.` |
| plot: non-numeric `parameter_value` | `ValueError` traceback | exit 1, names `points[0].parameter_value` |
| plot: unwritable output path | `FileNotFoundError` traceback | exit 1, `Cannot write the plot to ...` |
| metric that is not a number | silently coerced | prints `n/a` |

The contract is documented in both docstrings: **structural** problems are a clear message plus a
non-zero exit code (1 = data/file, 2 = usage); **value** problems make the analyser print `n/a`,
while the plotter stays strict (absent or null → `0.0`, present but unparseable → error).

**Schema drift guard.** `test_engine_schema.py` runs a real parameter sweep through the engine and
feeds the output straight into both tools, so a change to the engine's serialisation fails here
rather than silently breaking the utilities. Verified values for
`{kind: link_bandwidth_bps, link_id: link-1, values: [500000, 1000000], seeds: [7]}` →
`mean_latency_us` **46500.625 / 13005.0**. The plotter wrote a real 1200×1050 PNG whose chunks
(`IHDR, tEXt, pHYs, IDAT, IDAT, IEND`) tile the file exactly.

**Dependencies.** `requirements.txt` listed `pandas` and `numpy`, neither of which is imported
anywhere in the repository. Both were removed; only `matplotlib` remains, imported lazily inside
`plot_metrics.py`. Proven directly: both scripts run under `python -S` (site-packages disabled) —
the analyser completes normally, and the plotter prints
`Matplotlib not installed. Please run: pip install -r requirements.txt` and exits 1 instead of
raising.

### 23.2 Static typing — mypy configured, 35 errors fixed

```bash
.venv/bin/mypy
# Success: no issues found in 63 source files
```

`[tool.mypy]` was added to `pyproject.toml` with `check_untyped_defs`, `disallow_any_generics`,
`disallow_untyped_defs`, `no_implicit_optional`, `strict_equality`, `warn_redundant_casts` and
`warn_unused_ignores`. Every function in `python/netsim/` is fully annotated, which is why
`disallow_untyped_defs` could be enabled for the engine; the pytest modules are exempted by an
explicit per-module override (their fixture parameters are conventionally unannotated).

The first run reported **35 errors across 6 files**. All were fixed rather than suppressed, and the
**8 existing `# type: ignore` comments in the repository were removed — none were added**:

| Cluster | Fix |
|---|---|
| `server.py`, 22 errors | NAT handlers now validate with the existing `core/schema.py` helpers; the dispatch chain reused one `cfg` name for four unrelated config classes, which is what confused the inference — each branch now has its own typed local and the MAC branches use `MacProtocol.*` instead of four string literals |
| `datalink/flow_control.py`, 8 errors | the in-flight scan reused the loop variable `f`, so mypy typed it `_InFlightFrame` for the rest of the function and rejected the later `SlidingFrame` loops; renamed |
| `addressing/ipv6.py`, 2 errors | the guard now narrows `best_start` (`is not None`) instead of asserting it |
| `addressing/ipv4.py` | `mask_to_prefix` returns `int \| None`; the narrowed value is bound to its own name |
| `core/engine.py`, 2 errors | distinct locals for the transmission queue and the fault snapshot; the `pop(..., None)` result is annotated |
| `routing/{dijkstra,graph}.py` | the distance maps hold `float("inf")`, so they are `dict[str, float]`; the Dijkstra heap follows |
| `routing/bellman_ford.py` | the optional next-hop is bound to a local so it narrows on `is None` |
| `application/__init__.py` | see defect 19 below |

**Two real defects surfaced from the type errors** — the reason the errors were fixed rather than
suppressed:

| # | Severity | Defect | Status |
|---|---|---|---|
| 18 | **Critical** | `verify_and_correct_hamming` was **100% broken**: the server called `hamming_decode()`, which returns a `HammingDecodeResult` that has no `to_dict()`, so every call raised `AttributeError` and the API answered HTTP 500. The UI's `HammingVerifyResult` contract needs the 12 fields that `verify_and_correct_hamming()` produces | FIXED AND RETESTED |
| 19 | **High** | Application-layer events violated the declared event contract: `SimEvent.event_type` is the envelope `{"type": ..., "data": ...}` (and `src/types/events.ts` declares `SimEventEnvelope`), but `app_event_to_sim_event` passed a bare `SimEventType`, so every DNS/HTTP/FTP/SMTP/SNMP event serialised `event_type` as a plain string while engine events carried an object | FIXED AND RETESTED |

Defect 18 was reproduced in-process before the fix and verified after it:

```
{"codeword":"0110011","parity_mode":"even"} → has_error False, syndrome "000",
                                             "Codeword is valid. No bit errors detected."
{"codeword":"0100011"}                      → error_position 3, corrected_bits "0110011"
                                             (the original codeword), all 12 declared fields present
```

Defect 19 is confirmed by the front-end's own test double, which builds
`{type: 'application_event', data: {protocol, event_name}}` — the real engine was the deviant side.
The engine now emits the same envelope and key names.

### 23.3 Accessibility — axe-core in the browser suite

`@axe-core/playwright` (axe-core 4.13.0) drives a new suite, `e2e/a11y.spec.ts`, over the real UI
and the real service, tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. It audits **all nine
workspaces plus 23 sub-views** and fails on a violation of **any** impact level, collecting every
view's findings before asserting so one broken workspace cannot hide the rest.

```bash
npx playwright test e2e/a11y.spec.ts
# 2 passed
```

**Before:** 8 of 9 workspaces failed, and the sub-view sweep added 5 more findings.

| Finding | Measured | Fix |
|---|---|---|
| White label on `bg-brand-500` (`Run 50ms`) | 3.46:1 | `bg-brand-600` → 5.07:1 |
| White label on `bg-emerald-600` (`Inject Packet`, `Calculate`, …) | 3.77:1 | `bg-emerald-700` → 5.48:1 |
| White label on `bg-cyan-600` | 3.68:1 | `bg-cyan-700` → 5.36:1 |
| White label on `bg-teal-600` / `bg-amber-600` / `bg-rose-500` / `bg-emerald-500` | 3.74 / 3.19 / 3.67 / **2.54**:1 | one to two shades deeper, same hue |
| `text-slate-500` captions on the dark panels (seed badge, `(node-1)`, `/24`, `L4 Endpoints`, descriptions, empty states) | 3.75–4.16:1 | `text-slate-400` → 6.96–7.73:1 |
| Controls with **no accessible name** — captions were sibling `<span>`s, unassociated `<label>`s, or inline icon+text pairs | axe flagged **45** across the two scans (35 in the nine workspaces, 10 more in sub-views) | 108 controls associated mechanically, 12 by hand; two icon-only buttons and one dynamic caption were given explicit names |
| Icon-only button (`Trash2` in the VLSM allocator) | `button-name` critical, 4 nodes | `aria-label="Remove requirement N"` |
| Scrollable event log with no keyboard access | `scrollable-region-focusable` serious | `tabIndex={0}` + `role="log"` + `aria-label` |
| Disabled controls faded with `opacity`, which blends text **and** background towards the page | 2.9:1 (Routing button), 3.5:1 (QoS input) | coloured buttons now use neutral disabled colours (`disabled:bg-slate-700 disabled:text-slate-300`); the input fades at 60% instead of 40% |

Every replacement was checked against the WCAG contrast formula before being applied, and hover
shades were stepped in the same direction as their base (`hover:bg-<family>-500` → `-700`) so the
hover state does not regress either — axe itself only audits the rendered state, so those were
verified arithmetically. All 23 retargeted button classes and 4 hover shades now measure ≥ 4.5:1 in
both states.

The hover-state work is worth noting because it is **not** something axe could have caught: it was
found by computing the ratio for every white-on-colour token in `src/`, which surfaced
`bg-emerald-500` (2.54:1) and `bg-rose-500` (3.67:1) in default states too.

### 23.4 Verification on the round-5 tree

| Check | Command | Result |
|---|---|---|
| Engine tests | `.venv/bin/pytest python/tests -q` | **154 passed in 1.64 s** |
| Utility tests | `.venv/bin/pytest python-tools/tests -q` | **80 passed in 4.94 s** |
| Coverage (utilities) | `pytest python-tools/tests --cov=python-tools` | 99% (736 statements, 3 missed) |
| Python lint | `.venv/bin/ruff check .` | All checks passed |
| Python format | `.venv/bin/ruff format --check python/ python-tools/` | 71 files already formatted |
| Python types | `.venv/bin/mypy` | **Success: no issues found in 63 source files** |
| TypeScript | `npx tsc --noEmit` | clean |
| Front-end tests | `npx vitest run` | **93 passed**, 11 skipped (104) |
| Live integration | `npm run test:live` | **11 passed** against the real service |
| Production build | `npm run build` | built in 6.54 s |
| Browser E2E | `npx playwright test` | **24 passed (54.3 s)** — 22 functional + 2 accessibility |

**One intermediate E2E run failed, and it is worth recording why.** An earlier full-suite run
reported `1 failed, 4 passed, 19 did not run`: test 2b (failover to the same-origin proxy) left the
status badge on `UNKNOWN` for its whole 15 s window, which is the *pre-probe* value — the app never
reached its first health check. The failover itself was then instrumented in the browser, and it
works: the blocked request (`http://127.0.0.1:8765/health` → `net::ERR_FAILED`) is followed by
`GET http://127.0.0.1:1420/netsim-api/health`, and the badge reads `ONLINE` at every checkpoint from
+1 s to +12 s. The cause was the dev server, not the app: it had been running across the whole
session, so its module graph had absorbed dozens of HMR updates *and* a dependency install
(`@axe-core/playwright`) performed after it started. Restarting the dev server and re-running the
full suite gives `24 passed` with no other change. This matches the note in `TESTING.md` that a
reused dev server must be restarted before the browser suite.

The rest of the suite is unchanged by the engine edits: the 154 engine tests, the 93 front-end
tests and the 11 live tests all still pass, and the sweep values the utility tests assert
(46500.625 / 13005.0 µs) are identical to the values measured before the typing pass — so the
annotation fixes and the two defect fixes did not alter simulation behaviour.

### 23.5 What is still not verified

- **Manual assistive-technology testing** (screen reader, keyboard-only walkthrough) was not
  performed; no screen reader exists in this environment. axe-core's automated rules are necessary
  but not sufficient for WCAG conformance, and this report does not claim conformance.
- **axe audits the rendered state only.** Hover, focus and active styling were not audited by a
  tool; they were verified arithmetically (see §23.3). Dialogs and modals were not opened by the
  audit, so controls that only exist inside them are covered only by the static naming pass.
- **The desktop/Tauri path still does not exist** by design (§22.1).
