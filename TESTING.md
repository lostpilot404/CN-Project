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
Front-end unit/component     rendering, state, error and empty states  src/*.test.ts
        ↓
Front-end ↔ service          real HTTP against a running service       src/integration/
        ↓
Browser end-to-end           real Chromium, real service, real UI     e2e/
```

Each layer is independent of the one above it. A lower layer failing is never masked by a higher
layer passing.

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

The API-contract and server tests start the real HTTP service in-process on a loopback port, so
routing, JSON parsing and error mapping are exercised exactly as a browser client would exercise
them — not by calling `dispatch_command` directly.

### Conventions

- Tests assert **exact** expected values. No assertion is skipped, relaxed or written to match
  observed output. When an expectation turned out to be wrong, the expectation was corrected
  against the protocol definition or a hand calculation and the reason recorded.
- Determinism is asserted by running an experiment twice with the same seed and comparing results,
  excluding wall-clock fields such as `execution_time_ms`.

## 4. Front-end tests

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

Component tests drive real user interactions (clicks, typing) through the component tree and assert
on rendered output. They run against an in-memory test double, which is aliased away in every
non-test build — see §6.

## 5. Integration against the real service

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

## 6. The test double, and why it cannot leak

`src/lib/testDouble.ts` is an in-memory double used only by the vitest runner so components can be
tested without a service.

It cannot silently replace real results in a shipped build:

1. `vite.config.ts` aliases `@netsim/test-double` to `testDouble.stub.ts` unless `VITEST` is set.
   The stub **rejects every command**.
2. `src/lib/api.ts` only reaches the double when `window` is undefined (i.e. under the test runner).
   In a browser it always calls the Python service, and an unreachable service raises
   `BackendUnavailableError` rather than returning a substitute result.
3. The production bundle was inspected and contains no simulation double — only the rejecting stub.

## 7. Browser end-to-end

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
- layout: no horizontal overflow across 9 workspaces × 3 viewport widths

Tests that assert rendered topology call `resetProject()` first so runs are order-independent.
Selectors are scoped by `data-testid`; where a label also appears in the minimap, the scope is the
canvas node to avoid strict-mode ambiguity.

### Environments that cannot download a browser

If `npx playwright install` fails (`ECONNRESET` against `cdn.playwright.dev`), point Playwright at a
browser you already have:

```bash
NETSIM_CHROMIUM_PATH=/path/to/chromium npx playwright test
```

`README.md` documents a self-contained npm-published Chromium for hosts with no browser at all.
When no browser can be obtained, the suite is **not run** and must be reported as not verified —
selector inspection and TypeScript compilation are not browser tests.

## 8. What is not covered

- **Static type checking of the Python core.** There is no mypy/pyright configuration in this
  repository; Python correctness rests on the test suite and Ruff.
- **Assistive-technology behaviour.** No screen-reader or automated accessibility (axe-style) tooling
  is configured.
- **Rust/Tauri.** That runtime has been removed; there is nothing to test.

## 9. Adding a test

1. Put Python tests in `python/tests/` named `test_*.py`; they are collected automatically.
2. Prefer asserting exact values; if behaviour changed, confirm the new expectation against the
   protocol definition and say so in the test.
3. Guard any defect fix with a regression test that fails before the fix.
4. To assert front-end behaviour against the real engine, add to `src/integration/` and run with
   `NETSIM_LIVE_API=1`.
5. To assert browser behaviour, add to `e2e/netsim.spec.ts` and verify against the API rather than
   trusting the rendered label alone.
