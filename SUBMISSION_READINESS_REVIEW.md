# NetSim — Submission Readiness Review

- **Date:** 2026-10-24
- **Branch:** `arena/e7239da9-cn-project` (based on `d213648f3679b9c94b1326cc065d84640f1d5b9d` of `main`; `main` untouched, no force-push)
- **Method:** genuine hands-on verification — Playwright (Chromium) against the Vite dev
  server plus direct HTTP checks against the live Python service. No pass is claimed
  from code inspection alone; anything not executable in this environment is marked
  **NOT VERIFIED**.
- **Verdict: READY** (with the conditions in §11).

## 1. Scope covered

All 9 workspaces, each exercised end to end in the browser (see `evidence/screenshots/tour-*.png`):

| # | Workspace | Exercised |
|---|---|---|
| 1 | Topology Canvas | add/rename/connect nodes, link editor, undo/redo, zoom, inspector badges |
| 2 | Routing Studio | Dijkstra/Bellman-Ford tables, hop/inverse-bw metrics, convergence rounds |
| 3 | Addressing & NAT | IPv4 calc + prefix slider, split, VLSM, auditor, IPv6, NAT out/in, DNAT |
| 4 | Simulation & Events | inject, step/burst/run-all, filters, timeline, journey, encapsulation, inspector |
| 5 | Algorithm Studio | Hamming (SECDED), CRC calc/verify, checksum (RFC 1071 hand-check), GBN/SR, MAC ×4 |
| 6 | Transport Layer | TCP clean/drops/link-down, UDP loss, congestion chart, TCP-vs-UDP comparison |
| 7 | Application Layer | DNS (NOERROR/NXDOMAIN/empty), HTTP, FTP, SMTP accept/reject, SNMP (+bad OID) |
| 8 | QoS Performance | live metrics math, link utilization, fault scheduling |
| 9 | Batch Experiments | parameter sweep, A/B test, JSON/CSV downloads, `python-tools` round-trip |

Cross-cutting: project export/import, backend-offline behaviour + reload recovery,
320/375/768/1024/1440 px responsive, keyboard/Tab order, inject-modal Escape/focus.

## 2. Baselines (before fixes)

- `pytest python/tests`: **154 passed** · `pytest python-tools/tests`: **80 passed**
  (after installing `python-tools/requirements.txt` for matplotlib)
- `npx tsc --noEmit`: clean · `npx vitest run`: **93 passed / 11 skipped**
- `ruff check`, `ruff format --check`, `mypy`: clean
- Python is the sole simulation authority; the frontend `test-double` path was not
  relied on for any behavioural claim.

## 3. Residual findings revisited

1. **320 px attribution overlap → FIXED (D11).** The XYFlow attribution now sits alone
   in the bottom-right corner (MiniMap hidden below `sm`, toolbar docked bottom-center).
   Verified at 320 px: visible, no overlap (`evidence/screenshots/r12-topo-320.png`).
   Attribution was repositioned around, never hidden.
2. **Prefix slider → VERIFIED WORKING, no defect.** Dragging the slider drives the
   existing auto-recalculate effect: /24 → /26 updates network/broadcast to
   `192.168.1.0`/`192.168.1.63` and the thumb follows (`v-slider.png`). No change made.
3. **Unknown node-type default → VERIFIED SAFE, plus a guard (D12).** Unknown
   `node_type` *values* are rejected with HTTP 400
   (`Invalid node type 'quantum_router'. Expected one of: …`); omitting the key still
   defaults to PC (intentional, now regression-tested); `load_project_json` wraps
   bad values into a structured 400; unknown states render safe fallback icons.
   D12 additionally rejects lookalike keys (`type`, `device_type`, `kind`, …) with
   guidance instead of silently building a PC.

## 4. Defect log (D1–D15)

