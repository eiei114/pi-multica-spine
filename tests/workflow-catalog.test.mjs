import assert from "node:assert/strict";
import test from "node:test";

const {
  canTransitionWorkflowCatalogStatus,
  createWorkflowCatalogEntry,
  transitionWorkflowCatalogEntry,
  validateWorkflowCatalogManifest,
} = await import("../lib/workflow-catalog.ts");

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
    requiredTools: ["multica issue create", "multica issue update"],
    sideEffects: ["issue creation"],
    humanGates: ["final_review"],
    roles: ["interview", "reviewer"],
    stages: [
      { stageId: "capture_interview", role: "interview", questionParallelism: "serial" },
      { stageId: "spec_review", role: "reviewer" },
    ],
  };
}

test("validateWorkflowCatalogManifest accepts a well-formed manifest", () => {
  const result = validateWorkflowCatalogManifest(sampleManifest());
  assert.equal(result.ok, true);
  assert.equal(result.value.stages[0].stageId, "capture_interview");
});

test("validateWorkflowCatalogManifest rejects duplicate stage ids and unknown roles", () => {
  const manifest = sampleManifest();
  manifest.stages.push({ stageId: "capture_interview", role: "missing-role" });

  const result = validateWorkflowCatalogManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.startsWith("duplicate-stage:capture_interview")));
  assert.ok(result.errors.some((item) => item.startsWith("unknown-stage-role:capture_interview:missing-role")));
});

test("validateWorkflowCatalogManifest rejects primary source bundle mismatch", () => {
  const manifest = sampleManifest();
  manifest.sourceBundles = [{
    name: "primary-bundle",
    sourceUrl: manifest.sourceUrl,
    sourceCommit: manifest.sourceCommit,
    sourceContentHash: "c".repeat(64),
    license: "MIT",
  }];
  const result = validateWorkflowCatalogManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("source-bundle-primary-mismatch"));
});

 test("workflow catalog entry transition follows lifecycle rules", () => {
  const entry = createWorkflowCatalogEntry(sampleManifest());
  assert.equal(entry.status, "quarantined");
  assert.equal(entry.manifestDigest.length, 64);
  assert.equal(canTransitionWorkflowCatalogStatus("quarantined", "active"), false);
  assert.equal(canTransitionWorkflowCatalogStatus("quarantined", "audited"), true);

  const audited = transitionWorkflowCatalogEntry(entry, "audited");
  const active = transitionWorkflowCatalogEntry(audited, "active");
  assert.equal(active.status, "active");
  assert.throws(() => transitionWorkflowCatalogEntry(active, "audited"), /Invalid workflow catalog transition/);
});
