# NetSim — Final Engineering Report

**Project:** NetSim — Interactive Computer Network Simulation and Performance Analysis Platform
**Repository:** https://github.com/lostpilot404/CN-Project
**Branch:** `arena/541edc3e-cn-project` (never merged into `main`; all work confined to this branch)
**Report date:** 2026-10-16 (Asia/Calcutta)
**Baseline:** `d213648f3679b9c94b1326cc065d84640f1d5b9d` (start) → `42092dd` (Phases A–I final) →
**`9d31c85`** (this report, delivered) → `e04054a`… (residual pass — see Addendum, which records the
actual branch tip at its own delivery)

---

## 1. Verdict

**Complete for the assigned scope — every claimed gate green with evidence.** The two items
still open are documented non-goals (hardening posture, packaging), not unfinished work.

Every assigned phase is implemented, tested and verified: known-gap closure (B1–B3), real
table-driven packet routing (C), distinct throughput/goodput definitions (D), project import
(E1), experiment export (E2), circuit switching (E3), honest scope review (E4), UI system work
(F), accessibility + responsive audits (G), engineering hardening (H) and documentation (I).

Why not "complete, no outstanding work":

1. ~~**Phase F was executed at the design-system level, not as a per-workspace visual
   redesign.**~~ **Superseded by the residual pass (`e04054a`).** Phase F itself (`6f5265e`)
   was system-level: tokens, typography, focus rings, reduced motion, gradients/emoji removal,
   canvas keyboard editing. The residual pass then did the per-workspace interior work:
   9 of the 10 workspace interiors were individually corrected (Routing Studio, Addressing &
   NAT, Simulation & Events, Algorithm Studio + its three sub-studios, Transport Layer,
   Application Layer + its five sub-studios, QoS Performance, Batch Experiments, Topology
   Canvas) along with 12 shared panels (timeline, inspector, visualization) — titles aligned
   with the sidebar, decorative badges removed, one accent for actions, label casing unified,
   the Routing rules LaTeX replaced, nested cards flattened, endpoint fields turned into node
   selects, and the canvas chrome (device palette, controls, minimap, attribution) rebuilt.
   Circuit Switching was not restyled because it was created in E3 already conforming to the
   system — so "every workspace fully redesigned" would overclaim just as "tokens only"
   now underclaims. Evidence: `git show --stat e04054a` (30 component files) and the
   before/after screenshot pairs for 18 views.
2. **Some hardening items remain open by choice** (no authentication, permissive CORS, no rate
   limiting, single-threaded `HTTPServer`) — mitigated by the preserved loopback-only binding
   and now documented as such (handoff §14.8).
3. **No packaging/CI artifacts beyond the workflow** (no tags, no Python lockfile) — documented
   (handoff §14.9).

Everything else in the mission is closed with green evidence, including the previously broken
cold-start Playwright path.

---

## 2. Git state

| Item | Value |
|---|---|
| Branch | `arena/541edc3e-cn-project` (pushed to `origin`, clean tree at delivery) |
| Commits authored this effort | **18** (`786abb6` … final docs/metadata commit), linear on top of the docs baseline |
| `main` | untouched at `d213648`; obsolete `arena/5d41fe31-cn-project` never used |
| Large artifacts | none committed; all test output ephemeral |

**Correction to this report's first edition:** the header originally claimed `42092dd` as the
"final, pushed" commit. That was the last *implementation* commit of Phases A–I; this report was
delivered **as** commit `9d31c85` (the child of `42092dd`). A later residual pass added further
commits; its state is recorded in the Addendum so the git history is never restated inaccurately.

