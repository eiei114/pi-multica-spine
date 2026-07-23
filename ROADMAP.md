# Roadmap

> Maintenance context for `pi-multica-spine`. Repo-level only — **not** shipped in the npm tarball.

## Current release status

| Item | Value |
| --- | --- |
| Published version | **0.7.2** (candidate) |
| Working-tree version | `0.7.2` |
| Examples | spine + offline campaign + human-review rehearsal |
| Production gate | **CLOSED** |
| Absorbed seeds | ~~R-MNT-1..15~~ through v0.7.2 |

## Near-term lanes

| Lane | Goal |
| --- | --- |
| **Live ops** | Sandbox → Maintenance rehearsal with real `multica` CLI |
| **Coverage** | Raise branch coverage on sandbox/campaign modules |
| **Production gate** | Human opens per `docs/production-gate-decision.md` only |

## Candidate seeds (next)

| ID | Seed | Scope |
| --- | --- | --- |
| R-MNT-16 | Full offline campaign through `final_package` (no ledger seeding) | ~90 min |
| R-MNT-17 | Live sandbox dry-run checklist automation | ~45–60 min |
| R-MNT-18 | Template periodic re-sync (DOT-823) | ~60 min |

## Completed seeds (reference)

| ID | Done in |
| --- | --- |
| ~~R-MNT-1..12~~ | v0.6.0–v0.7.1 |
| ~~R-MNT-13~~ | v0.7.2 — coverage hotspots + denylist |
| ~~R-MNT-14~~ | v0.7.2 — publish registry HTTP pre-check |
| ~~R-MNT-15~~ | v0.7.2 — walkthrough human-review rehearsal |
