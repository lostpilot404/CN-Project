# NetSim Iceberg Audit — Defect Register

Persistent across all six audit sections. Do not delete entries; update status in place.

- **Repository:** `lostpilot404/CN-Project`
- **Audit branch:** `arena/38e9d176-cn-project`
- **Base commit at audit start:** `d737f4fc6d07aece005b7fbe1241d5d6eb5aedbf` (clean working tree, no local changes)
- **Browser-control method actually used:** real Chromium **153.0.8010.0** (Chrome Headless Shell
  from the `@sparticuz/chromium` npm tarball, extracted to `~/.cache/netsim-browser/`, launched with
  its bundled `libnss3`/`libnspr4`/`libnssutil3` via `LD_LIBRARY_PATH`) driven through
  **`playwright-core`** `chromium.launch({ executablePath })`. Playwright's own browser CDN
  (`cdn.playwright.dev`) is blocked in this sandbox, so `npx playwright install chromium` fails;
  the executablePath route is what the repo's `playwright.config.ts` already supports via
  `NETSIM_CHROMIUM_PATH`.
- **Verification legend:** `MANUAL` = exercised in the real browser and observed;
  `BACKEND` = called the Python service directly; `CODE` = code inspection only;
  `INDEPENDENT` = arithmetic recomputed outside the app; `UNVERIFIED` = not exercised.

---

## Summary

| ID | Severity | Title | Workspace | Status |
|----|----------|-------|-----------|--------|
| D-001 | P2 | Engine status indicator never self-recovers after a backend outage | Global / Sidebar | **FIXED + MANUAL re-verified** |
| D-002 | P2 | IPv4 prefix slider swallows increments (bound to the async result, not the request) | Addressing & NAT | **FIXED + MANUAL re-verified** |
| D-003 | P2 | Fault panel silently clamps out-of-range parameters, then reports success | QoS Performance | **FIXED + MANUAL re-verified** |
| D-004 | P3 | QoS notification timer overlap dismisses a newer message early | QoS Performance | **FIXED + MANUAL re-verified** |
| D-005 | **P1** | SECDED is encode-only: a double-bit error is "corrected" into silently wrong data | Algorithm Studio → Error Control → Hamming | **FIXED + MANUAL re-verified** |
| D-006 | **P1** | Published Python regression suite cannot be collected on a clean checkout | Test infrastructure | **FIXED (pre-existing at base commit)** |
| D-007 | P3 | Stale Rust/Tauri references survive in source comments and a test name | Docs / code hygiene | OPEN |
| D-008 | P3 | `hamming_decode` always reported `has_error=True`, including for valid codewords | Python API surface | **FIXED** |
| D-009 | P3 | Hard runtime dependency on `fonts.googleapis.com` | Global | OPEN (environment-dependent) |
| D-010 | P3 | `/health` is probed before every single API command (2× round-trips) | Transport layer | OPEN (performance) |

---

## D-001 — Engine status indicator never self-recovers (P2)

- **Workspace:** global (sidebar `data-testid="engine-status"`)
- **Verification:** MANUAL (real browser, backend killed and restarted mid-session)
- **Reproduction (pre-fix):**
  1. Load the app with the Python service stopped (or stop it after load).
  2. Confirm the indicator reads `OFFLINE`.
  3. Start the Python service; confirm `GET /health` returns 200 from outside the browser.
  4. Wait, without touching the UI.
- **Expected:** the indicator returns to `ONLINE` once the service is reachable again.
- **Observed (pre-fix):** stayed `OFFLINE` for the full 40 s observation window (20 polls at 2 s).
  It flipped to `ONLINE` only after a user action triggered an API call.
- **Root cause:** `src/App.tsx` calls `checkBackendHealth(false)` exactly once on mount, and the
  1 s polling effect is gated on `if (backendStatus !== 'online') return;`. Once offline, nothing
  ever re-probes health, so recovery depends on the user happening to click something.
- **Impact:** a user who opens the UI before starting the service (the documented two-terminal
  workflow, and exactly what happens in a proxied preview) sees a permanent `OFFLINE` and will
  conclude the platform is broken.
- **Fix:** added a recovery re-probe effect in `src/App.tsx` that polls `checkBackendHealth(false)`
  every 3 s while disconnected (and on `visibilitychange`), then refreshes project + simulation
  state when the service answers. `notify=false` is required: passing `true` flips the status to
  `connecting`, which tears the effect down and stops the loop after one attempt.
