# pi-multica-spine

[![CI](https://github.com/eiei114/pi-multica-spine/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-multica-spine/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-multica-spine/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-multica-spine/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pi-multica-spine.svg)](https://www.npmjs.com/package/pi-multica-spine)
[![npm downloads](https://img.shields.io/npm/dm/pi-multica-spine.svg)](https://www.npmjs.com/package/pi-multica-spine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)
<a href="https://buymeacoffee.com/ekawano114m"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60"></a>

> A Pi extension that keeps Multica work agents bound to the issue → PR → evidence → handoff contract.

## What this is

`pi-multica-spine` is for Pi agents doing implementation or PR-producing work inside Multica. It injects a short work-agent contract and exposes typed tools that make forgotten PR binding, verification evidence, and handoff gaps visible before an agent reports done.

It also includes an **experimental workflow-adapter control-plane foundation** for the latest Multica design work: workflow catalog manifests, project workflow bindings, compact parent issue summaries, repo-local workflow run ledgers, stage transitions, artifact envelopes, question records, and effective-permission checks.

It does not replace Multica controllers, Todo Runner, Review Sentinel, or PR creation flow. It is a narrow spine for work agents.

## Features

- Twenty-six typed tools: ten work-agent spine tools plus sixteen experimental workflow-adapter control-plane tools (including live CLI bridge paths).
- Repo-local `.multica-spine/` state store with opaque issue identifiers and ASCII-safe task filenames.
- Work-agent contract injected into Pi sessions so agents see the bind → PR → evidence → handoff flow up front.
- PR binding checker with a recommended `Multica Issue: <issue-identifier>` PR body line.
- Local import closure check: `multica_spine_verify` blocks completion while a linked vault issue still has `ready_for_multica: true`.
- Done gate via `multica_spine_verify` — fails until issue binding, PR writeback, evidence, handoff, local import closure, and git completion (clean worktree, no conflict markers, pushed commits, current PR head SHA) are complete.
- Experimental workflow-adapter persistence under `.multica-spine/workflow-catalog/`, `.multica-spine/workflow-bindings/`, and `.multica-spine/workflow-runs/`.
- Workflow catalog manifest validation, lifecycle transitions, project binding validation, parent summary generation, workflow run ledger creation, stage seeding/transitions, artifact recording, question recording, and effective-permission intersection checks.

### Work-agent spine tools

| Tool | Purpose |
|---|---|
| `multica_spine_bind` | Bind the active opaque issue identifier. Optional `localIssuePath` links a vault issue markdown for import-closure checks. |
| `multica_spine_context` | Inspect current issue, PR, evidence, handoff, and verification state. |
| `multica_spine_next` | Return current state plus the next required action. |
| `multica_spine_link_pr` | Record PR URL and metadata (`prNumber`, `prHeadSha`, `prBranch`, etc.). |
| `multica_spine_add_evidence` | Record verification command/manual/test/lint/typecheck evidence. |
| `multica_spine_handoff` | Record structured done/changed/verification/blockers/next handoff. |
| `multica_spine_verify` | Completion check. Fails until issue, PR binding, writeback, evidence, handoff, local import closure, and git completion blockers are resolved. |
| `multica_spine_metadata_list` | Read all per-issue metadata keys via `multica issue metadata list --output json`. Defaults to the bound issue. |
| `multica_spine_metadata_set` | Write one metadata key/value via `multica issue metadata set --output json`. Stored type matches the JS `value` type unless `type` overrides it. |
| `multica_spine_metadata_delete` | Remove one metadata key via `multica issue metadata delete --output json`. Deleting a missing key is a no-op. |

The `multica_spine_metadata_*` tools are CLI wrappers around the `multica` CLI. They always pass `--output json` and return the parsed key/value map. Each accepts an optional `issueIdentifier` (UUID or key like `DOT-123`) and falls back to the currently bound issue when omitted. They are independent of the bind → PR → evidence → handoff → verify completion gate, so reading or writing metadata does not affect `multica_spine_verify`.

### Experimental workflow-adapter tools

| Tool | Purpose |
|---|---|
| `multica_workflow_catalog_put` | Validate and persist one workflow catalog manifest entry. |
| `multica_workflow_catalog_get` | Read one persisted catalog entry by adapter id/version. |
| `multica_workflow_catalog_list` | List repo-local catalog entries. |
| `multica_workflow_catalog_transition` | Move an entry through `quarantined / audited / active / deprecated / revoked`. |
| `multica_workflow_binding_put` | Validate and persist one project workflow binding against the catalog manifest. |
| `multica_workflow_binding_get` | Read one persisted workflow binding by project id/key. |
| `multica_workflow_binding_list` | List repo-local workflow bindings. |
| `multica_workflow_parent_summary` | Build the compact parent workflow issue summary for a workflow run. Optional `writeback=true` writes summary metadata to the parent issue via live CLI. |
| `multica_workflow_run_create` | Create one repo-local workflow run ledger from a binding + catalog entry. `live=true` writes parent summary metadata. |
| `multica_workflow_run_context` | Inspect one workflow run ledger and state hash. `live=true` also reads parent issue metadata. |
| `multica_workflow_stage_seed` | Seed the next/specified stage from manifest order + binding role routes. `live=true` creates and assigns a Multica stage issue. |
| `multica_workflow_stage_transition` | Transition a stage through `seeded / waiting / produced / accepted / retrying / failed`. `live=true` mirrors status on the stage issue. |
| `multica_workflow_artifact_record` | Record a workflow artifact envelope in the ledger. `live=true` writes artifact lineage metadata to the producer issue. |
| `multica_workflow_question_record` | Record a Question Task answer artifact in the ledger. |
| `multica_workflow_permission_check` | Compute effective permission as Adapter ∩ Project ∩ Stage ∩ Issue ∩ Agent capability. |
| `multica_workflow_autopilot_trigger` | Invoke `multica autopilot trigger` for controller reconciliation paths. |

These workflow tools layer repo-local validation/state with optional **live Multica CLI** operations (`live` / `writeback`). Catalog/binding/run ledgers remain repo-local; stage issue create/assign/status, parent summary writeback, artifact lineage metadata, run metadata reads, and autopilot triggers go through the real `multica` executable via injectable runners (fixture-backed in tests).

## Install

Install the published npm package with Pi:

```bash
pi install npm:pi-multica-spine
```

Replace `pi-multica-spine` with the exact `name` from `package.json` when you fork or republish this package.

Pin a specific version when you want reproducible installs:

```bash
pi install npm:pi-multica-spine@0.1.4
```

Install into the current project instead of your user Pi settings:

```bash
pi install npm:pi-multica-spine -l
```

Or install from GitHub:

```bash
pi install git:github.com/eiei114/pi-multica-spine
```

Try it without permanently installing:

```bash
pi -e npm:pi-multica-spine
```

## Quick start

Clone the repo and try the extension locally:

```bash
git clone https://github.com/eiei114/pi-multica-spine.git
cd pi-multica-spine
npm install
pi -e .
```

Then bind an issue and walk the spine:

1. Call `multica_spine_bind` with your opaque issue identifier. Pass `localIssuePath` when a vault issue markdown should be tracked for import closure.
2. Call `multica_spine_next` to see the required next action.
3. Open a PR whose branch, title, or body references the bound issue.
4. Call `multica_spine_link_pr` with PR URL, number, head SHA, branch, and `writebackRecorded: true` after the source issue is updated.
5. Call `multica_spine_add_evidence` with verification results.
6. Call `multica_spine_handoff` with a reviewer-ready summary.
7. If a linked local issue markdown exists, set `ready_for_multica: false` in its frontmatter before verify.
8. Call `multica_spine_verify` before reporting done.

Recommended PR body line:

```md
Multica Issue: <issue-identifier>
```

### Contract injected into work-agent sessions

```md
You are acting as a Multica Work Agent.

For Multica implementation or PR-producing work:
1. Bind the active issue identifier with multica_spine_bind.
2. Use multica_spine_next to see the required next action.
3. Ensure PRs reference the bound issue identifier.
4. If a linked local issue markdown exists, set ready_for_multica: false before reporting done so import does not re-queue completed work.
5. Do not report done until multica_spine_verify passes.
```

### Local import closure

When a vault issue markdown is linked (via `localIssuePath` on bind, or auto-discovery under `Issues/`, `issues/`, or `4_Project/Multica-Agent-Strategy/Issues/`), `multica_spine_verify` checks that its frontmatter has `ready_for_multica: false` before completion.

Example frontmatter after work is done:

```yaml
---
title: Example task
ready_for_multica: false
multica_issue: <issue-identifier>
---
```

### State files

State is repo-local:

```txt
.multica-spine/current.json
.multica-spine/tasks/<safe-issue-identifier>.json
.multica-spine/workflow-catalog/<adapter>/v<version>.json
.multica-spine/workflow-bindings/<project>.json
.multica-spine/workflow-runs/<workflow-run-id>/state-ledger.json
```

Issue identifiers are stored canonically as opaque strings. Filenames are ASCII-safe slugs with a short hash suffix.

## Package contents

| Path | Purpose |
|---|---|
| `extensions/` | Pi TypeScript extension entrypoint (`index.ts`) |
| `lib/` | Spine state store, state machine, PR binding checker, workflow catalog/binding/run ledger primitives, permission/controller helpers, and schemas |
| `docs/` | Release and maintainer docs (`release.md`) |
| `README.md` | Public entrypoint (this file) |
| `LICENSE` | MIT license |
| `CHANGELOG.md` | Version history |

## Development

```bash
npm install
npm run ci
```

`npm run ci` runs typecheck, test coverage, and `npm pack --dry-run`.

Individual checks:

```bash
npm run typecheck
npm test
npm run test:coverage
npm run pack:check
```

## Release

This package is set up for npm Trusted Publishing, so no `NPM_TOKEN` is required.

```bash
npm version patch
git push
```

On `main`, `.github/workflows/auto-release.yml` creates the `v<version>` tag and GitHub Release, then dispatches `.github/workflows/publish.yml` to publish to npm.

See [`docs/release.md`](docs/release.md) for setup details.

## Docs

`docs/` is optional supporting documentation. README stays the GitHub/npm entrypoint.

- [`docs/release.md`](docs/release.md) — Trusted Publishing details (README Release summarizes the flow)
- [`ROADMAP.md`](ROADMAP.md) — maintenance context, current release status, and bounded 30–90 minute seed candidates (repo-only, not packaged)

## Security

Pi packages can execute code with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/pi-multica-spine
- GitHub: https://github.com/eiei114/pi-multica-spine
- Issues: https://github.com/eiei114/pi-multica-spine/issues

## License

MIT
