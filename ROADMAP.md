# Roadmap

> Maintenance context for `pi-multica-spine`. Repo-level only — **not** shipped in the
> npm tarball. Used by the Weekly maintenance seed planner and contributors.

## Current release status

| Item | Value | Source |
| --- | --- | --- |
| Published version | **0.7.0** (candidate) | `npm view pi-multica-spine version` after release |
| Working-tree version | `0.7.0` | `package.json` |
| Tool surface | 35 typed tools (10 spine + 25 workflow-adapter) | `extensions/index.ts` |
| CI baseline | `build` + `typecheck` + coverage (75/68/75) + changelog + `pack:smoke` + walkthrough | `npm run ci` |
| Production gate | **CLOSED** | `docs/production-gate-decision.md` |
| Absorbed seeds | ~~R-MNT-1..11~~ through v0.7.0 | investigation docs |

## Near-term lanes

| Lane | Goal |
| --- | --- |
| **Onboarding** | Expand `examples/` beyond minimal walkthrough |
| **Coverage** | Per-file floors or branch coverage push toward 80% |
| **Ops** | Rehearse sandbox → Maintenance via `docs/workflow-ops-checklist.md` |
| **Production gate** | Human opens per `docs/production-gate-decision.md` only |

## Known technical debt

| Area | Status | Evidence |
| --- | --- | --- |
| **Publish TOCTOU** | Mitigated (single trigger + E403 classifier) | DOT-881 investigation |
| **Branch coverage headroom** | Average branches ~69%; some files very low | `npm run test:coverage` |
| **Template alignment** | Last re-sync 2026-07-24 | `docs/investigations/2026-07-24-template-resync-dot-823.md` |
| **Production gate** | Intentionally closed | `docs/production-gate-decision.md` |

## Candidate seeds (next)

| ID | Seed | Scope |
| --- | --- | --- |
| R-MNT-12 | Workflow example campaign walkthrough | ~60–90 min |
| R-MNT-13 | Per-file coverage denylist / hotspots | ~45–75 min |
| R-MNT-14 | Publish pre-check via registry HTTP (template pattern) | ~45–60 min |

## Completed seeds (reference)

| ID | Done in |
| --- | --- |
| ~~R-MNT-1..6~~ | v0.6.0 |
| ~~R-MNT-7..8~~ | v0.6.1 |
| ~~R-MNT-9..11~~ | v0.7.0 |

See `CHANGELOG.md` and investigation docs for acceptance criteria history.