- **Manual retest:** identical scenario → `after kill pid: null status: OFFLINE`, then
  `backend restarted`, then **idle t+2 s status: ONLINE** with no user interaction.
- **Evidence:** `evidence/final-iceberg-audit/recovery/04-idle-still-offline.png`,
  `04-after-action-online.png` (pre-fix); `04-postfix-idle-recovery.log`,
  `04-idle-recovery-status.png` (post-fix).
- **Regression risk:** low — additive effect, does not alter the online polling path.

## D-002 — Prefix slider swallows increments (P2)

- **Workspace:** Addressing & NAT → IPv4 & CIDR Subnetting
- **Verification:** MANUAL + BACKEND
- **Reproduction (pre-fix):** load the workspace (default `192.168.1.0/24`), focus the
  "Prefix Slider", press ArrowRight twice in quick succession.
- **Expected:** slider at `/26`.
- **Observed (pre-fix):** slider at `/25` — **7 of 8 trials lost an increment**.
- **Root cause:** the `<input type="range">` was a controlled component whose `value` was
  `subnetInfo.prefix_length` — the result of the *last completed* backend calculation — while
  `onChange` only wrote the text field. Two rapid presses therefore both incremented from the same
  stale value (24 → 25 twice).
- **Note on scope:** the displayed results always agreed with the displayed prefix, so this was a
  **lost-input** defect, not a wrong-arithmetic defect. Subnet arithmetic was independently
  verified correct (see Scenario S-ALGO-1).
- **Fix:** `src/components/addressing/AddressingWorkspace.tsx` — added a memoised
  `requestedPrefix` parsed from `ipv4Input` (handles both `/prefix` and dotted-mask forms) and
  bound the slider's `value` and label to it. The result panel still renders only what Python
  returned.
- **Manual retest:** identical zero-gap scenario → **0 of 8 trials lost an increment**; two
  ArrowRight presses from `/24` land on `/26` with broadcast `192.168.1.63` and `62/64` usable,
  matching `calculate_ipv4_subnet('192.168.1.0/26')` exactly.
- **Evidence:** `evidence/final-iceberg-audit/addressing-routing/08-postfix-slider-26.png`.
- **Regression risk:** low.

## D-003 — Fault panel silently clamps parameters then reports success (P2)

- **Workspace:** QoS Performance → Runtime Fault Injection Panel
- **Verification:** MANUAL (request bodies captured in the browser)
- **Reproduction (pre-fix):** select *Bit Error Rate Change*, type `5` into "Error Rate (0.0 – 1.0)",
  click **Schedule Fault Event**.
- **Expected:** an honest rejection — an error rate of 5 is outside the stated 0.0–1.0 range.
- **Observed (pre-fix):** the browser sent `{"type":"bit_error","link_id":"link-1","error_rate":1}`
  and the UI showed **"Fault fault-7781 scheduled successfully at 5000 µs!"**. Typing `-1` sent
  `error_rate: 0` — a **no-op fault** — also with a success toast. Queue capacity `0` and `-7` both
  sent `new_capacity: 1`.
- **Root cause:** `handleScheduleFault` in `src/components/experiments/QosWorkspace.tsx` applied
  `Math.min(1.0, Math.max(0.0, faultParamValue))` and `Math.max(1, Math.round(faultParamValue))`
  *before* sending, so the backend's own validation (which correctly answers 400 — proven by the
  `bandwidth_degradation` case: *"Error: 'bandwidth_degradation' requires 'new_bandwidth_bps' >= 1"*)
  was never reached.
- **Impact:** success reported for a fault that is not the one the user configured, including one
  that does nothing at all. Matches the audit's "unsupported values silently normalized" and
  "false-positive status indicators" categories.
- **Fix:** replaced clamping with explicit range validation that surfaces an honest message and
  sends nothing; in-range values are now forwarded verbatim so Python stays the authority. Also
  extended the scheduled-fault `description` to include the parameter value (it previously omitted
  it entirely, and used `replace('_', ' ')` which only fixed the first underscore).
