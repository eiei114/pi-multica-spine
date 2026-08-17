# Idea session retention policy (R-MNT-42)

Concise operator notes for sandbox **idea session** cleanup classification. This lane is **read-only**: it never deletes files.

## Scope

| In scope (R-MNT-42) | Out of scope (Human Gate / Release C) |
| --- | --- |
| Inventory-backed retention **dry-run** via `/skill:idea-status --retention-dry-run` | Deleting session directories or spine state |
| Explicit eligibility rules and exit codes | Destructive Multica or production cleanup |
| Parent-evidence detection from review journal receipts | Automated closeout of `reviewed_cleanup_pending` stage issues |

Execution mode is `dry_run_only` (`lib/idea-session-retention-policy.ts`).

## Operator command

```bash
npm run build
node scripts/workflow-idea-status.mjs --retention-dry-run --json
```

Per-session:

```bash
node scripts/workflow-idea-status.mjs --retention-dry-run --workflow-run-id <run-id> --json
```

Banner when dry-run is active: `RETENTION DRY-RUN — NO FILES WERE DELETED`.

## Classification states

| State | Meaning |
| --- | --- |
| `eligible_for_future_review` | Safe to queue for a **future** Release C human review of directory cleanup |
| `blocked` | Retain the session tree (missing external evidence, young review, corrupt ledger, etc.) |
| `unknown` | Inventory or ledger facts are incomplete — rebuild or inspect verbose status |

Dry-run exit codes: `0` all eligible, `1` any blocked, `2` any unknown.

## Eligibility rules (committed reviewed sessions)

A session is **eligible_for_future_review** only when **all** hold:

1. Inventory record has a valid `canaryPath`, non-corrupt ledger, and `workflowRunId`.
2. Human final review journal status is `committed` (not `reviewed_cleanup_pending`).
3. Review artifact path stays inside the session root (symlink escape blocked).
4. **External evidence** exists: review journal receipts show completed `commit_parent_metadata` and `transition_parent_status`, with `binding.baseLedgerHash` matching the current ledger hash. Parent Multica metadata is treated as durable evidence outside the session tree.
5. Review journal `updatedAt` is at least **7 days** old (`IDEA_SESSION_FUTURE_REVIEW_WINDOW_DAYS`).
6. Inventory `generation` is positive (not stale).

Until rules 4–5 pass, classification returns **blocked** with `Durable evidence remains inside the session tree` or the future-review window message.

## Lifecycle cleanup (not retention deletion)

`reviewed_cleanup_pending` means final review committed but stage-issue closure failed. Operators recover via:

```bash
/skill:idea-status --workflow-run-id <run-id> --verbose
```

That path is **stage closure**, not filesystem retention.

## Related docs

- [`skills/idea-status/SKILL.md`](../skills/idea-status/SKILL.md)
- [`docs/workflow-ops-checklist.md`](workflow-ops-checklist.md)
- Closeout: [`docs/investigations/2026-08-17-rmnt-42-closeout.md`](investigations/2026-08-17-rmnt-42-closeout.md)
