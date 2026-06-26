# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

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
