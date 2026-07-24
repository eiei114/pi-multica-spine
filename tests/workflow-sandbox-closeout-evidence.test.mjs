import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCloseoutEvidenceFromCanaryState,
  buildCloseoutEvidenceRecord,
  buildReferenceCloseoutEvidence,
  CLOSEOUT_EVIDENCE_REFERENCE_FIXTURE,
  formatCloseoutEvidenceInvestigationNote,
  parseSandboxCloseoutEvidenceArgs,
  persistCloseoutEvidenceArtifacts,
  runSandboxCloseoutEvidence,
  validateCloseoutEvidence,
  validateCloseoutEvidenceFixture,
} from "../scripts/workflow-sandbox-closeout-evidence.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

test("parseSandboxCloseoutEvidenceArgs reads note path and skip-note", () => {
  const args = parseSandboxCloseoutEvidenceArgs([
    "--capture",
    "--note-path",
    "/tmp/note.md",
    "--skip-note",
  ]);
  assert.equal(args.notePath, "/tmp/note.md");
  assert.equal(args.skipNote, true);
});

test("formatCloseoutEvidenceInvestigationNote includes ledger hash", () => {
  const note = formatCloseoutEvidenceInvestigationNote(approvedRecord);
  assert.match(note, /ledgerHash/);
  assert.ok(note.includes(approvedRecord.ledgerHash));
  assert.match(note, /productionAllowed/);
});

test("persistCloseoutEvidenceArtifacts writes json and markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "closeout-evidence-"));
  try {
    const written = await persistCloseoutEvidenceArtifacts(approvedRecord, {
      repoRoot: root,
      outPath: join(root, "evidence.json"),
      notePath: join(root, "evidence.md"),
      writeDatedNote: false,
    });
    const json = JSON.parse(await readFile(written.jsonPath, "utf8"));
    assert.equal(json.workflowRunId, "run-1");
    const note = await readFile(written.notePath, "utf8");
    assert.match(note, /Sandbox Closeout Evidence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

test("validateCloseoutEvidenceFixture passes committed reference fixture", async () => {
  const result = await validateCloseoutEvidenceFixture(CLOSEOUT_EVIDENCE_REFERENCE_FIXTURE);
  assert.equal(result.ok, true);
});

test("buildReferenceCloseoutEvidence matches fixture core fields", async () => {
  const reference = buildReferenceCloseoutEvidence();
  const fixture = await validateCloseoutEvidenceFixture(CLOSEOUT_EVIDENCE_REFERENCE_FIXTURE);
  assert.equal(fixture.record.workflowRunId, reference.workflowRunId);
  assert.equal(fixture.record.lane, reference.lane);
});

test("runSandboxCloseoutEvidence offline schema validates fixture in CI", async () => {
  const report = await runSandboxCloseoutEvidence({ capture: false });
  assert.equal(report.ok, true);
  assert.equal(report.fixture?.ok, true);
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
