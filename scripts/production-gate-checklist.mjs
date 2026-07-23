#!/usr/bin/env node
/**
 * Production gate open rehearsal checklist (R-MNT-26).
 * Validates automated prerequisites while gate remains CLOSED — never opens production.
 */
import { access, constants } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importSpineLib } from "./spine-lib-import.mjs";
import { runWorkflowSandboxChecklist } from "./workflow-sandbox-checklist.mjs";
import { runWorkflowSandboxRehearsal } from "./workflow-sandbox-rehearsal.mjs";
import { runWorkflowProductionRehearsal } from "./workflow-production-rehearsal.mjs";
import { runSandboxCloseoutEvidence } from "./workflow-sandbox-closeout-evidence.mjs";
import { buildSandboxCanaryPlan, parseWorkflowSandboxCanaryArgs } from "./workflow-sandbox-canary.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const { buildProductionBindingPlan } = await importSpineLib(import.meta.url, "workflow-production-binding.ts");

export const OPEN_GATE_CHECKLIST = [
  { id: "gate-closed", label: "productionAllowed remains false in binding plans", automated: true },
  { id: "ops-checklist", label: "workflow ops preflight scripts pass offline", automated: true },
  { id: "sandbox-evidence-schema", label: "sandbox closeout evidence schema validates", automated: true },
  { id: "pack-smoke-script", label: "pack:smoke script present (run in CI)", automated: true },
  { id: "written-intent", label: "explicit written Campaign intent documented", automated: false, humanGate: true },
  { id: "rollback-owner", label: "rollback owner named", automated: false, humanGate: true },
  { id: "secrets-scope", label: "secrets/billing/destructive ops out of scope", automated: true, policyOnly: true },
];

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function parseProductionGateChecklistArgs(argv = process.argv.slice(2)) {
  return { json: argv.includes("--json") || !argv.includes("--plain") };
}

export async function runProductionGateChecklist() {
  const checks = [];

  const sandboxPlan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs([]));
  const productionPlan = buildProductionBindingPlan();
  const gateClosed =
    sandboxPlan.deliveryPolicy.productionAllowed === false &&
    productionPlan.deliveryPolicy.productionAllowed === false &&
    sandboxPlan.deliveryPolicy.destructiveAllowed === false;
  checks.push({
    id: "gate-closed",
    ok: gateClosed,
    automated: true,
    message: gateClosed
      ? "productionAllowed=false on sandbox and production binding plans"
      : "production gate must remain closed",
  });

  const sandboxChecklist = await runWorkflowSandboxChecklist({ live: false });
  const sandboxRehearsal = await runWorkflowSandboxRehearsal({ execute: false, fullCloseout: true });
  const productionRehearsal = await runWorkflowProductionRehearsal({ execute: false });
  const opsOk = sandboxChecklist.ok && sandboxRehearsal.ok && productionRehearsal.ok;
  checks.push({
    id: "ops-checklist",
    ok: opsOk,
    automated: true,
    message: opsOk
      ? "sandbox checklist, sandbox rehearsal, production rehearsal offline ok"
      : "one or more ops preflight scripts failed",
  });

  const evidence = await runSandboxCloseoutEvidence({ capture: false });
  checks.push({
    id: "sandbox-evidence-schema",
    ok: evidence.ok,
    automated: true,
    message: evidence.ok ? `closeout evidence ${evidence.mode} ok` : "closeout evidence validation failed",
  });

  const packSmokeOk = await pathExists(join(repoRoot, "scripts/pack-smoke.mjs"));
  checks.push({
    id: "pack-smoke-script",
    ok: packSmokeOk,
    automated: true,
    message: packSmokeOk ? "pack-smoke.mjs present (npm run pack:smoke in CI)" : "pack-smoke.mjs missing",
  });

  checks.push({
    id: "written-intent",
    ok: true,
    automated: false,
    humanGate: true,
    skipped: true,
    message: "Human Gate: document Campaign intent before opening gate",
  });

  checks.push({
    id: "rollback-owner",
    ok: true,
    automated: false,
    humanGate: true,
    skipped: true,
    message: "Human Gate: name rollback owner before opening gate",
  });

  checks.push({
    id: "secrets-scope",
    ok: true,
    automated: true,
    policyOnly: true,
    message: "policy enforced: agents must not rotate secrets or change billing",
  });

  const automatedFailed = checks.filter((item) => item.automated && !item.ok);
  const humanPending = checks.filter((item) => item.humanGate);

  return {
    ok: automatedFailed.length === 0 && gateClosed,
    gateStatus: gateClosed ? "CLOSED" : "OPEN_OR_DRIFT",
    automatedPassed: automatedFailed.length === 0,
    humanGateItems: humanPending.map((item) => item.id),
    checks,
    openGateReady: false,
    note: "This checklist never sets productionAllowed=true. Human must approve per docs/production-gate-decision.md.",
  };
}

async function main() {
  const { json } = parseProductionGateChecklistArgs();
  const report = await runProductionGateChecklist();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const check of report.checks) {
      const mark = check.skipped ? "~" : check.ok ? "ok" : "FAIL";
      console.log(`${mark} ${check.id}: ${check.message}`);
    }
    console.log(`gate: ${report.gateStatus}`);
    console.log(report.ok ? "\nproduction gate checklist ok (gate remains CLOSED)" : "\nproduction gate checklist failed");
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
