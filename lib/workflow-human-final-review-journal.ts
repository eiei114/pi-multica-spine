import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { StringEnum } from "./schema.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";
import type { WorkflowLiveCli } from "./workflow-live-cli.ts";
import { hashWorkflowRunLedger, WorkflowRunStateStore, type WorkflowRunStateLedger } from "./workflow-run-state.ts";
import { createParentWorkflowIssueSummary } from "./project-workflow-binding.ts";
import { ProjectWorkflowBindingStore } from "./project-workflow-binding-store.ts";
import { mapStageStatusToIssueStatus } from "./workflow-controller.ts";
import type { CanaryCampaignState } from "./workflow-sandbox-campaign.ts";

export const HumanFinalReviewJournalStatusSchema = StringEnum(["preparing", "committed", "reviewed_cleanup_pending", "failed"]);
export type HumanFinalReviewJournalStatus = Static<typeof HumanFinalReviewJournalStatusSchema>;
export const HumanFinalReviewReceiptSchema = Type.Object({ step: Type.String({ minLength: 1 }), status: StringEnum(["pending", "completed", "failed"]), attempt: Type.Integer({ minimum: 1 }), error: Type.Optional(Type.String({ minLength: 1 })), completedAt: Type.Optional(Type.String({ minLength: 1 })) });
export type HumanFinalReviewReceipt = Static<typeof HumanFinalReviewReceiptSchema>;
export const HumanFinalReviewBindingSchema = Type.Object({ reviewAttempt: Type.Integer({ minimum: 1 }), normalizedVerdict: StringEnum(["approved", "rejected"]), baseLedgerStateVersion: Type.Integer({ minimum: 1 }), baseLedgerHash: Type.String({ pattern: "^[a-f0-9]{64}$" }), reviewArtifactHash: Type.String({ pattern: "^[a-f0-9]{64}$" }), reviewedAt: Type.String({ minLength: 1 }) });
export type HumanFinalReviewBinding = Static<typeof HumanFinalReviewBindingSchema>;
export const HumanFinalReviewJournalSchema = Type.Object({ schemaVersion: Type.Integer({ minimum: 1 }), workflowRunId: Type.String({ minLength: 1 }), status: HumanFinalReviewJournalStatusSchema, binding: Type.Optional(HumanFinalReviewBindingSchema), receipts: Type.Array(HumanFinalReviewReceiptSchema), failedStageId: Type.Optional(Type.String({ minLength: 1 })), nextAction: Type.Optional(Type.String({ minLength: 1 })), updatedAt: Type.String({ minLength: 1 }) });
export type HumanFinalReviewJournal = Static<typeof HumanFinalReviewJournalSchema>;
export interface HumanFinalReviewInput { verdict: "approved" | "rejected"; reviewer: string; notes?: string; unresolvedAccepted?: boolean }
export interface HumanFinalReviewJournalResult { status: HumanFinalReviewJournalStatus; binding?: HumanFinalReviewBinding; reviewArtifactPath?: string; parentIdentifier?: string; workflowRunId: string; nextAction?: string; failedStageId?: string; error?: string }

const STEPS = ["write_review_artifact", "commit_parent_metadata", "transition_parent_status", "close_stage_issues"] as const;
const journalPath = (canaryPath: string, workflowRunId: string) => join(canaryPath, SPINE_STATE_ROOT, "review-journal", `${workflowRunId}.json`);
const artifactPathFor = (canaryPath: string, workflowRunId: string) => join(canaryPath, SPINE_STATE_ROOT, "canary-artifacts", workflowRunId, "final", "10-human-final-review.md");
const initialReceipts = (): HumanFinalReviewReceipt[] => STEPS.map((step) => ({ step, status: "pending", attempt: 1 }));
const reviewBody = (input: HumanFinalReviewInput, workflowRunId: string, ledgerHash: string, reviewedAt: string) => ["# Human Final Review", "", `- verdict: ${input.verdict}`, `- reviewer: ${input.reviewer}`, `- reviewed_at: ${reviewedAt}`, `- workflow_run_id: ${workflowRunId}`, `- ledger_hash: ${ledgerHash}`, `- unresolved_preference_accepted: ${input.unresolvedAccepted ?? true}`, "", "## Notes", input.notes ?? "Sandbox review completed.", ""].join("\n");

export class HumanFinalReviewJournalStore {
  private readonly canaryPath: string;
  constructor(canaryPath: string) { this.canaryPath = canaryPath; }
  async load(workflowRunId: string) { const raw = await readJsonFile<unknown>(journalPath(this.canaryPath, workflowRunId)); return raw ? assertValid(validateSchema(HumanFinalReviewJournalSchema, raw), "Invalid human final review journal") : undefined; }
  async save(journal: HumanFinalReviewJournal) { await writeJsonAtomic(journalPath(this.canaryPath, journal.workflowRunId), journal); return journal; }
  async begin(workflowRunId: string): Promise<HumanFinalReviewJournal> { return withFileLock(journalPath(this.canaryPath, workflowRunId), async () => { const existing = await this.load(workflowRunId); if (existing) return existing; return this.save({ schemaVersion: 1, workflowRunId, status: "preparing", receipts: initialReceipts(), updatedAt: new Date().toISOString() }); }); }
}

