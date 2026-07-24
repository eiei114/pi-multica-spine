#!/usr/bin/env node
/**
 * Sandbox full closeout evidence capture (R-MNT-25, R-MNT-28).
 * Offline validates evidence schema for CI; --capture reads live canary state and persists JSON + investigation note.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { access, constants } from "node:fs/promises";
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

export function defaultCloseoutEvidencePaths(root = repoRoot, capturedAt = new Date().toISOString()) {
  const date = capturedAt.slice(0, 10);
  return {
    jsonPath: join(root, "docs/investigations/sandbox-closeout-evidence.latest.json"),
    notePath: join(root, "docs/investigations/sandbox-closeout-evidence.latest.md"),
    datedNotePath: join(root, `docs/investigations/${date}-sandbox-closeout-evidence-live.md`),
  };
}

export const CLOSEOUT_EVIDENCE_REFERENCE_FIXTURE = join(
  repoRoot,
  "tests/fixtures/sandbox-closeout-evidence.reference.json",
);

export function buildReferenceCloseoutEvidence() {
  return buildCloseoutEvidenceRecord({
    projectId: "reference-project",
    parentIssueId: "parent-ref",
    parentIdentifier: "DOT-REFERENCE",
    workflowRunId: "canary-reference",
    canaryPath: "/tmp/reference",
    ledgerHash: "a".repeat(64),
    capturedAt: "2026-07-24T00:00:00.000Z",
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
}

export async function loadCloseoutEvidenceFixture(fixturePath = CLOSEOUT_EVIDENCE_REFERENCE_FIXTURE) {
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw);
}

export async function validateCloseoutEvidenceFixture(fixturePath = CLOSEOUT_EVIDENCE_REFERENCE_FIXTURE) {
  try {
    await access(fixturePath, constants.F_OK);
  } catch {
    return { ok: false, failures: [`fixture missing: ${fixturePath}`] };
  }
  let record;
  try {
    record = await loadCloseoutEvidenceFixture(fixturePath);
  } catch (error) {
    return {
      ok: false,
      failures: [`fixture parse error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const validation = validateCloseoutEvidence(record);
  if (!validation.ok) {
    return { ok: false, record, validation, failures: validation.failures };
  }
  const reference = buildReferenceCloseoutEvidence();
  const drift = [];
  for (const key of ["schemaVersion", "lane", "workflowRunId", "projectId", "parentIssueId"]) {
    if (record[key] !== reference[key]) {
      drift.push(`fixture drift: ${key} expected ${reference[key]} got ${record[key]}`);
    }
  }
  if (record.campaign?.currentStageId !== reference.campaign?.currentStageId) {
    drift.push("fixture drift: campaign.currentStageId");
  }
  return {
    ok: drift.length === 0,
    record,
    validation,
    failures: drift,
    fixturePath,
  };
}

export function parseSandboxCloseoutEvidenceArgs(argv = process.argv.slice(2)) {
  const capture = argv.includes("--capture");
  const json = argv.includes("--json") || !argv.includes("--plain");
  const canaryPathArg = argv.find((arg, index) => argv[index - 1] === "--canary-path");
  const outArg = argv.find((arg, index) => argv[index - 1] === "--out");
  const noteArg = argv.find((arg, index) => argv[index - 1] === "--note-path");
  const skipNote = argv.includes("--skip-note");
  const fixtureArg = argv.find((arg, index) => argv[index - 1] === "--fixture-path");
  return { capture, json, canaryPath: canaryPathArg, outPath: outArg, notePath: noteArg, skipNote, fixturePath: fixtureArg };
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

export function formatCloseoutEvidenceInvestigationNote(record, meta = {}) {
  const lines = [
    `# Sandbox Closeout Evidence (${record.capturedAt.slice(0, 10)})`,
    "",
    "> Auto-generated by `workflow-sandbox-closeout-evidence.mjs --capture`.",
    "",
    "## Lane status",
    "",
    "**COMPLETE** — sandbox full closeout with approved human review.",
    "",
    "## Run summary",
    "",
    "| Field | Value |",
    "|---|---|",
    `| capturedAt | ${record.capturedAt} |`,
    `| projectId | ${record.projectId ?? "—"} |`,
    `| parentIssueId | ${record.parentIssueId ?? "—"} |`,
    `| parentIdentifier | ${record.parentIdentifier ?? "—"} |`,
    `| workflowRunId | ${record.workflowRunId} |`,
    `| canaryPath | ${record.canaryPath} |`,
    `| ledgerHash | \`${record.ledgerHash}\` |`,
    `| currentStageId | ${record.campaign?.currentStageId ?? "—"} |`,
    `| workflowStatus | ${record.campaign?.workflowStatus ?? "—"} |`,
    `| stageCount | ${record.campaign?.stageCount ?? "—"} |`,
    `| stopReason | ${record.campaign?.stopReason ?? "—"} |`,
    `| humanReview.verdict | ${record.humanReview?.verdict ?? "—"} |`,
    `| reviewArtifactPath | ${record.humanReview?.reviewArtifactPath ?? "—"} |`,
    `| productionAllowed | ${record.deliveryPolicy?.productionAllowed === false ? "false (gate closed)" : "DRIFT"} |`,
    "",
    "## Artifacts",
    "",
    `- JSON: \`docs/investigations/sandbox-closeout-evidence.latest.json\``,
    `- Note: \`docs/investigations/sandbox-closeout-evidence.latest.md\``,
  ];
  if (meta.datedNotePath) {
    lines.push(`- Dated copy: \`${meta.datedNotePath.replace(/\\/g, "/").replace(/^.*docs\//, "docs/")}\``);
  }
  lines.push(
    "",
    "## Verification",
    "",
    "```bash",
    "npm run check:sandbox-evidence",
    "npm run check:production-gate",
    "```",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export async function persistCloseoutEvidenceArtifacts(record, options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const defaults = defaultCloseoutEvidencePaths(root, record.capturedAt);
  const jsonPath = options.outPath ?? defaults.jsonPath;
  const notePath = options.notePath ?? defaults.notePath;
  const datedNotePath = options.datedNotePath ?? defaults.datedNotePath;
  const writeNote = options.writeNote !== false;
  const writeDatedNote = options.writeDatedNote !== false;

  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const written = { jsonPath };
  if (writeNote) {
    await mkdir(dirname(notePath), { recursive: true });
    const note = formatCloseoutEvidenceInvestigationNote(record, { datedNotePath });
    await writeFile(notePath, note, "utf8");
    written.notePath = notePath;
  }
  if (writeDatedNote) {
    await mkdir(dirname(datedNotePath), { recursive: true });
    const note = formatCloseoutEvidenceInvestigationNote(record, { datedNotePath });
    await writeFile(datedNotePath, note, "utf8");
    written.datedNotePath = datedNotePath;
  }
  return written;
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
    const defaults = defaultCloseoutEvidencePaths(options.repoRoot ?? repoRoot, record.capturedAt);
    const artifacts = await persistCloseoutEvidenceArtifacts(record, {
      repoRoot: options.repoRoot,
      outPath: options.outPath ?? defaults.jsonPath,
      notePath: options.skipNote ? undefined : (options.notePath ?? defaults.notePath),
      writeNote: !options.skipNote,
      writeDatedNote: !options.skipNote,
    });
    return { ok: true, mode: "live-capture", record, validation, artifacts };
  }

  const reference = buildReferenceCloseoutEvidence();
  const referenceValidation = validateCloseoutEvidence(reference);
  if (!referenceValidation.ok) {
    return { ok: false, mode: "offline-schema", referenceValidation };
  }

  const fixturePath = options.fixturePath ?? CLOSEOUT_EVIDENCE_REFERENCE_FIXTURE;
  const fixtureCheck = await validateCloseoutEvidenceFixture(fixturePath);
  if (!fixtureCheck.ok) {
    return {
      ok: false,
      mode: "offline-schema",
      reference,
      referenceValidation,
      fixtureCheck,
      failures: fixtureCheck.failures,
    };
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
    fixture: fixtureCheck,
    note: "pass --capture --canary-path after live full closeout to persist JSON + investigation note",
  };
}

async function main() {
  const { capture, json, canaryPath, outPath, notePath, skipNote, fixturePath } =
    parseSandboxCloseoutEvidenceArgs();
  const defaults = defaultCloseoutEvidencePaths();
  const report = await runSandboxCloseoutEvidence({
    capture,
    canaryPath,
    outPath: outPath ?? (capture ? defaults.jsonPath : undefined),
    notePath: notePath ?? (capture && !skipNote ? defaults.notePath : undefined),
    skipNote,
    fixturePath,
  });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(report.ok ? "sandbox closeout evidence ok" : "sandbox closeout evidence failed");
    if (report.validation?.failures?.length) {
      console.log(report.validation.failures.join("\n"));
    }
    if (report.artifacts?.notePath) {
      console.log(`note: ${report.artifacts.notePath}`);
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
