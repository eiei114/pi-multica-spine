import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { StringEnum } from "./schema.ts";
import { safeIssueIdentifier } from "./state-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";
import type { WorkflowExecutionMode } from "./project-workflow-binding.ts";

const Sha256Hex = Type.String({ pattern: "^[a-f0-9]{64}$" });

export const WorkflowRunStatusSchema = StringEnum(["pending", "waiting", "running", "blocked", "failed", "completed"]);
export type WorkflowRunStatus = Static<typeof WorkflowRunStatusSchema>;

export const WorkflowStageStatusSchema = StringEnum(["seeded", "waiting", "produced", "accepted", "retrying", "failed"]);
export type WorkflowStageStatus = Static<typeof WorkflowStageStatusSchema>;

export const WorkflowEventTypeSchema = StringEnum([
  "run_created",
  "stage_seeded",
  "stage_updated",
  "artifact_recorded",
  "question_recorded",
]);
export type WorkflowEventType = Static<typeof WorkflowEventTypeSchema>;

export const QuestionAnswerStatusSchema = StringEnum(["observed", "researched", "inferred", "assumed", "unresolved"]);
export type QuestionAnswerStatus = Static<typeof QuestionAnswerStatusSchema>;

export const WorkflowArtifactEnvelopeSchema = Type.Object({
  artifactSchemaVersion: Type.Integer({ minimum: 1 }),
  workflowRunId: Type.String({ minLength: 1 }),
  stageId: Type.String({ minLength: 1 }),
  producerIssueId: Type.String({ minLength: 1 }),
  producerRunId: Type.String({ minLength: 1 }),
  attempt: Type.Integer({ minimum: 1 }),
  adapterBundleHash: Sha256Hex,
  inputArtifactHashes: Type.Array(Sha256Hex),
  outputPath: Type.String({ minLength: 1 }),
  outputHash: Sha256Hex,
  status: StringEnum(["immutable", "superseded"]),
});
export type WorkflowArtifactEnvelope = Static<typeof WorkflowArtifactEnvelopeSchema>;

export const WorkflowStageStateSchema = Type.Object({
  stageId: Type.String({ minLength: 1 }),
  status: WorkflowStageStatusSchema,
  attempt: Type.Integer({ minimum: 1 }),
  issueId: Type.Optional(Type.String({ minLength: 1 })),
  assignedAgentId: Type.Optional(Type.String({ minLength: 1 })),
  artifactHashes: Type.Array(Sha256Hex),
  updatedAt: Type.String({ minLength: 1 }),
});
export type WorkflowStageState = Static<typeof WorkflowStageStateSchema>;

export const WorkflowEventSchema = Type.Object({
  eventId: Type.String({ minLength: 1 }),
  eventType: WorkflowEventTypeSchema,
  stageId: Type.Optional(Type.String({ minLength: 1 })),
  timestamp: Type.String({ minLength: 1 }),
  details: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.Unknown())),
});
export type WorkflowEvent = Static<typeof WorkflowEventSchema>;

export const WorkflowQuestionRecordSchema = Type.Object({
  questionId: Type.String({ minLength: 1 }),
  questionTaskId: Type.String({ minLength: 1 }),
  resolverAgentId: Type.String({ minLength: 1 }),
  answerStatus: QuestionAnswerStatusSchema,
  sourceRefs: Type.Array(Type.String({ minLength: 1 })),
  confidence: StringEnum(["high", "medium", "low"]),
  answerHash: Sha256Hex,
});
export type WorkflowQuestionRecord = Static<typeof WorkflowQuestionRecordSchema>;

export const WorkflowRunStateLedgerSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  workflowRunId: Type.String({ minLength: 1 }),
  multicaProjectId: Type.String({ minLength: 1 }),
  adapterId: Type.String({ minLength: 1 }),
  adapterVersion: Type.Integer({ minimum: 1 }),
  adapterBundleHash: Sha256Hex,
  executionMode: StringEnum(["interactive", "autonomous_until_final"]),
  workflowStatus: WorkflowRunStatusSchema,
  currentStageId: Type.Optional(Type.String({ minLength: 1 })),
  stateVersion: Type.Integer({ minimum: 1 }),
  createdAt: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ minLength: 1 }),
  stages: Type.Record(Type.String({ minLength: 1 }), WorkflowStageStateSchema),
  artifacts: Type.Array(WorkflowArtifactEnvelopeSchema),
  events: Type.Array(WorkflowEventSchema),
  questions: Type.Array(WorkflowQuestionRecordSchema),
});
export type WorkflowRunStateLedger = Static<typeof WorkflowRunStateLedgerSchema>;

