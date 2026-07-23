import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createHermesAnswerArtifact,
  createHermesCompositeManifest,
  createHermesStageExecutionPacket,
  evaluateHermesSpecReview,
  HERMES_ADAPTER_ID,
  HERMES_MAX_FIX_CYCLES,
  HERMES_PINNED_SOURCE_BUNDLES,
  loadPinnedHermesBundles,
  loadHermesStageInstructions,
  resolveHermesQuestionSerially,
  resolveNextHermesStageTarget,
  validateHermesArtifactLineage,
} from "../lib/hermes-adapter.ts";
import { validateWorkflowCatalogManifest } from "../lib/workflow-catalog.ts";
import { WorkflowRunStateStore } from "../lib/workflow-run-state.ts";

function sampleBinding(enabledOptionalStages = []) {
  const manifest = createHermesCompositeManifest();
  return {
    schemaVersion: 1,
    multicaProjectId: "proj_123",
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: "Artifacts/workflows",
    enabledOptionalStages,
    projectGrants: ["design_doc", "implementation"],
    humanOwnedActions: ["release"],
    roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: `agent_${role}` }])),
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "start_and_final",
    deliveryPolicy: {
      prRequired: true,
      releaseAllowed: true,
      productionAllowed: false,
      destructiveAllowed: false,
    },
  };
}

function artifact(overrides = {}) {
  return {
    artifactSchemaVersion: 1,
    workflowRunId: "run_hermes",
    stageId: "capture",
    producerIssueId: "issue_capture",
    producerRunId: "attempt_1",
    attempt: 1,
    adapterBundleHash: createHermesCompositeManifest().derivedBundleHash,
    inputArtifactHashes: [],
    outputPath: "Artifacts/workflows/run_hermes/00-idea-capture.md",
    outputHash: "a".repeat(64),
    status: "immutable",
    ...overrides,
  };
}

