import assert from "node:assert/strict";
import test from "node:test";

const {
  createParentWorkflowIssueSummary,
  validateProjectWorkflowBinding,
} = await import("../lib/project-workflow-binding.ts");

function sampleManifest() {
  return {
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    sourceUrl: "https://github.com/example/hermes",
    sourceCommit: "acf82c9a169050c06ed33b9514ac1e17b6ccb68c",
    sourceContentHash: "a".repeat(64),
    derivedBundleHash: "b".repeat(64),
    license: "MIT",
    auditToolVersion: 1,
    stateSchemaVersion: 1,
    artifactSchemaVersion: 1,
    compatibleFrom: [],
    requiredTools: ["multica issue create"],
    sideEffects: [],
    humanGates: ["final_review"],
    roles: ["interview", "reviewer"],
    stages: [
      { stageId: "capture_interview", role: "interview" },
      { stageId: "spec_review", role: "reviewer" },
    ],
  };
}

function sampleBinding() {
  return {
    schemaVersion: 1,
    multicaProjectId: "proj_123",
    projectKey: "IOS-DEMO",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    artifactRoot: "Artifacts/workflows",
    projectGrants: ["design_doc", "implementation_spec"],
    humanOwnedActions: ["release", "production", "destructive"],
    roleRoutes: {
      interview: { agentId: "agent_interview" },
      reviewer: { agentId: "agent_reviewer", capabilityProfile: "ios-sol-gate" },
    },
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "start_and_final",
    deliveryPolicy: {
      prRequired: true,
      releaseAllowed: true,
      productionAllowed: true,
      destructiveAllowed: true,
    },
  };
}

test("validateProjectWorkflowBinding accepts a manifest-aligned binding", () => {
  const result = validateProjectWorkflowBinding(sampleBinding(), sampleManifest());
  assert.equal(result.ok, true);
  assert.equal(result.value.roleRoutes.interview.agentId, "agent_interview");
});

test("validateProjectWorkflowBinding rejects missing role routes and invalid autonomous gate", () => {
  const binding = sampleBinding();
  delete binding.roleRoutes.reviewer;
  binding.humanGate = "start_only";

  const result = validateProjectWorkflowBinding(binding, sampleManifest());
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("missing-role-route:reviewer"));
  assert.ok(result.errors.includes("autonomous-until-final-requires-start-and-final-human-gate"));
});

test("validateProjectWorkflowBinding rejects Windows-style artifact root traversal on every platform", () => {
  const binding = sampleBinding();
  binding.artifactRoot = "Artifacts\\..\\..\\outside";
  const result = validateProjectWorkflowBinding(binding, sampleManifest());
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("artifact-root-must-be-project-relative"));
});

test("createParentWorkflowIssueSummary stays within the compact metadata budget", () => {
  const summary = createParentWorkflowIssueSummary({
    binding: sampleBinding(),
    workflowRunId: "run_123",
    workflowBundleHash: "c".repeat(64),
    workflowStage: "capture_interview",
    workflowStatus: "waiting",
    workflowStatePointer: ".multica-spine/workflow-runs/run_123/state-ledger.json",
    workflowStateHash: "d".repeat(64),
  });

  assert.equal(summary.completion_authority, "workflow_controller");
  assert.ok(Object.keys(summary).length <= 15);
});
