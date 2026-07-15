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

## Current release status

| Item | Value | Source |
| --- | --- | --- |
| Published version | **0.1.4** (2026-07-07) | `npm view pi-multica-spine version`, GitHub Release `v0.1.4` |
| Working-tree version | `0.1.4` | `package.json` |
| `[Unreleased]` on `main` | metadata CLI wrappers (DOT-762), `add_evidence` dedup (DOT-752), template alignment 0.80.x (DOT-823) | `CHANGELOG.md` |
| Tool surface | 10 typed tools | `extensions/index.ts`, README "Tools" table |
| CI baseline | green: `typecheck` + `test:coverage` + `pack:check`; 7 test files, 18 files in tarball | `npm run ci` |
| Coverage (report-only) | ~93% lines / ~77% branches / ~93% functions | `CONTRIBUTING.md` |
| Open issues | none at last refresh | GitHub Issues |

### Release flow reminder

Releases use npm Trusted Publishing (no `NPM_TOKEN`). A version-bump push to `main` lets
`.github/workflows/auto-release.yml` create the `v<version>` tag + GitHub Release and then
dispatch `.github/workflows/publish.yml`. Human-owned: release/publish, secrets, billing.
See [`docs/release.md`](docs/release.md).

## Short-term maintenance goals (next 2–3 releases)

- **Next patch (0.1.5)** — Cut a release for the `[Unreleased]` entries already on `main`
  (metadata CLI wrappers, evidence dedup, template alignment). Pair it with **R-MNT-1**
  (single publish trigger) so the release itself does not re-trigger the DOT-881 race.
- **Next minor (0.2.0, if justified)** — The metadata CLI wrapper tools (DOT-762) are
  additive tool surface; decide whether to signal that with a minor bump. Bundle with
  onboarding polish: **R-MNT-4** (examples) and **R-MNT-3** (coverage gate).
- **Following release** — Defense-in-depth release hardening (**R-MNT-2**) plus repo hygiene
  seeds (**R-MNT-5**, **R-MNT-6**).

Priorities are deliberately conservative: this package is a narrow spine, so each release
should stay small, auditable, and dependency-light.

## Known technical debt

| Area | Status | Evidence |
| --- | --- | --- |
| **Publish workflow TOCTOU race** | Investigated, not yet fixed | `docs/investigations/2026-07-07-duplicate-publish-guard-e403.md` (DOT-881). Two concurrent, non-mutexed publish triggers for one version bump caused `E403`. Option A (single trigger) recommended; Option C (idempotent E403) as defense in depth. |
| **Coverage not enforced** | Report-only | `CONTRIBUTING.md` states "thresholds are not enforced yet." CI runs `--experimental-test-coverage` without a gate, so silent regressions are possible. |
| **No onboarding examples** | Gap | README quickstart describes the flow, but there is no checked-in, runnable walkthrough a first-time contributor can follow offline. |
| **No changelog lint** | Gap | Nothing prevents a release tag with an undated or missing `## [Unreleased]` section. |
| **README package-contents drift risk** | Low | The "Package contents" table must stay in sync with `package.json` `files` and `npm pack --dry-run` (currently 18 files). No automated check. |
| **Template alignment debt** | Tracked | DOT-823 aligned to pi-extension-template 0.80.x baseline; periodic re-sync expected as the template moves. |

## Candidate maintenance seeds (30–90 minutes each)

Each seed is bounded and has explicit acceptance criteria. Promote one to a Multica issue
when the Weekly maintenance seed planner needs the next micro-task. Seeds are proposals,
not commitments — re-scope or retire as the codebase changes.

| ID | Seed | Scope | Outcome |
| --- | --- | --- | --- |
| R-MNT-1 | Collapse `publish.yml` to a single trigger (DOT-881 Option A) | ~45–60 min | One publish run per version bump |
| R-MNT-2 | Treat "already published" `E403` as benign skip (DOT-881 Option C) | ~60–90 min | Defense-in-depth publish idempotency |
| R-MNT-3 | Enforce coverage thresholds in CI | ~45–75 min | Coverage regressions fail CI |
| R-MNT-4 | Add `examples/` walkthrough with fixture spine state | ~60–90 min | Runnable offline onboarding |
| R-MNT-5 | Keep-a-changelog lint script | ~30–45 min | Block undated/missing changelog releases |
| R-MNT-6 | README package-contents accuracy pass | ~20–30 min | Docs match published tarball |

### R-MNT-1 — Collapse `publish.yml` to a single trigger

Implement **Option A** from `docs/investigations/2026-07-07-duplicate-publish-guard-e403.md`.
Remove the redundant direct `push.branches: [main]` block (or its `package*.json` `paths`)
from `publish.yml` `on:` so a version bump publishes through one path only — the
`auto-release.yml` → `workflow_dispatch` handoff that `docs/release.md` already calls the
"reliable" path.

