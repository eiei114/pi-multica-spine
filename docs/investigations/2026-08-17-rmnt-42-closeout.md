# R-MNT-42 closeout — Idea session retention policy

**Date:** 2026-08-17  
**Seed:** Idea session cleanup / retention policy

## Delivered

| Item | Path |
| --- | --- |
| Retention policy constants + external-evidence helpers | `lib/idea-session-retention-policy.ts` |
| Classifier uses parent receipt evidence (no synthetic test flag) | `lib/retention-classifier.ts` |
| Operator policy doc | `docs/idea-session-retention-policy.md` |
| CI retention dry-run gate | `scripts/ci-offline-idea-retention-check.mjs` (`npm run check:idea-retention`) |

## Policy summary

- **Dry-run only** — banner `RETENTION DRY-RUN — NO FILES WERE DELETED`; no directory deletion in this seed.
- **External evidence** — committed review journal with completed `commit_parent_metadata` + `transition_parent_status` receipts and matching ledger hash.
- **Future-review window** — 7 days after journal `updatedAt` before `eligible_for_future_review`.
- **Destructive cleanup** — deferred to Human Gate / future Release C lane.

## Verification

```bash
npm run check:idea-retention
npm run ci
```
