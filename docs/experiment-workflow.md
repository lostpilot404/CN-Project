# Experiment execution and reproducibility

## Experiment dispatch

The general runner explicitly dispatches
`network`, `tcp`, and `udp`. Omitted targets retain legacy network behavior. Other targets are
rejected, not silently substituted. The dedicated GBN/SR comparison is unchanged.

The UI only exposes supported targets and parameters, and API validation rejects unsupported
combinations. A/B traffic
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
3. Download the result: **Download sweep/A/B JSON** for replay, or the per-result
   **Export JSON/CSV** controls for `python-tools` and spreadsheets. Form edits after execution
   do not alter the completed result snapshot.
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

## Limitations

Only network/TCP/UDP are general experiment targets. Other protocols remain in dedicated studios.
Transport scheduled faults/stochastic topology BER/loss/timed
injection and window/timeout/persistence sweeps remain unsupported. Bulk duration is not a cutoff.
Metric placeholders and model assumptions are not physical-network measurements.
