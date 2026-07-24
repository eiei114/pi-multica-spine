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

test("pre-handoff local lane records zero external mutations", () => {
  const spy = new ExternalMutationSpy();
  spy.assertZeroMutations();
  spy.record("multica", "project.create");
  assert.throws(() => spy.assertZeroMutations(), /zero external mutations/);
});
