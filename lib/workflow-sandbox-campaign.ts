import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

import {
  createHermesCompositeManifest,
  evaluateHermesSpecReview,
  HERMES_SPEC_REVIEW_STAGE_ID,
  type HermesStageExecutionPacket,
} from "./hermes-adapter.ts";
import { sha256Hex } from "./hash.ts";
import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { runControllerAutopilotTick } from "./workflow-controller-autopilot.ts";
import { seedWorkflowStageLive } from "./workflow-controller.ts";
import type { WorkflowLiveCli } from "./workflow-live-cli.ts";
import {
  hashWorkflowRunLedger,
  type WorkflowArtifactEnvelope,
  type WorkflowRunStateLedger,
  WorkflowRunStateStore,
} from "./workflow-run-state.ts";
import type { WorkflowCatalogManifest } from "./workflow-catalog.ts";

export const CONTROLLER_AGENT_ID = "58af011a-8a45-4dba-bca9-4bde1a81ebe5";
export const MAX_CAMPAIGN_STAGE_CYCLES = 80;
export const MAX_CONTROLLER_TICKS_PER_STAGE = 12;

export interface CanaryCampaignState {
  canaryPath: string;
  projectId: string;
  parentIssueId: string;
  workflowRunId: string;
  autopilotId?: string;
}

export interface CampaignStageResult {
  stageId: string;
  attempt: number;
  issueId?: string;
  outputPath: string;
  outputHash: string;
  controllerTicks: number;
  stopReason?: string;
}

export interface CampaignRunResult {
  completed: boolean;
  workflowStatus: string;
  currentStageId?: string;
  stages: CampaignStageResult[];
  controllerEvidence: unknown[];
  stopReason?: string;
}

function manifestStage(manifest: WorkflowCatalogManifest, stageId: string) {
  const stage = manifest.stages.find((item) => item.stageId === stageId);
  if (!stage) throw new Error(`Unknown manifest stage: ${stageId}`);
  return stage;
}

function collectInputArtifactHashes(
  ledger: WorkflowRunStateLedger,
  manifest: WorkflowCatalogManifest,
  stageId: string,
): string[] {
  const stageIndex = manifest.stages.findIndex((stage) => stage.stageId === stageId);
  if (stageIndex <= 0) return [];
  const hashes: string[] = [];
  for (let index = 0; index < stageIndex; index += 1) {
    const priorStageId = manifest.stages[index].stageId;
    const priorStage = ledger.stages[priorStageId];
    if (!priorStage) continue;
    for (const hash of priorStage.artifactHashes) {
      if (!hashes.includes(hash)) hashes.push(hash);
    }
  }
  return hashes;
}

function stageArtifactRelativePath(binding: ProjectWorkflowBinding, workflowRunId: string, outputFile: string): string {
  return posix.join(binding.artifactRoot, workflowRunId, outputFile);
}

export function buildStageArtifactContent(
  stageId: string,
  manifest: WorkflowCatalogManifest,
  ledger: WorkflowRunStateLedger,
  roughIdea: string,
): string {
  const stage = manifestStage(manifest, stageId);
  const outputs = stage.outputs?.join(", ") ?? "artifact";
  if (stageId === "implementation") {
    return [
      "# Build report",
      "",
      "Implemented minimal JSONL digest CLI in `src/digest.mjs`.",
      "",
      "## Commands",
      "- `node src/digest.mjs tasks.sample.jsonl`",
      "",
      "## Unresolved",
      "- Colorized human-readable summary preference remains unresolved.",
    ].join("\n");
  }
  if (stageId === "question_resolution") {
    return [
      "# Question resolution",
      "",
      "## Q1: Should human-readable output use color?",
      "- answer_status: unresolved",
      "- reason: No user preference recorded during capture.",
      `- rough_idea: ${roughIdea}`,
    ].join("\n");
  }
  if (stageId === HERMES_SPEC_REVIEW_STAGE_ID) {
    return [
      "# Spec review",
      "",
      "Verdict: pass",
      "- No blocking findings",
      "- Optional color preference documented as unresolved",
    ].join("\n");
  }
  if (stageId === "final_package") {
    return [
      "# Final output package",
      "",
      `workflow_run_id: ${ledger.workflowRunId}`,
      `ledger_hash: ${hashWorkflowRunLedger(ledger)}`,
      "",
      "Deliverables: JSONL digest CLI + campaign evidence package.",
      "Human final review requested.",
    ].join("\n");
  }
  return [
    `# ${stageId}`,
    "",
    `role: ${stage.role}`,
    `outputs: ${outputs}`,
    "",
    roughIdea,
  ].join("\n");
}

