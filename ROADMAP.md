# Roadmap

> Maintenance context for `pi-multica-spine`. Repo-level only — **not** shipped in the npm tarball.

## Current release status

| Item | Value |
| --- | --- |
| Published version | **0.7.3** (candidate) |
| Working-tree version | `0.7.3` |
| Examples | spine + full offline campaign through `final_package` |
| Production gate | **CLOSED** |
| Absorbed seeds | ~~R-MNT-1..18~~ through v0.7.3 |

## Near-term lanes

| Lane | Goal |
| --- | --- |
| **Live ops** | Sandbox → Maintenance rehearsal with real `multica` CLI (`check:sandbox-checklist --live`) |
| **Coverage** | Raise branch coverage on sandbox/campaign modules |
| **Production gate** | Human opens per `docs/production-gate-decision.md` only |

## Candidate seeds (next)

| ID | Seed | Scope |
| --- | --- | --- |
| R-MNT-19 | Live sandbox apply + campaign rehearsal automation | ~90 min |
| R-MNT-20 | Coverage branch floors for sandbox/campaign modules | ~60 min |
| R-MNT-21 | Template re-sync when pi-extension-template peer bumps | periodic |

## Completed seeds (reference)

| ID | Done in |
| --- | --- |
| ~~R-MNT-1..15~~ | v0.6.0–v0.7.2 |
| ~~R-MNT-16~~ | v0.7.3 — full offline campaign to `final_package` |
| ~~R-MNT-17~~ | v0.7.3 — `workflow-sandbox-checklist.mjs` |
| ~~R-MNT-18~~ | v0.7.3 — `template-resync-check.mjs` (DOT-823) |
