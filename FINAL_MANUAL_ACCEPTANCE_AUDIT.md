# NetSim — Final Manual Acceptance Audit

**Project:** NetSim — Interactive Computer Network Simulation and Performance Analysis Platform
**Repository:** https://github.com/lostpilot404/CN-Project
**Branch:** `arena/541edc3e-cn-project`
**Audit date:** 2026-10-16 (Asia/Calcutta)
**Auditor role:** senior engineer / QA lead / usability reviewer / project examiner

## Starting state (recorded before any change)

| Item | Value |
|---|---|
| Branch | `arena/541edc3e-cn-project` |
| HEAD at audit start | `ee8d304389b590e0e9391b3cf1b0727f7b4eff98` — **matches the handoff commit exactly** |
| Working tree at start | **clean** (no uncommitted changes) |
| `origin/main` | `d213648f3679b9c94b1326cc065d84640f1d5b9d`, untouched |
| Latest GitHub Actions at start | run `38927210571` on `ee8d304` = success (Python ✓ / Front-end ✓ / Browser e2e ✓) |
| Runtime used for this audit | Python service on `127.0.0.1:8765`, Vite dev server on `:1420`, real Chromium 153 headless (sandbox substitution for the blocked Playwright CDN — see FINAL_ENGINEERING_REPORT §5) |

All findings below were produced by driving the **running application in a real browser**
(clicks, typing, keyboard, DOM inspection, screenshots) and cross-checking results against the
authoritative Python service over its HTTP API. Where a check could not be completed it is
marked **NOT VERIFIED** — never a pass.

**Evidence:** screenshots are in [`audit-evidence/`](./audit-evidence/) (63 files, captured during
this audit; paths below are repository-relative).

---

## 1. Workspace & subview inventory (manual verdicts)

Verdict key: **PASS** = workflow exercised through the UI with plausible, model-consistent
results; **FAIL** = defect (recorded in §4); **PARTIAL** = works with a recorded minor issue;
**NOT VERIFIED** = could not be completed.

### 1.1 Topology Canvas (editor, inspector, connect dialog, keyboard, persistence)

| Field | Record |
|---|---|
| Area | Topology Canvas — complete editing scenario |
| Starting state | Fresh default project (3 nodes, 2 links) |
| Manual actions | Added 2 devices from palette (Workstation PC, Web Server); renamed via inspector + **Apply Changes**; set node state down; dragged node bodies; connected via handle drag; keyboard connect (C / Connect button, self-connection attempt, valid pair, Escape cancel, focus restoration); dragged handle onto same node; Undo/Redo; snap toggle; zoom controls; minimap; edge delete via inspector; node delete via Delete key; Export JSON → New → Import round trip; Import cancel; malformed import |
| Expected behavior | Every mutation reflected in `get_project` (authoritative); invalid operations rejected with visible feedback; export contains real state; import restores it |
| Observed behavior | All mutations persisted (5 nodes after adds; rename → "Renamed Srv" + state down after Apply); drag connections and keyboard connections created links (2→3→4); self-connection via dialog blocked inline ("Choose two different nodes — a node cannot connect to itself"), via drag rejected with toast "Cannot connect node 'node-2' to itself" and no link created; Undo/Redo 2→3→2→3 and 4→3→4; export `audit-topo.netsim` parsed with `schemaVersion: 1`, nodes restored by id after import; cancel left project unchanged; malformed JSON rejected with error toast, project intact |
| Evidence | `audit-evidence/T01-initial.png` … `T12-selfdrag.png`, `T10-apply-changes.png`, `PROBE3-dialog.png` (defect capture, §4.1), `U2-320-dialog.png` |
| Verdict | **PASS** (after fixes §4.1, §4.3) |
| Defects | P1 dialog-state reset (§4.1, fixed); P2 canvas unusable at 320 px (§4.3, fixed); P3 attribution overlap at 320 px (§4.6, open) |
| Resolution | Fixed and manually retested; see §4 |

