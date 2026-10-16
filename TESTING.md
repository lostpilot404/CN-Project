# NetSim — Testing Strategy

This document describes the test strategy actually implemented in this repository and the commands
that run it. For measured results, see [`QUALITY_AUDIT_REPORT.md`](QUALITY_AUDIT_REPORT.md); for the
architecture under test, see [`README.md`](README.md).

> Earlier revisions of this file described a Rust test strategy. That engine has been removed;
> Python is the sole simulation authority and the layers below are the ones that exist today.

## 1. Objective

Verify that the Python simulation core is correct, deterministic and robust; that the HTTP API
rejects bad input with client errors instead of internal faults; that the front-end renders what the
service actually returns; and that the two work together in a real browser.

## 2. Test layers

```text
Python unit tests            algorithm and model correctness          python/tests/
        ↓
Python API contract tests    hostile input, error mapping, regressions  python/tests/
        ↓
Utility tests                engine→script schema drift, bad input     python-tools/tests/
        ↓
      static typing          mypy over the engine and the utilities    pyproject.toml
        ↓
Front-end unit/component     rendering, state, error and empty states  src/*.test.tsx?
        ↓
Front-end ↔ service          real HTTP against a running service       src/integration/
        ↓
Browser end-to-end           real Chromium, real service, real UI     e2e/netsim.spec.ts
        ↓
Accessibility audit          axe-core over every workspace + sub-view e2e/a11y.spec.ts
```

Each layer is independent of the one above it. A lower layer failing is never masked by a higher
layer passing.

Continuous integration (`.github/workflows/ci.yml`) runs this same ladder on every push and pull
request: the Python tests and utility tests with ruff and mypy; the front-end typecheck, unit
tests and a production build (plus a check that the bundle contains only the inert test-double
stub); and both browser suites from a cold start — Playwright's `webServer` starts the Python
service and the dev server itself, which is exactly the cold-start path that must stay green.
CI pins **Node 22.22.2** and `package.json` declares `^22.22.2` (22.x LTS, 22.22.2+ within the
22.x line — verified on 22.22.2/22.22.3; other majors are untested and Node 23.x/25.x are
excluded by dependency engine ranges). The jsdom 30 / jest-dom 7 test stack cannot initialise
on Node 20 (`webidl.util.markAsUncloneable is not a function` before any test body runs).

## 3. Python tests

`.venv/bin/python -m pytest python/tests -q`

| File | Focus |
|---|---|
| `test_addressing.py` | IPv4 subnet math, network/broadcast/host counts, VLSM allocation |
| `test_routing.py` | Dijkstra and Bellman-Ford agreement, path reconstruction, disconnected graphs |
| `test_independent_validation.py` | Values derived by hand or from an independent implementation *before* running the code under test — validates the implementation rather than restating it |
| `test_protocol_regressions.py` | Link delay model, sliding window, Go-Back-N, congestion control, determinism. Expectations are hand calculations, so a behaviour change that keeps these green must be arithmetically identical |
| `test_api_contract.py` | Requests through the **real HTTP service**: malformed payloads, nested-object validation, 400 vs 404 vs 500 mapping, state leakage between projects. Each test names the defect it guards |
| `test_parity_golden.py` | Golden values across protocols and application-layer simulations (DNS, HTTP, FTP, SMTP, SNMP) |
| `test_server.py` | Server lifecycle: readiness, port binding, one request per command |
| `test_forwarding.py` | Table-driven per-hop forwarding: direct/multi-hop paths, deterministic tie-breaks, mid-flight link-down reroute, loop-guard protection, TTL and no-route drops, restore; Bellman-Ford/Dijkstra all-pairs path parity under every metric (incl. equal-cost tie-break), forwarding-policy round-trip for both algorithms, identical live delivery under both policies |
| `test_qos_definitions.py` | Hand-calculated throughput vs goodput anchors (TCP/UDP headers, retransmission overhead, delivered/dropped cases, 0-length intervals) |
| `test_circuit_switching.py` | Circuit admission model: setup/reservation, all-or-nothing blocking, competing requests, teardown/reuse, link-down and topology-mutation releases, project resets, malformed requests |
| `test_project_io.py` | Import/export contract: save/load round trips, schema-version rejection, duplicate/dangling identifiers, state resets, rejected imports leave the project intact |
| `test_request_limits.py` | HTTP hardening: request-body cap (413), malformed/negative Content-Length, malformed JSON, non-object bodies, invalid UTF-8 — all structured, no tracebacks |

The API-contract and server tests start the real HTTP service in-process on a loopback port, so
routing, JSON parsing and error mapping are exercised exactly as a browser client would exercise
them — not by calling `dispatch_command` directly.

