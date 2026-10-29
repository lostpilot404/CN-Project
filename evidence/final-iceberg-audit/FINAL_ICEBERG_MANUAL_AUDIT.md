# NetSim Interactive Computer Network Simulation Platform — Final Iceberg Manual Audit

**Repository:** `/home/user/CN-Project` · **Branch:** `arena/38e9d176-cn-project` · **Commits:**
`c932d61` (defect fixes + evidence), `5e18e2d` (this report), plus a documentation-consistency
commit recorded in `git log` (the branch head is re-verified against `origin` after every push)
**Base audited:** `d737f4f` · **Audit date:** 2026-10-29 · **Register:** `DEFECT_REGISTER.md` (this directory)

Method rule applied throughout: manual exercise in the real running application is the primary
acceptance test. Every claim below is tagged **MANUAL** (exercised in the live UI), **API** (direct
service call), **CODE** (source inspection), **TEST** (automated suite) or **UNVERIFIED**.
Screenshots and network captures are in the subdirectories of this folder; nothing was simulated,
mocked or retouched.

Tooling actually used (nothing invented): Chromium 153.0.8010.0 `headless_shell` (extracted from
`@sparticuz/chromium`, `LD_LIBRARY_PATH` supplied) driven by Playwright; Vite dev server on
`:1420` proxying `/netsim-api` to the Python service on `:8765`; `pytest`, `vitest`, `tsc`,
`ruff`, `mypy`, `vite build`, `playwright test`. `npx playwright install` and `apt-get chromium`
were both blocked by the sandbox firewall and were **not** used.

---

## Section 1 — Environment, inventory, global UI, topology, addressing, routing (Phases 0–5)

- **Environment (MANUAL):** Debian 12, Python 3.11.2, Node 22.22.3. `/health` reports
  `backend: python`, `authority: python-simulation-core`, `version 0.9.0`. All **10 workspaces**
  render with live controls; boot produced 29 API calls, 0 page errors, and exactly one console
  error: the blocked `fonts.googleapis.com` stylesheet (D-009, environment-dependent).
- **Python sole authority (MANUAL + CODE):** with the backend SIGKILLed, `Calculate` produced **no
  result panel** and reported the service unreachable — no fabricated values, no silent mock
  (`recovery/03-c-operation-while-down.png`). `candidateEndpoints()` prefers the same-origin
  `/netsim-api` proxy off-loopback, so a proxied deployment works.
- **Engine status recovery:** D-001 (status stuck OFFLINE after an outage) fixed and re-verified
  twice in the live UI.
- **Addressing "/24 → /26" stale-result scenario:** reproduced and root-caused (slider bound to the
  async *result*, not the request) — D-002 fixed; 7/8 lost increments → 0/8. Subnet/VLSM arithmetic
  independently recomputed and matched.
- **Routing (API + independent re-implementation, `verify_routing.py`):** on a purpose-built
  5-router topology whose three metrics deliberately disagree, the server matched my own Dijkstra
  and Bellman-Ford on **every** cost: hop_count → R1-R2-R5 (2), propagation_delay → R1-R3-R4-R5
  (300 µs), inverse_bandwidth → R1-R2-R5 (2). A DOWN direct link is excluded; the DEGRADED penalty
  `max(3b, b+50)` and `ceil(1e9/bw)` formulas confirmed. Dijkstra ≡ Bellman-Ford everywhere.
- **Topology editor (MANUAL):** "Add Core Router" → 4 nodes persisted; Undo → 3; node rename +
  "Apply Changes" persisted with the "Saved!" confirmation. Per-interface IPv4 inputs did not
  render for the selected router in my run — recorded **UNVERIFIED**, not claimed as a defect.

## Section 2 — Simulation engine, data-link, flow control/MAC, transport (Phases 6–9)

- **Packet lifecycle (MANUAL):** Inject dialog → packet pending; 5×"Run 50ms" reached
  `t = 11606 µs`, **exactly** the hand-computed 5 ingress + 800 tx + 5000 prop + 1 fwd + 800 tx +
  5000 prop. Event trace shows `queue_entered → transmission_started(tx_delay 800) →
  transmission_finished → packet_arrived` per hop; counters Delivered 1 / Dropped 0; Packet
  Inspector renders all **5 layers**.
- **Hamming/CRC/checksum (MANUAL + independent re-implementation `verify_algo.py`):** all parity
  constraints satisfied under even *and* odd parity; full single-bit sweep detected, positioned and
  corrected; CRC-10/CRC-16 remainders and RFC 1071 checksums (`0x220D`, `0xFFFF`→`0x0000`, …) match
  my own implementations. Invalid generators/inputs → HTTP 400 or disabled buttons.
- **D-005 (P1) SECDED:** two flipped bits were "corrected" into silently wrong data with a green
  banner; now reported `double_bit_detected`, uncorrectable, red "UNRECOVERABLE MULTIPLE-BIT ERROR".
  D-008 (clean codeword reported as erroneous) fixed alongside. Round-trips pass both parities.
- **MAC offered-load (MANUAL):** sweeping G = 0.2…3.0 moved collisions 0/0/12/18/27 — the parameter
  reaches the model; the three protocols hit distinct endpoints. Previously-reported lead cleared.