export interface CreateWorkflowRunLedgerInput {
  workflowRunId: string;
  multicaProjectId: string;
  adapterId: string;
  adapterVersion: number;
  adapterBundleHash: string;
  executionMode: WorkflowExecutionMode;
  initialStageId?: string;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function isProjectRelativePath(path: string): boolean {
  if (!path.trim() || isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path)) return false;
  const normalized = normalize(path).replace(/\\/g, "/");
  return normalized !== ".." && !normalized.startsWith("../");
}

function workflowStatusForStage(status: WorkflowStageStatus): WorkflowRunStatus {
  if (status === "failed") return "failed";
  if (status === "accepted") return "running";
  return "waiting";
}

export function stageAttemptKey(workflowRunId: string, stageId: string, attempt: number): string {
  return `${workflowRunId}:${stageId}:${attempt}`;
}

export function hashWorkflowRunLedger(ledger: WorkflowRunStateLedger): string {
  return sha256Hex(ledger);
}

export function createWorkflowRunLedger(input: CreateWorkflowRunLedgerInput): WorkflowRunStateLedger {
  const timestamp = nowIso();
  const stages: Record<string, WorkflowStageState> = {};
  if (input.initialStageId) {
    stages[input.initialStageId] = {
      stageId: input.initialStageId,
      status: "seeded",
      attempt: 1,
      artifactHashes: [],
      updatedAt: timestamp,
    };
  }
  const ledger: WorkflowRunStateLedger = {
    schemaVersion: 1,
    workflowRunId: input.workflowRunId,
    multicaProjectId: input.multicaProjectId,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    adapterBundleHash: input.adapterBundleHash,
    executionMode: input.executionMode,
    workflowStatus: input.initialStageId ? "waiting" : "pending",
    currentStageId: input.initialStageId,
    stateVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    stages,
    artifacts: [],
    events: [
      {
        eventId: stageAttemptKey(input.workflowRunId, input.initialStageId ?? "run", 1),
        eventType: "run_created",
        stageId: input.initialStageId,
        timestamp,
        details: input.initialStageId ? { seededStage: input.initialStageId } : undefined,
      },
    ],
    questions: [],
  };
  return assertValid(validateSchema(WorkflowRunStateLedgerSchema, ledger), "Invalid workflow run ledger");
}

