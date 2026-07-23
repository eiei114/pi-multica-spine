import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reconcileWorkflowEvents } from "../lib/workflow-controller-autopilot.ts";
import { createHermesCompositeManifest } from "../lib/hermes-adapter.ts";
import { buildStageArtifactContent, runCanaryCampaign } from "../lib/workflow-sandbox-campaign.ts";
import { runFixture } from "../lib/workflow-sandbox-fixtures.ts";
import { WorkflowRunStateStore } from "../lib/workflow-run-state.ts";

function sampleBinding() {
  const manifest = createHermesCompositeManifest();
  return {
    schemaVersion: 1,
    multicaProjectId: "proj_fixture",
    projectKey: "FIX",
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: ".multica-spine/canary-artifacts",
    enabledOptionalStages: [],
    projectGrants: ["design_doc", "implementation", "verification"],
    humanOwnedActions: [],
    roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: "agent_worker", capabilityProfile: role }])),
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

test("buildStageArtifactContent records unresolved color preference in question_resolution", () => {
  const manifest = createHermesCompositeManifest();
  const ledger = {
    workflowRunId: "run_fixture",
    adapterBundleHash: manifest.derivedBundleHash,
    stages: {},
  };
  const content = buildStageArtifactContent("question_resolution", manifest, ledger, "rough idea");
  assert.match(content, /unresolved/i);
});

test("workflow sandbox fixtures F3 duplicate event dedupes", async () => {
  const result = await runFixture("F3_duplicate_event");
  assert.equal(result.ok, true);
  assert.equal(result.name, "F3_duplicate_event");
});

test("workflow sandbox fixtures F5 rejects artifact path mutation", async () => {
  const result = await runFixture("F5_artifact_mutation");
  assert.equal(result.ok, true);
  assert.match(result.detail ?? "", /reject|mismatch|immutable/i);
});

test("runCanaryCampaign advances one stage with fixture live cli", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "campaign-"));
  const manifest = createHermesCompositeManifest();
  const binding = sampleBinding();
  const { ProjectWorkflowBindingStore } = await import("../lib/project-workflow-binding-store.ts");
  await new ProjectWorkflowBindingStore(cwd).save(binding);
  const runStore = new WorkflowRunStateStore(cwd);
  await runStore.create({
    workflowRunId: "run_campaign",
    multicaProjectId: binding.multicaProjectId,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    adapterBundleHash: manifest.derivedBundleHash,
    executionMode: binding.executionMode,
    initialStageId: "capture",
  });
  let ledger = await runStore.load("run_campaign");
  ledger = await runStore.upsertStage("run_campaign", {
    stageId: "capture",
    status: "seeded",
    attempt: 1,
    issueId: "issue_capture",
    assignedAgentId: "agent_worker",
    artifactHashes: [],
  });
  const issues = new Map([["parent_issue", { id: "parent_issue", project_id: binding.multicaProjectId, identifier: "DOT-FIX" }]]);
  const liveCli = {
    async verifyProject() {
      return {};
    },
    async getIssue(id) {
      const issue = issues.get(id);
      if (!issue) throw new Error(`missing issue ${id}`);
      return issue;
    },
    async createStageIssue(input) {
      const issue = { id: `issue_${input.stage}`, project_id: input.projectId, identifier: `DOT-${input.stage}` };
      issues.set(issue.id, issue);
      return issue;
    },
    async assignStageIssue() {
      return issues.values().next().value;
    },
    async transitionStageIssue() {
      return issues.values().next().value;
    },
    async writeParentSummary() {
      return {};
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
  const result = await runCanaryCampaign(
    {
      canaryPath: cwd,
      projectId: binding.multicaProjectId,
      parentIssueId: "parent_issue",
      workflowRunId: "run_campaign",
    },
    { liveCli, runStore, roughIdea: "fixture rough idea", maxStageCycles: 1 },
  );
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, "capture");
});
