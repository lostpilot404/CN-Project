# Final feature-branch verification and release gate

> **Consolidation note (2026-10-28):** the binary evidence folders referenced below
> (`audit-evidence/`, `evidence/`, `docs/evidence/`) were removed from HEAD when all
> work branches were consolidated into `main` (project-only cleanup). The files remain
> available in git history on the pre-consolidation branch commits merged by that PR.

**Date:** 2026-10-27 (Asia/Calcutta). **Branch:** `arena/fd51edb2-cn-project`.
Evidence is committed alongside the tested implementation. Resolve its containing commit with
`git log -1 --format=%H -- docs/FINAL_VERIFICATION.md`; the final response reports the pushed SHA
and independently checked remote HEAD. A self-referential commit hash is not embedded in this file.

## 1. Repository state established before work

- Branch matched the required feature branch; HEAD was `d213648f3679b9c94b1326cc065d84640f1d5b9d`.
- Dispatch, parameter validation, JSON export/replay and documentation edits were present locally
  as unstaged modifications/untracked additions. The staged diff was empty.
- The branch had no upstream. `git ls-remote --heads origin main arena/fd51edb2-cn-project`
  showed only `main` at `d213648...`; the feature branch did **not** yet exist remotely.
- No prior push was assumed. No branch switch, merge, force push or update to `main` is authorized.
- See [recorded environment/repository checks](evidence/2026-10-27/environment-and-repository.txt).

## 2. Actual browser acceptance

Real **Chromium 153.0.8010.0**, headless, driven by Playwright 1.63.0 on Debian 12, against the
actual Vite frontend and Python HTTP handler. Both were running, bound to `0.0.0.0` on ports
1420 and 8765. No simulation/API responses or browser downloads were mocked. Service uses the
same `NetSimRequestHandler` as the ordinary launcher; only the bind address was supplied externally.
The same-origin `/netsim-api` health route was also checked. External Google font requests were
fulfilled with empty responses to isolate unavailable typography; that is the sole network fixture.

There are **two available experiment download formats, both JSON**: sweep and A/B comparison.
There is no CSV option. All three available targets were exercised with both formats, not merely
one generic API serialization test.

| Target / workflow | Browser-triggered download saved as | Non-empty JSON, correct model/config/seeds/effective input | CLI deterministic replay |
|---|---|---|---|
| network sweep | `browser/network-sweep.json` | Pass | Equal |
| network A/B | `browser/network-comparison.json` | Pass | Equal |
| TCP sweep | `browser/tcp-sweep.json` | Pass | Equal |
| TCP A/B | `browser/tcp-comparison.json` | Pass | Equal |
| UDP sweep | `browser/udp-sweep.json` | Pass | Equal |
| UDP A/B | `browser/udp-comparison.json` | Pass | Equal |

Paths are relative to [evidence/2026-10-27/](evidence/2026-10-27/). Each has a `-replay.json`,
`-verification.json`, a setup `.png` and a `-results.png` showing the calculated outputs. Verification records contain actual bytes, suggested browser
filename, browser version, input values, errors, replay result and excluded fields.
The browser suggested `netsim-sweep.json` / `netsim-comparison.json`; target-specific storage names
avoid collisions. Original files were saved by Playwright's real browser `download` event.

Inputs: all-link bandwidth **1,000,000 / 10,000,000 bps**, seeds **42 / 101**, default three-node
project. Sweeps used **12 packets/segments** per run; A/B used the runner default **10**. Network
duration was **200,000 μs**; disabled transport duration remained at the displayed defaults (50,000
for sweep / 60,000 for A/B) and explicitly is **not** a bulk-transfer cutoff. Each result has four
per-run evidence records. A/B has two named scenarios. Tests matched all effective hop/link
bandwidths, configurations and model labels. Exports were downloaded **after editing the form
label**, confirming snapshots describe the completed run rather than current form state.

All six replays used `examples/replay_experiment.py` on the downloaded file. The entire parsed
result was compared, removing **only the documented top-level `execution_time_ms`** on each side.
Seeds, topology, aggregate/per-run metrics and provenance were not ignored. Every comparison passed.
No console/page errors, failed requests or service HTTP errors occurred in the six export workflows;
warning arrays were empty. Server log review found no internal-error tracebacks. Intentional invalid
DNS/node requests in other regression tests were correctly logged as rejections.

### GBN/SR teaching task

A separate real-browser test selected the existing comparison mode, explicitly entered the report
inputs and ran both models. Both configurations matched except protocol; observed outputs were
GBN **4 retransmissions / 26,200 μs**, SR **1 / 21,100 μs**, **8 completed frames each**.
`gbn-sr-comparison.png` and `gbn-sr-ui-results.json` preserve the screenshot and UI-triggered raw
responses. These are **not studio downloads**: that studio has no download button. No feature was
added to make it appear otherwise.

### Honest coverage boundary

These are automated actions in a real browser session, not a human usability study. Bandwidth
sweep/A-B downloads were browser-exercised for every exposed target; non-bandwidth sweeps were
verified by backend input-wiring tests, not individually exercised in the browser. No fabricated
manual pass or cross-simulator numerical equivalence is claimed.

