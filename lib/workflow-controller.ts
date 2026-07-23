import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import type {
  WorkflowArtifactEnvelope,
  WorkflowRunStateLedger,
  WorkflowStageState,
  WorkflowStageStatus,
} from "./workflow-run-state.ts";
import type { WorkflowCatalogManifest } from "./workflow-catalog.ts";
import type { WorkflowLiveCli } from "./workflow-live-cli.ts";
import { WORKFLOW_COMPLETION_AUTHORITY } from "./workflow-live-cli.ts";

export interface EffectivePermissionInput {
  adapterRequest: string[];
  projectGrant: string[];
  stageGrant: string[];
  issueBoundary: string[];
  agentCapability: string[];
}

export interface EffectivePermissionResult {
  granted: string[];
  blocked: string[];
}

export interface QuestionTaskRecord {
  questionId: string;
  questionTaskId: string;
  resolverAgentId: string;
  answerStatus: "observed" | "researched" | "inferred" | "assumed" | "unresolved";
  sourceRefs: string[];
  confidence: "high" | "medium" | "low";
  answerHash: string;
}

export interface SeedStageInput {
  stageId: string;
  attempt: number;
  issueId?: string;
  assignedAgentId?: string;
}

export function computeEffectivePermission(input: EffectivePermissionInput): EffectivePermissionResult {
  const intersect = (left: string[], right: string[]) => left.filter((item) => right.includes(item));
  const granted = intersect(
    intersect(intersect(intersect(input.adapterRequest, input.projectGrant), input.stageGrant), input.issueBoundary),
    input.agentCapability,
  );
  const grantedSet = new Set(granted);
  const blocked = input.adapterRequest.filter((item) => !grantedSet.has(item));
  return {
    granted: [...new Set(granted)].sort(),
    blocked: [...new Set(blocked)].sort(),
  };
}

export function resolveNextStageId(
  manifest: WorkflowCatalogManifest,
  currentStageId?: string,
  enabledOptionalStages: readonly string[] = [],
): string | undefined {
  const enabledOptional = new Set(enabledOptionalStages);
  const startIndex = currentStageId ? manifest.stages.findIndex((stage) => stage.stageId === currentStageId) + 1 : 0;
  if (currentStageId && startIndex === 0) throw new Error(`Unknown stage in manifest: ${currentStageId}`);
  for (let index = startIndex; index < manifest.stages.length; index += 1) {
    const stage = manifest.stages[index];
    if (stage.optional && !enabledOptional.has(stage.stageId)) continue;
    return stage.stageId;
  }
  return undefined;
}