| SHA | Subject |
|---|---|
| `786abb6` | fix: correct the Playwright cold-start harness and the documented Python setup (B1, B2) |
| `5209d8c` | feat: table-driven packet forwarding with TTL, loop guards and explicit drops (Phase C, 18 files, +924/−156) |
| `0880da5` | feat: define throughput and goodput as distinct, documented QoS quantities (Phase D, 13 files, +504/−19) |
| `9f28fd7` | feat: circuit switching as a dedicated educational model and workspace (E3, 11 files, +1307) |
| `264664d` | feat: validated project import with confirmation and full state reset (E1, 7 files, +519) |
| `c297d14` | feat: experiment result exports (JSON + CSV) with python-tools compatibility (E2, 5 files, +676) |
| `d769fa2` | docs: honest implementation scope — implemented, partial and illustrative claims (E4) |
| `6f5265e` | feat: canvas keyboard editing, reduced-motion support, extended a11y/responsive audits (F, G) |
| `70e3425` | feat: request-body hardening, bundle code splitting, and a full CI gate (H) |
| `42092dd` | docs: reconcile every document with the shipped code (Phase I) |
| `9d31c85` | docs: final engineering report with full verification matrix (this document's delivery commit) |
| `e04054a` | residual: dual-algorithm live forwarding, keyboard connect workflow, per-workspace UI redesign (**implementation snapshot** for the residual pass) |
| `bc630a1` | docs: reconcile report, handoff and guides with the residual pass; refresh stale test expectations |
| `9d90753` | ci: persist vitest junit output as an artifact when the unit gate fails |
| `0823a4d` | ci: run the gates on Node 22.22.2 (jsdom 30 cannot initialise on Node 20) — **CI-fix snapshot**, all three jobs green |
| `ee8d304` | docs: final counts, Phase F reassessment and the residual/CI addendum (this report's §9) |
| `1390345` | **manual acceptance audit commit** — the running application was exercised on this commit; P1 dialog reset, P2 stale results and P2 320 px canvas fixed; `FINAL_MANUAL_ACCEPTANCE_AUDIT.md` + 63 screenshots in `audit-evidence/` |
| (final) | documentation/metadata-only cleanup (this edit): count reconciliation + accurate Node engine range. **No application-behavior change and no new manual acceptance run** — the manual record applies to `1390345` |

---

## 3. Implemented work by area

### B — known gaps (closed)
- **B1 cold-start Playwright failure.** Option 1 executed: `VITE_NETSIM_API_URL` removed from
  `playwright.config.ts` `webServer` env (kept `NETSIM_API_TARGET`); test 2b untouched. Both
  paths verified: cold `npx playwright test` (nothing listening) → 25 passed at closure (today:
27 — see §5); reuse-server runs
  → same.
- **B2 README dependency gap.** Quickstart and TESTING install
  `pip install -r python-tools/requirements.txt`; explained why it is needed for the tool tests
  and mypy.
- **B3 re-regression of previously repaired defects** (exact selections re-run today):
  Hamming 4 passed · app-event serialization (EventContract 5 passed + Python serialization
  1 passed) · NAT normalization/isolation 11 passed · fault validation/execution 17 passed ·
  link provisioning/undo/redo 6 passed · TCP congestion avoidance 9 passed · queue
  overflow/loss accounting 14 passed · experiment validation 31 passed · export schema
  10 passed · backend-offline handling (apiClient 9 passed + Playwright tests 2 and 2b).

### C — real packet routing (closed, `5209d8c`; policy widened in the residual pass)
The first-available-link heuristic is gone. Each hop resolves the next hop from the routing
graph computed by the **selected algorithm/metric** (Dijkstra link-state or Bellman-Ford DV;
default hop count, also `latency`/`bandwidth` via `set_forwarding_policy`). *Residual-pass note:
at `5209d8c` the live path resolved with Dijkstra only while `set_forwarding_policy` accepted only
`dijkstra` — the Bellman-Ford half of this claim applied to the routing-table APIs. As of `e04054a`
`find_path` dispatches on the active algorithm with an identical deterministic tie-break and
`set_forwarding_policy` accepts `dijkstra` and `bellman_ford`, so the claim is true for the live
path as written.* Enforced TTL/hop
limit (explicit drop `dropped_ttl_expired`), loop guard, unreachable = drop (`dropped_no_route`),
deterministic tie-break per seed, exactly-once drop accounting, and alternate-path delivery
after a link-down fault. Pinned by `python/tests/test_forwarding.py` (direct route, intermediate
router, multi-path determinism, mid-flight fault reroute, disconnection, loop-prone topology,
restore, malformed policy API) plus golden parity.

### D — throughput vs goodput (closed, `0880da5`)
- **Throughput** = gross wire rate at a documented boundary (headers + payload, including
  retransmissions): engine boundary = final delivery; transport boundary = sender output.
- **Goodput** = unique delivered application payload rate (retransmissions and headers excluded).
- New accounting fields (`retransmitted_payload_bytes`, `header_bytes_sent`, `wire_bytes_sent`,
  `throughput_bytes_counted`, `goodput_payload_bytes`, `bytes_payload_delivered`) threaded
  Python → DTOs → test double → UI labels; hand-calculated regression anchors in
  `python/tests/test_qos_definitions.py` (e.g. TCP 1×1000 B/2 s: 4000 wire vs 3840 goodput bps;
  live ratio 0.96).

### E — production capabilities
- **E1 Project import (`264664d`):** navbar **Import JSON** (.netsim/JSON), 5 MB client cap,
  accessible confirmation dialog (replacement warning) before anything is sent; server
  validates first (JSON shape, **explicit schema-version check — version 1 only**, duplicate
  node/link ids, dangling link references) so a rejected import leaves the project untouched;
  success toast only after the server ack; import resets engine, NAT and circuit state. Tests:
  9 service (`test_project_io.py`) + 7 UI (`ProjectImport.test.tsx`).
- **E2 Experiment export (`c297d14`):** **Export JSON** = verbatim backend result (consumed
  unchanged by `python-tools/analyze_results.py` and `plot_metrics.py` — drift guard
  `test_ui_export_schema.py`); **Export CSV** = tidy tables with units in column names,
  per-run rows (seed + metrics) and per-point aggregate rows (run count, seed list, stddev/
  min/max where the contract defines them), empty cells where values do not apply; comparison
  CSV carries scenario identities, both measurements, raw deltas and percentage shifts (empty
  when undefined); filenames identify kind/name/timestamp; aria-live success/failure feedback.
- **E3 Circuit switching (`9f28fd7`):** implemented as a clearly scoped **educational
  admission-control model** (`python/netsim/switching/circuit.py`) — setup resolves the same
  authoritative routed path used for live forwarding and reserves the requested rate on every
  link (all-or-nothing); blocked requests return precise reasons and leave no partial state;
  teardown releases capacity; per-link reserved/available/utilisation + acceptance/blocking
  metrics; topology mutations and project create/import release state. API:
  `request_circuit` / `teardown_circuit` / `get_circuit_state`. Dedicated **Circuit Switching**
  workspace (10th). Tests: 10 service + 5 component.
- **E4 Honest scope review (`d769fa2`):** README “Implementation scope” table distinguishing
  **Implemented / Partial / Illustrative** for every user-visible area (IPv6 text-level only;
  MAC identifiers without learning/ARP; NAT NAPT model boundaries; sliding-window time-step
  model; educational TCP — no SACK/scaling/delayed ACKs; illustrative application models);
  scope notes in USER_GUIDE at each feature; per-section Status lines in ALGORITHMS (§16 now
  describes the real circuit model); exact project title restored in README and
  `index.html`; historical evidence (QUALITY_AUDIT_REPORT) preserved with a banner, not rewritten.

### F — UI system
Phase F (`6f5265e`): global tokens + typography stacks; `:focus-visible` ring;
`prefers-reduced-motion` support; gradient/emoji free; topology canvas: arrow-key nudge
(10 px / Shift 40 px), optional 10 px snap-to-grid toggle, `?` keyboard-help dialog, existing
Undo/Redo/Delete retained and listed; toasts announce as `role=status`/`alert`. Test ids
preserved everywhere (`data-testid` hooks unchanged except additions).

Residual pass (`e04054a`) — per-workspace interior work on 9 of 10 workspaces plus 12 shared
panels (precise list in §1.1): titles match sidebar labels; jargon badges removed; a single
brand accent for actions/tabs; label casing unified; Routing rules rendered as plain text
(was raw LaTeX); a Live-forwarding-policy panel added to Routing Studio; Simulation & Events
gained a workspace header and a correctly wrapped filter grid (6 columns inside a 380 px
sidebar were colliding); Transport/Application sub-studio tabs moved to their own rows;
endpoint fields became node selects; the DNS/FTP/HTTP/SNMP nested concept cards became
functional preset toolbars; QoS nested mini-cards flattened to definition grids; the device
palette moved to a bottom strip (no more overlap with nodes); React Flow controls, minimap and
attribution restyled to the canvas chrome. Circuit Switching unchanged — already conforming.

### G — accessibility & responsive
- axe-core (WCAG 2.0/2.1 A+AA tags) over **10 workspaces, 24 sub-views** (now incl. Circuit
  Switching and TCP vs UDP Comparison) **plus dialogs and transient states** (keyboard-help
  overlay, import confirmation dialog, error toast): **3 passed**. The audit found 7 real
  contrast failures in the new workspace; fixed and re-audited green.
- Horizontal overflow test spans **320 / 375 / 768 / 1024 / 1280 / 1440** across all 10
  workspaces: no unintended overflow (≤1 px tolerance) at any width.

### H — engineering quality
- **Contracts:** Python serializer → TS DTOs → `api.ts` → `testDouble` kept in step through every
  phase; api.ts ↔ testDouble command sets are identical (63/63, script-verified); server accepts
  64 commands — the one extra (`calculate_simple_checksum`) is a legacy diagnostic the UI
  deliberately does not expose.
- **testDouble cannot leak:** production bundle contains only the inert rejecting stub
  (0.14 kB) — verified locally and in CI (`grep` gate).
- **Code splitting:** vendor chunks — app ≈ 375 kB (was 1115 kB single chunk), vendor-charts
  366 kB, vendor-react 143 kB, vendor 134 kB, vendor-flow 125 kB (gzip: 68/95/46/43/40 kB).
- **CI:** `.github/workflows/ci.yml` — three jobs: Python (engine + tool tests, ruff lint,
  format check, mypy), front-end (tsc, vitest, build, double-free bundle check), browser e2e
  (functional + a11y from cold start).
- **Request hardening:** 5 MiB body cap (structured 413 + bounded drain), malformed/negative
  `Content-Length` → structured 400, malformed JSON / non-object / invalid UTF-8 → structured
  400 without tracebacks (`test_request_limits.py`); loopback-only binding preserved.

### I — documentation
README (title, scope table, command surface incl. circuit commands, verification matrix, CI),
USER_GUIDE (10 workspaces, import workflow, export formats, scope notes), ALGORITHMS (status
convention + per-section status), ARCHITECTURE (switching module, export module, dialog),
TESTING (inventory of every suite, CI ladder), NETSIM_PROJECT_HANDOFF (§14 status rollup with
per-defect resolutions and SHAs, history preserved), QUALITY_AUDIT_REPORT (historical banner).

---

## 4. Defect closure (handoff §14)

| § | Defect | Status | Evidence |
|---|---|---|---|
| 14.1 | Cold-start Playwright failure | **Resolved** (`786abb6`, option 1) | cold `npx playwright test` → 25 passed at closure; re-verified in the residual pass at 27 (24 functional + 3 a11y) |
| 14.2 | README dependency gap | **Resolved** (`786abb6`) | quickstart installs `python-tools/requirements.txt` |
| 14.3 | Heuristic forwarding / no fault reroute | **Resolved** (`5209d8c`) | `tests/test_forwarding.py`, golden parity |
| 14.4 | Goodput == throughput | **Resolved** (`0880da5`) | `tests/test_qos_definitions.py`, live ratio 0.96 |
| 14.5 | Per-engine determinism only | By design | documented claim boundary |
| 14.6 | ALGORITHMS described nonexistent features | **Resolved** (`9f28fd7`, `d769fa2`) | circuit model implemented; §16 rewritten to match |
| 14.7 | Source-tree navigation traps | By design | documented; shim kept |
| 14.8 | Server hardening gaps | **Partially resolved** (`70e3425`) | size cap + structured rejections; auth/rate-limit/CORS/threading still open |
| 14.9 | Build/packaging/CI gaps | **Partially resolved** (`70e3425`) | CI workflow + code splitting; tags/packaging/lockfile still open |
| 14.10 | Test double parallel implementation | Maintained | drift guards + 63/63 command-set check |
| 14.11 | Non-failure observations | Chunk warning gone | code splitting |
| 14.12 | Scope limits by design | **Documented** (`d769fa2`) | README scope table |

---

## 5. Verification matrix (2026-10-16, this branch)

| # | Command | Result | Exit |
|---|---|---|---|
| 1 | `.venv/bin/python -m pytest python/tests -q` | **217 passed** | 0 |
| 2 | `.venv/bin/pytest python-tools/tests -q` | **83 passed** | 0 |
| 3 | `.venv/bin/ruff check .` | clean (80 files) | 0 |
| 4 | `.venv/bin/ruff format --check python/ python-tools/` | all formatted | 0 |
| 5 | `.venv/bin/mypy` | clean, 67 files, no ignores | 0 |
| 6 | `npx tsc --noEmit` | clean | 0 |
| 7 | `npx vitest run` | **124 passed, 11 skipped** (live suite opt-in; 123 at the residual-pass snapshot, +1 dialog-poll regression test added by the manual acceptance audit) | 0 |
| 8 | `npm run build` | succeeds; split chunks as above | 0 |
| 9 | `NETSIM_LIVE_API=1 npx vitest run src/integration` | **11 passed** (real service) | 0 |
| 10 | `npx playwright test e2e/netsim.spec.ts` (**cold start**, nothing listening) | **24 passed** (functional incl. keyboard connect workflow) | 0 |
| 11 | `npx playwright test e2e/a11y.spec.ts` (standalone) | **3 passed** (incl. Connect dialog audit) | 0 |
| 12 | `npm ci` then the bundle guard (`! grep "not implemented in mock mode" dist/assets/`; `grep "No simulation service is available for command" dist/assets/`) | clean install; guard passes both conditions | 0 |

Local matrix re-executed 2026-10-16 after the Node/CI fix and the test-22 readiness fix;
counts 217/83/124(+11)/11/24/3 supersede the earlier figures 211/83/115(+11)/11/22(+3)/3
quoted in the first edition of this report (124 = 123 residual-pass + 1 manual-audit regression
test; see FINAL_MANUAL_ACCEPTANCE_AUDIT.md §7 for the post-audit regression run). Historical baseline counts (154/80/93/24) remain
superseded as before.

**Local vs GitHub Actions:** the table above was executed in this sandbox (Python 3.11 venv,
Node v22.22.3, substituted Chromium — see note). GitHub Actions on GitHub-hosted runners
(ubuntu-latest, Node 22.22.2, stock Playwright Chromium) is reported separately in §9.4; a
gate is only counted green there if its job actually passed.

Historical counts (154/80/93/24) are superseded; they were baseline measurements, not targets.

**Browser-environment note (exact, reproducible):** this sandbox blocks Playwright's browser
CDN (`npx playwright install chromium` → `Download failure, code=1`). The suites were therefore
run with the Chromium **153.0.8010.0** headless shell extracted from the
`@sparticuz/chromium@153.0.0` npm tarball (npm registry is reachable), placed at the path
Playwright 1.63 expects (`~/.cache/ms-playwright/chromium_headless_shell-1243/…`) with its
bundled NSS libs on `LD_LIBRARY_PATH`. On GitHub-hosted runners CI installs stock Playwright
Chromium (`npx playwright install --with-deps chromium`) and needs none of this.

---

## 6. UI review (viewports)

| Width | Result |
|---|---|
| 320 px | all 10 workspaces: no unintended horizontal overflow |
| 375 px | same |
| 768 px | same |
| 1024 px | same |
| 1280 px | same |
| 1440 px | same |

Accessibility: axe-core A/AA across 10 workspaces + 24 sub-views + dialogs/transients —
zero violations after fixing 7 slate-500 contrast failures the first audit found in the new
Circuit Switching workspace. Keyboard: visible `:focus-visible` ring everywhere, canvas
shortcuts (Undo/Redo/Delete/arrows/`?`), dialog focus management (initial focus, Escape, focus
return), live regions on toasts and export feedback, reduced-motion honored.

---

## 7. Outstanding limitations (honest)

1. ~~Legacy workspace interiors were standardized at the token level but not individually
   redesigned.~~ **Resolved in the residual pass** (`e04054a`, §3F/§1.1): interiors were
   individually corrected with before/after evidence. What remains true: this is a restrained
   refresh of 9 interiors, not a ground-up visual redesign of every panel, and two workspaces
   (Circuit Switching, and the topology inspector) needed no interior work by evidence, not
   neglect.
2. Server: no authentication, `Access-Control-Allow-Origin: *`, no rate limiting, single-threaded
   `HTTPServer` — safe only because it binds `127.0.0.1` (do not expose without real controls).
3. No release tags/packaging; no Python lockfile (CI pins via latest compatible).
4. Model scope limits (by design, now documented): IPv6 is text-level; MACs are identifiers
   (no learning/ARP); flow-control studios are receding-window teaching models; TCP lacks
   SACK/window scaling/delayed ACKs; circuit switching is an admission-control model without
   signalling protocols.
5. Determinism is per-engine (seeded CPython `random`), not bit-compatible with the removed
   Rust engine; changing a loss probability of 0 → ε reshuffles the RNG stream (documented).
6. `calculate_simple_checksum` exists on the server but is not exposed in the UI (legacy helper).
7. Live-integration run logs React `act(...)` noise (tests still pass 11/11) — test hygiene, not
   a product defect.

---

## 8. How to run

```bash
# Python service (authoritative engine) — terminal 1
python3 -m venv .venv && source .venv/bin/activate
pip install pytest ruff mypy
pip install -r python-tools/requirements.txt   # matplotlib for the tools + mypy gate
python python/netsim/server.py 8765

# Front-end — terminal 2 (Node 22.22.2+ required; see package.json engines)
npm ci
npm run dev        # http://localhost:1420

# Verification gate (all green on this branch)
.venv/bin/python -m pytest python/tests -q          # 217
.venv/bin/pytest python-tools/tests -q              # 83
.venv/bin/ruff check . && .venv/bin/ruff format --check python/ python-tools/
.venv/bin/mypy
npx tsc --noEmit
npx vitest run                                      # 124 (+11 live, skipped)
npm run build
NETSIM_LIVE_API=1 npx vitest run src/integration    # 11 (service must run)
npx playwright test e2e/netsim.spec.ts              # 24 (starts both servers itself)
npx playwright test e2e/a11y.spec.ts                # 3
npx playwright test                                 # 27 (both suites)
```

CI runs the same gate automatically (`.github/workflows/ci.yml`).

---

*Report authored 2026-10-16 on `arena/541edc3e-cn-project`. Sections 1–8 record the Phases A–I
effort whose last implementation commit is `42092dd`; the report itself was delivered as `9d31c85`.
Every number above is from a command executed in this workspace; nothing is inferred from code
inspection unless explicitly labelled as such. The residual pass, the CI runtime fix and the
final verification follow in the Addendum.*

---

## 9. Addendum — residual pass, CI runtime fix, final verification (2026-10-16)

The "final residual work and acceptance pass" ran after this report's first delivery. It had
four goals: finish the UI redesign of the workspace interiors, add a keyboard-accessible
topology connect workflow, resolve the routing-policy discrepancy, and close the remaining CI
failure with a real full verification.

### 9.1 Residual work (implementation snapshot `e04054a`, docs `bc630a1`)

- **Routing policy (was a discrepancy).** At `5209d8c` the live packet path resolved with
  Dijkstra only while `set_forwarding_policy` accepted only `dijkstra` — the "Dijkstra or
  Bellman-Ford" claim held for routing tables only. Now `RoutingGraph.find_path` dispatches
  both algorithms with an identical deterministic tie-break, `SimulationEngine.resolve_forwarding`
  follows the active `forwarding_algorithm`, and `set_forwarding_policy` accepts `dijkstra` and
  `bellman_ford` (everything else — including `ospf` — still rejected with 400). Pinned by
  all-pairs parity tests (every metric, incl. an equal-cost tie topology), policy round-trip
  tests, and identical live delivery under both policies (6 new tests in `test_forwarding.py`).
  The Routing Studio exposes the policy (algorithm + metric) in a Live-forwarding-policy panel.
- **Keyboard topology workflow (new).** Connect nodes without a pointer: **C** or the Connect
  toolbar button opens a modal (source/target node selects), validates incompatible choices
  before any request, shows authoritative `add_link` errors inline, cancels with Escape/Cancel,
  traps focus and restores it to the trigger. Canvas nodes are focusable (Enter/Space selects).
  No second frontend topology model: every mutation goes through the Python API. Pinned by
  8 component tests (`ConnectWorkflow.test.tsx`) and 2 Playwright regressions (workflow,
  incompatible/duplicate handling, backend errors, focus, cancellation).
- **Per-workspace interior redesign.** Precise scope in §1.1/§3F: 9 of 10 interiors + 12 shared
  panels, evidenced by `git show --stat e04054a` and before/after screenshots of 18 views
  (`before-*.png` / `after-*.png` captured at 1440×900).
- **Docs reconciliation (P4).** This report's git-state claims corrected (first edition named
  `42092dd` as its own delivery commit — it was delivered as `9d31c85`); handoff "nine
  workspaces" count fixed in four places; `set_forwarding_policy` added to the command table;
  stale a11y scope comment fixed (test 3 does audit dialogs/transients — and now also audits
  the Connect dialog); README a11y row no longer over-claims; USER_GUIDE gained the keyboard
  workflow. Historical audit evidence (old test results, QUALITY_AUDIT_REPORT) untouched.

### 9.2 CI runtime compatibility — the last failing gate

Run `38920763705` failed its Front-end unit step while the same tree passed locally. Root cause,
from the job's installed tree: CI pinned **Node 20.20.2**, but jsdom 30 / `@asamuzakjp/css-color` 7 /
`dom-selector` / `w3c-xmlserializer` require `^22.22.2 || ^24.15.0 || >=26.0.0`, `undici` 8
requires `>=22.19.0`, and `@testing-library/jest-dom` 7 requires `>=22`. Vitest died during jsdom
environment initialisation (`webidl.util.markAsUncloneable is not a function`) before any test
body ran — 17 "unhandled errors" were 17 test environments failing to boot, not 17 application
test failures. Fix (`0823a4d`): both `actions/setup-node` steps pin **22.22.2** — verified to
satisfy every `engines.node` in the complete installed tree (highest floor on the 22.x line);
`package.json` originally declared `engines.node >=22.22.2`; a metadata audit of all 170
  engine-bearing packages later tightened this to `^22.22.2` — Node 23.x is rejected by 10
  installed packages and 25.x by 4 (the jsdom family admits only `^22.22.2 || ^24.15.0 ||
  >=26.0.0`), while 24.15+/26+ satisfy the metadata but were never exercised here. Only
  22.22.2 (CI) and 22.22.3 (local) are verified.
No dependency upgrades; no test bypasses. A cold `npm ci` + full local matrix was re-run on the
corrected environment (§5, §9.3).

### 9.3 Final local verification (2026-10-16, this workspace, after all fixes)

| Gate | Result | Exit |
|---|---|---|
| `npm ci` (clean install) | 0 vulnerabilities blocking; clean install | 0 |
| `npx tsc --noEmit` | clean | 0 |
| `npx vitest run` | **124 passed, 11 skipped** (135 incl. 9 ConnectWorkflow tests — the 9th is the dialog-poll regression test from the manual audit) | 0 |
| `npm run build` | succeeds (largest chunk 374 kB index / 366 kB charts) | 0 |
| bundle guard (test double absent from `dist/`) | both conditions pass | 0 |
| `pytest python/tests -q` | **217 passed** (211 + 6 routing-policy tests) | 0 |
| `pytest python-tools/tests -q` | **83 passed** | 0 |
| `ruff check .` / `ruff format --check` | clean / 80 files formatted | 0 |
| `mypy` | clean, 67 files | 0 |
| `NETSIM_LIVE_API=1 npx vitest run src/integration` | **11 passed** | 0 |
| `npx playwright test e2e/netsim.spec.ts` (cold start) | **24 passed** (run twice, consecutive) | 0 |
| `npx playwright test e2e/a11y.spec.ts` | **3 passed** (incl. Connect dialog audit) | 0 |

### 9.4 GitHub Actions (GitHub-hosted runners; distinct from §9.3)

| Run | Commit | Python | Front-end | Browser e2e | Note |
|---|---|---|---|---|---|
| [38919904749](https://github.com/lostpilot404/CN-Project/actions/runs/38919904749) | `bc630a1` | ✓ | ✗ | ✓ | Front-end unit step failed on Node 20 runtime incompatibility (§9.2) |
| [38920763705](https://github.com/lostpilot404/CN-Project/actions/runs/38920763705) | `9d90753` | ✓ | ✗ | ✓ | Same failure; junit artifact retained |
| [38926068557](https://github.com/lostpilot404/CN-Project/actions/runs/38926068557) | `0823a4d` | ✓ (34s) | ✓ (50s) | ✓ (1m54s) | **All three jobs green** after the Node 22.22.2 pin |
| [38927210571](https://github.com/lostpilot404/CN-Project/actions/runs/38927210571) | `ee8d304` | ✓ (30s) | ✓ (44s) | ✓ (1m48s) | All three jobs green on the addendum commit |
| [38937799285](https://github.com/lostpilot404/CN-Project/actions/runs/38937799285) | `1390345` | ✓ (23s) | ✓ (51s) | ✓ (1m59s) | **All three jobs green on the manual-audit commit** |

All runs are `pull_request` runs on [PR #2](https://github.com/lostpilot404/CN-Project/pull/2)
(draft, CI verification only — `main` untouched and unmerged). GitHub-hosted e2e uses stock
Playwright Chromium — the sandbox browser substitution (§5 note) does not apply there. The
final documentation/metadata commit is expected to mirror `1390345`'s result (no code change);
its run is the latest on PR #2.

### 9.5 Residual-pass commit trail

| SHA | Role |
|---|---|
| `e04054a` | implementation snapshot: P1/P2/P3 (redesign, keyboard workflow, routing policy) |
| `bc630a1` | docs reconciliation + stale test-expectation refresh |
| `9d90753` | CI diagnostics (junit artifact on unit-gate failure) |
| `0823a4d` | CI runtime fix (Node 22.22.2) + test-22 readiness fix — CI green here |
| `ee8d304` | this addendum, count reconciliation (217/123/27 at the time), Phase F reassessment |
| `1390345` | **manual acceptance audit** — application exercised here (record + evidence); P1/P2 fixes; counts become 217/124/27 |
| (final) | documentation/metadata-only: count + engine-range reconciliation; no behavior change, no new manual run |

### 9.6 Unresolved / unverified behaviour (explicit)

- The UI redesign is a restrained refresh of the interiors listed in §3F, verified visually at
  1440×900 (18 before/after view captures) and structurally at 320–1440 px (e2e test 21); it is
  not a ground-up redesign of every panel, and no pixel-level acceptance suite exists.
- Model-scope limits (§7.4–7.6) are unchanged: IPv6 text-level, MACs as identifiers, TCP without
  SACK/window scaling, circuit switching as admission control only.
- GitHub Actions results in §9.4 cover the three CI jobs; nothing else runs remotely (no
  coverage upload, no matrix across OS/Node versions).
- Disclosed residual P3 items from the manual acceptance audit (record: FINAL_MANUAL_ACCEPTANCE_AUDIT.md
  §4): React Flow attribution overlaps the canvas toolbar at exactly 320 px; one unexplained,
  non-reproduced prefix-slider observation; `add_node` with an unknown type key silently defaults
  to `pc` (lenient API default). None affects the verified workflows.
- The manual acceptance audit exercised the running application on `1390345`; the final
  documentation/metadata commit did not trigger a new manual run (no behavior changed).