test("Hermes manifest pins both audited bundles and runtime loads only by digest", async () => {
  const manifest = createHermesCompositeManifest();
  const validation = validateWorkflowCatalogManifest(manifest);
  assert.equal(validation.ok, true);
  assert.equal(manifest.adapterId, HERMES_ADAPTER_ID);
  assert.deepEqual(
    manifest.sourceBundles.map((bundle) => bundle.sourceCommit),
    [
      "acf82c9a169050c06ed33b9514ac1e17b6ccb68c",
      "5db0d93e7acfd81a7e9f4a64a257d65501102684",
    ],
  );
  const requested = [];
  const filesByHash = new Map(manifest.sourceBundles.map((bundle) => [
    bundle.sourceContentHash,
    Object.fromEntries([...new Set(manifest.stages
      .filter((stage) => stage.sourceBundle === bundle.name)
      .flatMap((stage) => stage.instructionRefs))].map((ref) => [ref, `# Audited ${ref}`])),
  ]));
  const snapshots = await loadPinnedHermesBundles({
    async loadByDigest(contentHash) {
      requested.push(contentHash);
      return { contentHash, files: filesByHash.get(contentHash) };
    },
  });
  assert.deepEqual(requested, HERMES_PINNED_SOURCE_BUNDLES.map((bundle) => bundle.sourceContentHash));
  assert.equal(snapshots.length, 2);
  const planPacket = createHermesStageExecutionPacket(manifest, "implementation_plan");
  assert.equal(planPacket.sourceBundle, "hermes-agent-supwerpowers-chatgpt");
  assert.equal(planPacket.instructionRefs[0], "superpowers-writing-plans.md");
  assert.equal(planPacket.sourceContentHash, manifest.sourceBundles[1].sourceContentHash);
  const loadedPlan = await loadHermesStageInstructions({
    async loadByDigest(contentHash) {
      return { contentHash, files: filesByHash.get(contentHash) };
    },
  }, manifest, "implementation_plan");
  assert.equal(loadedPlan.instructions[0].ref, "superpowers-writing-plans.md");
  assert.match(loadedPlan.instructions[0].content, /^# Audited/);
  await assert.rejects(
    () => loadPinnedHermesBundles({
      async loadByDigest(contentHash) {
        return { contentHash, files: { "../escape.md": "unsafe" } };
      },
    }),
    /unsafe path/,
  );
});

test("Hermes Question Tasks resolve serially with hashed provenance", () => {
  const tasks = [
    {
      questionId: "q1",
      questionTaskId: "task_1",
      prompt: "Which API behavior is documented?",
      resolverRole: "research",
    },
    {
      questionId: "q2",
      questionTaskId: "task_2",
      prompt: "Which visual style does the user prefer?",
      resolverRole: "context",
      preferenceSensitive: true,
    },
  ];
  const researched = {
    resolverAgentId: "agent_research",
    answerStatus: "researched",
    answer: "The API is idempotent.",
    sourceRefs: ["https://example.test/api"],
    provenance: [{ kind: "external_source", ref: "https://example.test/api" }],
    confidence: "high",
  };
  assert.throws(
    () => resolveHermesQuestionSerially(tasks, [], "q2", researched),
    /Question Tasks are serial/,
  );
  const first = resolveHermesQuestionSerially(tasks, [], "q1", researched);
  assert.equal(first.record.answerHash, first.artifact.answerHash);
  assert.deepEqual(first.record.provenance, ["external_source:https://example.test/api"]);

  assert.throws(
    () => createHermesAnswerArtifact(tasks[1], {
      resolverAgentId: "agent_context",
      answerStatus: "inferred",
      answer: "dark",
      sourceRefs: [],
      provenance: [{ kind: "project_context", ref: "design.md" }],
      confidence: "medium",
    }),
    /cannot fabricate a user preference/,
  );
  const unresolved = createHermesAnswerArtifact(tasks[1], {
    resolverAgentId: "agent_context",
    answerStatus: "unresolved",
    answer: "No user preference is recorded.",
    sourceRefs: [],
    provenance: [{ kind: "unresolved", ref: "no-user-statement" }],
    confidence: "low",
  });
  assert.equal(unresolved.answerStatus, "unresolved");
});

test("Hermes optional UI stage is skipped unless the Project Binding enables it", () => {
  const manifest = createHermesCompositeManifest();
  const ledger = {
    workflowRunId: "run_hermes",
    adapterId: HERMES_ADAPTER_ID,
    currentStageId: "design_doc",
    stages: { design_doc: { stageId: "design_doc", status: "accepted", attempt: 1 } },
  };
  assert.equal(resolveNextHermesStageTarget(ledger, manifest, sampleBinding()).stageId, "implementation_spec");
  assert.equal(
    resolveNextHermesStageTarget(ledger, manifest, sampleBinding(["ui_design_brief"])).stageId,
    "ui_design_brief",
  );
});

test("Hermes artifact relay enforces canonical lineage and recursively supersedes dependents", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hermes-artifacts-"));
  const manifest = createHermesCompositeManifest();
  const store = new WorkflowRunStateStore(cwd);
  await store.create({
    workflowRunId: "run_hermes",
    multicaProjectId: "proj_123",
    adapterId: HERMES_ADAPTER_ID,
    adapterVersion: 1,
    adapterBundleHash: manifest.derivedBundleHash,
    executionMode: "autonomous_until_final",
    initialStageId: "capture",
  });
  const capture = artifact();
  await store.recordArtifact("run_hermes", capture);
  await store.upsertStage("run_hermes", { stageId: "design_doc", status: "produced", attempt: 1, artifactHashes: [] });
  const design = artifact({
    stageId: "design_doc",
    outputPath: "Artifacts/workflows/run_hermes/02-design-doc.md",
    outputHash: "b".repeat(64),
    inputArtifactHashes: [capture.outputHash],
  });
  let ledger = await store.load("run_hermes");
  validateHermesArtifactLineage(ledger, manifest, design, "Artifacts/workflows");
  await store.recordArtifact("run_hermes", design);
  await assert.rejects(
    () => store.recordArtifact("run_hermes", { ...design, outputHash: "f".repeat(64) }),
    /Immutable artifact output path already exists/,
  );
  await store.upsertStage("run_hermes", { stageId: "implementation_spec", status: "produced", attempt: 1, artifactHashes: [] });
  const spec = artifact({
    stageId: "implementation_spec",
    outputPath: "Artifacts/workflows/run_hermes/04-implementation-spec.md",
    outputHash: "c".repeat(64),
    inputArtifactHashes: [design.outputHash],
  });
  await store.recordArtifact("run_hermes", spec);
  await store.upsertStage("run_hermes", { stageId: "design_doc", status: "produced", attempt: 2, artifactHashes: [] });
  const replacement = artifact({
    stageId: "design_doc",
    attempt: 2,
    outputPath: "Artifacts/workflows/run_hermes/02-design-doc-attempt-2.md",
    outputHash: "d".repeat(64),
    inputArtifactHashes: [design.outputHash],
    supersedesOutputHash: design.outputHash,
  });
  ledger = await store.load("run_hermes");
  validateHermesArtifactLineage(ledger, manifest, replacement, "Artifacts/workflows");
  const updated = await store.recordArtifact("run_hermes", replacement);
  assert.equal(updated.artifacts.find((item) => item.outputHash === design.outputHash).status, "superseded");
  assert.equal(updated.artifacts.find((item) => item.outputHash === spec.outputHash).status, "superseded");
  assert.equal(updated.artifacts.find((item) => item.outputHash === replacement.outputHash).status, "immutable");
});

