# Cleanup inventory

Reviewed against checkout `dd2a29d2987d31896399062be6acc67aa4df6d2a` (2026-10-29). The checkout was clean and shallow; remote `main` matched HEAD. No untracked or ignored files existed before installing verification tools. Counts before cleanup: 291 tracked files, approximately 31 MiB as reported by `du`.

## KEEP

- `python/netsim/`, `src/`, `index.html`, `public/`: service, algorithms, UI and entry points. `src/lib/testDouble.ts` is used by Vitest; the production build aliases it to `testDouble.stub.ts` and CI checks the bundle.
- `python/tests/` (13 test modules plus fixtures), `python-tools/tests/` (5 test modules plus fixture), frontend `*.test.ts(x)` (18 files including live integration), and `e2e/` (3 suites): algorithm, API, regression, component, live integration, accessibility, download and replay coverage. No tests were removed or assertions relaxed.
- `examples/` and `python-tools/`: supported flow-control demonstration, experiment replay and export analysis/plotting, including their tests and matplotlib requirement.
- `docs/`, `README.md`, `evidence/final-iceberg-audit/`: project guidance and historical submission evidence. Audit screenshots and captures were retained even where a direct citation was not established; they may support the historical findings.
- `.github/workflows/ci.yml`, `ci/`, `.gitignore`, `package.json`, `package-lock.json`, `pyproject.toml`, `playwright.config.ts`, Vite, TypeScript, PostCSS and Tailwind configs: install, build, CI and verification infrastructure.

## REMOVE

No tracked files were proven safe to remove. In particular, an identical-file hash match between `python/netsim/congestion/__init__.py` and `python/netsim/transport/congestion.py` is not sufficient evidence of redundancy: both are importable module paths and may be compatibility surfaces. No generated build directories or dependency trees were tracked. Ignored artifacts created while verifying were not added to Git; `.mypy_cache/` was explicitly added to `.gitignore` rather than relying on mypy's self-generated ignore file.

## INVESTIGATE

- `evidence/final-iceberg-audit/`: the historical report and register cite some one-off scripts, a routing JSON, downloads and temporary replay outputs that were already absent in the starting checkout. Their availability and any coursework requirement for them need confirmation; provenance notes were added rather than reconstructing or deleting evidence.
- npm audit reported 7 vulnerabilities on the installed lockfile (2 moderate, 3 high, 2 critical). Changes to dependencies, including a major Vitest upgrade proposed by npm, require a separate compatibility and security review; no dependency or lockfile was changed for cleanup.
- Production build emitted an existing CSS syntax warning and a circular chunk warning. These need investigation separately; the build succeeded.

## Documentation corrections

README and testing guidance now describe the actual CI triggers, distinguish the live-integration command from CI, identify all three browser suites, correct the accessibility audit's dialog coverage, and link to the retained audit. Both audit documents flag pre-existing missing evidence. The historical findings themselves have not been altered.