**Files:** `.github/workflows/publish.yml`, `docs/release.md` (note single-trigger design).

**Acceptance criteria:**
- [ ] `publish.yml` `on:` has no `push.branches: [main]` trigger that fires on `package*.json`.
- [ ] `docs/release.md` documents the single-trigger intent and why the duplicate was removed.
- [ ] `npm run ci` passes.
- [ ] Verification invokes **no** real `npm publish` (static inspection of `on:` + the
      investigation's trigger-count reasoning in §2/§4).

### R-MNT-2 — Treat "already published" `E403` as benign skip

Implement **Option C** from the same investigation. Wrap the publish step so an `E403`
"cannot publish over the previously published versions" is classified as a **benign skip**
after confirming the already-published tarball `dist.shasum` matches the local
`npm pack` shasum; other `E403`/`E4xx` (auth/forbidden) still fail.

**Files:** `.github/workflows/publish.yml`; new fixture-based unit test for the classifier.

**Acceptance criteria:**
- [ ] Classifier unit-tested against captured stderr fixtures: benign
      (`E403` + "previously published" + matching shasum) vs auth-fail vs `E404`.
- [ ] Fixtures are captured text — **no** real `npm publish` is driven to obtain them.
- [ ] Mismatched shasum still fails the step.
- [ ] `npm run ci` passes.

### R-MNT-3 — Enforce coverage thresholds in CI

`CONTRIBUTING.md` documents a ~93% lines / ~77% branches / ~93% functions baseline, but CI
runs `--experimental-test-coverage` in report-only mode. Add an enforced threshold gate
(e.g. lines ≥ 90%, functions ≥ 90%) and refresh the documented baseline numbers from a clean
run.

**Files:** `package.json` (new `test:coverage:gate` or thresholds on `test:coverage`),
`.github/workflows/ci.yml`, `CONTRIBUTING.md`.

**Acceptance criteria:**
- [ ] CI fails when coverage drops below the threshold (demonstrated by a temporary check
      that is then reverted).
- [ ] Documented baseline in `CONTRIBUTING.md` matches a clean `npm run test:coverage` run.
- [ ] `npm run ci` green at head.
- [ ] No new runtime dependencies.

### R-MNT-4 — Add `examples/` walkthrough with fixture spine state

Create `examples/minimal-walkthrough/` showing the
`bind → next → link_pr → add_evidence → handoff → verify` flow against a checked-in fixture
`.multica-spine/` state plus a short `run-walkthrough.mjs` that exercises the store without
the live `multica` CLI. Improves onboarding for first-time contributors.

**Files:** `examples/` (new), `README.md` (link under Quick start / Docs).

**Acceptance criteria:**
- [ ] `node examples/minimal-walkthrough/run-walkthrough.mjs` exits 0 and prints a
      `verified: yes`-style summary using only the `lib/` store (no CLI / network).
- [ ] README links to the example.
- [ ] `examples/` is **not** added to the npm tarball (keep `package.json` `files` whitelist
      unchanged) — confirmed via `npm pack --dry-run`.
- [ ] `npm run ci` passes.

### R-MNT-5 — Keep-a-changelog lint script

Add a small `scripts/check-changelog.mjs` that asserts `CHANGELOG.md` has a `## [Unreleased]`
heading and at least one dated `## [x.y.z] - YYYY-MM-DD` section per published tag, then wire
it into `npm run ci`. Prevents cutting a release with an undated or missing changelog
section.

**Files:** `scripts/check-changelog.mjs` (new), `package.json`, `.github/workflows/ci.yml`.

**Acceptance criteria:**
- [ ] Script exits 0 against the current `CHANGELOG.md`.
- [ ] Script exits non-zero when `## [Unreleased]` is removed (demonstrated, then reverted).
- [ ] Script runs as part of `npm run ci`.
- [ ] No new runtime dependencies.

### R-MNT-6 — README package-contents accuracy pass

Reconcile the README "Package contents" table with the real `files` glob and the published
tarball (`npm pack --dry-run` → 18 files). Mark `ROADMAP.md` and `docs/investigations/` as
repo-only where appropriate, and fix any drift.

**Files:** `README.md`.

**Acceptance criteria:**
- [ ] Every table row maps to a real file/directory, or is explicitly marked repo-only.
- [ ] `npm pack --dry-run` contents match the documented set.
- [ ] `npm run ci` passes.

## How to update this file

- When a release ships: move `[Unreleased]` entries into a dated section, refresh
  "Current release status," and retire/promote any seed that landed.
- When a seed becomes an issue: leave the row here until the PR merges, then mark it done.
- When new technical debt is found: add a row to "Known technical debt" with a pointer to
  evidence (investigation doc, failing run, code path).
- Keep each seed at 30–90 minutes. If a seed grows past that, split it or move it to a
  tracked issue instead of leaving it here as pseudo-work.
