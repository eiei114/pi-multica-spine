# Roadmap

> Maintenance context for `pi-multica-spine`. Repo-level only — **not** shipped in the npm tarball.

## Current release status

| Item | Value |
| --- | --- |
| Published version | **0.7.4** (candidate) |
| Working-tree version | `0.7.4` |
| Examples | spine + full offline campaign + sandbox rehearsal |
| Production gate | **CLOSED** |
| Absorbed seeds | ~~R-MNT-1..21~~ through v0.7.4 |

## Near-term lanes

| Lane | Goal |
| --- | --- |
| **Live ops** | `npm run check:sandbox-rehearsal -- --execute` after `--live` checklist |
| **Coverage** | Sandbox branch floors enforced; raise line coverage on integration modules |
| **Production gate** | Human opens per `docs/production-gate-decision.md` only |

## Candidate seeds (next)

| ID | Seed | Scope |
| --- | --- | --- |
| R-MNT-22 | Live sandbox campaign through `final_package` + human review | ~90 min |
| R-MNT-23 | Maintenance production-run rehearsal automation | ~60 min |
| R-MNT-24 | Raise sandbox/campaign line coverage floors | ~60 min |

## Completed seeds (reference)

| ID | Done in |
| --- | --- |
| ~~R-MNT-1..18~~ | v0.6.0–v0.7.3 |
| ~~R-MNT-19~~ | v0.7.4 — sandbox rehearsal automation |
| ~~R-MNT-20~~ | v0.7.4 — sandbox branch coverage floors |
| ~~R-MNT-21~~ | v0.7.4 — template peer bump check |
