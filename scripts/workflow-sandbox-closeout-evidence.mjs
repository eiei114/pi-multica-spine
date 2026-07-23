#!/usr/bin/env node
/**
 * Sandbox full closeout evidence capture (R-MNT-25).
 * Offline validates evidence schema for CI; --capture reads live canary state.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importSpineLib } from "./spine-lib-import.mjs";
import { loadCanaryState } from "./workflow-sandbox-canary.mjs";
import { HERMES_FINAL_STAGE_ID } from "./workflow-sandbox-rehearsal.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const { hashWorkflowRunLedger, WorkflowRunStateStore } = await importSpineLib(
  import.meta.url,
  "workflow-run-state.ts",
);

export function parseSandboxCloseoutEvidenceArgs(argv = process.argv.slice(2)) {
  const capture = argv.includes("--capture");
  const json = argv.includes("--json") || !argv.includes("--plain");
  const canaryPathArg = argv.find((arg, index) => argv[index - 1] === "--canary-path");
  const outArg = argv.find((arg, index) => argv[index - 1] === "--out");
  return { capture, json, canaryPath: canaryPathArg, outPath: outArg };
}

export function buildCloseoutEvidenceRecord(input) {
  const record = {
    schemaVersion: 1,
    lane: "sandbox",
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    projectId: input.projectId,
    parentIssueId: input.parentIssueId,
    parentIdentifier: input.parentIdentifier,
    workflowRunId: input.workflowRunId,
    canaryPath: input.canaryPath,
    ledgerHash: input.ledgerHash,
    campaign: input.campaign,
    humanReview: input.humanReview,
    deliveryPolicy: input.deliveryPolicy ?? { productionAllowed: false },
  };
  return record;
}

export function validateCloseoutEvidence(record) {
  const failures = [];
  if (record?.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (record?.lane !== "sandbox") failures.push("lane must be sandbox");
  if (!record?.workflowRunId) failures.push("workflowRunId required");
  if (!record?.ledgerHash || !/^[a-f0-9]{64}$/.test(record.ledgerHash)) failures.push("ledgerHash must be sha256 hex");
  if (record?.deliveryPolicy?.productionAllowed !== false) failures.push("productionAllowed must be false");
  if (record?.humanReview?.verdict !== "approved") failures.push("humanReview.verdict must be approved");
  if (record?.campaign?.currentStageId !== HERMES_FINAL_STAGE_ID) {
    failures.push(`campaign.currentStageId must be ${HERMES_FINAL_STAGE_ID}`);
  }
  if (record?.campaign?.completed !== true) failures.push("campaign.completed must be true");
  return { ok: failures.length === 0, failures };
}

export function buildCloseoutEvidenceFromCanaryState(state, extras = {}) {
  const humanReview = state.humanFinalReview ?? extras.humanReview;
  const campaign = state.lastCampaign ?? extras.campaign;
  return buildCloseoutEvidenceRecord({
    projectId: state.projectId,
    parentIssueId: state.parentIssueId,
    parentIdentifier: state.parentIdentifier,
    workflowRunId: state.workflowRunId,
    canaryPath: state.canaryPath,
    ledgerHash: humanReview?.ledgerHash ?? extras.ledgerHash,
    campaign,
    humanReview,
    deliveryPolicy: { productionAllowed: false },
    capturedAt: extras.capturedAt,
  });
}

export async function resolveLedgerHash(canaryPath, workflowRunId, fallback) {
  if (fallback) return fallback;
  try {
    const ledger = await new WorkflowRunStateStore(canaryPath).load(workflowRunId);
    return ledger ? hashWorkflowRunLedger(ledger) : undefined;
  } catch {
    return undefined;
  }
}

export async function runSandboxCloseoutEvidence(options = {}) {
  const capture = options.capture ?? false;
  const canaryPath = options.canaryPath;

  if (capture) {
    if (!canaryPath) {
      return { ok: false, mode: "live-capture", error: "--canary-path required for --capture" };
    }
    const state = await loadCanaryState(canaryPath);
    if (!state?.workflowRunId) {
      return { ok: false, mode: "live-capture", error: `canary state missing at ${canaryPath}` };
    }
    const ledgerHash = await resolveLedgerHash(
      canaryPath,
      state.workflowRunId,
      state.humanFinalReview?.ledgerHash,
    );
    const record = buildCloseoutEvidenceFromCanaryState(state, { ledgerHash });
    const validation = validateCloseoutEvidence(record);
    if (!validation.ok) {
      return { ok: false, mode: "live-capture", record, validation };
    }
    if (options.outPath) {
      await mkdir(dirname(options.outPath), { recursive: true });
      await writeFile(options.outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    }
    return { ok: true, mode: "live-capture", record, validation };
  }

  const reference = buildCloseoutEvidenceRecord({
    projectId: "reference-project",
    parentIssueId: "parent-ref",
    workflowRunId: "canary-reference",
    canaryPath: "/tmp/reference",
    ledgerHash: "a".repeat(64),
    campaign: {
      completed: true,
      currentStageId: HERMES_FINAL_STAGE_ID,
      workflowStatus: "completed",
      stageCount: 12,
      stopReason: "completed",
    },
    humanReview: {
      verdict: "approved",
      ledgerHash: "a".repeat(64),
      reviewArtifactPath: "/tmp/final/10-human-final-review.md",
    },
  });
  const referenceValidation = validateCloseoutEvidence(reference);
  if (!referenceValidation.ok) {
    return { ok: false, mode: "offline-schema", referenceValidation };
  }

  if (canaryPath) {
    const state = await loadCanaryState(canaryPath);
    if (state?.humanFinalReview?.verdict === "approved" && state.lastCampaign?.completed) {
      const ledgerHash = await resolveLedgerHash(
        canaryPath,
        state.workflowRunId,
        state.humanFinalReview?.ledgerHash,
      );
      const liveRecord = buildCloseoutEvidenceFromCanaryState(state, { ledgerHash });
      const liveValidation = validateCloseoutEvidence(liveRecord);
      return {
        ok: liveValidation.ok,
        mode: "offline-with-state",
        canaryPath,
        record: liveRecord,
        validation: liveValidation,
      };
    }
  }

  return {
    ok: true,
    mode: "offline-schema",
    reference,
    validation: referenceValidation,
    note: "pass --capture --canary-path after live full closeout to persist evidence",
  };
}

async function main() {
  const { capture, json, canaryPath, outPath } = parseSandboxCloseoutEvidenceArgs();
  const defaultOut = join(
    repoRoot,
    "docs/investigations/sandbox-closeout-evidence.latest.json",
  );
  const report = await runSandboxCloseoutEvidence({
    capture,
    canaryPath,
    outPath: outPath ?? (capture ? defaultOut : undefined),
  });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(report.ok ? "sandbox closeout evidence ok" : "sandbox closeout evidence failed");
    if (report.validation?.failures?.length) {
      console.log(report.validation.failures.join("\n"));
    }
  }
  if (!report.ok) process.exitCode = 1;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
