# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## [Unreleased]

## [0.5.2] - 2026-07-24

### Added

- `clearStaleDaemonTaskContext()` in `lib/multica-cli.ts` for workflow CLI hygiene.
- Production workflow run runbook (`docs/workflow-production-run-runbook.md`).

### Changed

- Sandbox canary and production run scripts auto-clear stale `.multica/daemon_task_context.json` before live Multica calls.
- ROADMAP refreshed for v0.5.1 workflow ops and live lane evidence.
- README install pin example advances to `@0.5.1`.

## [0.5.1] - 2026-07-24

### Added

- Production workflow run CLI (`scripts/workflow-production-run.mjs`, `lib/workflow-production-run.ts`) with `--start`, `--campaign`, `--human-review`, and `--report`.
- Campaign/human-review hooks for production-themed Hermes artifacts.
- README workflow operations section for v0.5.0+ scripts and color policy.

### Changed

- Install pin example advances to `@0.5.0`.

## [0.5.0] - 2026-07-23

### Added

- JSONL digest library and CLI (`lib/jsonl-digest.ts`, `scripts/jsonl-digest.mjs`) with stable sorted digests.
- Human-readable summary mode (`--human`) and opt-in color (`--color` / `--no-color`).
- Production workflow binding plan/apply (`lib/workflow-production-binding.ts`, `scripts/workflow-production-binding.mjs`).
- Human final review CLI (`--human-review`, `lib/workflow-sandbox-human-review.ts`).
- Full sandbox campaign driver (`lib/workflow-sandbox-campaign.ts`) and F1–F8 fixtures.

### Changed

- Color output preference resolved: JSON default; color opt-in on TTY.
- Sandbox canary `--apply`, `--campaign`, and `--human-review` modes documented in runbook.
- Package version advances to `0.5.0`.

### Added

- Provider telemetry snapshots with deterministic refresh jitter, allowlisted header observation, and preflight decisions (`lib/provider-telemetry.ts`).
- Fixed capability pool routing with route decision ledger records (`lib/workflow-routing.ts`).
- Controller-owned Agent Factory with lease revalidation and idempotent provisioning (`lib/workflow-agent-factory.ts`).
- Audited adapter migration dry-run, apply, and rollback helpers (`lib/workflow-adapter-migration.ts`).
- Controller tick actions for migration recovery, telemetry refresh, route recording, and agent provisioning.
- Typed Multica CLI clients for `runtime list/usage` and `agent list/get/create/skills`.
- Experimental tools: `multica_workflow_telemetry_record`, `multica_workflow_route_preflight`, `multica_workflow_adapter_migration_dry_run`, `multica_workflow_adapter_migration_apply`, `multica_workflow_adapter_migration_rollback`.
- Sandbox canary harness (`scripts/workflow-sandbox-canary.mjs`) and runbook (`docs/workflow-sandbox-canary-runbook.md`).
- Workflow stage activation model (`always`, `binding_optional`, `controller_conditional`).

### Changed

- Hermes `spec_fix` is controller-conditional; `ui_design_brief` remains binding-optional.
- Catalog `compatibleFrom` accepts canonical adapter identity strings.
- Package version advances to `0.4.0`.

## [0.3.0] - 2026-07-23

### Added

- Run-only Controller Autopilot tick loop (`lib/workflow-controller-autopilot.ts`) with lease/fencing, bounded event reconcile, orphan adoption, and generic reconciler guard for `workflow_controller`-owned stages.
- `multica_workflow_controller_tick` experimental tool to execute exactly one bounded controller action per tick with optional live parent summary writeback.
- Tests for duplicate/stale event rejection, double-acquire reject path, orphan adoption, produced-stage validation, and summary persistence (`tests/workflow-controller-autopilot.test.mjs`).
- Dedicated Hermes Idea-to-Build composite Adapter (`lib/hermes-adapter.ts`) with both external bundles pinned by full commit and canonical content digest. Runtime loading uses audited digests, never live GitHub workflow content.
- Serial Hermes Question Task resolution with provenance-bearing Answer Artifacts, unresolved-preference preservation, and deterministic answer hashes.
- Immutable Artifact relay checks with canonical stage paths, input lineage validation, explicit supersession, and recursive downstream invalidation.
- Spec-review policy for PASS / PASS WITH CHANGES / FAIL, including at most two fix cycles and terminal human-review packages.
- `multica_workflow_hermes_manifest`, `multica_workflow_hermes_question_answer`, and `multica_workflow_hermes_review_decide` tools.

### Changed

- Project Workflow Bindings may explicitly enable optional Adapter stages; optional stages are skipped by default.
- Workflow Catalog manifests may record multiple audited source bundles for dedicated composite Adapters.
- Package version advances to `0.3.0` for the Controller + Hermes workflow lane.

## [0.2.1] - 2026-07-23

### Added

