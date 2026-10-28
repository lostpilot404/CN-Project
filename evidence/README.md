# Submission evidence — NetSim readiness review (2026-10-24)

Hands-on verification was performed with Playwright (Chromium) against the Vite dev
server (`http://127.0.0.1:1420/`, port 1420) and the live Python simulation service
(`http://127.0.0.1:8765`). Screenshots below are the re-verification set taken after
the fixes on branch `arena/e7239da9-cn-project`; `d*` / `trans-stale` / `app-dns-empty`
shots are the pre-fix records of the same views.

## Screenshots

### All 9 workspaces (baseline tour, post-fix build)
- `tour-topology-canvas.png`, `tour-routing-studio.png`, `tour-addressing-nat.png`
- `tour-simulation-events.png`, `tour-algorithm-studio.png`, `tour-transport-layer.png`
- `tour-application-layer.png`, `tour-qos-performance.png`, `tour-batch-experiments.png`

### Defect before/after pairs
| Finding | Before | After |
|---|---|---|
| D2 XYFlow light controls | `d2-topo.png` (white control stack, bottom-left) | `r12-topo-1440.png` (dark themed controls) |
| D3 squeezed filter grid | `d3-filters.png`, `d36-sim.png` (6 columns in 384 px, labels collide) | `r12-sim-1440.png` (2-column grid) |
| D4 stale transport result | `trans-stale.png` (ESTABLISHED trace kept under "unreachable" error) | `v-trans-stale.png` (error only, 0 stale markers) |
| D4 stale DNS result | `app-dns-empty.png` (NOERROR kept under "must not be empty") | `v-dns-empty.png` (error only, inspector reset) |
| D6 timeline row overflow | `d36-sim.png` (badges wrap mid-word, link id clipped) | `r12-sim-1440.png` |

### Fix verification
- `v-mac-g.png` — D7: MAC studio at G=2.5 (27 collisions, 73.0%).
- `v-slider.png` — prefix-slider residual: /24 → /26 follows live, broadcast `192.168.1.63`.
- `v-addr-invalid.png` — D4 + D10: invalid input shows the error with results cleared and plain `/p` split options.
- `v-exp.png` — D14: A/B deltas table with JSON/CSV export buttons.
- `d5-modal.png` — inject modal (D5: dialog role, Escape close, focus trap/return verified by script).
- `trans-tcp.png` — clean TCP run (handshake, Jacobson RTT, cwnd trace).
- `trans-comp.png` — TCP vs UDP comparison table.
- `algo-checksum.png` — checksum `0x220D`, hand-verified against RFC 1071.
- `algo-crc.png` — CRC studio; `qos-traffic.png` — QoS metrics; `exp-sweep.png` — sweep chart.
- `offline-addr.png` — backend-offline banner behaviour.

### Responsive (D11 + 320px attribution residual)
- `r12-topo-320.png`, `r12-sim-320.png`, `r13-trans-320.png`, `r13-app-320.png`
- `r12-topo-768.png`, `r12-sim-768.png`
- Zero document horizontal overflow measured at 320 / 375 / 768 / 1024 / 1440.

## Downloads (D14 end-to-end)
`sweep.json` / `sweep.csv` / `ab.json` / `ab.csv` were downloaded from the running UI
via Playwright's download events. `analyze_output.txt` is the output of
`python-tools/analyze_results.py` run against the downloaded `sweep.json` — the exact
workflow `USER_GUIDE §14` describes.

## Scripts
`scripts/*.mjs` are the Playwright re-verification scripts (run with
`LD_LIBRARY_PATH=/tmp/browser/libs/lib` against the local Chromium bundle):
- `vfix1*.mjs` — slider, addressing/DNS stale-clearing, modal Escape/focus.
- `vfix2.mjs` — transport stale-clearing after a link-down failure.
- `vfix3.mjs` — MAC offered-load response (G=0.3 vs 2.5).
- `vfix4.mjs` — sweep + A/B runs with JSON/CSV downloads.
- `resp*.mjs`, `desc.mjs` — responsive passes and defect close-ups.