Keyboard specifics (as claimed by the UI): **C** opens the connect dialog ✓; dialog is modal with
focus trap ✓ (2× Tab stays inside); Escape/Cancel closes and restores focus to the trigger ✓;
Enter on a focused canvas node selects it (role=button nodes) ✓; Delete removes selection ✓;
arrow keys nudge (existing feature, retained); "?" help overlay lists all of these ✓.

### 1.2 Routing Studio

| Field | Record |
|---|---|
| Area | Routing Studio — tables, both algorithms, live policy panel, rules |
| Starting state | Default project (router node-2) |
| Manual actions | Read Dijkstra table; switched to Bellman-Ford (DV) convergence view; compared table with `calculate_routing_table` engine output; set live forwarding algorithm + metric in the policy panel; hostile policy input `ospf` via API; PC node table request; added router and re-entered |
| Expected behavior | Table equals engine entries; convergence view renders; policy panel writes through to `get_simulation_state.forwarding_policy`; invalid algorithm rejected by name; non-router rejected with "not an L3 routing device" |
| Observed behavior | Table showed node-1/node-2/node-3 with metrics 1/0/1 and interfaces — identical to engine `entries` (3/3 match); Bellman-Ford renders convergence rounds; policy panel set `bellman_ford` + `propagation_delay` on the engine (verified in `get_simulation_state`); `ospf` → "Unsupported forwarding algorithm 'ospf'. Expected 'dijkstra' or 'bellman_ford'"; PC request → "…is not an L3 routing device…"; new router appeared after re-enter |
| Evidence | `audit-evidence/R01-initial.png`, `R02-bellman-ford.png`, `R03-after-scenarioB.png`, `F2-routing.png` |
| Verdict | **PASS** |
| Defect | none |

### 1.3 Addressing & NAT (5 subviews)

| Subview | Actions | Observed | Verdict |
|---|---|---|---|
| IPv4 & CIDR Subnetting | `192.168.10.0/26` → Calculate; `999.1.1.1/33` → Calculate; prefix slider | network 192.168.10.0, broadcast 192.168.10.63, 62 usable (hand-checkable ✓); invalid → "Invalid IPv4 address: '999.1.1.1'" + app usable; slider label tracks value (24→23 via keyboard; see §4.5) | **PASS** |
| True VLSM Allocator | default requirements → Allocate | allocations with prefixes + utilisation/wasted rendered | **PASS** |
| Topology IP Auditor | opened on default project | uniqueness statement rendered ("unique IPv4 addresses…") | **PASS** |
| IPv6 Inspector | `2001:0db8:0000:…:0001` → Inspect; `gggg::1` → Inspect | canonical `2001:db8::1` + RFC 3849 scope ✓; invalid → error "Only hex digits permitted in 'gggg' in 'gggg::1'" + **stale results cleared after fix** (§4.2) | **PASS** (after fix) |
| NAT / NAPT Translation | outbound translate ×2 | two mappings with successive pool ports (4915x) — stateful ✓ | **PASS** |

Evidence: `audit-evidence/A01-ipv4-initial.png`, `A02-ipv4-result.png`, `A04-vlsm-result.png`,
`A05-auditor.png`, `A07-nat-initial.png`, `A08-nat-result.png`, `A09-v6-error.png` (defect),
`A10-v6-error-fixed.png` (after fix), `F3-addressing.png`.

### 1.4 Simulation & Events

| Field | Record |
|---|---|
| Area | Simulation & Events — inject dialog, playback, timeline, filters, reset |
| Starting state | Default project; then custom scenarios (§2) |
| Manual actions | Inject dialog with payload 0 (invalid) then 512; Run All; Step Event ×2; Run All; Event-Type filter = Packet Dropped; Reset; timeline/journey inspection after scenario runs |
| Expected behavior | Invalid payload rejected before submit; delivery counted exactly once; step advances one event; Reset clears progress; filters narrow the list |
| Observed behavior | payload 0 → error shown; 512 B delivered=1 (engine metrics); Step ×2 → processed=2 pending=3; Run All → completed, pending=0; drop filter → correct filtered view; Reset → processed=0, t=0, delivered=0; timeline shows drop reason after scenario C (`audit-evidence/S05-scenarioC-timeline.png`) |
| Evidence | `audit-evidence/S01-initial.png`–`S05-scenarioC-timeline.png` |
| Verdict | **PASS** |
| Defect | none |

