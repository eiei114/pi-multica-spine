import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHermesCompositeManifest } from "../lib/hermes-adapter.ts";
import { ProjectWorkflowBindingStore } from "../lib/project-workflow-binding-store.ts";
import { WorkflowRunStateStore } from "../lib/workflow-run-state.ts";
import { runResumableHumanFinalReview } from "../lib/workflow-human-final-review-journal.ts";

test("cleanup pending preserves verdict", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hrj-"));
  const manifest = createHermesCompositeManifest();
  const binding = {
    schemaVersion: 1,
    multicaProjectId: "proj",
    projectKey: "P",
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: ".multica-spine/canary-artifacts",
    enabledOptionalStages: [],
    projectGrants: [],
    humanOwnedActions: [],
    roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: "agent_worker" }])),
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "start_and_final",
    deliveryPolicy: { prRequired: false, releaseAllowed: false, productionAllowed: false, destructiveAllowed: false },
  };
  await new ProjectWorkflowBindingStore(cwd).save(binding);
  const runStore = new WorkflowRunStateStore(cwd);
  await runStore.create({ workflowRunId: "run1", multicaProjectId: binding.multicaProjectId, adapterId: manifest.adapterId, adapterVersion: manifest.adapterVersion, adapterBundleHash: manifest.derivedBundleHash, executionMode: binding.executionMode, initialStageId: "capture" });
  await runStore.upsertStage("run1", { stageId: "final_package", status: "accepted", attempt: 1, issueId: "issue_final", assignedAgentId: "agent_worker", artifactHashes: [] });
  let ledger = await runStore.load("run1");
  ledger = { ...ledger, currentStageId: "final_package", workflowStatus: "completed" };
  await runStore.save(ledger);
  const liveCli = {
    async getIssue(id) { return { id, identifier: "DOT-1", status: "in_review" }; },
    async transitionStageIssue(id, status) { if (id === "issue_final") throw new Error("fail"); return { id, status }; },
    async writeParentSummary() { return {}; },
  };
  const result = await runResumableHumanFinalReview({ canaryPath: cwd, projectId: binding.multicaProjectId, parentIssueId: "parent", workflowRunId: "run1" }, { verdict: "approved", reviewer: "t" }, { liveCli, runStore });
  assert.equal(result.status, "reviewed_cleanup_pending");
});
