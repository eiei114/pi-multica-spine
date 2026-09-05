# Roadmap

> Maintenance context for `pi-multica-spine`. Repo-level only — **not** shipped in the npm tarball.

## Current release status

| Item | Value |
| --- | --- |
| Published version | **0.12.9** (npm) |
| Working-tree version | `0.12.9` |
| Entry skills | `/skill:idea-to-build` · `/skill:maintenance-build` |
| Vault entry | `scripts/workflow-vault-idea-entry.mjs` (offline check exists; not yet in `npm run ci`) |
| Production gate | **CLOSED** (`productionAllowed=false`) |
| Absorbed seeds | ~~R-MNT-1..42~~ through v0.12.9 |

## Short-term maintenance priorities (next 1–2 releases)

| Priority | Lane | Goal |
| --- | --- | --- |
| P0 | **Docs hygiene** | Keep README and ROADMAP aligned with registered tools, CI gates, and entry skills |
| P1 | **Entry coverage** | Wire remaining offline entry checks into `npm run ci` |
| P2 | **Live ops rehearsal** | First human-owned live `--execute` on sandbox/maintenance with gate closed |
| P3 | **Production gate** | Human opens per `docs/production-gate-decision.md` only |

## Candidate maintenance seeds

Each item is scoped to ~30–90 minutes for weekly seed planner conversion.

| ID | Task | Est. | Why needed |
| --- | --- | --- | --- |
| R-MNT-43 | Add README "Pi skills" discovery section listing `/skill:idea-to-build` and `/skill:maintenance-build` with install + invoke paths | ~30 min | Skills are documented inline under Install but lack a scannable index; seed planner and new operators cannot find entry points quickly |
| R-MNT-44 | Add `check:vault-idea-entry` to `npm run ci` and document vault-native flow in README | ~45 min | Script and offline check exist but CI skips vault entry; regressions would only surface in manual runs |
| R-MNT-45 | Add ROADMAP freshness guard to `check:readme` (version alignment + ≥3 open seeds with scope notes) | ~60 min | ROADMAP drift blocked seed planner (DOT-1011); automated guard prevents repeat |

## Completed seeds (reference)

| ID | Done in |
| --- | --- |
| ~~R-MNT-1..33~~ | v0.6.0–v0.7.8 |
| ~~R-MNT-37~~ | v0.7.9 — Idea-to-build slash entry skill |
| ~~R-MNT-38..40~~ | v0.8.0 — Fresh idea sessions, idea-entry live docs/smoke, maintenance-build skill |
| ~~R-MNT-41~~ | v0.12.9 — Maintenance entry live execute smoke (`check:maintenance-live-smoke`) |
| ~~R-MNT-42~~ | v0.12.9 — Idea session retention policy (dry-run classification + docs) |