- **Transport:** TCP recovery/RTT and congestion behaviour verified through the UI and e2e;
  D-012 (UDP bandwidth blindness, see §3) was the transport defect of record.

## Section 3 — Application studios, QoS/faults, experiments & exports (Phases 10–13)

- **DNS:** stale-result lead **cleared** — an un-re-run panel keeps the previous name on its own
  records; NXDOMAIN renders an honest empty state; whitespace-only names → HTTP 400.
  **D-014 found and fixed:** the client's copy of the default zone was merged on top of identical
  defaults, so one A query returned *two* identical answers and `payload_bytes_received` was
  inflated (128 B → now 96 B); round-robin and caller-added records still work.
- **SMTP Reject-policy toggle (MANUAL):** Accept → `is_accepted:true`, 14 events ending
  `SMTP_MESSAGE_ACCEPTED`, UI "250 QUEUED"; Reject → trace truncated at `SMTP_RCPT_REJECTED`,
  UI "550 REJECTED". Toggle drives model **and** UI.
- **Fault injection HTTP 500 lead:** not reproducible (7/7 HTTP 200; invalid inputs → clean 400s).
  D-003/D-004 (silent clamping then false success; notification overwrite) fixed and re-verified.
- **Experiments dispatch:** UI offers exactly the 3 supported targets; the runner **raises**
  `Unsupported experiment target …` for the others; incompatible parameters → HTTP 400 with a
  precise message. No wrong-model redirect. D-011 (target change clobbering the user's sweep
  config) and D-013 (dropdown displaying one parameter while submitting another) fixed + re-verified.
- **Export integrity (MANUAL, real `download` events):** all six download buttons produce non-empty
  files; JSON carries per-run seeds/values, embedded `base_project`, `provenance.target`,
  `engine_source_sha256`, and declares `execution_time_ms` nondeterministic; CSVs are well formed
  with units and `row_type`. `percent_change` is `null` (not NaN/Infinity) on a zero denominator.
- **Replay/determinism (API):** `examples/replay_experiment.py` reproduces the browser-downloaded
  sweep and A/B JSON **byte-identically** (after int/float normalisation, excluding only the
  documented wall-clock field); `analyze_results.py` consumes the same file correctly.
- **D-012 (P1):** UDP reported 1 644 800 bps over a 1 Mbps link and was flat across 1/10/100 Mbps
  while TCP responded; fixed in `udp.py` and re-verified in the live UI (889 k / 1.58 M / 1.64 M bps,
  never above capacity) with a new regression test.

## Section 4 — State, responsiveness, accessibility, browser/network forensics (Phases 14–19)

- **Stale results:** DNS and experiment panels label results with their own run's inputs; exports
  cannot refer to a different run (§3). No misattribution found.
- **Responsive (MANUAL, 8 named viewports × 10 workspaces = 80 probes,
  `responsive/30-overflow-matrix.json`):** **zero horizontal page overflow**. Three real defects
  found and fixed: **D-015** (Batch Experiments tabs off-screen ≤430 px), **D-016** (Transport
  results column and its primary Run button collapsed to a ~17 px sliver ≤430 px), **D-017**
  (circuit-switching attribution truncated mid-phrase). All re-verified at 320–1440 px with before/
  after screenshots. Two earlier "clipped" classifications were disproved by screenshot (a few px of
  border-radius/padding only) — recorded, not reported as defects. React Flow canvas items that sit
  outside the viewport are pannable by design.
- **Accessibility (MANUAL):** every workspace's interactive controls were scanned for missing
  accessible names — none unnamed; navbar/palette/nodes/dialogs/property fields all carry
  `aria-label`s; keyboard Tab reaches primary actions with a visible focus ring; the e2e a11y and
  keyboard-topology specs pass.
- **Browser/network forensics:** the only boot console error is the firewalled Google-Fonts
  stylesheet (D-009); the Vite proxy answers 500 (not 502/504) when the upstream is down — noted,
  cosmetic; D-010 (`/health` re-probed per command) remains open as a performance nit.
- **False functionality / contracts:** unsupported targets and parameters are explicitly rejected
  (HTTP 400 with reasons), never silently ignored or redirected; the frontend never fabricates.

## Section 5 — Performance/stability, documentation, evidence standard, prioritisation (Phases 20–25)

- **Stability:** long sequences (sweeps of 2–4 values × multiple seeds, 40-packet congestion runs,
  repeated inject/run cycles) completed without leaks, crashes or console errors; backend survived
  repeated kill/restart cycles.
- **Documentation:** README/docs ports (8765 / 1420 / `NETSIM_API_TARGET`) match reality; Rust/Tauri
  mentions in docs are deliberate removal notes; the only stale references were code comments/test
  names (**D-007, now fixed**). No nonexistent workspaces or wrong test counts advertised.
- **Evidence standard:** every defect entry in `DEFECT_REGISTER.md` names its verification mode and
  artifact path; screenshots are genuine captures; network JSON dumps accompany each UI claim.