### 1.5 Algorithm Studio (9 sub-studios)

| Subview | Actions | Observed | Verdict |
|---|---|---|---|
| Hamming Code | encode `1011` even parity; invalid `10121` | codeword `0110011` = **hand calculation** (p1=0,p2=1,d3=1,p4=0,d5=0,d6=1,d7=1) and equals engine `encoded_bits`; invalid → clear error | **PASS** |
| CRC Polynomial | `11010011101100` ÷ G=1101 | UI remainder `110` = engine `calculate_crc` ✓ | **PASS** (LaTeX help text cleaned, §4.4) |
| Internet Checksum | words `0001 0002` | result `FFFC` = one's-complement sum by hand ✓ | **PASS** |
| Sliding Window (Base) / Go-Back-N / Selective Repeat / GBN-vs-SR | Run each; GBN with window 0 | metrics rendered each time; window 0 → validation error | **PASS** |
| Pure ALOHA / Slotted ALOHA / CSMA / CSMA/CD | Run each | throughput/collision/utilisation metrics rendered | **PASS** |

Evidence: `audit-evidence/G02-hamming-result.png`, `G04-crc-result.png`, `G06-checksum-result.png`,
`G07-flow-comparison.png`, `G08-mac-*.png`, `F1-crc-fixed.png`.

### 1.6 Transport Layer (4 sub-studios)

| Subview | Actions | Observed | Verdict |
|---|---|---|---|
| TCP Studio | dropped segment [3]; no drops; payload −500 | engine/UI agree: lost=1, retrans=1, delivered=4 with drop vs retrans=0 without — **protocol options change results**; invalid → error shown | **PASS** |
| UDP Studio | default datagram run | UI shows engine values (4 segments, 4000 bytes) | **PASS** |
| Congestion Control | run defaults | cwnd / slow-start render | **PASS** |
| TCP vs UDP Comparison | opened (auto-run) | both result sets + goodput/throughput shown | **PASS** |

Evidence: `audit-evidence/X02-tcp-drop-result.png`, `X04-congestion.png`, `X05-comparison.png`,
`X06-udp-re.png`.

### 1.7 Application Layer (5 studios)

| Studio | Actions | Observed | Verdict |
|---|---|---|---|
| DNS | A query `www.example.com`; NXDOMAIN preset; empty query | engine answer `93.184.216.34` shown in UI; NXDOMAIN rendered; empty name → error | **PASS** |
| HTTP | default run | 200/response rendered | **PASS** |
| FTP | default run | transfer completion/bytes rendered | **PASS** |
| SMTP | deliver (accept) then **Reject Recipient (550)** option | accept → 250 path; reject → 550 path — option changes outcome | **PASS** |
| SNMP | GetRequest default | OID/response values rendered | **PASS** |

Evidence: `audit-evidence/Y02-dns-result.png`, `Y03-dns-nxdomain.png`, `Y05-http-result.png`,
`Y07-ftp-result.png`, `Y09-smtp-result.png`, `Y11-snmp-result.png`, `Y12-smtp-reject.png`.

### 1.8 Circuit Switching

| Field | Record |
|---|---|
| Area | Circuit Switching — admission control (Scenario F, §2.F) |
| Verdict | **PASS** (teardown retest below) |
| Evidence | `audit-evidence/C02-accepted.png`, `C03-blocked.png`, `C04-released.png` |

### 1.9 QoS Performance

| Field | Record |
|---|---|
| Area | QoS metrics + fault panel (Scenario E, §2.E) |
| Verdict | **PASS** |
| Evidence | `audit-evidence/Q02-qos-metrics.png`, `Q03-qos-after-slow-link.png` |

### 1.10 Batch Experiments

| Field | Record |
|---|---|
| Area | Parameter Sweep + Comparative A/B + exports (Scenario G, §2.G) |
| Verdict | **PASS** |
| Evidence | `audit-evidence/E02-exp-sweep-result.png`, `E03-exp-ab.png`, `E04-export-status.png` |

---

## 2. Simulation scenarios (outcome-verified)

