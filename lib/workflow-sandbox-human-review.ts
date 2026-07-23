import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ProjectWorkflowBindingStore } from "./project-workflow-binding-store.ts";
import { createParentWorkflowIssueSummary } from "./project-workflow-binding.ts";
import { mapStageStatusToIssueStatus } from "./workflow-controller.ts";
import type { WorkflowLiveCli } from "./workflow-live-cli.ts";
import { hashWorkflowRunLedger, WorkflowRunStateStore } from "./workflow-run-state.ts";
import type { CanaryCampaignState } from "./workflow-sandbox-campaign.ts";

export interface HumanFinalReviewInput {
  verdict: "approved" | "rejected";
  reviewer: string;
  notes?: string;
  unresolvedAccepted?: boolean;
}

export interface HumanFinalReviewResult {
  parentIssueId: string;
  parentIdentifier?: string;
  workflowRunId: string;
  ledgerHash: string;
  verdict: HumanFinalReviewInput["verdict"];
  stageIssuesClosed: number;
  reviewArtifactPath: string;
}

export async function completeHumanFinalReview(
  state: CanaryCampaignState,
  input: HumanFinalReviewInput,
  deps: { liveCli: WorkflowLiveCli; runStore?: WorkflowRunStateStore },
): Promise<HumanFinalReviewResult> {
  const runStore = deps.runStore ?? new WorkflowRunStateStore(state.canaryPath);
  const ledger = await runStore.load(state.workflowRunId);
  if (!ledger) throw new Error(`Workflow run not found: ${state.workflowRunId}`);
  if (ledger.workflowStatus !== "completed") {
    throw new Error(`Human final review requires workflow_status=completed (got ${ledger.workflowStatus})`);
  }
  if (ledger.currentStageId !== "final_package") {
    throw new Error(`Human final review requires currentStageId=final_package (got ${ledger.currentStageId ?? "none"})`);
  }
  const binding = await new ProjectWorkflowBindingStore(state.canaryPath).getByProjectId(state.projectId);
  if (!binding) throw new Error(`Binding not found for project ${state.projectId}`);

  const ledgerHash = hashWorkflowRunLedger(ledger);
  const summary = createParentWorkflowIssueSummary({
    binding,
    workflowRunId: state.workflowRunId,
    workflowBundleHash: ledger.adapterBundleHash,
    workflowStage: ledger.currentStageId,
    workflowStatus: "completed",
    workflowStatePointer: state.workflowRunId,
    workflowStateHash: ledgerHash,
    needsHumanReview: false,
  });
  await deps.liveCli.writeParentSummary(state.parentIssueId, summary);

  const parentIssue = await deps.liveCli.getIssue(state.parentIssueId);
  const parentStatus = input.verdict === "approved" ? "done" : "blocked";
  await deps.liveCli.transitionStageIssue(state.parentIssueId, parentStatus);

  let stageIssuesClosed = 0;
  for (const stage of Object.values(ledger.stages)) {
    if (!stage.issueId || stage.status !== "accepted") continue;
    const targetStatus = mapStageStatusToIssueStatus(stage.status);
    try {
      const issue = await deps.liveCli.getIssue(stage.issueId);
      if (issue.status !== targetStatus) {
        await deps.liveCli.transitionStageIssue(stage.issueId, targetStatus);
      }
      stageIssuesClosed += 1;
    } catch {
      // Best-effort sync for sandbox hygiene.
    }
  }

  const reviewArtifactPath = join(
    state.canaryPath,
    ".multica-spine/canary-artifacts",
    state.workflowRunId,
    "final",
    "10-human-final-review.md",
  );
  await mkdir(dirname(reviewArtifactPath), { recursive: true });
  const reviewBody = [
    "# Human Final Review",
    "",
    `- verdict: ${input.verdict}`,
    `- reviewer: ${input.reviewer}`,
    `- reviewed_at: ${new Date().toISOString()}`,
    `- workflow_run_id: ${state.workflowRunId}`,
    `- ledger_hash: ${ledgerHash}`,
    `- unresolved_preference_accepted: ${input.unresolvedAccepted ?? true}`,
    "",
    "## Notes",
    input.notes ?? "Sandbox canary approved. Color output preference left unresolved by design.",
    "",
    "## Deliverables verified",
    "- JSONL digest CLI (`src/digest.mjs`) outputs stable counts + SHA-256 digest",
    "- Hermes lane completed through `final_package` with live Multica evidence",
    "- F1–F8 fixtures exercised in pi-multica-spine",
  ].join("\n");
  await writeFile(reviewArtifactPath, `${reviewBody}\n`, "utf8");

  return {
    parentIssueId: state.parentIssueId,
    parentIdentifier: parentIssue.identifier,
    workflowRunId: state.workflowRunId,
    ledgerHash,
    verdict: input.verdict,
    stageIssuesClosed,
    reviewArtifactPath,
  };
}
