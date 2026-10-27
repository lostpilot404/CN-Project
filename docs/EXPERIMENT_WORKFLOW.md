# Experiment execution and reproducibility

## What changed after the novelty audit

The dated audit describes the inspected baseline. The general runner now explicitly dispatches
`network`, `tcp`, and `udp`. Omitted targets retain legacy network behavior. Other targets are
rejected, not silently substituted. The dedicated GBN/SR comparison is unchanged.

Supported parameters are listed in [the current report](../PROJECT_REPORT.md). The UI only exposes
supported targets and parameters. API validation also rejects unsupported combinations. A/B traffic
overrides now affect packet size/count/interval where supported. Non-finite and fractional count/time
values are rejected. Values are not silently raised to 64 bytes in packet-size sweeps.

TCP/UDP use the existing models, not a new implementation. They run bulk transfers to completion,
not duration-limited timed traffic. Unsupported faults, stochastic link loss/BER and intervals fail
clearly. Topology links below the transport model's 1 Mbps / 100 μs floors fail explicitly. Seeds
are provenance, not random loss inputs in those models. Queue capacity, window and timeout sweeps
are deliberately not supported for transport experiments in this iteration.

## Download and replay

1. Configure a topology and choose an experiment target.
2. Run a sweep or A/B comparison. Inspect the calculated metrics and model caveats.
3. Use **Download sweep JSON** or **Download A/B JSON**. Form edits after execution do not alter
   the completed result snapshot.
4. Keep the export and the source checkout matching `provenance.engine_source_sha256`.
5. From the repository root:

```sh
PYTHONPATH=python python examples/replay_experiment.py netsim-sweep.json > replay.json
# or netsim-comparison.json
```

The JSON contains `provenance.config` (including base topology and scenario overrides), effective
per-run inputs, seed/scenario labels, per-run QoS, aggregate metrics, engine version/source hash,
Python version and timing/metric caveats. TCP/UDP evidence also includes effective route hops and
raw transport metrics. Replay uses the embedded topology and no running UI/service. The source hash
identifies code but does not embed it; archive the matching checkout for long-term reproduction.
`execution_time_ms` is wall-clock metadata and may differ. Hash/version changes should be investigated,
not treated as deterministic-output failures. Do not compare aggregate output alone without inputs.
The replay CLI does not enforce the source hash; compare it before accepting a scientific replay.

A/B evidence preserves both scenario outputs for every seed. Equal seeds alone do not guarantee
identical stochastic events. The JSON schema is additive to existing sweep/A-B result fields;
existing analysis utilities can still consume those fields. The GBN/SR example has a separate schema.

## Final-source verification and evidence

See [FINAL_VERIFICATION.md](FINAL_VERIFICATION.md) for commands, scope, warnings and source binding.
Current results: **277 Python tests** (197 backend + 80 utilities), **95 frontend tests** with 11
opt-in skips, **11 separately executed live tests**, **31 Chromium E2E tests**, lint/format,
Python/TypeScript type checks and production build pass. No new coverage percentage is claimed.

### Implemented and verified

Real Chromium 153.0.8010.0 drove network/TCP/UDP through bandwidth sweeps and A/B comparisons.
Both available JSON download buttons were exercised for every target. Every browser-triggered file
was non-empty/parseable, matched the actual response and visible settings, and replayed identically
with only top-level `execution_time_ms` excluded. Seeds were 42/101; all-link bandwidths 1/10 Mbps.
Sweep packet count was 12; A/B default count 10. Form labels were edited before downloading to
verify immutable snapshots. Six screenshots, downloads, replays and error records are under
[evidence/2026-10-27/browser/](evidence/2026-10-27/browser/). No errors/failing requests were recorded
in these six workflows. Tests used real frontend and service; only external font requests were isolated.

The dedicated GBN/SR browser task also matched the report results (4 vs 1 retransmissions,
26,200 vs 21,100 μs, 8 completed each). Its stored UI-triggered responses are not studio downloads;
the studio does not have a download control. Network topology/packet and routing/addressing browser
regressions also passed. Parameter-matrix and A/B traffic overrides have backend regression coverage.

### Implemented but not manually verified

The browser acceptance is automation-driven, not a human usability study. Each individual
non-bandwidth sweep, all topology/input combinations, cross-platform replay and long-run stability
were not manually exercised. Backend test success is not described as a manual pass.

### Comparable capability found in Packet Tracer

Official help establishes network/event inspection, IP/routing education and saved/rerunnable
scenarios. These overlap with NetSim; they are not unique claims. See the
[source-backed comparison](PACKET_TRACER_COMPARISON.md).

### Candidate differentiator requiring further evidence

The exact matched-loss GBN/SR comparison and portable multi-seed metric/config snapshot workflow
are demonstrated in NetSim, but absence in Packet Tracer is not established. Packet Tracer was not
installed here. Official sources establish advertised version 9.0.1, not an exact installed build;
direct hands-on comparison remains outstanding. No numerical benchmark or exclusive claim is made.

### Unsupported or out of scope

Only network/TCP/UDP are general experiment targets. Other protocols remain in dedicated studios.
There is no experiment CSV download. Transport scheduled faults/stochastic topology BER/loss/timed
injection and window/timeout/persistence sweeps remain unsupported. Bulk duration is not a cutoff.
Metric placeholders and model assumptions are not physical-network measurements.

### Regression reconciliation

The previous bandwidth regressions in Python and E2E used `target=tcp` while testing timed topology
traffic; they now explicitly select `network`. New transport tests verify actual model configuration
and metrics. This corrects the tests' semantics rather than retaining the erroneous old dispatch.
Direct competing-simulator checks remain a separate evidence requirement, not replaced by these tests.
