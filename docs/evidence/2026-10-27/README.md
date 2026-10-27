# Verification evidence — 2026-10-27

- [Final release gate](../../FINAL_VERIFICATION.md): exact scope, inputs, tests, warnings and limits.
- [Capability comparison](../../PACKET_TRACER_COMPARISON.md): no installed Packet Tracer; official-source fallback.
- [Environment and original repository state](environment-and-repository.txt).
- [Source binding](source-manifest.json): implementation/config hashes and engine fingerprint.
- [Official Packet Tracer source excerpts](packet-tracer-sources.md).
- `logs/`: final-source test/type/lint/build outputs and reviewed service log.
- `browser/{network,tcp,udp}-{sweep,comparison}.json`: six files saved from actual Chromium
  download events, not substitute API exports.
- `browser/*-replay.json`: documented CLI replays of those files.
- `browser/*-verification.json`: non-empty bytes, config/model/effective input/seeds checks,
  immutable snapshot check, console/service/network observations and deterministic comparison.
- `browser/*.png`: setup and results screenshots. Browser internal scrolling requires separate
  screenshots for the configuration and result table.
- `browser/gbn-sr-ui-results.json` and `gbn-sr-comparison.png`: matched-loss dedicated studio run.
  This is a UI response capture, **not** a browser download; that studio has no download control.

All comparisons exclude only `execution_time_ms`. Application state may differ in wall-clock
fields, but inputs/topology/per-run outputs/provenance remain checked. No installer/browser binary,
virtual environment or node_modules is included. Evidence occupies about 2 MB.
