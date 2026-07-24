import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  ExternalMutationSpy,
  IdeaLocalArtifactStore,
  assertArtifactBundleUnchanged,
  validatePromotionReadyArtifacts,
} = await import("../lib/idea-local-artifact.ts");
const { LOCAL_IDEA_STAGE_IDS } = await import("../lib/idea-local-lane.ts");

function stageArtifacts() {
  return LOCAL_IDEA_STAGE_IDS.map((stageId, index) => ({
    stageId,
    outputPath: `${index}-${stageId}.md`,
    content: `artifact:${stageId}`,
  }));
}

test("local artifact registry blocks promotion_ready when build_handoff is missing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-artifact-"));
  const store = new IdeaLocalArtifactStore(cwd, "idea-1");
  const missingHandoff = stageArtifacts().filter((artifact) => artifact.stageId !== "build_handoff");
  await assert.rejects(
    store.finalizePromotionReady({ sessionId: "idea-1", workflowRunId: "idea-1", stageArtifacts: missingHandoff }),
    /build_handoff/,
  );
});

test("local artifact registry validates hash-addressed bundle for promotion_ready", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-artifact-ready-"));
  const store = new IdeaLocalArtifactStore(cwd, "idea-2");
  const registry = await store.finalizePromotionReady({
    sessionId: "idea-2",
    workflowRunId: "idea-2",
    stageArtifacts: stageArtifacts(),
  });
  assert.doesNotThrow(() => validatePromotionReadyArtifacts(registry));
  assert.equal(registry.artifacts.length, LOCAL_IDEA_STAGE_IDS.length);
});

test("local artifact registry rejects altered bundle hash and duplicate mutation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-artifact-dup-"));
  const store = new IdeaLocalArtifactStore(cwd, "idea-3");
  const registry = await store.finalizePromotionReady({
    sessionId: "idea-3",
    workflowRunId: "idea-3",
    stageArtifacts: stageArtifacts(),
  });
  assert.throws(() => assertArtifactBundleUnchanged(registry, "b".repeat(64)), /altered/);
  await assert.rejects(
    store.record({ sessionId: "idea-3", workflowRunId: "idea-3", stageId: "capture", outputPath: "x.md", content: "changed" }),
    /already recorded/,
  );
});

test("local artifact registry rejects stale stored bundle hash", () => {
  const registry = {
    schemaVersion: 1,
    sessionId: "idea-4",
    workflowRunId: "idea-4",
    artifacts: [{
      stageId: "build_handoff",
      outputPath: "05.md",
      contentHash: "a".repeat(64),
      provenance: { source: "local_lane", sessionId: "idea-4", recordedAt: "2026-07-24T00:00:00.000Z" },
    }],
    artifactBundleHash: "b".repeat(64),
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
  assert.throws(() => assertArtifactBundleUnchanged(registry, "b".repeat(64)), /inconsistent/);
});

test("validatePromotionReadyArtifacts rejects missing required stage", () => {
  const registry = {
    schemaVersion: 1,
    sessionId: "idea-missing",
    workflowRunId: "idea-missing",
    artifacts: [{
      stageId: "capture",
      outputPath: "0-capture.md",
      contentHash: "a".repeat(64),
      provenance: { source: "local_lane", sessionId: "idea-missing", recordedAt: "2026-07-24T00:00:00.000Z" },
    }],
    artifactBundleHash: "b".repeat(64),
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
  assert.throws(() => validatePromotionReadyArtifacts(registry), /Missing immutable local artifact/);
});

test("validatePromotionReadyArtifacts rejects invalid build_handoff hash", () => {
  const artifacts = stageArtifacts().map((artifact) => ({
    stageId: artifact.stageId,
    outputPath: artifact.outputPath,
    contentHash: artifact.stageId === "build_handoff" ? "short" : "a".repeat(64),
    provenance: { source: "local_lane", sessionId: "idea-handoff", recordedAt: "2026-07-24T00:00:00.000Z" },
  }));
  const registry = {
    schemaVersion: 1,
    sessionId: "idea-handoff",
    workflowRunId: "idea-handoff",
    artifacts,
    artifactBundleHash: "b".repeat(64),
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
  assert.throws(() => validatePromotionReadyArtifacts(registry), /hash-addressed/);
});

test("local artifact store rejects registry identity mismatch", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-artifact-identity-"));
  const store = new IdeaLocalArtifactStore(cwd, "idea-identity");
  await store.record({
    sessionId: "idea-identity",
    workflowRunId: "run-a",
    stageId: "capture",
    outputPath: "0-capture.md",
    content: "artifact:capture",
  });
  await assert.rejects(
    store.record({
      sessionId: "idea-identity",
      workflowRunId: "run-b",
      stageId: "clarify",
      outputPath: "1-clarify.md",
      content: "artifact:clarify",
    }),
    /identity mismatch/,
  );
});

test("assertArtifactBundleUnchanged accepts matching bundle hash", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-artifact-unchanged-"));
  const store = new IdeaLocalArtifactStore(cwd, "idea-unchanged");
  const registry = await store.finalizePromotionReady({
    sessionId: "idea-unchanged",
    workflowRunId: "idea-unchanged",
    stageArtifacts: stageArtifacts(),
  });
  assert.doesNotThrow(() => assertArtifactBundleUnchanged(registry, registry.artifactBundleHash));
});

test("ExternalMutationSpy records and asserts zero mutations", () => {
  const spy = new ExternalMutationSpy();
  spy.assertZeroMutations();
  spy.record("create", "project");
  assert.throws(() => spy.assertZeroMutations(), /Expected zero external mutations/);
  assert.equal(spy.records.length, 1);
});

test("local artifact store rejects cross-session writes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-artifact-bound-"));
  const store = new IdeaLocalArtifactStore(cwd, "idea-bound");
  await assert.rejects(
    store.record({
      sessionId: "other",
      workflowRunId: "other",
      stageId: "capture",
      outputPath: "0-capture.md",
      content: "artifact:capture",
    }),
    /bound to session/,
  );
});
