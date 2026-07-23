# Roadmap

> Maintenance context for `pi-multica-spine`. Repo-level only — **not** shipped in the
> npm tarball (the `package.json` `files` glob intentionally excludes it). Used by the
> Weekly maintenance seed planner and contributors to pick the next bounded micro-task.

This file is a living snapshot. Update it whenever a release ships, a seed is promoted to
an issue, or technical-debt priorities shift. Keep seeds scoped to **30–90 minutes**.

## Project purpose

`pi-multica-spine` is a Pi extension that keeps Multica work agents bound to the
**issue → PR → evidence → handoff** contract. It injects a short work-agent contract and
exposes ten typed tools (`bind`, `context`, `next`, `link_pr`, `add_evidence`, `handoff`,
`verify`, and `metadata_list` / `metadata_set` / `metadata_delete`). It does **not**
replace Multica controllers, Todo Runner, Review Sentinel, or the PR creation flow — it is
a narrow spine for work agents.

Workflow-adapter tools and CLIs extend that spine so Multica work can be run as a
**Campaign** (Hermes Idea-to-Build) with ledger + Human Gate boundaries.

## Current release status

| Item | Value | Source |
| --- | --- | --- |
| Published version | **0.6.0** (2026-07-24) | `npm view pi-multica-spine version`, GitHub Release `v0.6.0` |
| Working-tree version | `0.6.1` (candidate) | `package.json` |
| `[Unreleased]` on `main` | pack smoke + ops docs (this branch) | `CHANGELOG.md` |
| Tool surface | 35 typed tools (10 spine + 25 workflow-adapter) | `extensions/index.ts`, README |
| Workflow ops | JSONL digest, sandbox canary, production binding, production run CLIs | `scripts/`, `dist/`, `docs/` |
| CI baseline | green: `build` + `typecheck` + coverage + changelog + `pack:check` + walkthrough (+ `pack:smoke` in 0.6.1) | `npm run ci` |
| Live lanes | Sandbox DOT-1123; Production DOT-1137 | investigation docs |
| Master plan DOT-1116 | **completed** 2026-07-24 | Obsidian master plan + closeout doc |
| Production gate | **CLOSED** (`productionAllowed=false`) | `docs/production-gate-decision.md` |
| Absorbed seeds | ~~R-MNT-1..6~~ done in v0.6.0 | ADR-0001 |

### Release flow reminder

Releases use npm Trusted Publishing (no `NPM_TOKEN`). A version-bump push to `main` lets
`.github/workflows/auto-release.yml` create the `v<version>` tag + GitHub Release and then
dispatch `.github/workflows/publish.yml`. Human-owned: release/publish secrets setup, billing.
See [`docs/release.md`](docs/release.md).

## Workflow Adapter Completion (DOT-1116)

**Status: completed** (2026-07-24). See `docs/investigations/2026-07-24-workflow-adapter-completion-closeout.md`.

## Near-term lanes

| Lane | Goal | Human Gate? |
| --- | --- | --- |
| **0.6.x** | Stabilize compiled CLI distribution (`dist/` + pack smoke) and ops docs | No |
| **Ops daily** | Sandbox → Maintenance rehearsal via `docs/workflow-ops-checklist.md` | No |
| **Production gate** | Decision framework only until a human opens it | Yes — keep closed by default |
| **0.7.0** | Onboarding expansion + optional coverage floor raise | No |

## Known technical debt

| Area | Status | Evidence |
| --- | --- | --- |
| **Publish workflow TOCTOU race** | Mitigated (single trigger + E403 classifier in 0.6.0); residual race risk low | `docs/investigations/2026-07-07-duplicate-publish-guard-e403.md` |
| **Coverage floors are low** | Enforced, but floors (70/60/75) leave headroom for silent quality loss | `scripts/coverage-gate.mjs`, `CONTRIBUTING.md` |
| **CLI scripts hard-require `dist/`** | Expected after 0.6.0; pack smoke verifies install path | `scripts/*.mjs` → `dist/lib` |
| **Template alignment debt** | Tracked | DOT-823; periodic re-sync as pi-extension-template moves |
| **`spine-lib-import.mjs` unused** | Optional fallback helper exists but CLIs use static `dist` imports | `scripts/spine-lib-import.mjs` |
| **Production gate closed** | Intentional | `docs/production-gate-decision.md` |

