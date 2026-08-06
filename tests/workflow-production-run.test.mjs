import assert from "node:assert/strict";
import test from "node:test";

import { createHermesCompositeManifest } from "../lib/hermes-adapter.ts";
import {
  buildProductionRunPlan,
  buildProductionStageArtifactContent,
  buildProductionWorkflowRunId,
  productionCampaignState,
  productionFinalPackageDir,
  productionReviewArtifactPath,
  PRODUCTION_ROUGH_IDEA,
  summarizeProductionLedger,
} from "../lib/workflow-production-run.ts";
import { PRODUCTION_PROJECT_ID } from "../lib/workflow-production-binding.ts";
import { createWorkflowRunLedger } from "../lib/workflow-run-state.ts";
import {
  parseProductionRunArgs,
} from "../scripts/workflow-production-run.mjs";

test("production run plan targets maintenance project", () => {
  const plan = buildProductionRunPlan();
  assert.equal(plan.projectId, PRODUCTION_PROJECT_ID);
  assert.equal(plan.deliveryPolicy.prRequired, true);
  assert.match(plan.roughIdea, /README/);
});

test("PRODUCTION_ROUGH_IDEA avoids stale version pins", () => {
  assert.doesNotMatch(PRODUCTION_ROUGH_IDEA, /v0\.\d+\.\d+/);
  assert.doesNotMatch(PRODUCTION_ROUGH_IDEA, /@0\.\d+\.\d+/);
  assert.match(PRODUCTION_ROUGH_IDEA, /maintenance baseline/);
});

test("production workflow run id is unique per call", () => {
  const a = buildProductionWorkflowRunId();
  const b = buildProductionWorkflowRunId();
  assert.match(a, /^prod-\d{8}-[a-f0-9]{8}$/);
  assert.notEqual(a, b);
});

test("production stage artifact content covers implementation and final package", () => {
  const manifest = createHermesCompositeManifest();
  const ledger = createWorkflowRunLedger({
    workflowRunId: "prod-test",
    multicaProjectId: PRODUCTION_PROJECT_ID,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    adapterBundleHash: manifest.derivedBundleHash,
    executionMode: "autonomous_until_final",
    initialStageId: "capture",
  });
  const implementation = buildProductionStageArtifactContent("implementation", manifest, ledger, PRODUCTION_ROUGH_IDEA);
  assert.match(implementation, /workflow-production-run/);
  assert.doesNotMatch(implementation, /v0\.\d+\.\d+/);
  assert.doesNotMatch(implementation, /@0\.\d+\.\d+/);
  const questionResolution = buildProductionStageArtifactContent(
    "question_resolution",
    manifest,
    ledger,
    PRODUCTION_ROUGH_IDEA,
  );
  assert.doesNotMatch(questionResolution, /v0\.\d+\.\d+/);
  assert.doesNotMatch(questionResolution, /@0\.\d+\.\d+/);
  const finalPackage = buildProductionStageArtifactContent("final_package", manifest, ledger, PRODUCTION_ROUGH_IDEA);
  assert.match(finalPackage, /workflow_run_id: prod-test/);
  assert.doesNotMatch(finalPackage, /v0\.\d+\.\d+/);
  assert.doesNotMatch(finalPackage, /@0\.\d+\.\d+/);
});

test("production campaign state aliases repo path to canaryPath", () => {
  const state = productionCampaignState("/tmp/repo", {
    projectId: PRODUCTION_PROJECT_ID,
    parentIssueId: "parent-1",
    workflowRunId: "prod-1",
  });
  assert.equal(state.canaryPath, "/tmp/repo");
  assert.equal(state.workflowRunId, "prod-1");
});

test("production final package paths live under Artifacts/workflows", () => {
  const repo = "C:/repo";
  const runId = "prod-20260724-deadbeef";
  assert.match(productionFinalPackageDir(repo, runId), /Artifacts[\\/]workflows[\\/]prod-20260724-deadbeef[\\/]final$/);
  assert.match(productionReviewArtifactPath(repo, runId), /10-human-final-review\.md$/);
});

test("parseProductionRunArgs defaults to dry-run friendly repo path", () => {
  const config = parseProductionRunArgs([]);
  assert.equal(config.dryRun, false);
  assert.equal(config.start, false);
  assert.equal(config.projectId, PRODUCTION_PROJECT_ID);
});

test("summarizeProductionLedger returns hash and status", () => {
  const manifest = createHermesCompositeManifest();
  const ledger = createWorkflowRunLedger({
    workflowRunId: "prod-summary",
    multicaProjectId: PRODUCTION_PROJECT_ID,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    adapterBundleHash: manifest.derivedBundleHash,
    executionMode: "autonomous_until_final",
    initialStageId: "capture",
  });
  const summary = summarizeProductionLedger(ledger);
  assert.equal(summary?.workflowRunId, "prod-summary");
  assert.equal(summary?.workflowStatus, "waiting");
  assert.match(summary?.ledgerHash ?? "", /^[a-f0-9]{64}$/);
});