- **Prioritisation:** 17 defects registered — 3×P1, 8×P2, 6×P3. **15 FIXED (all P1 and P2),
  2 OPEN P3** (D-009 environment-dependent font CDN; D-010 double health-probing).

## Section 6 — Final regression, hygiene, submission (Phases 26)

| Gate | Result |
|---|---|
| `pytest python/tests python-tools/tests` | **351 passed** |
| `vitest run` | **126 passed / 11 skipped** (16 files) |
| `tsc --noEmit` | exit 0 |
| `ruff check .` / `ruff format --check .` | clean / **92 files formatted at the pre-report gate run; 93 at the current check.** This repo's ruff also formats Markdown, so the format set is 85 `.py` + the `.md` documents; the count rose from 92 to 93 only because this report's own `.md` joined the set when it was committed. Both runs were and are **clean** — the historical 92 is preserved as run, not rewritten. |
| `mypy` (repo config) | Success, 67 source files |
| `vite build` (production) | ✓ built in 6.9 s |
| `playwright test` (real Chromium) | **34/34 passed** (incl. downloads+replay, layout overflow, a11y/keyboard) |

Repository hygiene: commit chain on `arena/38e9d176-cn-project` — `c932d61` (defect fixes plus the
29 MB evidence tree kept in-repo under `evidence/`, consistent with the audit's evidence
requirement), `5e18e2d` (this report), followed by a documentation-consistency commit whose SHA is
recorded in `git log`. No rebase, no merge into `main`, no force-push at any point;
`package-lock.json` left untouched; working tree clean after every commit. Remote HEAD parity was
independently confirmed via `git ls-remote`, `git rev-parse` and the GitHub API at each handoff —
`c932d61209bdb0aae3c84abc3a5877afee89bedf` at the fix-commit handoff and
`5e18e2da63706f9aecd67b8ad263b71dac2002fa` at the report handoff. These are historical results and
are preserved as run, not rewritten.

---

## Required 13-point summary

1. **Environment truthfulness:** audited with tools actually installed (extracted Chromium 153
   headless_shell + Playwright); blocked installs (`playwright install`, apt Chromium) documented,
   never claimed.
2. **Scope covered:** all 10 workspaces exercised live; Phases 0–26 executed in order across the
   six sections.
3. **Python remains the sole simulation authority:** backend-down produced no fabricated results;
   provenance records engine, model version, source hash and executed target per run.
4. **Defect register:** 17 entries (3 P1, 8 P2, 6 P3); **15 fixed and manually re-verified**,
   2 open P3 (D-009 font CDN, D-010 health-probe churn).
5. **P1 fixes:** SECDED double-bit mis-correction (D-005); un-collectable pytest suite (D-006,
   pre-existing at base commit); UDP bandwidth-blind throughput (D-012).
6. **Arithmetic independently verified:** subnetting/VLSM, Dijkstra & Bellman-Ford under 3 metrics,
   CRC/CRC-16, RFC 1071 checksums, Hamming (both parities), 2-hop packet timing (t = 11606 µs exact).
7. **Export & replay integrity:** real browser downloads captured for all six buttons; replay is
   byte-identical modulo the documented nondeterministic wall-clock field.
8. **Named leads resolved:** "/24→/26" staleness = D-002 (fixed); MAC offered-load = wired (cleared);
   fault HTTP 500 = not reproducible (cleared); stale DNS = honest labelling + D-014 duplicate
   answers (fixed); stale transport comparisons = D-012 bias (fixed); wrong-run exports = cleared.
9. **Responsive:** 0/80 page-overflow probes; three phone-width layout defects fixed without hiding
   any functionality, re-verified at 320–1440 px with before/after screenshots.
10. **Accessibility:** no unnamed interactive controls; keyboard reachability and visible focus
    confirmed; dedicated a11y/keyboard e2e specs pass.
11. **Regression:** pytest 351, vitest 126/11, tsc 0, ruff clean, mypy clean, prod build OK,
    e2e 34/34 — all green *after* every fix.
12. **Documentation:** ports and architecture notes accurate; last stale Rust/Tauri code references
    removed (D-007); docs' removal notes are honest.
13. **Submission state:** committed on the session branch as `c932d61` (fixes + evidence) and
    `5e18e2d` (this report), plus a final documentation-consistency commit; pushed each time, with
    remote HEAD parity independently confirmed for `5e18e2d` via `ls-remote`, `rev-parse` and the
    GitHub API and re-confirmed after the documentation commit; evidence tree and this report
    accompany the branch.

**Documented limitations:** (a) `fonts.googleapis.com` is a hard boot dependency and is unreachable
in firewalled environments (D-009); (b) `/health` is re-probed per command, doubling round-trips
(D-010); (c) per-interface IPv4 editing in the topology property panel was not exercised for router
nodes (UNVERIFIED); (d) at ≤430 px several secondary control rows (routing table, preset chips)
remain horizontally scrollable inside `overflow-x-auto` containers without a visible scroll
affordance — content reachable, polish outstanding; (e) CI on the pushed commit was not observed
from this sandbox (all gates above are local runs).

## Verdict

**READY WITH DOCUMENTED LIMITATIONS**