### Conventions

- Tests assert **exact** expected values. No assertion is skipped, relaxed or written to match
  observed output. When an expectation turned out to be wrong, the expectation was corrected
  against the protocol definition or a hand calculation and the reason recorded.
- Determinism is asserted by running an experiment twice with the same seed and comparing results,
  excluding wall-clock fields such as `execution_time_ms`.

## 4. Utility tests (`python-tools/`)

```bash
.venv/bin/pip install -r python-tools/requirements.txt   # matplotlib: needed by plot_metrics.py
.venv/bin/pytest python-tools/tests -q
```

`python-tools/requirements.txt` is part of the supported test gate, not an optional extra: both the
utility test suite and `mypy` import `plot_metrics.py`, which imports matplotlib. In an environment
without it, ~21 utility tests fail on `ModuleNotFoundError: matplotlib` and mypy reports two errors —
that shape of failure is a setup problem, not a code regression.

| File | Focus |
|---|---|
| `test_analyze_results.py` | sweep-document parsing, missing/extra keys, `n/a` for unmeasurable values, exit codes |
| `test_plot_metrics.py` | strict value handling, PNG output (chunks walked, not offset-guessed), missing-matplotlib path |
| `test_engine_schema.py` | **drift guard** — runs a real sweep through the engine and feeds the result to both tools |
| `test_ui_export_schema.py` | **drift guard** — the UI's JSON export shape is parsed by both tools (including the analyze CLI) |
| `test_cli.py` | both scripts as subprocesses: malformed JSON, wrong types, bad paths, exit codes |

The scripts live in a hyphenated directory, so `conftest.py` loads them by path with
`importlib.util.spec_from_file_location` and puts `python/` on `sys.path` to reach the engine.

Two conventions, both documented in the script docstrings and asserted here: **structural**
problems (bad JSON, wrong shape, unreadable path) exit non-zero with a message naming the offending
field; **value** problems make the analyser print `n/a`, while the plotter is strict — an absent or
null metric is `0.0`, a present but unparseable one is an error.

## 5. Static typing

```bash
.venv/bin/mypy
```

`[tool.mypy]` in `pyproject.toml` enables `check_untyped_defs`, `disallow_any_generics`,
`disallow_untyped_defs`, `no_implicit_optional`, `strict_equality`, `warn_redundant_casts` and
`warn_unused_ignores` over `python/netsim/` and `python-tools/`. `disallow_untyped_defs` is on
because every def in the engine is annotated; the pytest modules are exempted by an explicit
per-module override, since unannotated fixture parameters are conventional in tests.

`warn_unused_ignores` is deliberate: the repository contains **zero** `# type: ignore` comments, so
a new one either has to be justified or it fails the check.

## 6. Front-end tests

```bash
npx tsc --noEmit        # types
npx vitest run          # unit + component
npm run build           # production bundle
```

| File | Focus |
|---|---|
| `src/lib/apiClient.test.ts` | Endpoint resolution order, health probing, retry, `BackendUnavailableError` vs `BackendCommandError` |
| `src/App.test.ts` | Application shell, sidebar/navbar state, backend status reporting |
| `src/Phase*Acceptance.test.ts` | Per-phase acceptance of the workspaces (topology, addressing, datalink, transport, application, experiments) |
| `src/CircuitSwitching.test.tsx` | Circuit Switching workspace: empty states, accepted/blocked results from the service, client-side validation, teardown |
| `src/ProjectImport.test.tsx` | Import workflow: confirmation dialog, oversized files, contract rejections, save/load round trip |
| `src/ExperimentExport.test.tsx` | Result exports: filenames, python-tools JSON schema, CSV columns/units/empty cells, comparison deltas, download feedback |
| `src/ConnectWorkflow.test.tsx` | Keyboard connect workflow: modal semantics, focus management and restoration, validation before any request, inline backend errors, Escape/Cancel cancellation |

Component tests drive real user interactions (clicks, typing) through the component tree and assert
on rendered output. They run against an in-memory test double, which is aliased away in every
non-test build — see §8.

## 7. Integration against the real service

```bash
# terminal 1
.venv/bin/python python/netsim/server.py 8765

# terminal 2
NETSIM_LIVE_API=1 npx vitest run src/integration
```

These tests are **skipped** unless `NETSIM_LIVE_API=1` is set, which is why a plain `npx vitest run`
reports skipped tests. They are not disabled; they require a running service. With the flag set they
talk to the actual Python process over HTTP — no mocks — and assert on real simulation output,
including that the reported authority is `python`.

This distinction matters: a page rendering successfully does not prove its controls work. These
tests confirm request → Python execution → response → rendered result.

