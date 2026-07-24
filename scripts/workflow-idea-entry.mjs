#!/usr/bin/env node
/**
 * Idea-to-build slash entry bootstrap (R-MNT-37, Release A #59).
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { importSpineLibs } from "./spine-lib-import.mjs";
import { runWorkflowSandboxChecklist } from "./workflow-sandbox-checklist.mjs";
import {
  bootstrapSandboxRepo,
  buildFreshCanaryPath,
  buildSandboxCanaryPlan,
  DEFAULT_CANARY_PATH,
  parseWorkflowSandboxCanaryArgs,
} from "./workflow-sandbox-canary.mjs";

const {
  formatIdeaEntryHumanResult,
  resolveIdeaEntryConfig,
  IdeaInvocationReservationStore,
  normalizeRoughIdea,
  hashNormalizedInput,
  IdeaSessionManifestStore,
  IdeaLocalLaneStore,
} = await importSpineLibs(import.meta.url, [
  "idea-entry-human.ts",
  "idea-entry-config.ts",
  "idea-entry-reservation.ts",
  "idea-session-manifest.ts",
  "idea-local-lane.ts",
]);

export const MIN_ROUGH_IDEA_LENGTH = 12;

export function parseWorkflowIdeaEntryArgs(argv = process.argv.slice(2)) {
  const execute = argv.includes("--execute");
  const runFullCampaign = argv.includes("--run-full-campaign");
  const dryRun = argv.includes("--dry-run") || (!execute && !argv.includes("--plan"));
  const json = argv.includes("--json") || !argv.includes("--plain");
  const verbose = argv.includes("--verbose");
  const reuseDefaultCanary = argv.includes("--reuse-default-canary");
  const newSession = argv.includes("--new-session");
  const canaryPathArg = argv.find((arg, index) => argv[index - 1] === "--canary-path");
  const roughIdeaArg = argv.find((arg, index) => argv[index - 1] === "--rough-idea");
  const roughIdeaFileArg = argv.find((arg, index) => argv[index - 1] === "--rough-idea-file");
  const maxStageCyclesArg = argv.find((arg, index) => argv[index - 1] === "--max-stage-cycles");
  const sessionSuffixArg = argv.find((arg, index) => argv[index - 1] === "--session-suffix");
  const invocationTokenArg = argv.find((arg, index) => argv[index - 1] === "--invocation-token");
  const vaultRootArg = argv.find((arg, index) => argv[index - 1] === "--vault-root");
  const sessionsRootArg = argv.find((arg, index) => argv[index - 1] === "--sessions-root");
  return {
    execute,
    runFullCampaign,
    dryRun,
    json,
    verbose,
    reuseDefaultCanary,
    newSession,
    canaryPath: canaryPathArg,
    roughIdea: roughIdeaArg,
    roughIdeaFile: roughIdeaFileArg,
    maxStageCycles: maxStageCyclesArg ? Number(maxStageCyclesArg) : undefined,
    sessionSuffix: sessionSuffixArg,
    invocationToken: invocationTokenArg,
    vaultRoot: vaultRootArg,
    sessionsRoot: sessionsRootArg,
  };
}

export function summarizeBootstrapRun(run = {}) {
  const ledger = run.ledger ?? {};
  return {
    completed: false,
    workflowStatus: ledger.workflowStatus ?? "waiting",
    currentStageId: ledger.currentStageId ?? "capture",
    stageCount: Object.keys(ledger.stages ?? {}).length,
    stopReason: run.stopReason ?? "bootstrap_only",
  };
}

export async function bootstrapLocalIdeaSession({
  canaryPath,
  sessionId,
  roughIdea,
  bootstrapSandboxRepo: bootstrap = bootstrapSandboxRepo,
}) {
  const initialCommit = await bootstrap(canaryPath);
  const lane = await new IdeaLocalLaneStore(canaryPath).create({
    sessionId,
    workflowRunId: `idea-${sessionId}`,
    roughIdea,
  });
  return {
    workflowRunId: lane.workflowRunId,
    currentStageId: lane.currentStageId,
    workflowStatus: lane.status,
    initialCommit,
  };
}

export function buildLiveIdeaEntryNextSteps({ canaryPath, roughIdea, campaign }) {
  if (campaign.completed) {
    return ["Implementation Project creation occurs at build_handoff, before implementation work starts."];
  }
  return [
    `After explicit human approval, advance one local idea stage for ${JSON.stringify(canaryPath)}. Do not create a Multica Project before build_handoff.`,
  ];
}

export function resolveIdeaEntryCanaryPath(roughIdea, options = {}) {
  if (options.canaryPath) return options.canaryPath;
  if (options.reuseDefaultCanary) return DEFAULT_CANARY_PATH;
  return buildFreshCanaryPath(roughIdea, {
    now: options.now,
    sessionSuffix: options.sessionSuffix,
    sessionsRoot: options.sessionsRoot,
  });
}

export async function loadRoughIdeaFromArgs(args) {
  if (args.roughIdea?.trim()) return args.roughIdea.trim();
  if (args.roughIdeaFile) {
    return (await readFile(args.roughIdeaFile, "utf8")).trim();
  }
  return undefined;
}

export function validateRoughIdea(roughIdea) {
  if (!roughIdea?.trim()) {
    return { ok: false, error: "rough idea required (pass --rough-idea or --rough-idea-file)" };
  }
  if (roughIdea.trim().length < MIN_ROUGH_IDEA_LENGTH) {
    return { ok: false, error: `rough idea must be at least ${MIN_ROUGH_IDEA_LENGTH} characters` };
  }
  return { ok: true, roughIdea: roughIdea.trim() };
}

function canaryArgv(canaryPath, roughIdea, extra = []) {
  return ["--canary-path", canaryPath, "--rough-idea", roughIdea, ...extra];
}

function completedReservationResult(reservation, extra = {}) {
  return {
    ok: true,
    reused: true,
    mode: "completed",
    sessionId: reservation.sessionId,
    invocationToken: reservation.invocationToken,
    canaryPath: reservation.canaryPath,
    parentIdentifier: reservation.parentIdentifier,
    workflowRunId: reservation.workflowRunId,
    skillCommand: "/skill:idea-to-build",
    next: reservation.workflowRunId
      ? `/skill:idea-status --workflow-run-id ${reservation.workflowRunId}`
      : "/skill:idea-to-build",
    ...extra,
  };
}

export async function runWorkflowIdeaEntry(options = {}) {
  const loaded = options.roughIdea ?? (await loadRoughIdeaFromArgs(options));
  const validation = validateRoughIdea(loaded);
  if (!validation.ok) {
    return { ok: false, mode: "validation", error: validation.error };
  }
  const roughIdea = validation.roughIdea;
  const normalizedInput = normalizeRoughIdea(roughIdea);

  let config;
  try {
    config = await resolveIdeaEntryConfig({
      flagVaultRoot: options.vaultRoot,
      flagSessionsRoot: options.sessionsRoot,
      cwd: options.cwd,
      projectConfigPath: options.projectConfigPath,
    });
  } catch (error) {
    return { ok: false, mode: "validation", error: error instanceof Error ? error.message : String(error) };
  }

  const sessionsRoot = config.sessionsRoot ?? options.cwd ?? process.cwd();
  const invocationToken = options.newSession ? randomUUID() : (options.invocationToken ?? randomUUID());
  const reservationStore = new IdeaInvocationReservationStore(sessionsRoot);
  let reservation;
  try {
    reservation = await reservationStore.reserve({
      invocationToken,
      normalizedInput,
      now: options.now ? () => options.now.toISOString?.() ?? String(options.now) : undefined,
    });
  } catch (error) {
    return { ok: false, mode: "validation", error: error instanceof Error ? error.message : String(error) };
  }

  if (reservation.status === "completed" && reservation.workflowRunId) {
    return completedReservationResult(reservation, {
      result: `Reused sandbox idea session ${reservation.sessionId} for parent ${reservation.parentIdentifier ?? "(unknown)"}`,
    });
  }

  const canaryPath = reservation.canaryPath
    ?? resolveIdeaEntryCanaryPath(roughIdea, {
      canaryPath: options.canaryPath,
      reuseDefaultCanary: options.reuseDefaultCanary ?? false,
      reuseDefaultCanaryPath: options.reuseDefaultCanaryPath,
      now: options.now,
      sessionSuffix: options.sessionSuffix ?? reservation.sessionId,
      sessionsRoot,
    });
  const freshSession = !reservation.canaryPath && !options.canaryPath && !(options.reuseDefaultCanary ?? false);

  if (!reservation.canaryPath) {
    reservation = await reservationStore.update(invocationToken, {
      status: "mutating",
      canaryPath,
    });
  }

  const manifestStore = new IdeaSessionManifestStore(canaryPath);
  await manifestStore.writeOnce({
    sessionId: reservation.sessionId,
    invocationToken: reservation.invocationToken,
    normalizedInputHash: hashNormalizedInput(normalizedInput),
    canaryPath,
    lifecycleStatus: options.execute ? "starting" : "planned",
    now: options.now?.toISOString?.() ?? (typeof options.now === "string" ? options.now : undefined),
  });

  const plan = buildSandboxCanaryPlan(
    parseWorkflowSandboxCanaryArgs(canaryArgv(canaryPath, roughIdea, ["--dry-run"])),
  );

  const checklist = await runWorkflowSandboxChecklist({
    live: false,
    canaryPath,
  });
  if (!checklist.ok) {
    await reservationStore.update(invocationToken, { status: "failed", error: "preflight failed" });
    return { ok: false, mode: options.execute ? "live" : "offline", step: "preflight", checklist, plan, sessionId: reservation.sessionId, invocationToken };
  }

  if (!options.execute) {
    return {
      ok: true,
      mode: "offline-plan",
      roughIdea,
      canaryPath,
      freshSession,
      plan,
      checklist,
      sessionId: reservation.sessionId,
      invocationToken,
      config,
      skillCommand: "/skill:idea-to-build",
      result: `Planned sandbox idea session ${reservation.sessionId}`,
      next: `node scripts/workflow-idea-entry.mjs --rough-idea ${JSON.stringify(roughIdea)} --execute --invocation-token ${invocationToken}`,
      nextSteps: [
        "Invoke /skill:idea-to-build then paste the rough idea",
        `node scripts/workflow-idea-entry.mjs --rough-idea ${JSON.stringify(roughIdea)} --execute --invocation-token ${invocationToken}`,
        "After explicit approval, advance one local stage at a time; promote only after build_handoff is promotion_ready.",
      ],
    };
  }

  if (options.runFullCampaign) {
    await reservationStore.update(invocationToken, { status: "failed", error: "full campaign requires the deferred project-bound implementation lane" });
    return {
      ok: false,
      mode: "validation",
      error: "--run-full-campaign is unavailable before build_handoff creates or reuses an implementation project",
      sessionId: reservation.sessionId,
      invocationToken,
    };
  }

  const localSession = await bootstrapLocalIdeaSession({
    canaryPath,
    sessionId: reservation.sessionId,
    roughIdea,
  });
  const campaign = {
    completed: false,
    workflowStatus: localSession.workflowStatus,
    currentStageId: localSession.currentStageId,
    stageCount: 1,
    stopReason: "local_capture_ready",
  };

  const ok = Boolean(localSession.workflowRunId) && plan.deliveryPolicy.productionAllowed === false;

  if (ok) {
    await manifestStore.patch({
      workflowRunId: localSession.workflowRunId,
      lifecycleStatus: "active",
    });
    await reservationStore.update(invocationToken, {
      status: "completed",
      workflowRunId: localSession.workflowRunId,
      resultPointer: localSession.workflowRunId,
    });
  } else {
    await reservationStore.update(invocationToken, { status: "failed", error: "local idea bootstrap incomplete" });
  }

  return {
    ok,
    mode: "live-start",
    roughIdea,
    canaryPath,
    freshSession,
    checklist,
    sessionId: reservation.sessionId,
    invocationToken,
    workflowRunId: localSession.workflowRunId,
    campaign,
    result: ok
      ? `Started local idea session ${reservation.sessionId} at capture. No Multica Project or Spine binding exists before build_handoff.`
      : "Local idea entry did not complete",
    next: localSession.workflowRunId
      ? `/skill:idea-status --workflow-run-id ${localSession.workflowRunId}`
      : "/skill:idea-to-build",
    nextSteps: buildLiveIdeaEntryNextSteps({ canaryPath, roughIdea, campaign }),
  };
}

async function main() {
  const args = parseWorkflowIdeaEntryArgs();
  const report = await runWorkflowIdeaEntry({
    execute: args.execute,
    runFullCampaign: args.runFullCampaign,
    canaryPath: args.canaryPath,
    reuseDefaultCanary: args.reuseDefaultCanary,
    roughIdea: await loadRoughIdeaFromArgs(args),
    maxStageCycles: args.maxStageCycles,
    sessionSuffix: args.sessionSuffix,
    invocationToken: args.invocationToken,
    newSession: args.newSession,
    vaultRoot: args.vaultRoot,
    sessionsRoot: args.sessionsRoot,
    cwd: process.cwd(),
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (args.verbose) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatIdeaEntryHumanResult(report));
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