export async function runResumableHumanFinalReview(state: CanaryCampaignState, input: HumanFinalReviewInput, deps: { liveCli: WorkflowLiveCli; runStore?: WorkflowRunStateStore; reviewArtifactPath?: string; journalStore?: HumanFinalReviewJournalStore }): Promise<HumanFinalReviewJournalResult> {
  const runStore = deps.runStore ?? new WorkflowRunStateStore(state.canaryPath);
  const journalStore = deps.journalStore ?? new HumanFinalReviewJournalStore(state.canaryPath);
  const ledger = await runStore.load(state.workflowRunId);
  if (!ledger || ledger.workflowStatus !== "completed" || ledger.currentStageId !== "final_package") throw new Error("Human final review requires completed workflow at final_package");
  const started = await journalStore.begin(state.workflowRunId);
  let journal: HumanFinalReviewJournal = started;
  const artifactPath = deps.reviewArtifactPath ?? artifactPathFor(state.canaryPath, state.workflowRunId);
  const ledgerHash = hashWorkflowRunLedger(ledger);
  if (!journal.binding) {
    const reviewedAt = new Date().toISOString();
    journal = await journalStore.save({ ...journal, binding: { reviewAttempt: 1, normalizedVerdict: input.verdict, baseLedgerStateVersion: ledger.stateVersion, baseLedgerHash: ledgerHash, reviewedAt, reviewArtifactHash: sha256Hex(reviewBody(input, state.workflowRunId, ledgerHash, reviewedAt)) }, updatedAt: reviewedAt });
  }
  else if (journal.binding.normalizedVerdict !== input.verdict) throw new Error("Conflicting final review verdict for the same workflow run");
  const binding = journal.binding!;
  const receipts = journal.receipts.map((item) => ({ ...item }));
  const done = (step: string) => { const i = receipts.findIndex((item) => item.step === step); if (i >= 0) receipts[i] = { ...receipts[i], status: "completed", completedAt: new Date().toISOString() }; };
  const failed = (step: string, error: string) => { const i = receipts.findIndex((item) => item.step === step); if (i >= 0) receipts[i] = { ...receipts[i], status: "failed", error }; };
  try {
    if (receipts.find((item) => item.step === "write_review_artifact")?.status !== "completed") {
      const body = reviewBody({ ...input, verdict: binding.normalizedVerdict }, state.workflowRunId, binding.baseLedgerHash, binding.reviewedAt);
      if (sha256Hex(body) !== binding.reviewArtifactHash) throw new Error("Review artifact content does not match immutable binding");
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, body + "\n", "utf8");
      done("write_review_artifact");
    }
    const bindingConfig = await new ProjectWorkflowBindingStore(state.canaryPath).getByProjectId(state.projectId);
    if (!bindingConfig) throw new Error(`Binding not found for project ${state.projectId}`);
    if (receipts.find((item) => item.step === "commit_parent_metadata")?.status !== "completed") {
      await deps.liveCli.writeParentSummary(state.parentIssueId, createParentWorkflowIssueSummary({ binding: bindingConfig, workflowRunId: state.workflowRunId, workflowBundleHash: ledger.adapterBundleHash, workflowStage: ledger.currentStageId ?? "final_package", workflowStatus: "completed", workflowStatePointer: state.workflowRunId, workflowStateHash: binding.baseLedgerHash, needsHumanReview: false }));
      await deps.liveCli.getIssue(state.parentIssueId);
      done("commit_parent_metadata");
    }
    if (receipts.find((item) => item.step === "transition_parent_status")?.status !== "completed") {
      await deps.liveCli.transitionStageIssue(state.parentIssueId, binding.normalizedVerdict === "approved" ? "done" : "blocked");
      done("transition_parent_status");
    }
    if (receipts.find((item) => item.step === "close_stage_issues")?.status !== "completed") {
      try {
        for (const stage of Object.values(ledger.stages)) {
          if (!stage.issueId || stage.status !== "accepted") continue;
          const target = mapStageStatusToIssueStatus(stage.status);
          const issue = await deps.liveCli.getIssue(stage.issueId);
          if (issue.status !== target) await deps.liveCli.transitionStageIssue(stage.issueId, target);
        }
        done("close_stage_issues");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed("close_stage_issues", message);
        const failedStageId = Object.values(ledger.stages).find((stage) => stage.status === "accepted")?.stageId;
        const nextAction = `/skill:idea-status --workflow-run-id ${state.workflowRunId} --verbose`;
        await journalStore.save({ ...journal, schemaVersion: 1, workflowRunId: state.workflowRunId, status: "reviewed_cleanup_pending", receipts, failedStageId, nextAction, updatedAt: new Date().toISOString() });
        const parentIssue = await deps.liveCli.getIssue(state.parentIssueId);
        return { status: "reviewed_cleanup_pending", binding, reviewArtifactPath: artifactPath, parentIdentifier: parentIssue.identifier, workflowRunId: state.workflowRunId, nextAction, failedStageId, error: message };
      }
    }
    await journalStore.save({ ...journal, schemaVersion: 1, workflowRunId: state.workflowRunId, status: "committed", receipts, updatedAt: new Date().toISOString() });
    const parentIssue = await deps.liveCli.getIssue(state.parentIssueId);
    return { status: "committed", binding, reviewArtifactPath: artifactPath, parentIdentifier: parentIssue.identifier, workflowRunId: state.workflowRunId };
  } catch (error) {
    await journalStore.save({ ...journal, schemaVersion: 1, workflowRunId: state.workflowRunId, status: "failed", receipts, nextAction: `/skill:idea-status --workflow-run-id ${state.workflowRunId} --verbose`, updatedAt: new Date().toISOString() });
    throw error;
  }
}

export function deriveReviewJournalLifecycle(ledger: WorkflowRunStateLedger, journal?: HumanFinalReviewJournal): string {
  if (journal?.status === "reviewed_cleanup_pending") return "reviewed_cleanup_pending";
  if (journal?.status === "committed") return "reviewed";
  if (ledger.currentStageId === "final_package" && ledger.workflowStatus === "completed") return "final_package";
  if (ledger.workflowStatus === "failed") return "terminal_failed";
  if (ledger.workflowStatus === "blocked") return "blocked";
  return "active";
}