export class WorkflowRunStateStore {
  readonly cwd: string;
  readonly root: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT, "workflow-runs");
  }

  runRootPath(workflowRunId: string): string {
    return join(this.root, safeIssueIdentifier(workflowRunId));
  }

  ledgerPath(workflowRunId: string): string {
    return join(this.runRootPath(workflowRunId), "state-ledger.json");
  }

  async load(workflowRunId: string): Promise<WorkflowRunStateLedger | undefined> {
    const ledger = await readJson<WorkflowRunStateLedger>(this.ledgerPath(workflowRunId));
    if (!ledger) return undefined;
    if (ledger.workflowRunId !== workflowRunId) {
      throw new Error(`Workflow run id mismatch in ledger: expected ${workflowRunId}, got ${ledger.workflowRunId}`);
    }
    return assertValid(validateSchema(WorkflowRunStateLedgerSchema, ledger), "Invalid workflow run ledger");
  }

  async create(input: CreateWorkflowRunLedgerInput): Promise<WorkflowRunStateLedger> {
    const existing = await this.load(input.workflowRunId);
    if (existing) {
      if (
        existing.multicaProjectId !== input.multicaProjectId ||
        existing.adapterId !== input.adapterId ||
        existing.adapterVersion !== input.adapterVersion ||
        existing.adapterBundleHash !== input.adapterBundleHash ||
        existing.executionMode !== input.executionMode
      ) {
        throw new Error(`Workflow run ${input.workflowRunId} already exists with different binding metadata`);
      }
      return existing;
    }

    const ledger = createWorkflowRunLedger(input);
    await this.save(ledger);
    return ledger;
  }

  async save(ledgerInput: WorkflowRunStateLedger): Promise<WorkflowRunStateLedger> {
    const ledger = assertValid(validateSchema(WorkflowRunStateLedgerSchema, ledgerInput), "Invalid workflow run ledger");
    await writeJson(this.ledgerPath(ledger.workflowRunId), ledger);
    return ledger;
  }

  async upsertStage(workflowRunId: string, stage: Omit<WorkflowStageState, "updatedAt">): Promise<WorkflowRunStateLedger> {
    const ledger = await this.requireLedger(workflowRunId);
    const timestamp = nowIso();
    ledger.stages[stage.stageId] = {
      ...stage,
      updatedAt: timestamp,
    };
    ledger.currentStageId = stage.stageId;
    ledger.workflowStatus = workflowStatusForStage(stage.status);
    ledger.updatedAt = timestamp;
    ledger.stateVersion += 1;
    ledger.events.push({
      eventId: `${stageAttemptKey(workflowRunId, stage.stageId, stage.attempt)}:${stage.status}:${ledger.stateVersion}`,
      eventType: stage.status === "seeded" ? "stage_seeded" : "stage_updated",
      stageId: stage.stageId,
      timestamp,
      details: { status: stage.status, issueId: stage.issueId, assignedAgentId: stage.assignedAgentId },
    });
    return this.save(ledger);
  }

  async recordArtifact(workflowRunId: string, artifactInput: WorkflowArtifactEnvelope): Promise<WorkflowRunStateLedger> {
    const artifact = assertValid(validateSchema(WorkflowArtifactEnvelopeSchema, artifactInput), "Invalid workflow artifact envelope");
    const ledger = await this.requireLedger(workflowRunId);
    if (artifact.workflowRunId !== workflowRunId) {
      throw new Error(`Artifact workflow run mismatch: expected ${workflowRunId}, got ${artifact.workflowRunId}`);
    }
    if (artifact.adapterBundleHash !== ledger.adapterBundleHash) {
      throw new Error("Artifact adapter bundle hash does not match workflow run ledger");
    }
    if (!isProjectRelativePath(artifact.outputPath)) {
      throw new Error(`Artifact output path must be project-relative: ${artifact.outputPath}`);
    }
    const stage = ledger.stages[artifact.stageId];
    if (!stage) {
      throw new Error(`Cannot record artifact for unknown stage: ${artifact.stageId}`);
    }
    if (artifact.attempt !== stage.attempt) {
      throw new Error(`Artifact attempt mismatch for ${artifact.stageId}: expected ${stage.attempt}, got ${artifact.attempt}`);
    }
    const existingArtifact = ledger.artifacts.find((item) => item.outputHash === artifact.outputHash);
    if (existingArtifact) {
      if (JSON.stringify(existingArtifact) !== JSON.stringify(artifact)) {
        throw new Error(`Artifact hash already exists with different envelope: ${artifact.outputHash}`);
      }
      return ledger;
    }
    ledger.artifacts.push(artifact);
    stage.artifactHashes = [...new Set([...stage.artifactHashes, artifact.outputHash])];
    stage.updatedAt = nowIso();
    ledger.updatedAt = stage.updatedAt;
    ledger.stateVersion += 1;
    ledger.events.push({
      eventId: `${artifact.workflowRunId}:${artifact.stageId}:artifact:${artifact.outputHash.slice(0, 12)}`,
      eventType: "artifact_recorded",
      stageId: artifact.stageId,
      timestamp: stage.updatedAt,
      details: { outputPath: artifact.outputPath, outputHash: artifact.outputHash },
    });
    return this.save(ledger);
  }

  async recordQuestion(workflowRunId: string, questionInput: WorkflowQuestionRecord): Promise<WorkflowRunStateLedger> {
    const question = assertValid(validateSchema(WorkflowQuestionRecordSchema, questionInput), "Invalid workflow question record");
    const ledger = await this.requireLedger(workflowRunId);
    const existingQuestion = ledger.questions.find((item) => item.questionId === question.questionId);
    if (existingQuestion) {
      if (existingQuestion.answerHash !== question.answerHash) {
        throw new Error(`Question ${question.questionId} already has a different answer hash`);
      }
      return ledger;
    }
    ledger.questions.push(question);
    ledger.updatedAt = nowIso();
    ledger.stateVersion += 1;
    ledger.events.push({
      eventId: `${workflowRunId}:question:${question.questionId}`,
      eventType: "question_recorded",
      timestamp: ledger.updatedAt,
      details: { questionTaskId: question.questionTaskId, answerStatus: question.answerStatus },
    });
    return this.save(ledger);
  }

  async setWorkflowStatus(workflowRunId: string, status: WorkflowRunStatus): Promise<WorkflowRunStateLedger> {
    const ledger = await this.requireLedger(workflowRunId);
    if (ledger.workflowStatus === status) return ledger;
    ledger.workflowStatus = status;
    ledger.updatedAt = nowIso();
    ledger.stateVersion += 1;
    return this.save(ledger);
  }

  private async requireLedger(workflowRunId: string): Promise<WorkflowRunStateLedger> {
    const ledger = await this.load(workflowRunId);
    if (!ledger) throw new Error(`Workflow run not found: ${workflowRunId}`);
    return ledger;
  }
}