| ID | Severity | Finding | Fix | Re-verified |
|---|---|---|---|---|
| D1 | Low | Raw `$…$` LaTeX in Routing help (`$A \to B$`, `$(base \times 3).max(…)$`, `$\\lceil…$) and DataLink help (`$P_0$`, `$G(x)$`, `$\\ge 1$`, `+$0^r$`) | Plain-text/Unicode copy (`RoutingWorkspace.tsx`, `DataLinkWorkspace.tsx`); formulas checked against `python/netsim/routing/graph.py:79-88` | grep for `$[A-Za-z\\]` across `src/*.tsx`: clean |
| D2 | Low | XYFlow `<Controls>` rendered default **light** buttons on the dark canvas | Dark theme via supported `--xy-controls-*` CSS variables + attribution styling (`src/index.css`) | `d2-topo.png` → `r12-topo-1440.png` |
| D3 | Med | Event-filter grid used viewport breakpoints inside the fixed 384 px column → 6 squeezed dropdowns, labels colliding | Fixed `grid-cols-2` (`EventFilters.tsx`; only used in that column) | `d3-filters.png` → `r12-sim-1440.png`, `r12-sim-320.png` |
| D4 | **High** | Failed runs left the previous successful result on screen (Transport ESTABLISHED trace, DNS NOERROR + inspector, IPv4/split/VLSM/IPv6/NAT, Hamming/CRC/checksum, flow-control, MAC, routing, sweep/A-B) | Every per-run handler clears its result state (and app packet selection) in `catch` | ESTABLISHED 15→0, NOERROR result 5→0 (+inspector reset), `v-trans-stale.png`, `v-dns-empty.png`, `v-addr-invalid.png` |
| D5 | Med | Inject modal: no dialog role, no Escape close, focus stayed on opener, no trap | `role=dialog` + `aria-modal`, Escape handler, initial focus, focus trap, focus return, labelled close button | Script: role ✓ focus-in ✓ Escape-close ✓ focus-return ✓ |
| D6 | Med | Timeline rows overflowed: badges wrapped mid-word, node/link ids clipped | Wrapping rows, `nowrap`/`shrink-0` badges, description drops below when narrow | `d36-sim.png` → `r12-sim-1440.png` |
| D7 | **High** | MAC `offered_load_g` was ignored (fixed RNG schedule; G=0.3 vs 2.5 identical) | Poisson arrivals: per-station mean gap N/G frame-times in all 4 protocols, G clamped at 1e-3 | UI: 4 coll. @G=0.3 → 27 @G=2.5 (`v-mac-g.png`); engine: all 4 protocols differ, same-seed repeats identical; new golden test |
| D8 | Med | DNS response `details` leaked raw `<DnsRecord …>` reprs | `name TYPE value` list (or `none`); other studios audited (scalars only) | UI + code audit |
| D9 | **High** | `schedule_fault_command` with string `fault_type` → HTTP 500 `AttributeError` | `FaultScheduleEntry.from_dict` rejects non-dict with a 400 + shape guidance | Live: structured 400, no traceback; regression tests assert 400 |
| D10 | Med | Split dropdown showed counts with no valid base (`/26 (67108864 subnets)`) | Counts withheld until a base calculation exists | `/1…` plain → `/25 (2 subnets)` with base (`v-addr-invalid.png`) |
| D11 | Med | 320/375 unusable (224 px sidebar, clipped navbar/toolbar); 768 crowding | Icon sidebar + icon palette below `lg`, compact navbar, toolbar reposition, wrapping control bars, stacked sim columns, wrapping workspace headers/tab pills | 0 doc overflow at 320/375/768/1024/1440; all tabs/controls reachable (`r12-*`, `r13-*`) |
| D12 | Med | `add_node` with `{"type": "router"}` silently built a PC | Lookalike-key guard with correct-key guidance; omission still defaults to PC | Live 400s; 3 parametrized tests + omit-default test |
| D13 | — | Duplicate same-pair links accepted | **No change — intentional.** Parallel links are covered by `test_regression_a_link_can_be_added_even_when_every_port_is_in_use`; overlapping canvas rendering noted as a cosmetic limitation | N/A (reverted the rejection) |
| D14 | Med | Sweep/A-B results had no JSON/CSV download although `USER_GUIDE §14` + `python-tools` expect sweep JSON | JSON (raw result) + CSV (points/deltas) downloads on both result panels | Downloads captured; `analyze_results.py` consumes the UI JSON (`evidence/downloads/`) |
| D15 | Low | Experiments errors rendered `String(err)` → `Error: …` prefix | `instanceof Error ? message : String(err)` like every other workspace | tsc + code check |

Deliberate non-changes (verified safe): QoS poll keeps last-known metrics on failure
(standard dashboard behaviour); NAT-table cache kept on load error; sim event log is
append-only; `w-84` on the property panel is a pre-existing dead class (width is
content-driven; left untouched to avoid desktop changes).

## 5. Hand-verified behaviour notes (exact values)

- **Checksum:** `0001+F203+F4F5+F6F7 = 0x1DDF2 → 0xDDF3 → ~ = 0x220D` — UI matches RFC 1071 exactly.
- **SECDED:** `0110011` has four ones → even → P0=0 ✓ (initial suspicion resolved, not a defect).
- **TCP/Jacobson:** first RTT 20,128 µs = `4×(32+5,000)`; SRTT 20,128; RTO 60,384 = `20,128+4×10,064`; drops run recovered (RTO 104,096). Comparison: TCP 4,000 B via 2 retransmissions vs UDP 2,000 B / 0 retx at 33.3% loss — coherent.
- **QoS:** 1000 B / 11,606 µs → 689,298 bps (UI `689.30 Kbps`, `11.61 ms`); link busy 800 µs → `6.89%`.
- **MAC determinism:** same-seed repeats byte-identical; G now drives contention in all 4 protocols.
- **SMTP:** `nobody@nowhere.invalid` yields `250 QUEUED` under the Accept policy — the model is policy-driven, not mailbox-validated (accepted model semantics).
- **Offline:** backend stop → OFFLINE badges + error banner, no phantom results; reload recovers ONLINE; transport re-probes per command.

## 6. Exports / failure handling / responsive / a11y

- **Exports:** project JSON round-trips; sweep/A-B JSON+CSV download from the UI and the sweep JSON feeds `python-tools/analyze_results.py` successfully.
- **Failure handling:** unknown commands → 404; rejected input → structured 400 (no tracebacks); offline → banners + recovery. D9's 500-class hole is closed with regression tests.
- **Responsive:** 320/375/768/1024/1440 px all render with zero document overflow; 320 px keeps navigation, topology, simulation, and all studio tab-switchers usable.
- **Keyboard/a11y:** Tab order navbar → sidebar is sensible; inject modal traps focus, closes on Escape, returns focus; icon-only controls keep accessible names (`sr-only` labels, `aria-label`s, tooltips).

## 7. NOT VERIFIED (explicit)

- SMTP **Reject**-policy toggle effect (only Accept-policy runs observed).
- Tampered-CRC UI click-path assertion (banner regex inconclusive; engine path is test-covered).
- Screen-reader pass (keyboard support verified; no SR run).
- Non-Chromium browsers; physical mobile devices (viewport emulation only).
- Load/stress beyond the scripted runs.

## 8. Regression after all fixes

- `pytest python/tests`: **161 passed** (154 + 7 new) · `pytest python-tools/tests`: **80 passed**
- `npx vitest run`: **93 passed / 11 skipped** (unchanged) · `npx tsc --noEmit`: clean
- `ruff check`, `ruff format --check`, `mypy`: clean
- Full `git diff` audit performed: every intended change confirmed present; no test weakened.

## 9. Changed files (26)

Engine: `python/netsim/datalink/mac.py`, `python/netsim/application/dns.py`,
`python/netsim/faults/model.py`, `python/netsim/server.py`; tests:
`python/tests/test_api_contract.py`, `python/tests/test_parity_golden.py`.
UI: addressing, transport, 5 application studios, datalink ×3, experiments (+Qos headers),
routing, simulation studio, timeline ×2, topology ×3, layout ×2, `src/index.css`.
Docs/evidence: this file + `evidence/`.

## 10. Submission checklist

- [x] All 9 workspaces hands-on verified + evidence
- [x] 3 residual findings revisited and closed
- [x] 14 defects fixed + 1 investigated/no-change, all re-verified
- [x] Exports / failure / responsive / a11y verified
- [x] Full regression green, history preserved, no force-push, `main` untouched

## 11. Verdict: READY ✅

NetSim is ready for submission on `arena/e7239da9-cn-project`. Conditions: the §7
NOT VERIFIED items stand as stated (Chromium-only, no SR pass, two narrow UI paths
unasserted), and the D13 parallel-link canvas overlap remains a known cosmetic
limitation. None blocks submission.
