import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCloseoutEvidenceFromCanaryState,
  buildCloseoutEvidenceRecord,
  parseSandboxCloseoutEvidenceArgs,
  runSandboxCloseoutEvidence,
  validateCloseoutEvidence,
} from "../scripts/workflow-sandbox-closeout-evidence.mjs";
import { HERMES_FINAL_STAGE_ID } from "../scripts/workflow-sandbox-rehearsal.mjs";

const approvedRecord = {
  schemaVersion: 1,
  lane: "sandbox",
  capturedAt: "2026-07-24T00:00:00.000Z",
  projectId: "proj",
  parentIssueId: "parent",
  workflowRunId: "run-1",
  canaryPath: "/tmp/canary",
  ledgerHash: "b".repeat(64),
  campaign: {
    completed: true,
    currentStageId: HERMES_FINAL_STAGE_ID,
    workflowStatus: "completed",
    stageCount: 12,
    stopReason: "completed",
  },
  humanReview: {
    verdict: "approved",
    ledgerHash: "b".repeat(64),
    reviewArtifactPath: "/tmp/review.md",
  },
  deliveryPolicy: { productionAllowed: false },
};

test("parseSandboxCloseoutEvidenceArgs reads capture flags", () => {
  const args = parseSandboxCloseoutEvidenceArgs([
    "--capture",
    "--canary-path",
    "/tmp/x",
    "--out",
    "/tmp/out.json",
    "--plain",
  ]);
  assert.equal(args.capture, true);
  assert.equal(args.canaryPath, "/tmp/x");
  assert.equal(args.outPath, "/tmp/out.json");
  assert.equal(args.json, false);
});

test("validateCloseoutEvidence accepts approved final_package record", () => {
  const result = validateCloseoutEvidence(approvedRecord);
  assert.equal(result.ok, true);
});

test("validateCloseoutEvidence rejects open production gate", () => {
  const result = validateCloseoutEvidence({
    ...approvedRecord,
    deliveryPolicy: { productionAllowed: true },
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /productionAllowed/);
});

test("buildCloseoutEvidenceFromCanaryState maps canary state", () => {
  const record = buildCloseoutEvidenceFromCanaryState(
    {
      projectId: "p1",
      parentIssueId: "iss",
      parentIdentifier: "DOT-1",
      workflowRunId: "wr-1",
      canaryPath: "/tmp/c",
      humanFinalReview: approvedRecord.humanReview,
      lastCampaign: approvedRecord.campaign,
    },
    { ledgerHash: approvedRecord.ledgerHash },
  );
  assert.equal(record.workflowRunId, "wr-1");
  assert.equal(validateCloseoutEvidence(record).ok, true);
});

test("runSandboxCloseoutEvidence offline schema passes in CI", async () => {
  const report = await runSandboxCloseoutEvidence({ capture: false });
  assert.equal(report.ok, true);
  assert.equal(report.mode, "offline-schema");
});

test("buildCloseoutEvidenceRecord defaults deliveryPolicy closed", () => {
  const record = buildCloseoutEvidenceRecord({
    projectId: "p",
    parentIssueId: "i",
    workflowRunId: "w",
    canaryPath: "/c",
    ledgerHash: "c".repeat(64),
    campaign: approvedRecord.campaign,
    humanReview: approvedRecord.humanReview,
  });
  assert.equal(record.deliveryPolicy.productionAllowed, false);
});