## 3. Final-source regression results

| Check | Actual result | Log under `evidence/2026-10-27/logs/` |
|---|---|---|
| `.venv/bin/python -m pytest python/tests python-tools/tests -q` | **277 passed** = 197 backend + 80 utilities | `python-tests.txt` |
| `.venv/bin/ruff check .` | Pass | `ruff.txt` |
| `.venv/bin/ruff format --check python/ python-tools/ examples/` | Pass, 74 files | `format.txt` |
| `.venv/bin/mypy` | Pass, 63 source files | `mypy.txt` |
| `npm run typecheck` | Pass | `typecheck.txt` |
| `npm test` | **95 passed, 11 skipped** (opt-in live tests) | `frontend-tests.txt` |
| `npm run test:live` | **11 passed** against actual service | `live-integration.txt` |
| `npx playwright test` (with Chromium/library path environment) | **31 passed** | `browser-tests.txt` |
| `npm run build` | Pass | `build.txt` |

Warnings retained, not hidden: Vite warns about a >500 kB bundle; live jsdom integration emits
React `act(...)` warnings in the intentional offline-state test. Neither is a first-party browser
console error in the verified download flows. No new coverage percentage is claimed.

Initial acceptance attempts found test-harness issues, not hidden passes: browser launch needed
NSPR/NSS shared libraries (Chromium 153 and its library bundle came from `@sparticuz/chromium@153.0.0`,
installed outside the repository; `LD_LIBRARY_PATH=/tmp/al2023/lib` was used); first download test set a label before a preset reset it; comparison
label selector differed from sweep; an old E2E request still used TCP for timed network traffic.
Environment/locators and the stale test target were corrected. The full final suite then passed.
One input-validation defect found during source reconciliation was fixed: A/B seeds now use the
same integer validation as sweeps instead of silently truncating fractions. Four regression cases
cover fractional, NaN, infinite and boolean seeds. The service was restarted and all final gates
were rerun. No simulation algorithm or interface layout was changed during this acceptance pass.

## 4. Packet Tracer and evidence categories

See [the source-backed comparison](PACKET_TRACER_COMPARISON.md), its version/build/OS limitations,
and [source register](evidence/2026-10-27/packet-tracer-sources.md).

- **Implemented and verified:** NetSim browser downloads/replay, supported target dispatch,
  input validation and the matched-loss GBN/SR exercise within recorded scope.
- **Implemented but not manually verified:** individual non-bandwidth browser sweep variants,
  wider topology/input combinations, cross-version/platform replay and human usability.
- **Comparable capability found in Packet Tracer:** topology/packet/event inspection, routing/
  addressing education, saved network scenarios and scheduled-PDU reruns (official documentation).
- **Candidate differentiator requiring further evidence:** NetSim's direct GBN/SR task and compact
  multi-seed experiment/config/metric snapshot workflow relative to a named Packet Tracer build.
- **Unsupported or out of scope:** general-runner application/MAC/flow-control dispatch, transport
  scheduled faults/stochastic BER/loss/timed injection, full device emulation and universal novelty.

## 5. Release decision and remaining limitations

The NetSim browser export/replay gate passes for the recorded six workflows. Packet Tracer is
unavailable here, so the user-authorized documentation fallback is fulfilled, but direct hands-on
comparison remains outstanding. Official sources establish advertised **9.0.1**, not an installed
build. Do **not** declare verified exclusive novelty or unconditional academic readiness.

The supported claim is integration: a Python-authoritative educational environment for selected
algorithms, inspectable state, controlled experiments and reproducible JSON evidence. It is not a
first/unique/superior/faster/more-accurate claim, nor proof of learning improvement.

Model limitations remain: standalone studios are not one full network stack; transport runs bulk
transfers, uses model floors and no stochastic loss inputs; UDP latency/jitter are unavailable,
TCP shared latency is RTT/2; network goodput equals its throughput formula; seed equality does not
prove matched random events after changed ordering; replay CLI records but does not enforce source
fingerprints; bounded model recovery and per-input repeatability do not establish correctness for
all inputs. The observed UDP throughput need not vary with bandwidth even though effective hops do.

## 6. Evidence-to-source binding and repeat commands

[source-manifest.json](evidence/2026-10-27/source-manifest.json) records SHA-256 hashes of the
Python implementation, frontend, tests and replay examples. Export provenance separately fingerprints
the Python engine. The committed evidence and manifest can therefore be checked against the final
checkout without embedding a recursive commit hash. A post-commit browser rerun is performed outside
tracked evidence and checked against these source hashes before the normal feature-branch push.

```sh
# Services: ordinary local commands are in README; acceptance bound the handler to 0.0.0.0.
# Use an installed Chromium path and its library environment if not using Playwright's browser:
NETSIM_CHROMIUM_PATH=/path/to/chromium npx playwright test
# All suite logs and existing evidence should be retained; do not treat a new run as old evidence.
PYTHONPATH=python python3 examples/replay_experiment.py \
  docs/evidence/2026-10-27/browser/tcp-sweep.json > replay.json
```

No binaries, installers, virtualenvs, node_modules or large generated datasets are included.
