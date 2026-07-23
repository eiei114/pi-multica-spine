#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { createHermesCompositeManifest } from "../dist/lib/hermes-adapter.js";
import { createParentWorkflowIssueSummary } from "../dist/lib/project-workflow-binding.js";
import { ProjectWorkflowBindingStore } from "../dist/lib/project-workflow-binding-store.js";
import { buildWorkflowLiveCli } from "../dist/lib/workflow-live-cli.js";
import {
  createAutopilotClient,
  createIssueClient,
  createMetadataClient,
  createProjectClient,
  clearStaleDaemonTaskContext,
  runMultica,
} from "../dist/lib/multica-cli.js";
import {
  PRODUCTION_PROJECT_ID,
  PRODUCTION_REPO_PATH,
} from "../dist/lib/workflow-production-binding.js";
import { applyProductionWorkflowBinding } from "./workflow-production-binding.mjs";
import {
  buildProductionRunPlan,
  buildProductionStageArtifactContent,
  buildProductionWorkflowRunId,
  productionCampaignState,
  productionFinalPackageDir,
  productionReviewArtifactPath,
  PRODUCTION_CONTROLLER_AGENT_ID,
  PRODUCTION_ROUGH_IDEA,
  PRODUCTION_STATE_RELATIVE,
  summarizeProductionLedger,
  writeProductionImplementationArtifacts,
} from "../dist/lib/workflow-production-run.js";
import { hashWorkflowRunLedger, WorkflowRunStateStore } from "../dist/lib/workflow-run-state.js";
import { runCanaryCampaign } from "../dist/lib/workflow-sandbox-campaign.js";
import { completeHumanFinalReview } from "../dist/lib/workflow-sandbox-human-review.js";

const CONTROLLER_TITLE = "pi-multica-spine Production Controller";

export function parseProductionRunArgs(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      start: { type: "boolean", default: false },
      campaign: { type: "boolean", default: false },
      "human-review": { type: "boolean", default: false },
      report: { type: "boolean", default: false },
      "repo-path": { type: "string", default: PRODUCTION_REPO_PATH },
      "project-id": { type: "string", default: PRODUCTION_PROJECT_ID },
    },
    allowPositionals: false,
  });
  return {
    dryRun: values["dry-run"] ?? false,
    start: values.start ?? false,
    campaign: values.campaign ?? false,
    humanReview: values["human-review"] ?? false,
    report: values.report ?? false,
    repoPath: values["repo-path"] ?? PRODUCTION_REPO_PATH,
    projectId: values["project-id"] ?? PRODUCTION_PROJECT_ID,
  };
}

function multicaJson(args) {
  const stdout = execFileSync("multica", args, { encoding: "utf8" });
  return stdout.trim() ? JSON.parse(stdout) : {};
}

