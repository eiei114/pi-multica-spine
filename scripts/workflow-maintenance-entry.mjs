#!/usr/bin/env node
/**
 * Maintenance-build slash entry bootstrap (R-MNT-40).
 * Human invokes /skill:maintenance-build with a brief; this script starts the Maintenance Hermes workflow.
 */
import { readFile } from "node:fs/promises";
import { access, constants } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importSpineLib } from "./spine-lib-import.mjs";
import {
  parseProductionRunArgs,
  runProductionCampaign,
  startProductionWorkflowRun,
  loadProductionRunState,
} from "./workflow-production-run.mjs";
import { FULL_LIVE_CAMPAIGN_STAGE_CYCLES } from "./workflow-sandbox-rehearsal.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const { buildProductionRunPlan } = await importSpineLib(import.meta.url, "workflow-production-run.ts");

export const MIN_MAINTENANCE_BRIEF_LENGTH = 12;

export function parseWorkflowMaintenanceEntryArgs(argv = process.argv.slice(2)) {
  const execute = argv.includes("--execute");
  const dryRun = argv.includes("--dry-run") || (!execute && !argv.includes("--plan"));
  const json = argv.includes("--json") || !argv.includes("--plain");
  const repoPathArg = argv.find((arg, index) => argv[index - 1] === "--repo-path");
  const briefArg = argv.find((arg, index) => argv[index - 1] === "--maintenance-brief");
  const briefFileArg = argv.find((arg, index) => argv[index - 1] === "--maintenance-brief-file");
  const maxStageCyclesArg = argv.find((arg, index) => argv[index - 1] === "--max-stage-cycles");
  return {
    execute,
    dryRun,
    json,
    repoPath: repoPathArg,
    maintenanceBrief: briefArg,
    maintenanceBriefFile: briefFileArg,
    maxStageCycles: maxStageCyclesArg ? Number(maxStageCyclesArg) : FULL_LIVE_CAMPAIGN_STAGE_CYCLES,
  };
}

export async function loadMaintenanceBriefFromArgs(args) {
  if (args.maintenanceBrief?.trim()) return args.maintenanceBrief.trim();
  if (args.maintenanceBriefFile) {
    return (await readFile(args.maintenanceBriefFile, "utf8")).trim();
  }
  return undefined;
}

