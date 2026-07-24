#!/usr/bin/env node
/**
 * Maintenance production-run rehearsal automation (R-MNT-23).
 * Offline mode validates orchestration for CI; --execute runs live multica ops.
 */
import { access, constants } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importSpineLib } from "./spine-lib-import.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const { buildProductionRunPlan } = await importSpineLib(import.meta.url, "workflow-production-run.ts");

const {
  parseProductionRunArgs,
  startProductionWorkflowRun,
  runProductionCampaign,
  runProductionHumanReview,
} = await import("./workflow-production-run.mjs");

const { FULL_LIVE_CAMPAIGN_STAGE_CYCLES, HERMES_FINAL_STAGE_ID } = await import(
  "./workflow-sandbox-rehearsal.mjs"
);

export const PRODUCTION_REHEARSAL_STEPS = ["preflight", "start", "campaign", "human-review"];
export const DEFAULT_PRODUCTION_MAX_STAGE_CYCLES = FULL_LIVE_CAMPAIGN_STAGE_CYCLES;

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function parseWorkflowProductionRehearsalArgs(argv = process.argv.slice(2)) {
  const execute = argv.includes("--execute");
  const json = argv.includes("--json") || !argv.includes("--plain");
  const repoPathArg = argv.find((arg, index) => argv[index - 1] === "--repo-path");
  const maxStageCyclesArg = argv.find((arg, index) => argv[index - 1] === "--max-stage-cycles");
  return {
    execute,
    json,
    repoPath: repoPathArg,
    maxStageCycles: maxStageCyclesArg ? Number(maxStageCyclesArg) : DEFAULT_PRODUCTION_MAX_STAGE_CYCLES,
  };
}

function productionArgv(repoPath, extra = []) {
  return ["--repo-path", repoPath, ...extra];
}

export function buildOfflineProductionRehearsalPlan(repoPath) {
  const plan = buildProductionRunPlan(repoPath);
  const startConfig = parseProductionRunArgs(productionArgv(repoPath, ["--start"]));
  const campaignConfig = parseProductionRunArgs(productionArgv(repoPath, ["--campaign"]));
  const humanReviewConfig = parseProductionRunArgs(productionArgv(repoPath, ["--human-review"]));
  const policyClosed =
    plan.deliveryPolicy.productionAllowed === false &&
    plan.deliveryPolicy.destructiveAllowed === false;
  return {
    ok:
      policyClosed &&
      startConfig.start === true &&
      campaignConfig.campaign === true &&
      humanReviewConfig.humanReview === true,
    plan,
    steps: PRODUCTION_REHEARSAL_STEPS,
    maxStageCycles: DEFAULT_PRODUCTION_MAX_STAGE_CYCLES,
    modes: {
      start: startConfig.start,
      campaign: campaignConfig.campaign,
      humanReview: humanReviewConfig.humanReview,
    },
  };
}

export async function runWorkflowProductionRehearsal(options = {}) {
  const execute = options.execute ?? false;
  const repoPath = options.repoPath ?? buildProductionRunPlan().repoPath;
  const maxStageCycles = options.maxStageCycles ?? DEFAULT_PRODUCTION_MAX_STAGE_CYCLES;

  const distLib = join(repoRoot, "dist", "lib", "hash.js");
  const checks = [];
  if (await pathExists(distLib)) {
    checks.push({ id: "dist-lib", ok: true, message: "dist/lib present" });
  } else {
    checks.push({ id: "dist-lib", ok: false, message: "dist/lib missing — run npm run build" });
  }

  const plan = buildOfflineProductionRehearsalPlan(repoPath);
  checks.push({
    id: "production-plan",
    ok: plan.ok,
    message: plan.ok
      ? "Maintenance production-run plan keeps productionAllowed=false"
      : "production-run plan failed policy/mode checks",
  });

  const preflightOk = checks.every((item) => item.ok);
  if (!preflightOk) {
    return { ok: false, mode: execute ? "live" : "offline", step: "preflight", checks, plan };
  }

  if (!execute) {
    return {
      ok: true,
      mode: "offline-rehearsal",
      repoPath,
      steps: PRODUCTION_REHEARSAL_STEPS,
      checks,
      plan,
      nextSteps: [
        "npm run check:production-rehearsal",
        "docs/workflow-production-live-execute-runbook.md",
        "node scripts/workflow-production-rehearsal.mjs --execute",
      ],
    };
  }

  const startConfig = parseProductionRunArgs(productionArgv(repoPath, ["--start"]));
  const startResult = await startProductionWorkflowRun(startConfig);
  const campaignConfig = parseProductionRunArgs(
    productionArgv(repoPath, ["--campaign", "--max-stage-cycles", String(maxStageCycles)]),
  );
  campaignConfig.maxStageCycles = maxStageCycles;
  const campaignResult = await runProductionCampaign(campaignConfig);

  if (
    !campaignResult.campaign.completed ||
    campaignResult.campaign.currentStageId !== HERMES_FINAL_STAGE_ID
  ) {
    return {
      ok: false,
      mode: "live-execute",
      repoPath,
      steps: PRODUCTION_REHEARSAL_STEPS,
      checks,
      start: { workflowRunId: startResult.state?.workflowRunId },
      campaign: {
        completed: campaignResult.campaign.completed,
        currentStageId: campaignResult.campaign.currentStageId,
        stopReason: campaignResult.campaign.stopReason,
        maxStageCycles,
      },
      error: `campaign must reach ${HERMES_FINAL_STAGE_ID} before human review`,
    };
  }

  const reviewConfig = parseProductionRunArgs(productionArgv(repoPath, ["--human-review"]));
  const reviewResult = await runProductionHumanReview(reviewConfig);
  const ok = reviewResult.review?.verdict === "approved";

  return {
    ok,
    mode: "live-full-closeout",
    repoPath,
    steps: PRODUCTION_REHEARSAL_STEPS,
    checks,
    start: { workflowRunId: startResult.state?.workflowRunId },
    campaign: {
      completed: campaignResult.campaign.completed,
      currentStageId: campaignResult.campaign.currentStageId,
      stageCount: campaignResult.campaign.stages.length,
      stopReason: campaignResult.campaign.stopReason,
      maxStageCycles,
    },
    humanReview: {
      verdict: reviewResult.review?.verdict,
      reviewArtifactPath: reviewResult.review?.reviewArtifactPath,
      ledgerHash: reviewResult.review?.ledgerHash,
    },
  };
}

async function main() {
  const { execute, json, repoPath, maxStageCycles } = parseWorkflowProductionRehearsalArgs();
  const report = await runWorkflowProductionRehearsal({ execute, repoPath, maxStageCycles });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`mode: ${report.mode}`);
    for (const step of PRODUCTION_REHEARSAL_STEPS) {
      console.log(`- ${step}`);
    }
    console.log(report.ok ? "production rehearsal ok" : "production rehearsal failed");
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
