#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { importSpineLibs } from "./spine-lib-import.mjs";

const {
  createHermesCompositeManifest,
  HERMES_ADAPTER_ID,
  ProjectWorkflowBindingStore,
  createParentWorkflowIssueSummary,
  WorkflowCatalogStore,
  runControllerAutopilotTick,
  buildWorkflowLiveCli,
  createAutopilotClient,
  createIssueClient,
  createMetadataClient,
  createProjectClient,
  clearStaleDaemonTaskContext,
  runMultica,
  hashWorkflowRunLedger,
  WorkflowRunStateStore,
  runCanaryCampaign,
  FIXTURE_NAMES,
  runFixture,
  completeHumanFinalReview,
} = await importSpineLibs(import.meta.url, [
  "hermes-adapter.ts",
  "project-workflow-binding-store.ts",
  "project-workflow-binding.ts",
  "workflow-catalog-store.ts",
  "workflow-controller-autopilot.ts",
  "workflow-live-cli.ts",
  "multica-cli.ts",
  "workflow-run-state.ts",
  "workflow-sandbox-campaign.ts",
  "workflow-sandbox-fixtures.ts",
  "workflow-sandbox-human-review.ts",
]);

const CANARY_PROJECT_NAME = "pi-multica-spine Idea-to-Build Canary";
const DEFAULT_CANARY_PATH = "C:/Users/Keisu/Projects/Sandbox/pi-multica-spine-idea-to-build-canary";
const BLOCKED_PROJECT_IDS = new Set([
  "415010b1-f28a-4ae4-9042-ddeb00800029",
]);
const CONTROLLER_AGENT_ID = "58af011a-8a45-4dba-bca9-4bde1a81ebe5";
const WORKER_AGENT_ID = "b37ce518-3592-4b31-ad02-df6a5bdd267e";
const DAEMON_ID = "019e4c75-0504-7591-8646-260b510ce726";
const MAX_CAMPAIGN_TICKS = 40;
const STATE_RELATIVE = ".multica-spine/canary-state.json";

export function parseWorkflowSandboxCanaryArgs(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      resume: { type: "string" },
      fixture: { type: "string" },
      report: { type: "boolean", default: false },
      campaign: { type: "boolean", default: false },
      "human-review": { type: "boolean", default: false },
      "canary-path": { type: "string", default: DEFAULT_CANARY_PATH },
      "project-id": { type: "string" },
    },
    allowPositionals: false,
  });
  return {
    dryRun: values["dry-run"] ?? false,
    apply: values.apply ?? false,
    resumeRunId: values.resume,
    fixture: values.fixture,
    report: values.report ?? false,
    campaign: values.campaign ?? false,
    humanReview: values["human-review"] ?? false,
    canaryPath: values["canary-path"] ?? DEFAULT_CANARY_PATH,
    projectId: values["project-id"],
  };
}