## Candidate maintenance seeds (30–90 minutes each)

| ID | Seed | Scope | Outcome |
| --- | --- | --- | --- |
| ~~R-MNT-7~~ | Pack-install smoke for published CLIs | ~45–60 min | done in v0.6.1 |
| ~~R-MNT-8~~ | Ops checklist + production gate decision note | ~30–45 min | done in v0.6.1 |
| R-MNT-9 | Optional: migrate CLIs to `importSpineLib` | ~60–90 min | Dev fallback without prior `build` |
| R-MNT-10 | Raise coverage floors toward 0.7.0 | ~45–75 min | Tighten gate after measuring headroom |
| R-MNT-11 | Template re-sync pass (DOT-823) | ~60–90 min | Diff vs current pi-extension-template |

### R-MNT-7 — Pack-install smoke for published CLIs

Install the `npm pack` tarball into a temp directory and run `scripts/jsonl-digest.mjs` against a tiny fixture so broken `dist/` layouts fail CI before publish.

**Files:** `scripts/pack-smoke.mjs`, `package.json`, `.github/workflows/ci.yml` (if CI invokes `npm run ci` only, package.json is enough).

**Acceptance criteria:**
- [x] `npm run pack:smoke` exits 0 and prints `{ ok: true, ... }`.
- [x] Smoke uses only the packed tarball (no live `npm publish`).
- [x] Wired into `npm run ci`.

### R-MNT-8 — Ops checklist + production gate decision note

**Files:** `docs/workflow-ops-checklist.md`, `docs/production-gate-decision.md`, README/ROADMAP links.

**Acceptance criteria:**
- [x] Checklist covers sandbox + Maintenance production-run + failure recovery.
- [x] Gate note lists open/close criteria; agents forbidden from flipping without human yes.
- [x] `productionAllowed` remains `false` in code defaults.

### R-MNT-9 — Optional: migrate CLIs to `importSpineLib`

Replace static `../dist/lib/*.js` imports with `importSpineLib` so local scripts can fall back to `lib/*.ts` when `dist/` is missing.

**Acceptance criteria:**
- [ ] All workflow/jsonl CLIs resolve via the helper.
- [ ] Pack smoke still passes (dist path preferred).
- [ ] `npm run ci` green.

### R-MNT-10 — Raise coverage floors toward 0.7.0

Measure current averages; raise `scripts/coverage-gate.mjs` floors without flaking on Windows/Linux.

**Acceptance criteria:**
- [ ] Floors increased with documented baseline in `CONTRIBUTING.md`.
- [ ] CI green on Linux + local Windows spot check.

### R-MNT-11 — Template re-sync pass (DOT-823)

Diff against current `pi-extension-template` and absorb non-breaking hygiene only.

**Acceptance criteria:**
- [ ] Investigation note lists adopted vs deferred deltas.
- [ ] No behavior change to Multica tools without tests.

## How to update this file

- When a release ships: move `[Unreleased]` entries into a dated section, refresh
  "Current release status," and retire/promote any seed that landed.
- When a seed becomes an issue: add `Status: in progress (<issue-link>)` to the seed
  subsection header. When the PR merges, strike through the table row (`~~R-MNT-N~~`) and
  add `Status: done (<issue-link>)` to the subsection, or remove the row and subsection
  entirely if the seed is fully absorbed.
- When new technical debt is found: add a row to "Known technical debt" with a pointer to
  evidence (investigation doc, failing run, code path).
- Keep each seed at 30–90 minutes. If a seed grows past that, split it or move it to a
  tracked issue instead of leaving it here as pseudo-work.