### A — basic connectivity
- **Config:** default PC(1)–Router(2)–Server(3); inject 512 B node-1→node-3; Run All.
- **Expected:** exactly one delivery over 2 hops.
- **Observed:** `packets_delivered=1`, 0 drops (engine metrics read via API; UI timeline agrees).
- **Verdict: PASS.** Evidence `S03-after-run.png`.

### B — multi-hop routing under the forwarding policy
- **Config:** diamond node-1 – RA – node-3 (100 µs ×2 legs) vs node-1 – node-2 – node-3 (9000 µs ×2 legs after edit); RA added as `nodeType: router`.
- **Expected:** policy `propagation_delay` must send the packet via RA; policy `hop_count` (equal 2-hop cost) must resolve the tie deterministically (documented tie-break: smallest predecessor id → node-2); repeated runs identical.
- **Observed:** delay policy → arrivals node-4 (RA) via link-3, node-3 via link-4 (**fast path**); hop policy → node-2 via link-1/link-2 (**tie-break**), identical across 2 runs. Routing tables agree with live hops (RA's table: node-3 via node-3, metric 100).
- **Verdict: PASS.** The engine follows its implemented policy; table computation and live forwarding are consistent. (First attempt failed due to my own API misuse — `type` vs `nodeType` silently defaulted a "router" to a PC; see §4.7.)

### C — broken connectivity
- **Config:** default project; link-1 (node-1↔node-2) set DOWN; inject node-1→node-3.
- **Expected:** delivery fails with an explicit drop cause, not silence.
- **Observed:** `packets_delivered=0`, `packets_dropped_link_down=1`; UI timeline/summary shows the drop (`S05-scenarioC-timeline.png`).
- **Verdict: PASS.**

### D — transport and application behavior
- **Config:** TCP with dropped segment [3] vs clean; UDP run; SMTP accept vs reject-550; DNS A + NXDOMAIN.
- **Expected:** protocol options change results in the documented direction.
- **Observed:** TCP retrans 1→0 with drop removed; SMTP 250 vs 550 path; DNS answer vs NXDOMAIN; UI values match engine for every case.
- **Verdict: PASS.**

### E — performance and QoS
- **Config:** 1500 B packet over 2 links at 10 Mbps vs the same traffic at 1 Mbps (one variable).
- **Expected:** total latency rises by exactly the extra transmission time: 2×(12 000−1 200) µs = **21 600 µs**.
- **Observed:** 12 406 µs vs 34 006 µs → **Δ = 21 600 µs exactly**. Units (µs, bps) consistent in UI; throughput/goodput shown as distinct fields.
- **Verdict: PASS** (arithmetic identity is hand-verifiable).

### F — circuit switching
- **Config:** default topology (10 Mbps links); request default rate; request 900 Mbps; teardown; re-request.
- **Expected:** admission within capacity, blocking with reason beyond capacity, release frees capacity.
- **Observed:** first request accepted (`C02-accepted.png`); 900 Mbps blocked with capacity reason (`C03-blocked.png`); Teardown (aria-name "Tear down circuit …") released it (`C04-released.png`); re-request accepted. This is the documented **educational admission-control model** — no signalling protocol is claimed or shown.
- **Verdict: PASS.**

### G — batch experiments
- **Config:** default parameter sweep; repeat same-seed sweep via engine; Comparative A/B; exports.
- **Expected:** results correspond to config; same seed → identical results; exports carry real data.
- **Observed:** sweep produced 5 points + metrics table; identical JSON across two same-seed engine runs; A/B delta view rendered; exports: `netsim-sweep-bandwidth-sweep-analysis-<ts>.json` (keys `experiment_name, parameter_name, points[5], total_runs, seeds, execution_time_ms`) and `.csv` (header `experiment_name,parameter_name,row_type,parameter_value,seed,run_count,seeds,throughput_bps,goodput_bps,latency_us,jitter_us,loss_rate,retrans…`, 21 rows) — internally consistent.
- **Verdict: PASS.**

---

## 3. Engine-authority and UI review

### 3.1 Python engine is authoritative (traced)
- Every result checked in §1–2 was produced by the Python service (`get_simulation_state` / protocol APIs) and displayed by the frontend without transformation discrepancies (UI-vs-engine equality asserted for routing tables, Hamming/CRC/checksum, TCP/UDP metrics, DNS answers, QoS deltas).
- **No mock in production:** live `dist/` build contains no test-double stub strings ("not implemented in mock mode") and does contain the rejecting stub message ("No simulation service is available for command"); `src/lib/testDouble.ts` is vitest-only (alias). Verified by grep on the built bundle during this audit.
- **Service down:** engine badge → `OFFLINE` + "Backend Offline"; red banner "Cannot reach the NetSim simulation service. Start it with: python python/netsim/server.py 8765"; no fabricated success; on restart → `ONLINE` and actions work again (`audit-evidence/D01-service-down.png`, `D02-service-recovered.png`).
- **Determinism:** same-seed sweep repetition identical (Scenario G); equal-cost routing tie repeated identically (Scenario B).
- **Stale results:** defect found in Addressing (§4.2) and fixed; other studios keep "last run" panels only in run-scoped contexts where the run is explicitly labelled.

### 3.2 Routing/algorithm claims
- Both algorithms are selectable for tables/convergence AND for live forwarding via the policy panel; `ospf` rejected; docs (README/ALGORITHMS/report §C) match this behavior. A control labelled Bellman-Ford executes Bellman-Ford (parity tests + path evidence). Tie-break: min predecessor id — observed live (Scenario B).
- Edge cases: disconnected destination → `dropped_no_route`; down-only path → `dropped_link_down` (Scenario C); non-router table request rejected; equal-cost tie deterministic.

### 3.3 UI and responsive review (screenshots, 5 sizes)
- **Overflow:** zero horizontal overflow at 320×800, 375×812, 768×1024, 1024×768, 1440×900 across all 10 workspaces (measured `scrollWidth-clientWidth` per workspace per size).
- **Redesign areas checked individually:** Routing (policy panel, rules in plain text), Addressing, Simulation, Algorithm Studio, Transport, Application, QoS (flattened definition grid), shared panels, topology controls, device palette (bottom strip), minimap (dark, status-colored) — consistent titles matching the sidebar, single accent, sentence-case labels, no leftover badges.
- **Keyboard:** Tab focus ring visible (3px solid outline on sidebar buttons); Connect dialog focus trap verified; Escape restores focus; all essential actions reachable without pointer (documented in the in-app "?" overlay).
- **320 px topology** was broken at audit start (P2, §4.3) — fixed (icon-rail sidebar, wrapping toolbar); re-verified with `U2-320-topology.png`, `U2-320-dialog.png`, `U2-375-topology.png`, `U2-768-topology.png`.
- Open P3: React Flow attribution clips over the toolbar at exactly 320 px (`U-320-topology-chrome` shows the earlier state; still slightly overlapping after the fix).

---

## 4. Defects found, root causes, fixes, retests

| # | Sev | Defect | Root cause | Fix | Retest |
|---|---|---|---|---|---|
| 4.1 | **P1** | Connect dialog silently reset selections and **cleared validation/backend errors within ~1 s**; focus yanked back to the first field while open. e2e test 23 masked it by asserting within one poll tick. | `ConnectDialog` init/trap effect depended on `[open, nodes, onCancel]`; App polls state at 1 Hz; `TopologyCanvas` re-created `nodes`/`onCancel` every tick → effect re-ran → `setError(null)` + defaults + `focus()`. Same class in `ConfirmDialog` (focus steal per tick). | Effects keyed on `[open]` with handler/prop refs (`ConnectDialog.tsx`, `ConfirmDialog.tsx`); stable props in `TopologyCanvas.tsx` (`useMemo`/`useCallback`); regression test pinning state+error survival across parent re-renders (`ConnectWorkflow.test.tsx`). | Manual: error persists 2.5 s across ticks, selection sticks after 1.5 s idle, valid connect works (links 2→3). Unit: 9/9. e2e 22/23 green. Evidence `PROBE3-dialog.png` (before) vs dialog after fix (`T05-connect-dialog.png` + §4.1 manual retest). |
| 4.2 | **P2** | Addressing IPv6 (and IPv4/VLSM/split): after a **failed** submit the previous input's results stayed on screen with no indication they were stale. | Result setters (`setIpv6Info` etc.) only updated on success. | On error, the corresponding result is cleared in all four handlers (`AddressingWorkspace.tsx`). | Manual: `gggg::1` → error shown, stale `2001:db8::1` panel gone, valid input repopulates (`A09-v6-error.png` → `A10-v6-error-fixed.png`). |
| 4.3 | **P2** | At 320 px the topology workspace was effectively unusable: 224 px sidebar left a ~96 px canvas; palette truncated mid-labels; **Connect button clipped**; timeline text stacked per-word. The overflow test passed only because the canvas clips. | Fixed-width sidebar (`w-56`) at all breakpoints; absolute toolbar with no wrap. | Sidebar collapses to icon rail below `md` (accessible names kept via `aria-label`, so role-based tests/e2e still match); canvas toolbar wraps and is width-bounded (`Sidebar.tsx`, `TopologyCanvas.tsx`). | Manual: all toolbar controls incl. Connect visible at 320 (`U2-320-topology.png`); dialog opens at 320 (`U2-320-dialog.png`); e2e 21/22 green ×2. |
| 4.4 | **P3** | Raw LaTeX in the CRC help text (`$G(x)$`, `$r = …$`, `$\ge 1$`) — inconsistent with the plain-text rules panel (residual redesign leak). | Not caught by the earlier Routing-only LaTeX cleanup. | Rewritten in plain English (`DataLinkWorkspace.tsx`). *(Fix attempt initially broke the build: esbuild rejects `>` inside JSX text — corrected immediately; see §5.)* | Visual `F1-crc-fixed.png`; 0 `$…$` spans left in `src/components`. |
| 4.5 | **P3** | Prefix slider keyboard stepping appeared to move 1 step for 4 arrow presses in one probe. | Not reproduced after focused retest: slider min 0/max 32 tracks its label; single-step per press verified. | None (no defect isolated). | Recorded as unexplained one-off; slider functional. |
| 4.6 | **P3** | React Flow attribution slightly overlaps the canvas toolbar at exactly 320 px. | Both are pinned near the top at very narrow width. | Left open (cosmetic, 320 px only). | Documented; see `U2-320-topology.png`. |
| 4.7 | **P3** | `add_node` with an unknown type key (`"type"`) silently defaults to `pc` instead of rejecting. | Argument aliases are `node_type`/`nodeType`; unknown keys fall back to the default. | Left open by design (lenient defaults; UI always sends `nodeType`). | Noted for transparency; no user-visible path affected. |

**One-off non-reproduced observations (recorded honestly):** an Undo that appeared to no-op in one
driver run (could not be reproduced in 2 focused reruns with the same sequence — 4→3→4 both
times); a browser-level dialog click timeout that turned out to be correct modal blocking (see
below).

---

## 5. Import / export and error recovery

| Check | Observed | Verdict |
|---|---|---|
| Project export contains current state | `audit-topo.netsim` = `schemaVersion: 1` + nodes/links of the live project | PASS |
| Export → New → Import restores topology | node ids and links restored exactly | PASS |
| Import confirmation communicates replacement | dialog states replacement; confirm/cancel both work | PASS |
| Cancel import leaves project unchanged | node count identical | PASS |
| Malformed file rejected safely | "{not json" → error toast, project intact | PASS |
| Experiment export JSON/CSV content | real sweep data, consistent headers/units (Scenario G) | PASS |
| Service outage mid-session | OFFLINE + actionable banner; full recovery after restart | PASS |
| Dialog open/close ×3 + cancel | state intact each time | PASS |
| Modal semantics | Connect dialog blocks underlying clicks (by design); backdrop click and Escape both dismiss | PASS |
| Reset / Undo / Redo | engine reset to t=0/counters 0; history works | PASS |
| Request-size / malformed-body / hostile inputs | 413 with limit name; structured 400s for malformed JSON, non-object bodies, invalid node types (path-traversal string rejected by enum); no tracebacks | PASS |
| Network binding | service binds `127.0.0.1` (loopback). *Note: a second `169.254.0.21:8765` listener is sandbox port-forwarding infrastructure, not the app.* | PASS |
| Persistence | export/import only — **no auto-save**; USER_GUIDE §14 matches (verified wording) | PASS |

## 6. NOT VERIFIED

- Real-network multi-host behavior outside the simulator (no external sockets exist; everything is the educational engine — expected).
- Long-horizon memory/leak behavior beyond the audit session length.
- The 320 px attribution overlap (P3, §4.6) remains unpolished.
- Playwright's stock Chromium download in this sandbox (CDN blocked; substituted Chromium 153 used — same caveat as FINAL_ENGINEERING_REPORT §5). GitHub-hosted CI runs stock Chromium.

## 7. Automated regression (supporting evidence only — rerun after fixes)

| Gate | Result | Exit |
|---|---|---|
| `pytest python/tests` | 217 passed | 0 |
| `pytest python-tools/tests` | 83 passed | 0 |
| `ruff check` / `ruff format --check` | clean / all formatted | 0 |
| `mypy` | clean (67 files) | 0 |
| `tsc --noEmit` | clean | 0 |
| `npx vitest run` | **124 passed, 11 skipped** (incl. new dialog-poll regression test) | 0 |
| `npm run build` + bundle guard | build ok; no test-double strings in `dist/` | 0 |
| `NETSIM_LIVE_API=1 vitest src/integration` | 11 passed | 0 |
| `npx playwright test e2e/netsim.spec.ts` | 24 passed (run ×2 after fixes) | 0 |
| `npx playwright test e2e/a11y.spec.ts` | 3 passed (incl. Connect dialog audit) | 0 |

## 8. Changed files in this audit

| File | Change |
|---|---|
| `src/components/topology/ConnectDialog.tsx` | P1: init/trap effect on `[open]`, refs for `nodes`/`onCancel` |
| `src/components/ui/ConfirmDialog.tsx` | P1 class: focus effect on `[open]`, ref for `onCancel` |
| `src/components/topology/TopologyCanvas.tsx` | stable dialog props; keyboard handler reads project via ref (kills a one-tick stale-closure race behind the e2e flake); toolbar wraps/bounded |
| `src/components/layout/Sidebar.tsx` | P2: icon-rail below `md` with preserved accessible names |
| `src/components/addressing/AddressingWorkspace.tsx` | P2: clear stale results on failed submit (4 handlers) |
| `src/components/datalink/DataLinkWorkspace.tsx` | P3: CRC panel LaTeX → plain text |
| `src/ConnectWorkflow.test.tsx` | +1 regression test (state/error survival across parent re-renders) |
| `FINAL_MANUAL_ACCEPTANCE_AUDIT.md`, `audit-evidence/` | this record + 63 screenshots |

## 9. Final verification after fixes (2026-10-16)

Full regression (§7) green on the final tree; the important manual scenarios (A–G), the topology
workflow, the outage/recovery path and the 320 px layout were repeated on the fixed code; final
visuals `F1–F4` captured; no unexplained console errors beyond sandbox font-CDN noise and
expected 400-resource logs from rejected inputs; evidence committed alongside this record.

---

## 10. Submission-readiness decision

# READY WITH DISCLOSED MINOR ISSUES

**Rationale.** Every critical workflow — topology editing (mouse + keyboard), routing under both
algorithms and the live forwarding policy, all addressing/NAT subviews, simulation playback and
injection, all 9 algorithm sub-studios, all 4 transport sub-studios, all 5 application studios,
circuit-switching admission, QoS, batch experiments, import/export, and service outage/recovery —
was exercised manually through the running application with outcome-verified results (including
two hand-checkable arithmetic identities: Hamming `0110011` and the 21 600 µs QoS delta). The
three defects found (P1 dialog state reset, P2 stale results on error, P2 320 px canvas) are
fixed and manually retested; a regression test pins the P1. No P0/P1 remains. The remaining
issues are explicitly disclosed minor (P3) items: attribution overlap at exactly 320 px (§4.6),
an unexplained one-off slider observation (§4.5), and lenient `add_node` defaulting (§4.7).
A green CI run alone was not used as justification; this decision rests on the manual record above.
