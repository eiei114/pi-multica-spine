# Roadmap

> Maintenance context for `pi-multica-spine`. Repo-level only — **not** shipped in the npm tarball.

## Current release status

| Item | Value |
| --- | --- |
| Published version | **0.7.5** → **0.7.6** (candidate) |
| Working-tree version | `0.7.6` |
| Examples | spine + full offline campaign + sandbox/production rehearsal + closeout evidence |
| Production gate | **CLOSED** |
| Absorbed seeds | ~~R-MNT-1..27~~ through v0.7.6 |

## Near-term lanes

| Lane | Goal |
| --- | --- |
| **Live ops** | `check:sandbox-rehearsal` / `check:production-rehearsal` with `--execute` |
| **Coverage** | Sandbox line + branch + function floors on integration modules |
| **Production gate** | Human opens per `docs/production-gate-decision.md` only |

## Candidate seeds (next)

| ID | Seed | Scope |
| --- | --- | --- |
| R-MNT-28 | Persist live closeout evidence to investigation note on `--capture` | ~45 min |
| R-MNT-29 | Live sandbox `--execute` runbook + failure matrix | ~60 min |
| R-MNT-30 | Extension module function coverage floors | ~60 min |

## Completed seeds (reference)

| ID | Done in |
| --- | --- |
| ~~R-MNT-1..21~~ | v0.6.0–v0.7.4 |
| ~~R-MNT-22~~ | v0.7.5 — sandbox full closeout rehearsal |
| ~~R-MNT-23~~ | v0.7.5 — production-run rehearsal automation |
| ~~R-MNT-24~~ | v0.7.5 — sandbox line coverage floors |
| ~~R-MNT-25~~ | v0.7.6 — live sandbox closeout evidence capture |
| ~~R-MNT-26~~ | v0.7.6 — production gate open rehearsal checklist |
| ~~R-MNT-27~~ | v0.7.6 — sandbox function coverage floors |
