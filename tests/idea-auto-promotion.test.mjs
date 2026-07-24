import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { autoPromoteIdeaSession } = await import("../lib/idea-auto-promotion.ts");
const { createHermesCompositeManifest } = await import("../lib/hermes-adapter.ts");
const { ProjectWorkflowBindingStore } = await import("../lib/project-workflow-binding-store.ts");
const { WorkflowRunStateStore } = await import("../lib/workflow-run-state.ts");

function binding(project) {
  const manifest = createHermesCompositeManifest();
  return {
    schemaVersion: 1,
    multicaProjectId: project.id,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: "Artifacts/workflows",
    projectGrants: ["implementation"],
    humanOwnedActions: ["release", "production", "destructive", "billing", "secrets"],
    roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: `agent-${role}` }])),
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "final_only",
    deliveryPolicy: { prRequired: true, releaseAllowed: false, productionAllowed: false, destructiveAllowed: false },
  };
}

test("automatic promotion dry-run reports mutations and apply creates one execution lineage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "auto-promotion-"));
  const runStore = new WorkflowRunStateStore(cwd);
  const bindingStore = new ProjectWorkflowBindingStore(cwd);
  const calls = [];
  const liveCli = {
    async verifyProject() {},
    async getIssue() { return { id: "parent", project_id: "project" }; },
    async createStageIssue(input) { calls.push(input); return { id: "stage", identifier: "DOT-1", project_id: "project" }; },
    async assignStageIssue() {},
    async transitionStageIssue() {},
    async writeParentSummary() {},
    async writeStageWriteback() {},
    async readRunMetadata() { return {}; },
    async triggerAutopilot() { return {}; },
  };
  const input = {
    sessionId: "idea-1",
    workflowRunId: "idea-1",
    projectTitle: "Daily Relic iOS",
    projectDescription: "desc",
    artifactBundleHash: "a".repeat(64),
    artifacts: [{ stageId: "build_handoff", outputPath: "05-agent-build-handoff.md", outputHash: "a".repeat(64) }],
  };
  const deps = {
    cwd,
    projects: {
      async list() { return [{ id: "project", title: "Daily Relic iOS", status: "planned" }]; },
      async create() { throw new Error("unexpected create"); },
    },
    buildBinding: binding,
    createParentIssue: async () => ({ id: "parent", identifier: "DOT-0" }),
    activateProject: async () => {},
    liveCli,
    runStore,
    bindingStore,
  };
  const dryRun = await autoPromoteIdeaSession({ ...input, dryRun: true }, deps);
  assert.equal(dryRun.mode, "dry-run");
  assert.ok(dryRun.plan?.mutations.includes("seed_spec_review"));
  assert.equal(calls.length, 0);

  const result = await autoPromoteIdeaSession(input, deps);
  assert.equal(result.mode, "promoted");
  assert.equal(result.ledger?.currentStageId, "spec_review");
  assert.equal(result.ledger?.artifacts.length, 1);
  assert.equal(calls[0].title.includes("spec_review"), true);
  assert.equal((await autoPromoteIdeaSession(input, deps)).mode, "reused");
  assert.equal(calls.length, 1);
});

test("automatic promotion rejects a binding that retains a start gate before mutation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "auto-promotion-blocked-"));
  const project = { id: "project", title: "P", status: "planned" };
  await assert.rejects(
    autoPromoteIdeaSession({
      sessionId: "idea",
      workflowRunId: "idea",
      projectTitle: "P",
      projectDescription: "d",
      artifactBundleHash: "b".repeat(64),
      artifacts: [{ stageId: "build_handoff", outputPath: "handoff", outputHash: "b".repeat(64) }],
    }, {
      cwd,
      projects: {
        async list() { return [project]; },
        async create() { return project; },
      },
      buildBinding: () => ({ ...binding(project), humanGate: "start_and_final" }),
      createParentIssue: async () => { throw new Error("must not mutate"); },
      liveCli: {},
      runStore: new WorkflowRunStateStore(cwd),
      bindingStore: new ProjectWorkflowBindingStore(cwd),
    }),
    /final_only/,
  );
});

test("duplicate planned title fails closed before mutation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "auto-promotion-dup-title-"));
  const { resolveImplementationProject } = await import("../lib/idea-project-promotion.ts");
  await assert.rejects(
    resolveImplementationProject({
      projectTitle: "Dup",
      projectDescription: "d",
      client: {
        async list() {
          return [
            { id: "a", title: "Dup", status: "planned" },
            { id: "b", title: "Dup", status: "planned" },
          ];
        },
        async create() { throw new Error("must not create"); },
      },
    }),
    /Multiple planned/,
  );
});

test("artifactsFromRegistry exports promotion artifacts from validated bundle", async () => {
  const { artifactsFromRegistry } = await import("../lib/idea-auto-promotion.ts");
  const { IdeaLocalArtifactStore } = await import("../lib/idea-local-artifact.ts");
  const { LOCAL_IDEA_STAGE_IDS } = await import("../lib/idea-local-lane.ts");
  const cwd = await mkdtemp(join(tmpdir(), "auto-promotion-artifacts-"));
  const store = new IdeaLocalArtifactStore(cwd, "idea-art");
  const registry = await store.finalizePromotionReady({
    sessionId: "idea-art",
    workflowRunId: "idea-art",
    stageArtifacts: LOCAL_IDEA_STAGE_IDS.map((stageId, index) => ({
      stageId,
      outputPath: `${index}.md`,
      content: stageId,
    })),
  });
  const artifacts = artifactsFromRegistry(registry);
  assert.equal(artifacts.some((artifact) => artifact.stageId === "build_handoff"), true);
});

test("route gap skips candidate without creating agents", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "auto-promotion-route-gap-"));
  const project = { id: "project", title: "Gap App", status: "planned" };
  const manifest = createHermesCompositeManifest();
  const partialBinding = {
    ...binding(project),
    roleRoutes: Object.fromEntries(
      manifest.roles
        .filter((role) => role !== "spec_reviewer")
        .map((role) => [role, { agentId: `agent-${role}` }]),
    ),
  };
  const result = await autoPromoteIdeaSession({
    sessionId: "gap",
    workflowRunId: "gap",
    projectTitle: "Gap App",
    projectDescription: "desc",
    artifactBundleHash: "c".repeat(64),
    artifacts: [{ stageId: "build_handoff", outputPath: "handoff", outputHash: "c".repeat(64) }],
  }, {
    cwd,
    projects: { async list() { return [project]; }, async create() { return project; } },
    buildBinding: () => partialBinding,
    createParentIssue: async () => { throw new Error("must not create parent"); },
    liveCli: {},
    runStore: new WorkflowRunStateStore(cwd),
    bindingStore: new ProjectWorkflowBindingStore(cwd),
  });
  assert.equal(result.mode, "blocked");
  assert.match(result.reason ?? "", /missing_route:spec_reviewer/);
});