## 8. The test double, and why it cannot leak

`src/lib/testDouble.ts` is an in-memory double used only by the vitest runner so components can be
tested without a service.

It cannot silently replace real results in a shipped build:

1. `vite.config.ts` aliases `@netsim/test-double` to `testDouble.stub.ts` unless `VITEST` is set.
   The stub **rejects every command**.
2. `src/lib/api.ts` only reaches the double when `window` is undefined (i.e. under the test runner).
   In a browser it always calls the Python service, and an unreachable service raises
   `BackendUnavailableError` rather than returning a substitute result.
3. The production bundle was inspected and contains no simulation double — only the rejecting stub.

## 9. Browser end-to-end

```bash
npx playwright install chromium
npx playwright test
```

`playwright.config.ts` starts **both** the Python service and the Vite dev server itself, with
`/health` and the dev-server URL as readiness probes, so the suite is self-contained. The tests drive
a real Chromium against the real application and assert on real engine data by cross-checking the UI
against the API:

- startup: no console errors, no failed API requests, version read from the health payload
- topology: add nodes, connect by dragging between handles, verified against `get_project`
- simulation: inject, step, run to completion, virtual clock advances
- packet inspector: five protocol layers compared against `get_packet_details`
- routing tables, subnet/VLSM, Hamming/CRC/checksum, GBN, MAC protocols
- TCP, UDP, congestion window, DNS, QoS counts, sweep reproducibility, A/B delta
- layout: no horizontal overflow across the workspaces at the supported viewport widths

Tests that assert rendered topology call `resetProject()` first so runs are order-independent.
Selectors are scoped by `data-testid`; where a label also appears in the minimap, the scope is the
canvas node to avoid strict-mode ambiguity.

**Restart the dev server before a full run.** `playwright.config.ts` uses
`reuseExistingServer: !CI`, so a Vite process left over from earlier work is reused silently. A dev
server that has been running for a long time accumulates HMR updates — and a dependency install
after it started leaves its optimizer state stale — which makes page loads unreliable and can fail
the startup tests for reasons that have nothing to do with the application. Stop the old server,
start a fresh one, then run the suite. (The same applies to the Python service: the browser tests
talk to whatever process is already listening on 8765.)

### Accessibility audit

```bash
npx playwright test e2e/a11y.spec.ts
```

`e2e/a11y.spec.ts` runs axe-core (via `@axe-core/playwright`) over the real UI and the real
service, tagged `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`. It audits every workspace in the
spec's `WORKSPACES` list and every sub-view in `SUB_VIEWS`, and **fails on a violation of any impact level** — the assertion collects every view's
findings first, so one broken workspace does not hide the others.

What it does *not* establish, and what is therefore still unverified in the report:

- axe analyses the **rendered state**. Hover, focus and active styling is not audited by a tool;
  those colours were checked against the WCAG contrast formula instead.
- Dialogs and transient states are not opened by the audit.
- Automated rules are necessary but not sufficient for WCAG conformance: this suite passing is not
  a claim of conformance, and no manual screen-reader testing is possible in this environment.

### Environments that cannot download a browser

If `npx playwright install` fails (`ECONNRESET` against `cdn.playwright.dev`), point Playwright at a
browser you already have:

```bash
NETSIM_CHROMIUM_PATH=/path/to/chromium npx playwright test
```

`README.md` documents a self-contained npm-published Chromium for hosts with no browser at all.
When no browser can be obtained, the suite is **not run** and must be reported as not verified —
selector inspection and TypeScript compilation are not browser tests.

## 10. What is not covered

- **Manual assistive-technology behaviour.** axe-core runs in the browser suite (§9), but no
  screen reader or keyboard-only walkthrough is possible here, and automated rules cannot certify
  WCAG conformance.
- **Hover/focus/active styling under a tool.** axe audits the rendered state only; those colours
  are verified arithmetically, not automatically.
- **Rust/Tauri.** That runtime has been removed; there is nothing to test.

## 11. Adding a test

1. Put Python tests in `python/tests/` named `test_*.py`; they are collected automatically.
2. Prefer asserting exact values; if behaviour changed, confirm the new expectation against the
   protocol definition and say so in the test.
3. Guard any defect fix with a regression test that fails before the fix.
4. To assert front-end behaviour against the real engine, add to `src/integration/` and run with
   `NETSIM_LIVE_API=1`.
5. To assert browser behaviour, add to `e2e/netsim.spec.ts` and verify against the API rather than
   trusting the rendered label alone.
6. To extend accessibility coverage, add the view to `WORKSPACES` or `SUB_VIEWS` in
   `e2e/a11y.spec.ts`; sub-views nested inside another sub-view need a `via` entry.
