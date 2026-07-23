import assert from "node:assert/strict";
import test from "node:test";

const {
  canAcceptProducedStage,
  computeEffectivePermission,
  resolveNextStageId,
  seedWorkflowStage,
  transitionWorkflowStage,
} = await import("../lib/workflow-controller.ts");

test("computeEffectivePermission returns the strict intersection and blocked adapter requests", () => {
  const result = computeEffectivePermission({
    adapterRequest: ["design_doc", "release", "research"],
    projectGrant: ["design_doc", "research", "release"],
    stageGrant: ["design_doc", "research"],
    issueBoundary: ["design_doc", "research"],
    agentCapability: ["design_doc"],
  });

  assert.deepEqual(result.granted, ["design_doc"]);
  assert.deepEqual(result.blocked, ["release", "research"]);
});

test("resolveNextStageId walks manifest order", () => {
  const manifest = {
    stages: [{ stageId: "capture" }, { stageId: "design" }, { stageId: "review" }],
  };
  assert.equal(resolveNextStageId(manifest), "capture");
  assert.equal(resolveNextStageId(manifest, "capture"), "design");
  assert.equal(resolveNextStageId(manifest, "review"), undefined);
});

test("seedWorkflowStage uses binding role routes and transitionWorkflowStage enforces legal moves", () => {
  const ledger = { stages: {} };
  const manifest = {
    stages: [
      { stageId: "capture", role: "interview" },
      { stageId: "review", role: "reviewer" },
    ],
  };
  const binding = {
    roleRoutes: {
      interview: { agentId: "agent_interview" },
      reviewer: { agentId: "agent_review" },
    },
  };

  const seeded = seedWorkflowStage(ledger, manifest, binding, { stageId: "capture", attempt: 1 });
  assert.equal(seeded.assignedAgentId, "agent_interview");
  assert.equal(seeded.status, "seeded");

  const produced = transitionWorkflowStage(seeded, "produced");
  assert.equal(produced.status, "produced");

  assert.equal(canAcceptProducedStage(produced, { outputHash: "a".repeat(64) }), true);
  const accepted = transitionWorkflowStage(produced, "accepted", { outputHash: "a".repeat(64) });
  assert.equal(accepted.status, "accepted");
  assert.throws(() => transitionWorkflowStage(accepted, "produced"), /Invalid stage transition/);
});