export function seedWorkflowStage(
  ledger: WorkflowRunStateLedger,
  manifest: WorkflowCatalogManifest,
  binding: ProjectWorkflowBinding,
  input: SeedStageInput,
): WorkflowStageState {
  const manifestStage = manifest.stages.find((stage) => stage.stageId === input.stageId);
  if (!manifestStage) {
    throw new Error(`Cannot seed unknown manifest stage: ${input.stageId}`);
  }
  if (!binding.roleRoutes[manifestStage.role]) {
    throw new Error(`Binding missing role route for stage ${input.stageId} role ${manifestStage.role}`);
  }
  const existing = ledger.stages[input.stageId];
  if (existing && input.attempt < existing.attempt) {
    throw new Error(`Cannot seed stale attempt for ${input.stageId}: ${input.attempt} < ${existing.attempt}`);
  }
  return {
    stageId: input.stageId,
    status: "seeded",
    attempt: input.attempt,
    issueId: input.issueId,
    assignedAgentId: input.assignedAgentId ?? binding.roleRoutes[manifestStage.role].agentId,
    artifactHashes: existing?.artifactHashes ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export function transitionWorkflowStage(
  stage: WorkflowStageState,
  nextStatus: WorkflowStageStatus,
  artifact?: WorkflowArtifactEnvelope,
): WorkflowStageState {
  const allowed: Record<WorkflowStageStatus, WorkflowStageStatus[]> = {
    seeded: ["waiting", "produced", "failed"],
    waiting: ["produced", "failed", "retrying"],
    produced: ["accepted", "retrying", "failed"],
    accepted: ["accepted"],
    retrying: ["seeded", "waiting", "failed"],
    failed: ["failed"],
  };
  if (!allowed[stage.status].includes(nextStatus)) {
    throw new Error(`Invalid stage transition: ${stage.status} -> ${nextStatus}`);
  }
  const artifactHashes = artifact ? [...new Set([...stage.artifactHashes, artifact.outputHash])] : stage.artifactHashes;
  return {
    ...stage,
    status: nextStatus,
    artifactHashes,
    updatedAt: new Date().toISOString(),
  };
}

export function canAcceptProducedStage(stage: WorkflowStageState, artifact?: WorkflowArtifactEnvelope): boolean {
  return stage.status === "produced" && artifact?.status === "immutable" && Boolean(artifact.outputHash);
}

export function mapStageStatusToIssueStatus(stageStatus: WorkflowStageStatus): string {
  switch (stageStatus) {
    case "seeded":
    case "waiting":
      return "todo";
    case "produced":
      return "in_progress";
    case "accepted":
      return "done";
    case "retrying":
      return "in_progress";
    case "failed":
      return "blocked";
    default:
      return "in_progress";
  }
}

export interface LiveStageSeedInput {
  ledger: WorkflowRunStateLedger;
  manifest: WorkflowCatalogManifest;
  binding: ProjectWorkflowBinding;
  parentIssueId: string;
  stageId?: string;
  attempt?: number;
  titlePrefix?: string;
  liveCli: WorkflowLiveCli;
}

export async function seedWorkflowStageLive(input: LiveStageSeedInput): Promise<{
  stage: WorkflowStageState;
  issueId: string;
  issueIdentifier?: string;
}> {
  const stageId = input.stageId ?? resolveNextStageId(
    input.manifest,
    input.ledger.currentStageId,
    input.binding.enabledOptionalStages,
  );
  if (!stageId) throw new Error(`No next stage available for workflow run: ${input.ledger.workflowRunId}`);
  const manifestStage = input.manifest.stages.find((stage) => stage.stageId === stageId);
  if (!manifestStage) throw new Error(`Cannot seed unknown manifest stage: ${stageId}`);
  const stageOrdinal = input.manifest.stages.findIndex((stage) => stage.stageId === stageId) + 1;
  const assignedAgentId = input.binding.roleRoutes[manifestStage.role]?.agentId;
  if (!assignedAgentId) {
    throw new Error(`Binding missing role route for stage ${stageId} role ${manifestStage.role}`);
  }
  const parentIssue = await input.liveCli.getIssue(input.parentIssueId);
  if (parentIssue.project_id !== input.binding.multicaProjectId) {
    throw new Error(
      `Workflow parent issue project mismatch: expected ${input.binding.multicaProjectId}, got ${parentIssue.project_id ?? "unknown"}`,
    );
  }
  const attempt = input.attempt ?? input.ledger.stages[stageId]?.attempt ?? 1;
  const title = `${input.titlePrefix ?? "Workflow stage"}: ${stageId} (attempt ${attempt})`;
  const executionPacket = manifestStage.sourceBundle && manifestStage.instructionRefs?.length
    ? [
        `source_bundle=${manifestStage.sourceBundle}`,
        `adapter_bundle_hash=${input.ledger.adapterBundleHash}`,
        `instruction_refs=${manifestStage.instructionRefs.join(",")}`,
        `outputs=${(manifestStage.outputs ?? []).join(",")}`,
      ].join("\n")
    : undefined;
  const issue = await input.liveCli.createStageIssue({
    title,
    description: [
      `Workflow run ${input.ledger.workflowRunId} stage ${stageId} attempt ${attempt}. completion_authority=${WORKFLOW_COMPLETION_AUTHORITY}`,
      executionPacket,
    ].filter(Boolean).join("\n"),
    parentIssueId: input.parentIssueId,
    stage: stageOrdinal,
    projectId: input.binding.multicaProjectId,
    status: "todo",
  });
  await input.liveCli.writeStageWriteback({
    issueIdentifier: issue.id,
    extra: {
      workflow_run_id: input.ledger.workflowRunId,
      workflow_stage_id: stageId,
      workflow_stage_attempt: attempt,
      completion_authority: WORKFLOW_COMPLETION_AUTHORITY,
    },
  });
  await input.liveCli.assignStageIssue(issue.id, assignedAgentId);
  const stage = seedWorkflowStage(input.ledger, input.manifest, input.binding, {
    stageId,
    attempt,
    issueId: issue.id,
    assignedAgentId,
  });
  return { stage, issueId: issue.id, issueIdentifier: issue.identifier };
}

export async function transitionWorkflowStageLive(
  liveCli: WorkflowLiveCli,
  stage: WorkflowStageState,
  nextStatus: WorkflowStageStatus,
  artifact?: WorkflowArtifactEnvelope,
): Promise<WorkflowStageState> {
  const nextStage = transitionWorkflowStage(stage, nextStatus, artifact);
  if (stage.issueId) {
    await liveCli.transitionStageIssue(stage.issueId, mapStageStatusToIssueStatus(nextStatus));
    if (artifact) {
      await liveCli.writeStageWriteback({
        issueIdentifier: stage.issueId,
        artifact,
      });
    }
  }
  return nextStage;
}

export function summarizeControllerState(ledger: WorkflowRunStateLedger): {
  workflowRunId: string;
  workflowStatus: string;
  currentStageId?: string;
  stageCount: number;
  artifactCount: number;
  questionCount: number;
  stateVersion: number;
} {
  return {
    workflowRunId: ledger.workflowRunId,
    workflowStatus: ledger.workflowStatus,
    currentStageId: ledger.currentStageId,
    stageCount: Object.keys(ledger.stages).length,
    artifactCount: ledger.artifacts.length,
    questionCount: ledger.questions.length,
    stateVersion: ledger.stateVersion,
  };
}
