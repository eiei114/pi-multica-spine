import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { sha256Hex } from "./hash.ts";
import { readJsonFile } from "./json-file-store.ts";
import type { IdeaSessionInventoryRecord } from "./idea-session-inventory.ts";
import { hashWorkflowRunLedger, WorkflowRunStateStore } from "./workflow-run-state.ts";
import { HumanFinalReviewJournalSchema } from "./workflow-human-final-review-journal.ts";
import { assertValid, validateSchema } from "./validation.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export const RetentionCandidateStateSchema = ["eligible_for_future_review", "blocked", "unknown"] as const;
export type RetentionCandidateState = (typeof RetentionCandidateStateSchema)[number];
export interface RetentionCandidateReport { sessionId: string; workflowRunId?: string; state: RetentionCandidateState; reason: string; next?: string }
export interface RetentionDryRunReport { banner: "RETENTION DRY-RUN — NO FILES WERE DELETED"; eligible: RetentionCandidateReport[]; blocked: RetentionCandidateReport[]; unknown: RetentionCandidateReport[]; exitCode: 0 | 1 | 2 }
async function loadReviewJournal(canaryPath: string, workflowRunId: string) { const raw = await readJsonFile<unknown>(join(canaryPath, SPINE_STATE_ROOT, "review-journal", `${workflowRunId}.json`)); if (!raw) return undefined; try { return assertValid(validateSchema(HumanFinalReviewJournalSchema, raw), "Invalid review journal"); } catch { return undefined; } }
async function isPathContained(root: string, target: string) { const rootReal = await realpath(root); const targetReal = await realpath(target); const rel = relative(rootReal, targetReal); if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, reason: `Path escapes session root: ${target}` }; if ((await lstat(targetReal)).isSymbolicLink()) return { ok: false, reason: `Symlink escape blocked: ${target}` }; return { ok: true }; }
export async function classifyRetentionCandidate(record: IdeaSessionInventoryRecord, inventoryGeneration: number, options: { now?: Date; syntheticExternalEvidence?: boolean } = {}): Promise<RetentionCandidateReport> {
  const base = { sessionId: record.sessionId, workflowRunId: record.workflowRunId };
  if (!record.canaryPath) return { ...base, state: "unknown", reason: "Missing canary path", next: "/skill:idea-status --rebuild" };
  if (record.corrupt) return { ...base, state: "blocked", reason: record.corruptReason ?? "Corrupt authoritative source", next: `/skill:idea-status --workflow-run-id ${record.workflowRunId ?? record.sessionId} --verbose` };
  if (!record.workflowRunId || !record.ledgerPresent) return { ...base, state: "unknown", reason: "Missing authoritative run ledger", next: `/skill:idea-status --workflow-run-id ${record.workflowRunId ?? record.sessionId} --verbose` };
  const ledger = await new WorkflowRunStateStore(record.canaryPath).load(record.workflowRunId);
  if (!ledger) return { ...base, state: "unknown", reason: "Workflow run ledger could not be loaded", next: `/skill:idea-status --workflow-run-id ${record.workflowRunId} --verbose` };
  try { hashWorkflowRunLedger(ledger); } catch (error) { return { ...base, state: "blocked", reason: error instanceof Error ? error.message : String(error), next: `/skill:idea-status --workflow-run-id ${record.workflowRunId} --verbose` }; }
  const journal = await loadReviewJournal(record.canaryPath, record.workflowRunId);
  if (!journal || journal.status !== "committed") return { ...base, state: "blocked", reason: "Session is not in committed reviewed state", next: `/skill:idea-status --workflow-run-id ${record.workflowRunId} --verbose` };
  const reviewArtifact = join(record.canaryPath, SPINE_STATE_ROOT, "canary-artifacts", record.workflowRunId, "final", "10-human-final-review.md");
  const containment = await isPathContained(record.canaryPath, reviewArtifact).catch(() => ({ ok: false, reason: "Evidence path blocked" }));
  if (!containment.ok) return { ...base, state: "blocked", reason: containment.reason ?? "Evidence path blocked", next: `/skill:idea-status --workflow-run-id ${record.workflowRunId} --verbose` };
  if (!options.syntheticExternalEvidence) return { ...base, state: "blocked", reason: "Durable evidence remains inside the session tree", next: `/skill:idea-status --retention-dry-run --workflow-run-id ${record.workflowRunId} --verbose` };
  const ageDays = ((options.now ?? new Date()).getTime() - new Date(journal.updatedAt).getTime()) / 86_400_000;
  if (ageDays < 7) return { ...base, state: "blocked", reason: "Reviewed session has not reached the 7-day future-review window", next: `/skill:idea-status --retention-dry-run --workflow-run-id ${record.workflowRunId}` };
  if (inventoryGeneration <= 0) return { ...base, state: "unknown", reason: "Stale inventory generation", next: "/skill:idea-status --rebuild" };
  return { ...base, state: "eligible_for_future_review", reason: "Synthetic external evidence fixture with committed review and valid ledger", next: `/skill:idea-status --retention-dry-run --workflow-run-id ${record.workflowRunId} --verbose` };
}
export async function buildRetentionDryRunReport(records: IdeaSessionInventoryRecord[], inventoryGeneration: number, options: { syntheticExternalEvidenceFor?: string; now?: Date } = {}): Promise<RetentionDryRunReport> {
  const eligible: RetentionCandidateReport[] = []; const blocked: RetentionCandidateReport[] = []; const unknown: RetentionCandidateReport[] = [];
  for (const record of records) { const candidate = await classifyRetentionCandidate(record, inventoryGeneration, { now: options.now, syntheticExternalEvidence: options.syntheticExternalEvidenceFor === record.workflowRunId }); (candidate.state === "eligible_for_future_review" ? eligible : candidate.state === "blocked" ? blocked : unknown).push(candidate); }
  let exitCode: 0 | 1 | 2 = 0; if (unknown.length) exitCode = 2; else if (blocked.length) exitCode = 1;
  return { banner: "RETENTION DRY-RUN — NO FILES WERE DELETED", eligible, blocked, unknown, exitCode };
}
export function retentionReportFingerprint(report: RetentionDryRunReport): string { return sha256Hex(report); }
