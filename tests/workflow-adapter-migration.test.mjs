import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WorkflowAdapterMigrationStore,
  buildMigrationSnapshot,
  dryRunAdapterMigration,
  formatAdapterIdentity,
  rollbackAdapterMigration,
} from "../lib/workflow-adapter-migration.ts";
import { createWorkflowCatalogEntry } from "../lib/workflow-catalog.ts";

function sampleManifest(adapterVersion = 1) {
  return {
    adapterId: "hermes-idea-to-build",
    adapterVersion,
    sourceUrl: "https://github.com/example/hermes",
    sourceCommit: "acf82c9a169050c06ed33b9514ac1e17b6ccb68c",
    sourceContentHash: "a".repeat(64),
    derivedBundleHash: "b".repeat(64),
    license: "MIT",
    auditToolVersion: 1,
    stateSchemaVersion: 1,
    artifactSchemaVersion: 1,
    compatibleFrom: [],
    requiredTools: ["multica_workflow_controller_tick"],
    sideEffects: ["issue creation"],
    humanGates: ["final_review"],
    roles: ["designer"],
    stages: [{ stageId: "design_doc", role: "designer" }],
  };
}

function sampleBinding(manifest) {
  return {
    schemaVersion: 1,
    multicaProjectId: "proj_1",
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: "Artifacts/workflows",
    projectGrants: ["design_doc"],
    humanOwnedActions: ["release"],
    roleRoutes: { designer: { agentId: "agent_designer" } },
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

test("adapter migration dry-run rejects inactive target and schema mismatch", () => {
  const sourceEntry = createWorkflowCatalogEntry(sampleManifest(1), "active");
  const targetManifest = sampleManifest(2);
  targetManifest.compatibleFrom = [];
  const targetEntry = createWorkflowCatalogEntry(targetManifest, "quarantined");
  const ledger = {
    schemaVersion: 1,
    workflowRunId: "run_1",
    multicaProjectId: "proj_1",
    adapterId: sourceEntry.manifest.adapterId,
    adapterVersion: sourceEntry.manifest.adapterVersion,
    adapterBundleHash: sourceEntry.manifest.derivedBundleHash,
    executionMode: "autonomous_until_final",
    workflowStatus: "running",
    currentStageId: "design_doc",
    stateVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: { design_doc: { stageId: "design_doc", status: "accepted", attempt: 1, artifactHashes: [], updatedAt: new Date().toISOString() } },
    artifacts: [],
    events: [],
    questions: [],
  };
  const dryRun = dryRunAdapterMigration({
    sourceEntry,
    targetEntry,
    binding: sampleBinding(sourceEntry.manifest),
    ledger,
  });
  assert.equal(dryRun.compatible, false);
  assert.match(dryRun.humanFallbackReason ?? "", /target_not_active|incompatible_identity/);
});

test("adapter migration snapshot and rollback are idempotent for preparing state", async () => {
  const sourceEntry = createWorkflowCatalogEntry(sampleManifest(1), "active");
  const targetManifest = sampleManifest(2);
  targetManifest.compatibleFrom = [formatAdapterIdentity({
    adapterId: sourceEntry.manifest.adapterId,
    adapterVersion: sourceEntry.manifest.adapterVersion,
    derivedBundleHash: sourceEntry.manifest.derivedBundleHash,
  })];
  const targetEntry = createWorkflowCatalogEntry(targetManifest, "active");
  const binding = sampleBinding(sourceEntry.manifest);
  const ledger = {
    schemaVersion: 1,
    workflowRunId: "run_1",
    multicaProjectId: "proj_1",
    adapterId: sourceEntry.manifest.adapterId,
    adapterVersion: sourceEntry.manifest.adapterVersion,
    adapterBundleHash: sourceEntry.manifest.derivedBundleHash,
    executionMode: "autonomous_until_final",
    workflowStatus: "running",
    currentStageId: "design_doc",
    stateVersion: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: { design_doc: { stageId: "design_doc", status: "accepted", attempt: 1, artifactHashes: [], updatedAt: new Date().toISOString() } },
    artifacts: [],
    events: [],
    questions: [],
  };
  const snapshot = buildMigrationSnapshot({
    workflowRunId: ledger.workflowRunId,
    source: {
      adapterId: sourceEntry.manifest.adapterId,
      adapterVersion: sourceEntry.manifest.adapterVersion,
      derivedBundleHash: sourceEntry.manifest.derivedBundleHash,
    },
    target: {
      adapterId: targetEntry.manifest.adapterId,
      adapterVersion: targetEntry.manifest.adapterVersion,
      derivedBundleHash: targetEntry.manifest.derivedBundleHash,
    },
    sourceEntry,
    targetEntry,
    binding,
    ledger,
    createdAt: new Date().toISOString(),
  });
  const cwd = await mkdtemp(join(tmpdir(), "migration-store-"));
  const store = new WorkflowAdapterMigrationStore(cwd);
  await store.saveSnapshot(snapshot);
  const loaded = await store.loadSnapshot("run_1");
  assert.equal(loaded?.snapshotId, snapshot.snapshotId);
  const rollback = rollbackAdapterMigration(snapshot, binding, "deadbeef", { migrationStatus: "preparing" });
  const again = rollbackAdapterMigration(snapshot, rollback.binding, "deadbeef", { migrationStatus: "preparing" });
  assert.deepEqual(again.binding, rollback.binding);
});