- Live Multica CLI bridge (`lib/workflow-live-cli.ts`) and expanded `lib/multica-cli.ts` issue/project/autopilot clients for workflow stage issue create/assign/status, parent summary metadata writeback, artifact lineage writeback, run metadata reads, and autopilot trigger invocation.
- Workflow tools accept `live` / `writeback` flags to mirror repo-local ledger mutations onto Multica (`multica_workflow_run_create`, `multica_workflow_run_context`, `multica_workflow_stage_seed`, `multica_workflow_stage_transition`, `multica_workflow_artifact_record`, `multica_workflow_parent_summary`).
- `multica_workflow_autopilot_trigger` experimental tool for controller execution paths.
- Fixture-backed tests for the injectable CLI executor (`tests/workflow-live-cli.test.mjs`, `tests/workflow-multica-cli.test.mjs`).

### Changed

- `ProjectWorkflowBindingStore.save` validates the bound Multica project via `multica project get` when the live CLI bridge is enabled.
- Every workflow-stage metadata writeback sets `completion_authority=workflow_controller`.

## [0.2.0] - 2026-07-23

### Changed

- Remove the `push` trigger from `.github/workflows/publish.yml` so version bumps publish through the `auto-release.yml` → `workflow_dispatch` handoff only, preventing the duplicate-publish TOCTOU race (DOT-881).

### Added

- Experimental Multica workflow-adapter foundation modules under `lib/`: workflow catalog manifest validation/lifecycle, project workflow binding + compact parent issue summary, and repo-local workflow run state-ledger storage for the latest adapter-contract design.
- Experimental workflow-adapter tools: catalog put/get/list/transition, binding put/get/list, parent summary generation, workflow run create/context, stage seed/transition, artifact/question record, and effective-permission check.

## [0.1.5] - 2026-07-20

### Changed

- Align package metadata and extension patterns with pi-extension-template 0.80.x baseline (DOT-823).
- Bump package version to `0.1.5` for the patch release.

### Added

- `multica_spine_metadata_list`, `multica_spine_metadata_set`, and `multica_spine_metadata_delete` tools: CLI wrappers around `multica issue metadata list|set|delete` that force `--output json` and return the parsed key/value map. Each tool defaults to the bound issue when `issueIdentifier` is omitted, and `set` preserves the JS value type by default (overridable via `type`). These tools are independent of the `multica_spine_verify` completion gate.
- `multica_spine_add_evidence` now dedups evidence: repeated calls with the same `kind`, `command`, and `exitCode` refresh the existing record instead of appending a duplicate, keeping at most one entry per verification step.

## [0.1.4] - 2026-07-07

### Added

- `multica_spine_verify` now checks linked local issue markdown for `ready_for_multica: false` before completion.
- Optional `localIssuePath` on `multica_spine_bind` and auto-discovery under `Issues/` / vault import folders.
- Work-agent contract prompt now reminds agents to close local import issues before reporting done.

## [0.1.3] - 2026-07-04

### Added

- Add Buy Me a Coffee sponsor button to README and native GitHub funding link via `.github/FUNDING.yml`.

### Added

- `npm run test:coverage` using Node's built-in `--experimental-test-coverage` reporter; CI runs coverage in report-only mode (no enforced thresholds yet).
- Fail fast on silent hung git network commands (`git push`, `git fetch`, `git pull`, `git ls-remote`) in work-agent bash calls with a 3-minute idle transport watchdog, distinct failure output, and actionable next-step hints for auth, remote, network, credential prompt, or shell issues.
- Regression tests for git network command detection, failure classification, and silent subprocess idle abort.

## [0.1.2] - 2026-06-28

### Added

- Added git completion checks to `multica_spine_verify` so Multica work agents cannot report done while a rebase/merge is still in progress, conflict markers remain, the worktree is dirty, local commits are unpushed, or PR head SHA metadata is stale.
- Added git next-action guidance that tells agents to run `git push --force-with-lease` after successful rebase verification instead of stopping for confirmation.

## [0.1.1] - 2026-06-27

### Changed

- Align README with the current Pi extension template: add `Features`, `Install`, `Quick start`, `Package contents`, `Release`, and `Links` sections while preserving Multica spine contract, state file, and example-flow content.

## [0.1.0] - 2026-06-18

### Added

- Initial Multica Work Agent Contract extension.
- `multica_spine_bind`, `multica_spine_context`, `multica_spine_next`, `multica_spine_link_pr`, `multica_spine_add_evidence`, `multica_spine_handoff`, and `multica_spine_verify` tools.
- Repo-local `.multica-spine/` state store with opaque issue identifiers and ASCII-safe task filenames.
- State machine for `UNBOUND`, `BOUND`, `PR_LINKED`, `EVIDENCE_READY`, `HANDOFF_READY`, and `VERIFIED`.
- PR binding checker and recommended `Multica Issue: <issue-identifier>` PR body line.
- Tests for state storage, PR binding, next action, verification failure, extension registration, and short context injection.
