# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## [Unreleased]

- Add Buy Me a Coffee sponsor button to README and native GitHub funding link via `.github/FUNDING.yml`.

### Added

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