- **Manual retest:** all 7 invalid inputs (BER 5, BER −1, capacity 0, −7, 2.5, bandwidth 0, −100)
  → **no request sent**, visible message e.g. *"Bit error rate must be between 0.0 and 1.0
  (received 5)"*. All 9 valid inputs → **HTTP 200** with values forwarded verbatim
  (`error_rate: 0.01`, `new_capacity: 8`, `new_bandwidth_bps: 1000000`).
- **Evidence:** `qos-faults/11-clamp.log` (pre-fix bodies), `13-postfix-final.log`,
  `13-postfix-invalid-rejected.png`, `13-postfix-valid-scheduled.png`.
- **Regression risk:** low; previously-accepted valid values still schedule.

## D-004 — QoS notification timer overlap (P3)

- **Workspace:** QoS Performance
- **Verification:** MANUAL (this is what made D-003's messages appear to vanish during retesting)
- **Observed (pre-fix):** each notification scheduled its own `setTimeout(() => setNotification(null), 3500)`
  without cancelling the pending one, so a second action within 3.5 s had its message wiped early
  by the *first* action's timer. An error message could disappear before it was read.
- **Root cause:** missing single-timer guard. `src/App.tsx` already implements exactly this guard
  for its toasts (`toastTimer`), so the pattern was available and inconsistent.
- **Fix:** added a `notifyTimer` ref + `notify(msg, type)` helper in `QosWorkspace.tsx`; all four
  notification sites now route through it, with cleanup on unmount.
- **Manual retest:** every message in the D-003 retest remained readable at 900 ms across rapid
  successive actions.
- **Regression risk:** negligible.

## D-005 — SECDED double-bit errors silently "corrected" into wrong data (P1)

- **Workspace:** Algorithm Studio → Error Control → Hamming Code
- **Verification:** MANUAL (real browser) + BACKEND + INDEPENDENT
- **Reproduction (pre-fix):**
  1. Algorithm Studio → Error Control → Hamming Code, data `1011`, Even Parity, **Encode**.
  2. In "Interactive Error-Bit Injection & Syndrome Correction" — whose own header says
     *"Click any bit below to flip it and test single/double bit error detection"* — flip **two** bits.
- **Expected:** a double-bit error must be **detected and reported uncorrectable** (that is the
  "DED" half of SECDED, which `README.md` line 18 and `docs/user-guide.md` line 122 both advertise).
- **Observed (pre-fix):** a green/amber banner **"ERROR DETECTED & CORRECTED"** reading
  *"Single-bit error detected and corrected at position 6 (1-indexed)."* with
  **CORRECTED CODEWORD: 0100101** and **EXTRACTED DATA: 0101**. The true data is **1011**.
  The backend returned `error_type: "single_bit"`, `is_correctable: true`.
- **Root cause:** `encode_hamming` computes the SECDED overall-parity bit (`overall_parity`,
  `encoded_bits_secded`) and the UI *displays* it, but `verify_and_correct_hamming` implemented
  plain Hamming syndrome decoding only and never consulted an overall-parity bit. The UI seeded its
  tester from `encoded_bits` (the plain 7-bit word), so no P0 bit was ever available to check. Two
  flips simply produce a different nonzero syndrome, which plain SEC decoding then "corrects" into
  a third, wrong codeword.
- **Why the test suite missed it:** `python/tests/test_parity_golden.py::test_parity_07_hamming`
  only asserts the *corrupted* case (`dec.has_error is True`), which passes regardless. No test
  asserted `has_error is False` for a clean codeword, which is what exposed D-008.
- **Fix (backend, `python/netsim/datalink/hamming.py`):** `verify_and_correct_hamming` gained an
  explicit `secded: bool = False` parameter. When true it expects `P0 + codeword` and applies the
  textbook four-case decision table:

  | syndrome | overall parity | diagnosis |
  |---|---|---|
  | `S == 0` | ok | no error |
  | `S == 0` | bad | single error in P0 itself → correctable |
  | `S != 0` | bad | single error at position S → correctable |
  | `S != 0` | ok | **double-bit error → detected, NOT correctable** |

  `secded` defaults to `False`, so plain-Hamming callers and all existing tests keep their prior
  behaviour (plain Hamming genuinely cannot detect doubles — that is information-theoretically
  correct for a SEC code, and is no longer presented as SECDED).
- **Fix (server):** `verify_and_correct_hamming` handler accepts and forwards `secded`.
- **Fix (frontend):** `api.verifyAndCorrectHamming(code, mode, secded)`; the tester is now seeded
  from `encoded_bits_secded`, compares against it, sends `secded: true`, and labels bit 0
  `P0 (SECDED)` with the payload bits labelled `pos 1…7`.
- **Manual retest (identical scenario):** the tester now renders **8** bit buttons
  (`P0 (SECDED)`, `pos 1…pos 7`). Single-bit flip → *"ERROR DETECTED & CORRECTED"*,
  **EXTRACTED DATA: 1011** (correct). Two-bit flip → red **"UNRECOVERABLE MULTIPLE-BIT ERROR"**,
  `is_correctable: false`, `corrected_bits: null`, `extracted_data_bits: null`, message
  *"Double-bit error detected by SECDED and NOT corrected…"*. The UI already had this red state —
  it simply could never be reached before.
- **Evidence:** `algorithms/17-DOUBLE-bit-banner.png` (post-fix), `17-single-bit-banner.png`,
  `18-postfix-secded-tester.png`, `16-double-bit-CLAIMED-corrected.png` (pre-fix),
  `secded.log` / `secded_postfix.log` transcripts.
- **Regression risk:** moderate-low. Additive parameter; 350 Python tests + 126 frontend tests pass.

## D-006 — Python regression suite cannot be collected (P1, pre-existing)

- **Verification:** BACKEND/CLI; **confirmed present at pristine base commit** via `git stash`
- **Reproduction:** on a clean checkout of `d737f4f`, run `.venv/bin/python -m pytest -q`.
- **Expected:** the suite runs (the project publishes it as regression evidence).
- **Observed:** collection aborts —
  `ImportError: cannot import name 'API_PORT' from 'conftest' (/…/python-tools/tests/conftest.py)`,
  `!!!! Interrupted: 1 error during collection !!!!`. **Zero tests executed.**
- **Root cause:** `python/tests/test_request_limits.py` did `from conftest import API_PORT`. Both
  `python/tests/` and `python-tools/tests/` contain a `conftest.py` and neither is a package
  (no `__init__.py`), so under pytest's default `prepend` import mode both directories land on
  `sys.path` and both conftests are importable under the same top-level name `conftest`.
  `python-tools/tests/conftest.py` shadowed `python/tests/conftest.py`.
- **Fix:** added `python/tests/_api_port.py` holding `API_PORT = 8798` as the single source of
  truth (uniquely named, so unambiguous), imported by both `conftest.py` and
  `test_request_limits.py`. No package restructuring and no change to pytest's import mode.
- **Retest:** `.venv/bin/python -m pytest -q` → **350 passed**.
- **Regression risk:** very low.
- **Note:** this defect means every previously published "N tests passing" claim for the Python
  suite was unverifiable from a clean checkout.

## D-007 — Stale Rust/Tauri references (P3, FIXED)

- **Verification:** CODE + grep re-scan (no `tauri`/`rust` tokens remain in `src/` or `python/netsim/`)
- Was: `MacStudio.tsx:53` `// Format persistence object for Tauri DTO`, `App.test.ts:20`
  `describe('Tauri mock API bridge', …)`, `node.py:59` `# Hash matches Rust: …`.
- All three rewritten to describe the current Python/TS reality. The *docs* already handled the
  removal honestly (`docs/architecture.md:223-226` tabulates exactly what was deleted).

## D-008 — `hamming_decode` always reported an error (P3)

- **Verification:** BACKEND
- **Observed:** `hamming_decode('0110011', even_parity=True)` on a **valid** codeword returned
  `has_error=True`.
- **Root cause:** it compared `res.error_type != "no_error"`, but
  `verify_and_correct_hamming` emits `"none"` for the clean case — the string `"no_error"` is never
  produced, so the comparison was always true.
- **Fix:** use `res.has_error` directly; also added `_coerce_parity_mode` so `hamming_encode` /
  `hamming_decode` accept a `ParityMode` explicitly instead of silently treating the truthy string
  enum `ParityMode.ODD` as *even* parity (the footgun that initially misled this audit).
- **Retest:** `has_error=False` on a clean codeword; 350 tests pass.

## D-009 — External font CDN dependency (P3, OPEN)

- **Verification:** MANUAL (browser console + network)
- `index.html:8,10` hard-link `fonts.googleapis.com`. In this sandbox the request fails with
  `net::ERR_CONNECTION_CLOSED`, producing the app's **only** console error and **only** failed
  request on boot. Rendering falls back to `system-ui`, so nothing breaks, but an air-gapped
  classroom gets a blocked external request on every page load.

## D-010 — `/health` probed before every API command (P3, OPEN, performance)

- **Verification:** MANUAL (network capture)
- `apiClient.endpoint()` re-probes `GET /health` on the resolved endpoint for **every** command, so
  a 14 s session with 29 API calls produced 31 `/health` requests — roughly 2× the round-trips.
  Behaviour is correct (it is what makes restart recovery work), but it doubles chatter.

---

## D-011 — Changing Experiment Target silently destroys the user's sweep configuration (P2, FIXED + MANUAL)

- **Verification:** MANUAL (real UI, `s21_clobber.mjs` before / `s24_d011_retest.mjs` after)
- The target `<select>`'s `onChange` was `{ setSweepTarget(v); handleSweepPreset('link_bandwidth'); }`
  and `handleSweepPreset` unconditionally overwrites `sweepName`, `sweepParamType` and
  `sweepValuesStr`. Reproduced live: name "Buffer Sizing Sweep", param `queue_capacity`,
  values `2,4,8,16`, seeds `7` → changing only the target to `tcp` reset the name to
  "Bandwidth Impact Sweep", the parameter to `link_bandwidth` and the values to the bandwidth
  preset; switching back to `network` kept the clobbered state. Consequence: the executed sweep and
  the exported `experiment_name`/filename were not what the user configured.
- **Fix** (`ExperimentsWorkspace.tsx`): the target `onChange` now only sets the target; presets are
  applied from the Variable-Parameter control, which is the input that actually changes validity.
- **Retest:** name/parameter/values/seeds all preserved across tcp→udp→network when the parameter
  remains valid for the new target (Case 1), and reconciled only when genuinely invalid (Case 2,
  see D-013). Evidence `experiments-exports/21-target-clobbers-config.png`,
  `24-d011-d013-postfix.png`.

## D-012 — UDP throughput/completion independent of link bandwidth; reported 1.64 Mbps over a 1 Mbps link (P1, FIXED + MANUAL + TEST)

- **Verification:** MANUAL (real UI sweep, `s22_udp_ui.mjs`) + direct model probes + new regression test
- `simulate_udp` computed `completion_time_us = max(1, curr_time_us)` where `curr_time_us += 5000`
  per datagram, so throughput was `wire_bytes*8 / 5000N` regardless of topology. Per-hop
  `tx_delay = calculate_tx_delay_us(...)` fed only the delivery-event timestamps, i.e. the event
  trace and the reported metrics disagreed. Pre-fix sweep at 1/10/100 Mbps: completion flat at
  20 000 µs, throughput flat at 1 644 800 bps — **1.64× the physical capacity of a 1 Mbps link**
  (4×1028 wire bytes = 32 896 bits cannot cross it in 20 000 µs), while TCP responded normally, so
  the advertised TCP-vs-UDP comparison was systematically biased toward UDP. The experiment *runner*
  was not at fault (the parameter reached the links correctly).
- **Fix** (`python/netsim/transport/udp.py`): track `last_transit_us = max(last_transit_us,
  transit_time)` and set `completion_time_us = max(1, curr_time_us, last_transit_us)`; the 5000 µs
  sender pacing is retained.
- **Retest in the real UI:** UDP mean throughput now 889 081.1 / 1 581 538.5 / 1 638 247.0 bps at
  1/10/100 Mbps (measurement window 37 000 / 20 800 / 20 080 µs) — varies with bandwidth and never
  exceeds the link capacity; TCP 380 082.2 / 522 810.1 / 543 151.8 bps with latency 9 192 → 5 042 µs.
  The apparent inconsistency with a naive 64 000 µs two-hop serialization floor was resolved by
  hand-tracing the loop: the two hops pipeline, so 4 datagrams at 1 Mbps / 1000 µs propagation finish
  at exactly 42 000 µs, now pinned by
  `test_udp_throughput_responds_to_link_bandwidth_and_never_exceeds_it`.
- **Test-side hardening:** `test_udp_service_results_report_headers_in_throughput_only` failed only
  on an exact float `==` of a subtraction of two large floats (identity holds to 1.16e-10; it was
  exactly representable at the old `t=40000`, not at `t=46600`). Switched to `pytest.approx` plus a
  new `assert t > 8*5000` that pins the corrected behaviour — net stronger.
  Evidence `experiments-exports/22-udp-bandwidth-sweep.png`, `22-tcp-bandwidth-sweep.png`,
  `22-udp-tcp-sweep-network.json`.

## D-013 — Variable-Parameter dropdown *displays* one parameter while *submitting* another (P2, FIXED + MANUAL)

- **Verification:** MANUAL (real UI, `s23_mismatch.mjs` before/after)
- The `<select>` renders network-only `<option>`s conditionally
  (`{sweepTarget === 'network' && <option value="queue_capacity">…}`), so after switching to tcp/udp
  React state kept a value with no matching option: the browser **displayed** the first option
  (`link_bandwidth`) while the request **submitted** `{"type":"queue_capacity"}` → HTTP 400
  `Parameter 'queue_capacity' is not supported for target 'tcp'`. The backend rejected honestly and
  the error banner surfaced it (no wrong model ran), but the control lied about what would execute —
  a violation of "displayed labels and properties match submitted values".
- **Fix:** module-scope `NETWORK_ONLY_SWEEP_PARAMS` + `isSweepParamValidForTarget()`; the target
  `onChange` reconciles via the bandwidth preset **only** when the current parameter is genuinely
  unusable for the new target.
- **Retest:** displays `link_bandwidth`, submits `{"type":"link_bandwidth"}`, HTTP 200, no banner.
  Evidence `experiments-exports/23-param-display-vs-submitted.png`.

## D-014 — DNS answers duplicated and response size inflated because the client's zone copy is merged on top of the identical defaults (P2, FIXED + MANUAL)

- **Verification:** MANUAL (real UI, `s27_app.mjs`/`s28_app2.mjs`) + direct model probes
- `simulate_dns` did `zone = get_default_dns_zone(); zone.extend(config.custom_records)`, and the
  browser client sends its **own copy of those same defaults** as `custom_records`
  (`DnsStudio.tsx` `DEFAULT_ZONE_RECORDS`). Every default record therefore existed twice: a single
  A query for `www.example.com` returned **two identical answer records**, and because
  `payload_bytes_received = len(answers) * 32 + 64` the reported response size was inflated
  (128 B instead of 96 B). The `DNS_LOOKUP` event also reported a zone twice the size shown in the
  UI's "Configured Zone Table".
- **Fix** (`python/netsim/application/dns.py`): merge without exact duplicates —
  `for record in config.custom_records: if record not in zone: zone.append(record)`.
  Genuinely distinct records (real round-robin: same name+type, different value) still produce
  multiple answers, callers can still add/override entries, NXDOMAIN and empty-name rejection
  unchanged.
- **Retest in the real UI:** one answer record, `Payload Received 96 B`, `Zone database records
  searched: 7` = 5 defaults + 2 genuinely new. Evidence
  `application/28-dns-postfix-single-answer.png`.
- Related **cleared** lead: a stale DNS result is *not* misattributed — after editing the hostname
  without re-running, the panel still shows the previous run's records **labelled with the previous
  name**, and re-running replaces them (NXDOMAIN renders an honest empty state).

## D-015 — Batch Experiments tab switcher pushed off-screen at phone widths (P2, FIXED + MANUAL)

- **Verification:** MANUAL (real UI at 320/375/390/430/768/1440, `s31_narrow.mjs` before /
  `s32_narrow_retest.mjs` after)
- The header row kept the title block and the two-tab switcher side by side (`flex items-center
  justify-between`); the switcher needed ~470 px, so at ≤430 px "Comparative A/B" sat past the right
  edge inside a horizontal scroller with no affordance (tab boxes measured at x=358 w=130 in a
  375 px viewport).
- **Fix:** header stacks below `sm:` (`flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`).
- **Retest:** both tabs fully inside the viewport at every width tested; keyboard reachability
  unchanged. Evidence `responsive/31-375x812-experiments.png` (before),
  `32-375x812-experiments-postfix.png` (after).

## D-016 — Transport results column (and its primary Run button) collapsed to a ~17 px sliver at phone widths (P2, FIXED + MANUAL)

- **Verification:** MANUAL (real UI, same scripts as D-015)
- The studio body was `flex-1 flex overflow-hidden` with a fixed `w-80` config `<aside>`; the results
  `<section>` is a scroll container, so its automatic minimum size is 0 and it absorbed all the
  shrinkage. At 320-430 px the available 264-374 px went to the 320 px aside and the results column —
  including "Run Default TCP Simulation" — became an unusable sliver (button box ~17 px wide).
- **Fix:** stack below `md:` (`flex-col md:flex-row`, aside `w-full md:w-80 md:shrink-0`,
  section `flex-1 min-w-0 md:overflow-y-auto`, body scrolls vertically on narrow screens). No
  functionality hidden.
- **Retest:** Run button fully visible at 320/375/390/430/768/1440 (118-196 px wide). Evidence
  `responsive/31-375x812-transport.png` (before), `32-375x812-transport-postfix.png` (after).

## D-017 — Circuit-switching model attribution truncated mid-phrase at phone widths (P3, FIXED + MANUAL)

- **Verification:** MANUAL (real UI at 320/375/390/768, `s34_classify.mjs` + `s36_switch_retest.mjs`)
- The header put a `shrink-0 text-right` attribution block ("Model: hop-count shortest path" /
  "Reservations: shared per link") beside the title; below ~400 px it hung off the right edge and
  rendered as "Model: hop-count" / "Reservations: s", i.e. information silently lost (only reachable
  via an undiscoverable horizontal scroll).
- **Fix:** header stacks below `sm:`; attribution left-aligns and keeps full text on narrow screens.
- **Retest:** both lines fully inside the viewport at 320/375/390/768 (right edge 296/351/366/744).
  Evidence `responsive/35-320x800-switching.png` (before), `36-320x800-switching-postfix.png` (after).

---

## Investigated and cleared (NOT defects)

Recording these prevents rework in later sections.

| Item | Verdict | Evidence |
|---|---|---|
| MAC "offered load (G) is ignored" (previously reported) | **Cleared — genuinely fixed.** Sweeping G = 0.2/0.5/1.0/1.5/3.0 at a fixed seed through the real UI moved collisions 0 → 0 → 12 → 18 → 27. Not merely a label change: the request body carries `offered_load_g` and results vary monotonically. | `flowcontrol-mac/09-mac-network.json`, `09-mac-offered-load.png` |
| MAC protocol selector only changes the label | **Cleared.** Pure ALOHA / Slotted ALOHA / CSMA-CD tabs each hit their own endpoint (`simulate_pure_aloha`, `simulate_slotted_aloha`, `simulate_csma_cd`). | same capture |
| Fault injection returning HTTP 500 (previously reported) | **Cleared.** All 7 fault types return 200; invalid inputs return clean 400s with explanatory messages. No 500 observed on any fault path. | `qos-faults/10-faults-network.json` |
| Frontend prefers a hardcoded loopback endpoint and would break a proxied preview | **Cleared.** `candidateEndpoints()` prefers same-origin `/netsim-api` whenever the page hostname is *not* loopback, and `vite.config.ts` proxies that prefix to the Python service. Loopback-first only applies to local development. | `src/lib/apiClient.ts:59-70` |
| CRC arithmetic | **Cleared — correct.** Independently recomputed modulo-2 division for `11010011101100`/`1011` → remainder `100`, codeword `11010011101100100`; and for CRC-16 `10001000000100111` → `0100010010011001`. All match. Invalid generators (`0`, `1`) → HTTP 400 with a clear message; empty inputs disable the button. | `algorithms/15-crc.png`, `verify_algo.py` |
| Internet checksum arithmetic | **Cleared — correct.** RFC 1071 independently recomputed for `0001 F203 F4F5 F6F7` → `0x220D`; `0xFFFF` → `0x0000`; `0x0000` → `0xFFFF`. All match, including carry folding and complement. Corruption injection correctly yields `is_valid: false, error_detected: true`. | `algorithms/15-checksum.png` |
| Hamming encode arithmetic (even **and** odd parity) | **Cleared — correct.** For every tested word, parity positions are exactly the powers of two, all parity constraints are satisfied under the selected mode, and the data bits are recoverable. Full single-bit sweep: every one of the 7/11/10/3/12 flips is detected, correctly positioned and corrected, under both even and odd parity. Clean codewords produce **no** false positive. | `verify_algo.py`, `algorithms/14-hamming.png` |
| Checksum parser splitting `0x12345` into `0x1234`+`0x5000` | **Intentional behaviour, not a defect.** `parse_hex_to_16bit_words` treats an undelimited string as a contiguous hex stream chunked into 16-bit words, right-padding the final partial chunk — the correct reading for a pasted packet hex dump. Delimited tokens longer than 4 digits are chunked the same way. Worth a UI hint, but the model is defensible. | `python/netsim/datalink/checksum.py:95-143` |
| Batch-experiment exports referring to the wrong run | **Cleared.** The exported JSON carries the run's own `experiment_name`, `provenance.config` (including the embedded `base_project`), per-run `seed`/`parameter_value`, `provenance.target` (the model that actually ran), `engine_source_sha256`, and declares `execution_time_ms` nondeterministic via `provenance.wall_clock_field`. Top-level name matches `config.experiment_name`. Both the "Download … JSON" buttons and `ExportButtons` emit byte-identical content for the same run. | `experiments-exports/downloads/*`, `s25_downloads.mjs`, `s26_ab.mjs` |
| Replay / determinism of downloaded exports | **Cleared — reproducible.** `examples/replay_experiment.py` on the browser-downloaded sweep and A/B JSON reproduces them **byte-identically** after normalising int/float JSON artefacts and excluding only the documented-nondeterministic `execution_time_ms`. `python-tools/analyze_results.py` consumes the same downloaded file correctly. All 290 raw leaf diffs were `13005` vs `13005.0` style serialisation artefacts of the JS round-trip. | `/tmp/replay_sweep.json`, `/tmp/replay_ab.json` vs downloads |
| Routing arithmetic (Dijkstra, Bellman-Ford, 3 metrics) | **Cleared — correct.** On a purpose-built 5-router topology the three metrics deliberately disagree and the server matches an independent implementation on every cost: hop_count→R1-R2-R5 (2), propagation_delay→R1-R3-R4-R5 (300 µs), inverse_bandwidth→R1-R2-R5 (2). Dijkstra and Bellman-Ford agree everywhere; a DOWN direct link is excluded from routes; DEGRADED penalty `max(3b, b+50)` and `ceil(1e9/bw)` confirmed. | `verify_routing.py`, `routing-hopcount.json` |
| Packet-lifecycle arithmetic (2-hop delivery) | **Cleared — correct.** Inject + 5×"Run 50ms" through the UI reached `t=11606 µs`, exactly the hand-computed 5 ingress + 800 tx + 5000 prop + 1 fwd + 800 tx + 5000 prop; event trace shows queue_entered → transmission_started(tx_delay 800) → transmission_finished → packet_arrived per hop; counters Delivered 1 / Dropped 0; Packet Inspector shows all 5 layers. | `topology-simulation/38-simulation-after-run.png`, `38-packet-inspector.png` |
| Topology editor add / undo / property apply | **Cleared — works.** "Add Core Router" → 4 nodes persisted; Undo → 3 nodes; node rename + "Apply Changes" persisted with the "Saved!" confirmation. Per-interface IPv4 inputs did not render for the selected router in this run — **unverified**, not claimed as a defect. | `topology-simulation/37-topology-after-add.png`, `38-property-editor.png` |
| SMTP Reject-policy toggle | **Cleared — works end to end.** Accept → `reject_recipient:false`, `is_accepted:true`, 14 events ending `SMTP_MESSAGE_ACCEPTED`, UI "250 QUEUED". Reject → `reject_recipient:true`, `is_accepted:false`, trace truncated at `SMTP_RCPT_REJECTED` (no DATA transfer), UI "550 REJECTED". | `application/28-smtp-accept.png`, `28-smtp-reject.png` |
| Documentation consistency (ports, Rust/Tauri, test counts) | **Mostly honest.** README/docs ports (8765/1420/`NETSIM_API_TARGET`) match reality; Rust/Tauri mentions in docs are deliberate removal notes. Only code-comment drift existed (D-007, now fixed). | grep over README.md, docs/*.md |

| Prefix slider landing one step off a computed thumb coordinate | **Test artefact, not a defect.** The displayed results were always exactly correct for the displayed prefix (`/27` → broadcast `192.168.1.31`, `30/32` usable). | `s8_race.mjs` output |