test("Hermes clean PASS advances to implementation_plan not spec_fix", () => {
  const manifest = createHermesCompositeManifest();
  const ledger = {
    workflowRunId: "run_hermes",
    currentStageId: "spec_review",
    stages: {
      spec_review: { stageId: "spec_review", status: "accepted", attempt: 1 },
    },
    reviews: [{
      stageId: "spec_review",
      attempt: 1,
      verdict: "pass",
      findingIds: [],
      reviewArtifactHash: "e".repeat(64),
      recordedAt: new Date().toISOString(),
      terminal: false,
    }],
  };
  const target = resolveNextHermesStageTarget(ledger, manifest, sampleBinding());
  assert.equal(target?.stageId, "implementation_plan");
});

test("Hermes PASS WITH CHANGES advances to spec_fix without binding optional enablement", () => {
  const manifest = createHermesCompositeManifest();
  const ledger = {
    workflowRunId: "run_hermes",
    currentStageId: "spec_review",
    stages: {
      spec_review: { stageId: "spec_review", status: "accepted", attempt: 1 },
    },
    reviews: [{
      stageId: "spec_review",
      attempt: 1,
      verdict: "pass_with_changes",
      findingIds: ["F-1"],
      reviewArtifactHash: "e".repeat(64),
      recordedAt: new Date().toISOString(),
      terminal: false,
    }],
  };
  const target = resolveNextHermesStageTarget(ledger, manifest, sampleBinding());
  assert.equal(target?.stageId, "spec_fix");
});

test("Hermes spec_fix acceptance returns to spec_review with incremented attempt", () => {
  const manifest = createHermesCompositeManifest();
  const ledger = {
    workflowRunId: "run_hermes",
    currentStageId: "spec_fix",
    stages: {
      spec_fix: { stageId: "spec_fix", status: "accepted", attempt: 1 },
    },
  };
  const target = resolveNextHermesStageTarget(ledger, manifest, sampleBinding());
  assert.deepEqual(target, { stageId: "spec_review", attempt: 2 });
});

test("Hermes unknown stage id throws instead of defaulting to first stage", () => {
  const manifest = createHermesCompositeManifest();
  const ledger = {
    workflowRunId: "run_hermes",
    currentStageId: "not_a_real_stage",
    stages: {
      not_a_real_stage: { stageId: "not_a_real_stage", status: "accepted", attempt: 1 },
    },
  };
  assert.throws(
    () => resolveNextHermesStageTarget(ledger, manifest, sampleBinding()),
    /Unknown stage in manifest: not_a_real_stage/,
  );
});

test("Hermes review policy branches and stops after two fix cycles", () => {
  const reviewHash = "e".repeat(64);
  const ledger = {
    workflowRunId: "run_hermes",
    stages: { spec_review: { stageId: "spec_review", status: "produced", attempt: 1 } },
    artifacts: [{ outputHash: reviewHash, stageId: "spec_review", attempt: 1, status: "immutable" }],
  };
  const changes = evaluateHermesSpecReview(ledger, {
    stageId: "spec_review",
    attempt: 1,
    verdict: "pass_with_changes",
    findingIds: ["F-1"],
    reviewArtifactHash: reviewHash,
  });
  assert.equal(changes.nextStageId, "spec_fix");
  assert.equal(changes.record.terminal, false);

  const cappedAttempt = HERMES_MAX_FIX_CYCLES + 1;
  const cappedLedger = {
    workflowRunId: "run_hermes",
    stages: { spec_review: { stageId: "spec_review", status: "produced", attempt: cappedAttempt } },
    artifacts: [{ outputHash: reviewHash, stageId: "spec_review", attempt: cappedAttempt, status: "immutable" }],
  };
  const capped = evaluateHermesSpecReview(cappedLedger, {
    stageId: "spec_review",
    attempt: cappedAttempt,
    verdict: "pass_with_changes",
    findingIds: ["F-1"],
    reviewArtifactHash: reviewHash,
  });
  assert.equal(capped.record.terminal, true);
  assert.equal(capped.terminalPackage.needsHumanReview, true);
  assert.equal(capped.terminalPackage.reason, "spec_review_fix_cycle_cap_reached");
});

test("Hermes lineage allows a re-review to consume the preceding bounded fix", () => {
  const manifest = createHermesCompositeManifest();
  const fixHash = "f".repeat(64);
  const ledger = {
    workflowRunId: "run_hermes",
    adapterId: HERMES_ADAPTER_ID,
    artifacts: [{
      outputHash: fixHash,
      stageId: "spec_fix",
      attempt: 1,
      status: "immutable",
    }],
  };
  assert.doesNotThrow(() => validateHermesArtifactLineage(ledger, manifest, artifact({
    stageId: "spec_review",
    attempt: 2,
    outputPath: "Artifacts/workflows/run_hermes/06-spec-review-attempt-2.md",
    outputHash: "1".repeat(64),
    inputArtifactHashes: [fixHash],
  }), "Artifacts/workflows"));
});
