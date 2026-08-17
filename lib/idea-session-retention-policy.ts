import type { HumanFinalReviewJournal } from "./workflow-human-final-review-journal.ts";

/** Dry-run banner echoed by idea-status retention reports (no filesystem deletion). */
export const IDEA_SESSION_RETENTION_DRY_RUN_BANNER = "RETENTION DRY-RUN — NO FILES WERE DELETED" as const;

/** Minimum age before a reviewed session may be classified for a future Release C cleanup review. */
export const IDEA_SESSION_FUTURE_REVIEW_WINDOW_DAYS = 7;
export const IDEA_SESSION_FUTURE_REVIEW_WINDOW_MS = IDEA_SESSION_FUTURE_REVIEW_WINDOW_DAYS * 86_400_000;

/**
 * R-MNT-42 scope: classify retention candidates only.
 * Directory deletion remains a Human Gate and is deferred to a future Release C lane.
 */
export const IDEA_SESSION_RETENTION_EXECUTION_MODE = "dry_run_only" as const;

const EXTERNAL_EVIDENCE_STEPS = ["commit_parent_metadata", "transition_parent_status"] as const;

export function reviewReceiptCompleted(journal: HumanFinalReviewJournal, step: string): boolean {
  const receipt = journal.receipts.find((item) => item.step === step);
  return receipt?.status === "completed";
}

/** Parent Multica metadata + status transitions count as durable evidence outside the session tree. */
export function hasExternalRetentionEvidence(
  journal: HumanFinalReviewJournal | undefined,
  ledgerHash: string,
): boolean {
  if (!journal || journal.status !== "committed" || !journal.binding) return false;
  if (journal.binding.baseLedgerHash !== ledgerHash) return false;
  return EXTERNAL_EVIDENCE_STEPS.every((step) => reviewReceiptCompleted(journal, step));
}

export function reviewedSessionAgeMs(journal: HumanFinalReviewJournal, now: Date): number {
  return now.getTime() - new Date(journal.updatedAt).getTime();
}

export function isPastFutureReviewWindow(journal: HumanFinalReviewJournal, now: Date): boolean {
  return reviewedSessionAgeMs(journal, now) >= IDEA_SESSION_FUTURE_REVIEW_WINDOW_MS;
}