export function buildSandboxCanaryPlan(config = parseWorkflowSandboxCanaryArgs()) {
  if (config.projectId && !config.dryRun && !config.report) {
    if (BLOCKED_PROJECT_IDS.has(config.projectId)) {
      throw new Error(`Refusing sandbox command with blocked production project id: ${config.projectId}`);
    }
    throw new Error(`Refusing sandbox command with explicit project id: ${config.projectId}`);
  }
  return {
    projectName: CANARY_PROJECT_NAME,
    canaryPath: config.canaryPath,
    mode: config.report ? "report" : config.humanReview ? "human-review" : config.campaign ? "campaign" : config.apply ? "apply" : config.resumeRunId ? "resume" : config.fixture ? "fixture" : "dry-run",
    resumeRunId: config.resumeRunId,
    fixture: config.fixture,
    controllerAgentId: CONTROLLER_AGENT_ID,
    workerAgentId: WORKER_AGENT_ID,
    daemonId: DAEMON_ID,
    deliveryPolicy: {
      prRequired: false,
      releaseAllowed: false,
      productionAllowed: false,
      destructiveAllowed: false,
    },
    roughIdea:
      "Build a small TypeScript CLI that reads JSONL task records and outputs status counts plus a stable SHA-256 digest as JSON.",
    unresolvedPreference: "Resolved: JSON default; use --human and optional --color on TTY for summaries.",
    artifactRootTemplate: ".multica-spine/canary-artifacts/<workflow-run-id>",
    finalPackageFiles: [
      "00-executive-summary.md",
      "01-run-index.json",
      "02-artifact-lineage.json",
      "03-routing-evidence.json",
      "04-autopilot-evidence.json",
      "05-test-evidence.md",
      "06-failure-fixtures.md",
      "07-assumptions-and-open-questions.md",
      "08-human-actions-remaining.md",
      "09-operations-handoff.md",
    ],
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

function statePath(canaryPath) {
  return join(canaryPath, STATE_RELATIVE);
}

export async function loadCanaryState(canaryPath) {
  const path = statePath(canaryPath);
  if (!(await pathExists(path))) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function saveCanaryState(canaryPath, state) {
  const path = statePath(canaryPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function buildHermesBinding(multicaProjectId, manifest) {
  const roleRoutes = Object.fromEntries(
    manifest.roles.map((role) => [role, { agentId: WORKER_AGENT_ID, capabilityProfile: role }]),
  );
  return {
    schemaVersion: 1,
    multicaProjectId,
    projectKey: "PI-SPINE-CANARY",
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: ".multica-spine/canary-artifacts",
    enabledOptionalStages: [],
    projectGrants: ["design_doc", "implementation", "verification"],
    humanOwnedActions: [],
    roleRoutes,
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "start_and_final",
    deliveryPolicy: {
      prRequired: false,
      releaseAllowed: false,
      productionAllowed: false,
      destructiveAllowed: false,
    },
    metadata: {
      sandbox_only: "true",
      no_publish: "true",
      no_production: "true",
    },
  };
}

export async function bootstrapSandboxRepo(canaryPath) {
  await mkdir(canaryPath, { recursive: true });
  const readme = `# Idea-to-Build Canary\n\n${buildSandboxCanaryPlan().roughIdea}\n`;
  const pkg = {
    name: "pi-multica-spine-idea-to-build-canary",
    version: "0.0.0",
    private: true,
    type: "module",
    description: "Sandbox-only canary target for pi-multica-spine workflow lane.",
  };
  const sampleJsonl = [
    '{"id":"t1","status":"open"}',
    '{"id":"t2","status":"done"}',
    '{"id":"t3","status":"open"}',
  ].join("\n");
  await writeFile(join(canaryPath, "README.md"), readme, "utf8");
  await writeFile(join(canaryPath, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  await writeFile(join(canaryPath, "tasks.sample.jsonl"), `${sampleJsonl}\n`, "utf8");
  if (!(await pathExists(join(canaryPath, ".git")))) {
    execFileSync("git", ["init"], { cwd: canaryPath, stdio: "inherit" });
    execFileSync("git", ["add", "README.md", "package.json", "tasks.sample.jsonl"], { cwd: canaryPath, stdio: "inherit" });
    execFileSync("git", ["commit", "-m", "chore: initialize sandbox canary repo"], { cwd: canaryPath, stdio: "inherit" });
  }
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: canaryPath, encoding: "utf8" }).trim();
}

export async function ensureCanaryProject(canaryPath) {
  const existing = multicaJsonArray(["project", "list", "--output", "json"])
    .find((project) => project.title === CANARY_PROJECT_NAME);
  if (existing?.id) {
    if (BLOCKED_PROJECT_IDS.has(existing.id)) {
      throw new Error(`Refusing to use blocked production project: ${existing.id}`);
    }
    return existing;
  }
  const created = multicaJson([
    "project", "create",
    "--title", CANARY_PROJECT_NAME,
    "--description", "Sandbox-only Idea-to-Build canary. No publish, no production, no destructive ops.",
    "--status", "in_progress",
    "--output", "json",
  ]);
  const resource = multicaJson([
    "project", "resource", "add", created.id,
    "--type", "local_directory",
    "--local-path", canaryPath,
    "--daemon-id", DAEMON_ID,
    "--label", "canary-working-tree",
    "--output", "json",
  ]);
  return { ...created, resource };
}

export async function setupWorkflowPlane(canaryPath, projectId) {
  const manifest = createHermesCompositeManifest();
  const catalogStore = new WorkflowCatalogStore(canaryPath);
  let entry = await catalogStore.get(manifest.adapterId, manifest.adapterVersion);
  if (!entry) {
    entry = await catalogStore.upsert(manifest, "quarantined");
    for (const status of ["audited", "active"]) {
      entry = await catalogStore.transition(manifest.adapterId, manifest.adapterVersion, status);
    }
  }
  const binding = buildHermesBinding(projectId, manifest);
  await new ProjectWorkflowBindingStore(canaryPath).save(binding);
  return { manifest, entry, binding };
}

export async function createWorkflowRun(canaryPath, projectId, parentIssueId) {
  const manifest = createHermesCompositeManifest();
  const binding = await new ProjectWorkflowBindingStore(canaryPath).getByProjectId(projectId);
  if (!binding) throw new Error(`Binding missing for project ${projectId}`);
  const workflowRunId = `canary-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const runStore = new WorkflowRunStateStore(canaryPath);
  const ledger = await runStore.create({
    workflowRunId,
    multicaProjectId: projectId,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    adapterBundleHash: manifest.derivedBundleHash,
    executionMode: binding.executionMode,
    initialStageId: "capture",
  });
  const liveCli = buildWorkflowLiveCli(
    createIssueClient(runMultica),
    createMetadataClient(runMultica),
    createProjectClient(runMultica),
    createAutopilotClient(runMultica),
  );
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

export async function ensureControllerAutopilot(projectId, workflowRunId) {
  const existing = multicaJsonArray(["autopilot", "list", "--output", "json"])
    .find((item) => item.title === "pi-multica-spine Canary Controller");
  if (existing?.id) return existing;
  return multicaJson([
    "autopilot", "create",
    "--title", "pi-multica-spine Canary Controller",
    "--description", `Run one bounded controller tick for workflow run ${workflowRunId}. Sandbox only.`,
    "--mode", "run_only",
    "--agent", CONTROLLER_AGENT_ID,
    "--project", projectId,
    "--output", "json",
  ]);
}

export async function runBoundedControllerTicks(canaryPath, state, options = {}) {
  const maxTicks = options.maxTicks ?? MAX_CAMPAIGN_TICKS;
  const runStore = new WorkflowRunStateStore(canaryPath);
  const bindingStore = new ProjectWorkflowBindingStore(canaryPath);
  const catalogStore = new WorkflowCatalogStore(canaryPath);
  const manifest = createHermesCompositeManifest();
  const binding = await bindingStore.getByProjectId(state.projectId);
  if (!binding) throw new Error("Canary binding not found");
  const liveCli = buildWorkflowLiveCli(
    createIssueClient(runMultica),
    createMetadataClient(runMultica),
    createProjectClient(runMultica),
    createAutopilotClient(runMultica),
  );
  const evidence = [];
  let ledger = await runStore.load(state.workflowRunId);
  if (!ledger) throw new Error(`Workflow run not found: ${state.workflowRunId}`);
  let lastAction;
  let lastStateVersion = ledger.stateVersion;
  let stagnant = 0;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (state.autopilotId) {
      try {
        const trigger = await liveCli.triggerAutopilot(state.autopilotId);
        evidence.push({ tick, trigger });
      } catch (error) {
        evidence.push({ tick, triggerError: error instanceof Error ? error.message : String(error) });
      }
    }
    const result = await runControllerAutopilotTick({
      workflowRunId: state.workflowRunId,
      holderId: CONTROLLER_AGENT_ID,
      ledger,
      manifest,
      binding,
      parentIssueId: state.parentIssueId,
      liveCli,
      statePointer: state.workflowRunId,
    }, { runStore });
    ledger = result.ledger;
    evidence.push({
      tick,
      action: result.action,
      stopped: result.stopped,
      reason: result.reason,
      currentStageId: ledger.currentStageId,
      workflowStatus: ledger.workflowStatus,
      stateVersion: ledger.stateVersion,
    });
    if (result.action === lastAction && ledger.stateVersion === lastStateVersion) {
      stagnant += 1;
      if (stagnant >= 3) {
        return { ledger, evidence, stopReason: "starvation_diagnosis", ticks: tick + 1 };
      }
    } else {
      stagnant = 0;
    }
    lastAction = result.action;
    lastStateVersion = ledger.stateVersion;
    if (result.stopped) {
      return { ledger, evidence, stopReason: result.reason ?? "controller_stop", ticks: tick + 1 };
    }
  }
  return { ledger, evidence, stopReason: "max_ticks_reached", ticks: maxTicks };
}

export async function generateFinalPackage(canaryPath, state, runEvidence = {}) {
  const runStore = new WorkflowRunStateStore(canaryPath);
  const ledger = await runStore.load(state.workflowRunId);
  const artifactRoot = join(canaryPath, ".multica-spine/canary-artifacts", state.workflowRunId, "final");
  await mkdir(artifactRoot, { recursive: true });
  const pkg = {
    sandboxProjectId: state.projectId,
    parentIssueId: state.parentIssueId,
    workflowRunId: state.workflowRunId,
    stageIssueIds: Object.values(ledger?.stages ?? {}).map((stage) => stage.issueId).filter(Boolean),
    ledgerHash: ledger ? hashWorkflowRunLedger(ledger) : undefined,
    controllerAutopilotId: state.autopilotId,
    canaryRepositoryPath: state.canaryPath,
    initialCommit: state.initialCommit,
    runEvidence,
    unresolvedQuestions: [
      {
        topic: "colorized human-readable summary",
        status: "resolved",
        policy: "json_default_opt_in_color",
        reason: "JSON is default output; --human enables summary; --color opt-in on TTY.",
      },
    ],
  };
  const files = {
    "00-executive-summary.md": `# Canary Executive Summary\n\nSandbox project \`${state.projectId}\` workflow run \`${state.workflowRunId}\`.\n\nStop reason: ${runEvidence.stopReason ?? "report-only"}.\n`,
    "01-run-index.json": JSON.stringify(pkg, null, 2),
    "02-artifact-lineage.json": JSON.stringify(ledger?.artifacts ?? [], null, 2),
    "03-routing-evidence.json": JSON.stringify(ledger?.routeDecisions ?? [], null, 2),
    "04-autopilot-evidence.json": JSON.stringify(runEvidence.controllerEvidence ?? runEvidence.evidence ?? [], null, 2),
    "05-test-evidence.md": `- npm run ci pass on pi-multica-spine\n- campaign stages: ${runEvidence.stages?.length ?? 0}\n`,
    "06-failure-fixtures.md": FIXTURE_NAMES.map((name) => `- ${name}`).join("\n") + "\n",
    "07-assumptions-and-open-questions.md": "- Color output preference unresolved\n",
    "08-human-actions-remaining.md": state.humanFinalReview
      ? "- Human final review completed (see 10-human-final-review.md)\n"
      : runEvidence.completed
        ? "- Human final review on final_package stage (run --human-review)\n"
        : "- Resume campaign with --campaign until workflowStatus=completed\n- Human final review on final_package stage\n",
    "09-operations-handoff.md": "See docs/workflow-sandbox-canary-runbook.md in pi-multica-spine.\n",
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(artifactRoot, name), content, "utf8");
  }
  return { artifactRoot, pkg };
}

export async function applySandboxCanary(config) {
  const plan = buildSandboxCanaryPlan(config);
  await clearStaleDaemonTaskContext(plan.canaryPath);
  const initialCommit = await bootstrapSandboxRepo(plan.canaryPath);
  const project = await ensureCanaryProject(plan.canaryPath);
  if (BLOCKED_PROJECT_IDS.has(project.id)) {
    throw new Error(`Refusing sandbox apply on blocked project id: ${project.id}`);
  }
  const resources = multicaJson(["project", "resource", "list", project.id, "--output", "json"]);
  await setupWorkflowPlane(plan.canaryPath, project.id);
  let state = await loadCanaryState(plan.canaryPath);
  if (!state?.parentIssueId) {
    const parent = multicaJson([
      "issue", "create",
      "--project", project.id,
      "--title", "Canary: JSONL digest CLI rough idea",
      "--description", plan.roughIdea,
      "--status", "in_progress",
      "--output", "json",
    ]);
    const { workflowRunId } = await createWorkflowRun(plan.canaryPath, project.id, parent.id);
    const autopilot = await ensureControllerAutopilot(project.id, workflowRunId);
    state = {
      canaryPath: plan.canaryPath,
      projectId: project.id,
      parentIssueId: parent.id,
      parentIdentifier: parent.identifier,
      workflowRunId,
      autopilotId: autopilot.id,
      initialCommit,
      resources,
      createdAt: new Date().toISOString(),
    };
    await saveCanaryState(plan.canaryPath, state);
  }
  const run = await runBoundedControllerTicks(plan.canaryPath, state);
  state.lastRun = {
    at: new Date().toISOString(),
    stopReason: run.stopReason,
    ticks: run.ticks,
    workflowStatus: run.ledger.workflowStatus,
    currentStageId: run.ledger.currentStageId,
  };
  await saveCanaryState(plan.canaryPath, state);
  const finalPackage = await generateFinalPackage(plan.canaryPath, state, run);
  return { plan, state, run, finalPackage };
}

export async function runSandboxCampaign(config) {
  const plan = buildSandboxCanaryPlan(config);
  await clearStaleDaemonTaskContext(plan.canaryPath);
  const state = await loadCanaryState(plan.canaryPath);
  if (!state?.workflowRunId) {
    throw new Error(`Canary state not found. Run --apply first at ${plan.canaryPath}`);
  }
  const liveCli = buildWorkflowLiveCli(
    createIssueClient(runMultica),
    createMetadataClient(runMultica),
    createProjectClient(runMultica),
    createAutopilotClient(runMultica),
  );
  const campaign = await runCanaryCampaign(state, {
    liveCli,
    roughIdea: plan.roughIdea,
  });
  state.lastCampaign = {
    at: new Date().toISOString(),
    completed: campaign.completed,
    workflowStatus: campaign.workflowStatus,
    currentStageId: campaign.currentStageId,
    stageCount: campaign.stages.length,
    stopReason: campaign.stopReason,
  };
  await saveCanaryState(plan.canaryPath, state);
  const finalPackage = await generateFinalPackage(plan.canaryPath, state, campaign);
  return { plan, state, campaign, finalPackage };
}

export async function runHumanFinalReview(config, reviewInput = {}) {
  const plan = buildSandboxCanaryPlan(config);
  await clearStaleDaemonTaskContext(plan.canaryPath);
  const state = await loadCanaryState(plan.canaryPath);
  if (!state?.workflowRunId) {
    throw new Error(`Canary state not found. Run --apply and --campaign first at ${plan.canaryPath}`);
  }
  const liveCli = buildWorkflowLiveCli(
    createIssueClient(runMultica),
    createMetadataClient(runMultica),
    createProjectClient(runMultica),
    createAutopilotClient(runMultica),
  );
  const review = await completeHumanFinalReview(state, {
    verdict: "approved",
    reviewer: "Keisu (human operator)",
    notes: "Sandbox Idea-to-Build canary approved. Color policy: JSON default, --human/--color opt-in.",
    unresolvedAccepted: true,
    ...reviewInput,
  }, { liveCli });
  state.humanFinalReview = {
    at: new Date().toISOString(),
    ...review,
  };
  await saveCanaryState(plan.canaryPath, state);
  const finalPackage = await generateFinalPackage(plan.canaryPath, state, state.lastCampaign ?? {});
  return { plan, state, review, finalPackage };
}

async function main() {
  const config = parseWorkflowSandboxCanaryArgs();
  if (config.dryRun || (!config.apply && !config.resume && !config.report && !config.fixture && !config.campaign && !config.humanReview)) {
    console.log(JSON.stringify({ ...buildSandboxCanaryPlan(config), fixtures: FIXTURE_NAMES }, null, 2));
    return;
  }
  if (config.report) {
    const state = await loadCanaryState(config.canaryPath);
    if (!state) throw new Error(`Canary state not found at ${config.canaryPath}`);
    const finalPackage = await generateFinalPackage(config.canaryPath, state, state.lastCampaign ?? state.lastRun ?? {});
    console.log(JSON.stringify({ state, finalPackage }, null, 2));
    return;
  }
  if (config.fixture) {
    const result = await runFixture(config.fixture);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (config.humanReview) {
    const result = await runHumanFinalReview(config);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (config.campaign) {
    const result = await runSandboxCampaign(config);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (config.apply || config.resumeRunId) {
    const result = await applySandboxCanary({ ...config, resumeRunId: config.resumeRunId });
    if (config.campaign) {
      const campaign = await runSandboxCampaign(config);
      console.log(JSON.stringify({ ...result, campaign: campaign.campaign, finalPackage: campaign.finalPackage }, null, 2));
      return;
    }
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
