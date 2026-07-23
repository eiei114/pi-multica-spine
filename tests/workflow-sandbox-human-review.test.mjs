import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHermesCompositeManifest } from "../lib/hermes-adapter.ts";
import { completeHumanFinalReview } from "../lib/workflow-sandbox-human-review.ts";
import { WorkflowRunStateStore } from "../lib/workflow-run-state.ts";

function sampleBinding() {
  const manifest = createHermesCompositeManifest();
  return {
    schemaVersion: 1,
    multicaProjectId: "proj_review",
    projectKey: "REV",
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: ".multica-spine/canary-artifacts",
    enabledOptionalStages: [],
    projectGrants: ["design_doc", "implementation"],
    humanOwnedActions: [],
    roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: "agent_worker" }])),
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "start_and_final",
    deliveryPolicy: {
      prRequired: false,
      releaseAllowed: false,
      productionAllowed: false,
      destructiveAllowed: false,
    },
  };
}

test("completeHumanFinalReview writes parent summary and review artifact", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "human-review-"));
  const manifest = createHermesCompositeManifest();
  const binding = sampleBinding();
  const { ProjectWorkflowBindingStore } = await import("../lib/project-workflow-binding-store.ts");
  await new ProjectWorkflowBindingStore(cwd).save(binding);
  const runStore = new WorkflowRunStateStore(cwd);
  await runStore.create({
    workflowRunId: "run_review",
    multicaProjectId: binding.multicaProjectId,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    adapterBundleHash: manifest.derivedBundleHash,
    executionMode: binding.executionMode,
    initialStageId: "capture",
  });
  await runStore.upsertStage("run_review", {
    stageId: "final_package",
    status: "accepted",
    attempt: 1,
    issueId: "issue_final",
    assignedAgentId: "agent_worker",
    artifactHashes: [],
  });
  let ledger = await runStore.load("run_review");
  ledger = { ...ledger, currentStageId: "final_package", workflowStatus: "completed" };
  await runStore.save(ledger);

  const writes = [];
  const liveCli = {
    async verifyProject() {
      return {};
    },
    async getIssue(id) {
      return { id, identifier: "DOT-PARENT", project_id: binding.multicaProjectId, status: "in_review" };
    },
    async createStageIssue() {
      throw new Error("not expected");
    },
    async assignStageIssue() {
      return { id: "issue_final" };
    },
    async transitionStageIssue(id, status) {
      writes.push({ id, status });
      return { id, status };
    },
    async writeParentSummary(issueId, summary) {
      writes.push({ issueId, summary });
      return summary;
    },
    async writeStageWriteback() {
      return {};
    },
    async readRunMetadata() {
      return {};
    },
    async triggerAutopilot() {
      return {};
    },
  };

  const result = await completeHumanFinalReview(
    {
      canaryPath: cwd,
      projectId: binding.multicaProjectId,
      parentIssueId: "parent_issue",
      workflowRunId: "run_review",
    },
    {
      verdict: "approved",
      reviewer: "tester",
      notes: "approved in test",
    },
    { liveCli, runStore },
  );

  assert.equal(result.verdict, "approved");
  assert.match(result.reviewArtifactPath, /10-human-final-review\.md$/);
  const parentWrite = writes.find((item) => item.summary?.workflow_status === "completed");
  assert.ok(parentWrite);
  assert.equal(parentWrite.summary.needs_human_review, false);
});