export function validateMaintenanceBrief(brief) {
  if (!brief?.trim()) {
    return { ok: false, error: "maintenance brief required (pass --maintenance-brief or --maintenance-brief-file)" };
  }
  if (brief.trim().length < MIN_MAINTENANCE_BRIEF_LENGTH) {
    return { ok: false, error: `maintenance brief must be at least ${MIN_MAINTENANCE_BRIEF_LENGTH} characters` };
  }
  return { ok: true, maintenanceBrief: brief.trim() };
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function productionArgv(repoPath, roughIdea, extra = []) {
  return ["--repo-path", repoPath, "--rough-idea", roughIdea, ...extra];
}

export async function runMaintenancePreflight(repoPath, options = {}) {
  const checks = [];
  const distLib = join(repoRoot, "dist", "lib", "hash.js");
  if (await pathExists(distLib)) {
    checks.push({ id: "dist-lib", ok: true, message: "dist/lib present" });
  } else {
    checks.push({ id: "dist-lib", ok: false, message: "dist/lib missing — run npm run build" });
  }

  const plan = buildProductionRunPlan(repoPath);
  const policyOk =
    plan.deliveryPolicy.productionAllowed === false &&
    plan.deliveryPolicy.destructiveAllowed === false;
  checks.push({
    id: "maintenance-policy",
    ok: policyOk,
    message: policyOk
      ? "Maintenance lane keeps productionAllowed=false"
      : "Maintenance delivery policy must keep productionAllowed=false",
  });

  if (options.live) {
    checks.push({
      id: "live-skipped",
      ok: true,
      message: "Live multica preflight deferred to start/campaign scripts",
    });
  }

  const ok = checks.every((check) => check.ok);
  return { ok, checks, plan };
}

export async function runWorkflowMaintenanceEntry(options = {}) {
  const loaded = options.maintenanceBrief ?? (await loadMaintenanceBriefFromArgs(options));
  const validation = validateMaintenanceBrief(loaded);
  if (!validation.ok) {
    return { ok: false, mode: "validation", error: validation.error };
  }
  const maintenanceBrief = validation.maintenanceBrief;
  const repoPath = options.repoPath ?? buildProductionRunPlan().repoPath;
  const plan = buildProductionRunPlan(repoPath);

  const checklist = await runMaintenancePreflight(repoPath, { live: options.execute ?? false });
  if (!checklist.ok) {
    return { ok: false, mode: options.execute ? "live" : "offline", step: "preflight", checklist, plan };
  }

  if (!options.execute) {
    return {
      ok: true,
      mode: "offline-plan",
      maintenanceBrief,
      repoPath,
      plan,
      checklist,
      skillCommand: "/skill:maintenance-build",
      nextSteps: [
        "Invoke /skill:maintenance-build then paste the maintenance brief",
        `node scripts/workflow-maintenance-entry.mjs --maintenance-brief ${JSON.stringify(maintenanceBrief)} --execute`,
        "node scripts/workflow-production-run.mjs --campaign --max-stage-cycles 80",
      ],
    };
  }

  const priorState = await loadProductionRunState(repoPath);
  const startConfig = parseProductionRunArgs(productionArgv(repoPath, maintenanceBrief, ["--start"]));
  const startResult = await startProductionWorkflowRun(startConfig);
  const campaignConfig = parseProductionRunArgs(
    productionArgv(repoPath, maintenanceBrief, [
      "--campaign",
      "--max-stage-cycles",
      String(options.maxStageCycles ?? FULL_LIVE_CAMPAIGN_STAGE_CYCLES),
    ]),
  );
  const campaignResult = await runProductionCampaign(campaignConfig);

  const ok =
    Boolean(startResult.state?.workflowRunId) &&
    Boolean(campaignResult.campaign) &&
    plan.deliveryPolicy.productionAllowed === false;

  return {
    ok,
    mode: "live-start",
    maintenanceBrief,
    repoPath,
    checklist,
    parentIdentifier: startResult.state?.parentIdentifier,
    workflowRunId: startResult.state?.workflowRunId,
    projectId: startResult.state?.projectId,
    parentReused: Boolean(priorState?.parentIssueId),
    campaign: {
      completed: campaignResult.campaign.completed,
      workflowStatus: campaignResult.campaign.workflowStatus,
      currentStageId: campaignResult.campaign.currentStageId,
      stageCount: campaignResult.campaign.stages.length,
      stopReason: campaignResult.campaign.stopReason,
    },
    nextSteps: campaignResult.campaign.completed
      ? ["node scripts/workflow-production-run.mjs --human-review"]
      : ["node scripts/workflow-production-run.mjs --campaign --max-stage-cycles 80"],
  };
}

async function main() {
  const args = parseWorkflowMaintenanceEntryArgs();
  const report = await runWorkflowMaintenanceEntry({
    execute: args.execute,
    repoPath: args.repoPath,
    maintenanceBrief: await loadMaintenanceBriefFromArgs(args),
    maxStageCycles: args.maxStageCycles,
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`mode: ${report.mode}`);
    console.log(`parent: ${report.parentIdentifier ?? "(planned)"}`);
    console.log(`workflowRunId: ${report.workflowRunId ?? "(planned)"}`);
    if (report.campaign) {
      console.log(`stage: ${report.campaign.currentStageId} (${report.campaign.workflowStatus})`);
    }
  } else {
    console.log(`maintenance entry failed: ${report.error ?? report.step ?? "unknown"}`);
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