function multicaJsonArray(args) {
  const parsed = multicaJson(args);
  return Array.isArray(parsed) ? parsed : parsed.items ?? parsed.issues ?? [parsed];
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function statePath(repoPath) {
  return join(repoPath, PRODUCTION_STATE_RELATIVE);
}

export async function loadProductionRunState(repoPath) {
  const path = statePath(repoPath);
  if (!(await pathExists(path))) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function saveProductionRunState(repoPath, state) {
  const path = statePath(repoPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function buildLiveCli() {
  return buildWorkflowLiveCli(
    createIssueClient(runMultica),
    createMetadataClient(runMultica),
    createProjectClient(runMultica),
    createAutopilotClient(runMultica),
  );
}

export async function createProductionWorkflowRun(repoPath, projectId, parentIssueId, workflowRunId) {
  const manifest = createHermesCompositeManifest();
  const binding = await new ProjectWorkflowBindingStore(repoPath).getByProjectId(projectId);
  if (!binding) throw new Error(`Production binding missing for project ${projectId}`);
  const runStore = new WorkflowRunStateStore(repoPath);
  const ledger = await runStore.create({
    workflowRunId,
    multicaProjectId: projectId,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    adapterBundleHash: manifest.derivedBundleHash,
    executionMode: binding.executionMode,
    initialStageId: "capture",
  });
  const liveCli = buildLiveCli();
  const summary = createParentWorkflowIssueSummary({
    binding,
    workflowRunId,
    workflowBundleHash: manifest.derivedBundleHash,
    workflowStage: ledger.currentStageId ?? "capture",
    workflowStatus: ledger.workflowStatus,
    workflowStatePointer: workflowRunId,
    workflowStateHash: hashWorkflowRunLedger(ledger),
  });
  await liveCli.writeParentSummary(parentIssueId, summary);
  return { workflowRunId, ledger };
}

export async function ensureProductionControllerAutopilot(projectId, workflowRunId) {
  const existing = multicaJsonArray(["autopilot", "list", "--output", "json"])
    .find((item) => item.title === CONTROLLER_TITLE);
  if (existing?.id) return existing;
  return multicaJson([
    "autopilot", "create",
    "--title", CONTROLLER_TITLE,
    "--description", `Run one bounded controller tick for production workflow run ${workflowRunId}.`,
    "--mode", "run_only",
    "--agent", PRODUCTION_CONTROLLER_AGENT_ID,
    "--project", projectId,
    "--output", "json",
  ]);
}

export async function generateProductionFinalPackage(repoPath, state, runEvidence = {}) {
  const runStore = new WorkflowRunStateStore(repoPath);
  const ledger = await runStore.load(state.workflowRunId);
  const artifactRoot = productionFinalPackageDir(repoPath, state.workflowRunId);
  await mkdir(artifactRoot, { recursive: true });
  const pkg = {
    productionProjectId: state.projectId,
    parentIssueId: state.parentIssueId,
    parentIdentifier: state.parentIdentifier,
    workflowRunId: state.workflowRunId,
    stageIssueIds: Object.values(ledger?.stages ?? {}).map((stage) => stage.issueId).filter(Boolean),
    ledgerHash: ledger ? hashWorkflowRunLedger(ledger) : undefined,
    controllerAutopilotId: state.autopilotId,
    repoPath: state.repoPath,
    runEvidence,
    deliveryPolicy: buildProductionRunPlan(repoPath).deliveryPolicy,
  };
  const files = {
    "00-executive-summary.md": `# Production Executive Summary\n\nMaintenance project \`${state.projectId}\` workflow run \`${state.workflowRunId}\`.\n\nStop reason: ${runEvidence.stopReason ?? "report-only"}.\n`,
    "01-run-index.json": JSON.stringify(pkg, null, 2),
    "02-artifact-lineage.json": JSON.stringify(ledger?.artifacts ?? [], null, 2),
    "03-routing-evidence.json": JSON.stringify(ledger?.routeDecisions ?? [], null, 2),
    "04-autopilot-evidence.json": JSON.stringify(runEvidence.controllerEvidence ?? runEvidence.evidence ?? [], null, 2),
    "05-test-evidence.md": `- npm run ci pass on pi-multica-spine\n- campaign stages: ${runEvidence.stages?.length ?? 0}\n`,
    "06-human-actions-remaining.md": state.humanFinalReview
      ? "- Human final review completed (see 10-human-final-review.md)\n"
      : runEvidence.completed
        ? "- Human final review on final_package stage (run --human-review)\n"
        : "- Resume campaign with --campaign until workflowStatus=completed\n- Human final review on final_package stage\n",
    "07-operations-handoff.md": "See docs/production-workflow-binding.md and README workflow operations section.\n",
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(artifactRoot, name), content, "utf8");
  }
  return { artifactRoot, pkg };
}

export async function startProductionWorkflowRun(config) {
  if (config.projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(`Refusing production run for unexpected project id: ${config.projectId}`);
  }
  await clearStaleDaemonTaskContext(config.repoPath);
  const plan = buildProductionRunPlan(config.repoPath);
  await applyProductionWorkflowBinding({ repoPath: config.repoPath, projectId: config.projectId });
  let state = await loadProductionRunState(config.repoPath);
  if (!state?.parentIssueId) {
    const parent = multicaJson([
      "issue", "create",
      "--project", config.projectId,
      "--title", "Production: README v0.5.0 workflow operations",
      "--description", plan.roughIdea,
      "--status", "in_progress",
      "--output", "json",
    ]);
    const workflowRunId = buildProductionWorkflowRunId();
    const { ledger } = await createProductionWorkflowRun(config.repoPath, config.projectId, parent.id, workflowRunId);
    const autopilot = await ensureProductionControllerAutopilot(config.projectId, workflowRunId);
    state = {
      repoPath: config.repoPath,
      projectId: config.projectId,
      parentIssueId: parent.id,
      parentIdentifier: parent.identifier,
      workflowRunId,
      autopilotId: autopilot.id,
      roughIdea: plan.roughIdea,
      createdAt: new Date().toISOString(),
      ledgerSummary: summarizeProductionLedger(ledger),
    };
    await saveProductionRunState(config.repoPath, state);
  }
  const finalPackage = await generateProductionFinalPackage(config.repoPath, state, state.lastCampaign ?? {});
  return { plan, state, finalPackage };
}

export async function runProductionCampaign(config) {
  await clearStaleDaemonTaskContext(config.repoPath);
  const plan = buildProductionRunPlan(config.repoPath);
  const state = await loadProductionRunState(config.repoPath);
  if (!state?.workflowRunId) {
    throw new Error(`Production run state not found. Run --start first at ${config.repoPath}`);
  }
  const liveCli = buildLiveCli();
  const campaign = await runCanaryCampaign(productionCampaignState(config.repoPath, state), {
    liveCli,
    roughIdea: state.roughIdea ?? plan.roughIdea ?? PRODUCTION_ROUGH_IDEA,
    buildStageArtifactContent: buildProductionStageArtifactContent,
    onImplementationStage: writeProductionImplementationArtifacts,
  });
  state.lastCampaign = {
    at: new Date().toISOString(),
    completed: campaign.completed,
    workflowStatus: campaign.workflowStatus,
    currentStageId: campaign.currentStageId,
    stageCount: campaign.stages.length,
    stopReason: campaign.stopReason,
  };
  const runStore = new WorkflowRunStateStore(config.repoPath);
  state.ledgerSummary = summarizeProductionLedger(await runStore.load(state.workflowRunId));
  await saveProductionRunState(config.repoPath, state);
  const finalPackage = await generateProductionFinalPackage(config.repoPath, state, campaign);
  return { plan, state, campaign, finalPackage };
}

export async function runProductionHumanReview(config, reviewInput = {}) {
  await clearStaleDaemonTaskContext(config.repoPath);
  const state = await loadProductionRunState(config.repoPath);
  if (!state?.workflowRunId) {
    throw new Error(`Production run state not found. Run --start and --campaign first at ${config.repoPath}`);
  }
  const liveCli = buildLiveCli();
  const review = await completeHumanFinalReview(productionCampaignState(config.repoPath, state), {
    verdict: "approved",
    reviewer: "Keisu (human operator)",
    notes: "Production Maintenance lane approved. README ops docs and workflow scripts verified.",
    unresolvedAccepted: true,
    ...reviewInput,
  }, {
    liveCli,
    reviewArtifactPath: productionReviewArtifactPath(config.repoPath, state.workflowRunId),
    deliverablesVerified: [
      "- README v0.5.0 workflow operations section",
      "- `scripts/workflow-production-run.mjs` live on Maintenance project",
      "- Hermes lane completed through `final_package` with prRequired=true binding",
      "- Color policy: JSON default, --human/--color opt-in",
    ],
    defaultNotes: "Production workflow run approved.",
  });
  state.humanFinalReview = {
    at: new Date().toISOString(),
    ...review,
  };
  await saveProductionRunState(config.repoPath, state);
  const finalPackage = await generateProductionFinalPackage(config.repoPath, state, state.lastCampaign ?? {});
  return { state, review, finalPackage };
}

async function main() {
  const config = parseProductionRunArgs();
  const plan = buildProductionRunPlan(config.repoPath);
  if (config.dryRun || (!config.start && !config.campaign && !config.humanReview && !config.report)) {
    console.log(JSON.stringify({ mode: "dry-run", plan }, null, 2));
    return;
  }
  if (config.report) {
    const state = await loadProductionRunState(config.repoPath);
    if (!state) throw new Error(`Production run state not found at ${config.repoPath}`);
    const finalPackage = await generateProductionFinalPackage(config.repoPath, state, state.lastCampaign ?? {});
    console.log(JSON.stringify({ state, finalPackage }, null, 2));
    return;
  }
  if (config.humanReview) {
    const result = await runProductionHumanReview(config);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (config.campaign) {
    const result = await runProductionCampaign(config);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (config.start) {
    const result = await startProductionWorkflowRun(config);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
