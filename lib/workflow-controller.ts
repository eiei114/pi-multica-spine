import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import type {
  WorkflowArtifactEnvelope,
  WorkflowRunStateLedger,
  WorkflowStageState,
  WorkflowStageStatus,
} from "./workflow-run-state.ts";
import type { WorkflowCatalogManifest } from "./workflow-catalog.ts";

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

export function resolveNextStageId(manifest: WorkflowCatalogManifest, currentStageId?: string): string | undefined {
  if (!currentStageId) return manifest.stages[0]?.stageId;
  const index = manifest.stages.findIndex((stage) => stage.stageId === currentStageId);
  if (index < 0) throw new Error(`Unknown stage in manifest: ${currentStageId}`);
  return manifest.stages[index + 1]?.stageId;
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
  return stage.status === "produced" && Boolean(artifact?.outputHash);
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