export async function writeImplementationArtifacts(canaryPath: string): Promise<void> {
  const digestSource = `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node src/digest.mjs <tasks.jsonl>");
  process.exit(1);
}
const lines = readFileSync(path, "utf8").trim().split(/\\n+/).filter(Boolean);
const counts = {};
for (const line of lines) {
  const record = JSON.parse(line);
  const status = String(record.status ?? "unknown");
  counts[status] = (counts[status] ?? 0) + 1;
}
const payload = { counts, lineCount: lines.length };
const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
console.log(JSON.stringify({ ...payload, digest }));
`;
  await mkdir(join(canaryPath, "src"), { recursive: true });
  await writeFile(join(canaryPath, "src", "digest.mjs"), digestSource, "utf8");
  const pkgPath = join(canaryPath, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.scripts = { ...(pkg.scripts ?? {}), digest: "node src/digest.mjs tasks.sample.jsonl" };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

async function ensureStageIssue(
  ledger: WorkflowRunStateLedger,
  manifest: WorkflowCatalogManifest,
  binding: ProjectWorkflowBinding,
  parentIssueId: string,
  liveCli: WorkflowLiveCli,
  runStore: WorkflowRunStateStore,
): Promise<WorkflowRunStateLedger> {
  const stageId = ledger.currentStageId;
  if (!stageId) throw new Error("Ledger missing currentStageId");
  const stage = ledger.stages[stageId];
  if (!stage) throw new Error(`Ledger missing stage state: ${stageId}`);
  if (stage.issueId) return ledger;
  const seeded = await seedWorkflowStageLive({
    ledger,
    manifest,
    binding,
    parentIssueId,
    stageId,
    attempt: stage.attempt,
    liveCli,
  });
  return runStore.upsertStage(ledger.workflowRunId, {
    stageId: seeded.stage.stageId,
    status: seeded.stage.status,
    attempt: seeded.stage.attempt,
    issueId: seeded.issueId,
    assignedAgentId: seeded.stage.assignedAgentId,
    artifactHashes: seeded.stage.artifactHashes,
  });
}

async function produceStageArtifact(
  canaryPath: string,
  state: CanaryCampaignState,
  ledger: WorkflowRunStateLedger,
  manifest: WorkflowCatalogManifest,
  binding: ProjectWorkflowBinding,
  runStore: WorkflowRunStateStore,
  roughIdea: string,
): Promise<{ ledger: WorkflowRunStateLedger; artifact: WorkflowArtifactEnvelope }> {
  const stageId = ledger.currentStageId;
  if (!stageId) throw new Error("Ledger missing currentStageId");
  const stage = ledger.stages[stageId];
  if (!stage?.issueId) throw new Error(`Stage ${stageId} missing issueId before artifact production`);
  if (stage.status === "produced" || stage.status === "accepted") {
    const artifact = [...ledger.artifacts].reverse().find((item) => item.stageId === stageId && item.attempt === stage.attempt);
    if (!artifact) throw new Error(`Produced stage ${stageId} missing artifact envelope`);
    return { ledger, artifact };
  }
  if (stageId === "implementation") {
    await writeImplementationArtifacts(canaryPath);
  }
  const manifestStageDef = manifestStage(manifest, stageId);
  const outputFile = manifestStageDef.outputs?.[0] ?? `${stageId}.md`;
  const outputPath = stageArtifactRelativePath(binding, state.workflowRunId, outputFile);
  const absolutePath = join(canaryPath, outputPath);
  await mkdir(join(canaryPath, binding.artifactRoot, state.workflowRunId), { recursive: true });
  const content = buildStageArtifactContent(stageId, manifest, ledger, roughIdea);
  await writeFile(absolutePath, `${content}\n`, "utf8");
  const outputHash = sha256Hex(content);
  const artifact: WorkflowArtifactEnvelope = {
    artifactSchemaVersion: 1,
    workflowRunId: state.workflowRunId,
    stageId,
    producerIssueId: stage.issueId,
    producerRunId: `attempt_${stage.attempt}`,
    attempt: stage.attempt,
    adapterBundleHash: ledger.adapterBundleHash,
    inputArtifactHashes: collectInputArtifactHashes(ledger, manifest, stageId),
    outputPath,
    outputHash,
    status: "immutable",
  };
  ledger = await runStore.recordArtifact(state.workflowRunId, artifact);
  ledger = await runStore.upsertStage(state.workflowRunId, {
    stageId,
    status: "produced",
    attempt: stage.attempt,
    issueId: stage.issueId,
    assignedAgentId: stage.assignedAgentId,
    artifactHashes: [...new Set([...stage.artifactHashes, outputHash])],
  });
  if (stageId === HERMES_SPEC_REVIEW_STAGE_ID) {
    const decision = evaluateHermesSpecReview(ledger, {
      stageId: HERMES_SPEC_REVIEW_STAGE_ID,
      attempt: stage.attempt,
      verdict: "pass",
      findingIds: [],
      reviewArtifactHash: outputHash,
    });
    ledger = await runStore.recordReview(state.workflowRunId, decision.record);
  }
  return { ledger, artifact };
}

async function runControllerUntilIdle(
  state: CanaryCampaignState,
  ledger: WorkflowRunStateLedger,
  manifest: WorkflowCatalogManifest,
  binding: ProjectWorkflowBinding,
  liveCli: WorkflowLiveCli | undefined,
  runStore: WorkflowRunStateStore,
  maxTicks: number,
): Promise<{ ledger: WorkflowRunStateLedger; evidence: unknown[]; stopReason?: string }> {
  const evidence: unknown[] = [];
  let lastAction: string | undefined;
  let stagnant = 0;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const result = await runControllerAutopilotTick(
      {
        workflowRunId: state.workflowRunId,
        holderId: CONTROLLER_AGENT_ID,
        ledger,
        manifest,
        binding,
        parentIssueId: state.parentIssueId,
        liveCli,
        statePointer: state.workflowRunId,
      },
      { runStore },
    );
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
    if (result.stopped) {
      return { ledger, evidence, stopReason: result.reason };
    }
    if (result.action === lastAction) {
      stagnant += 1;
      if (stagnant >= 3) {
        return { ledger, evidence, stopReason: "controller_starvation" };
      }
    } else {
      stagnant = 0;
    }
    lastAction = result.action;
  }
  return { ledger, evidence, stopReason: "max_controller_ticks" };
}

export async function runCanaryCampaign(
  state: CanaryCampaignState,
  deps: {
    liveCli: WorkflowLiveCli;
    runStore?: WorkflowRunStateStore;
    roughIdea?: string;
    maxStageCycles?: number;
  },
): Promise<CampaignRunResult> {
  const runStore = deps.runStore ?? new WorkflowRunStateStore(state.canaryPath);
  const manifest = createHermesCompositeManifest();
  const binding = await import("./project-workflow-binding-store.ts").then(async ({ ProjectWorkflowBindingStore }) => {
    const loaded = await new ProjectWorkflowBindingStore(state.canaryPath).getByProjectId(state.projectId);
    if (!loaded) throw new Error(`Binding not found for project ${state.projectId}`);
    return loaded;
  });
  const roughIdea = deps.roughIdea ?? "JSONL digest CLI canary";
  const stages: CampaignStageResult[] = [];
  const controllerEvidence: unknown[] = [];
  let ledger = await runStore.load(state.workflowRunId);
  if (!ledger) throw new Error(`Workflow run not found: ${state.workflowRunId}`);

  for (let cycle = 0; cycle < (deps.maxStageCycles ?? MAX_CAMPAIGN_STAGE_CYCLES); cycle += 1) {
    if (ledger.workflowStatus === "completed" || ledger.workflowStatus === "failed") {
      return {
        completed: ledger.workflowStatus === "completed",
        workflowStatus: ledger.workflowStatus,
        currentStageId: ledger.currentStageId,
        stages,
        controllerEvidence,
        stopReason: ledger.workflowStatus,
      };
    }
    const stageId = ledger.currentStageId;
    if (!stageId) break;
    const stage = ledger.stages[stageId];
    if (!stage || stage.status === "accepted") {
      const advanced = await runControllerUntilIdle(
        state,
        ledger,
        manifest,
        binding,
        deps.liveCli,
        runStore,
        MAX_CONTROLLER_TICKS_PER_STAGE,
      );
      ledger = advanced.ledger;
      controllerEvidence.push(...advanced.evidence);
      if (ledger.workflowStatus === "completed") {
        return {
          completed: true,
          workflowStatus: ledger.workflowStatus,
          currentStageId: ledger.currentStageId,
          stages,
          controllerEvidence,
          stopReason: "completed",
        };
      }
      if (ledger.currentStageId === stageId) {
        return {
          completed: false,
          workflowStatus: ledger.workflowStatus,
          currentStageId: ledger.currentStageId,
          stages,
          controllerEvidence,
          stopReason: advanced.stopReason ?? "stage_not_advanced",
        };
      }
      continue;
    }

    ledger = await ensureStageIssue(ledger, manifest, binding, state.parentIssueId, deps.liveCli, runStore);
    const produced = await produceStageArtifact(
      state.canaryPath,
      state,
      ledger,
      manifest,
      binding,
      runStore,
      roughIdea,
    );
    ledger = produced.ledger;
    const controller = await runControllerUntilIdle(
      state,
      ledger,
      manifest,
      binding,
      deps.liveCli,
      runStore,
      MAX_CONTROLLER_TICKS_PER_STAGE,
    );
    ledger = controller.ledger;
    controllerEvidence.push(...controller.evidence);
    stages.push({
      stageId,
      attempt: stage.attempt,
      issueId: ledger.stages[stageId]?.issueId,
      outputPath: produced.artifact.outputPath,
      outputHash: produced.artifact.outputHash,
      controllerTicks: controller.evidence.length,
      stopReason: controller.stopReason,
    });
    if (ledger.workflowStatus === "completed") {
      return {
        completed: true,
        workflowStatus: ledger.workflowStatus,
        currentStageId: ledger.currentStageId,
        stages,
        controllerEvidence,
        stopReason: "completed",
      };
    }
  }

  return {
    completed: ledger.workflowStatus === "completed",
    workflowStatus: ledger.workflowStatus,
    currentStageId: ledger.currentStageId,
    stages,
    controllerEvidence,
    stopReason: "max_stage_cycles",
  };
}

export type { HermesStageExecutionPacket };
