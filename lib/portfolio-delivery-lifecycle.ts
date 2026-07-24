import { join } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export const STALL_THRESHOLD_MS = 8 * 60 * 60 * 1000;
export const MAX_CONTROLLER_RETRIES = 2;
export const MAX_PR_FEEDBACK_ATTEMPTS = 2;

export type DeliveryLifecycleStatus =
  | "active"
  | "stalled"
  | "retrying"
  | "blocked"
  | "awaiting_revision"
  | "pr_feedback"
  | "completed";

export interface DeliveryLifecycleRecord {
  schemaVersion: 1;
  sessionId: string;
  workflowRunId: string;
  projectId: string;
  status: DeliveryLifecycleStatus;
  retryCount: number;
  prFeedbackCount: number;
  lastEvidenceAt?: string;
  failurePackage?: {
    reason: string;
    writtenAt: string;
    artifactRevisionHash?: string;
  };
  updatedAt: string;
}

export interface DeliveryLifecycleInput {
  sessionId: string;
  workflowRunId: string;
  projectId: string;
  now?: Date;
  lastEvidenceAt?: string;
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

export function evaluateStall(
  record: Pick<DeliveryLifecycleRecord, "lastEvidenceAt" | "status">,
  now = new Date(),
): DeliveryLifecycleStatus {
  if (record.status === "completed" || record.status === "blocked") return record.status;
  if (!record.lastEvidenceAt) return record.status;
  const elapsed = now.getTime() - Date.parse(record.lastEvidenceAt);
  return elapsed >= STALL_THRESHOLD_MS ? "stalled" : record.status;
}

export function applyControllerRetry(
  record: DeliveryLifecycleRecord,
  reason: string,
): DeliveryLifecycleRecord {
  if (record.retryCount >= MAX_CONTROLLER_RETRIES) {
    return {
      ...record,
      status: "blocked",
      failurePackage: { reason, writtenAt: nowIso(), artifactRevisionHash: record.failurePackage?.artifactRevisionHash },
      updatedAt: nowIso(),
    };
  }
  return {
    ...record,
    status: "retrying",
    retryCount: record.retryCount + 1,
    updatedAt: nowIso(),
  };
}

export function resumeFromArtifactRevision(
  record: DeliveryLifecycleRecord,
  artifactRevisionHash: string,
): DeliveryLifecycleRecord {
  if (!record.failurePackage) {
    throw new Error("Artifact revision resumption requires a prior failure package");
  }
  return {
    ...record,
    status: "awaiting_revision",
    retryCount: 0,
    prFeedbackCount: 0,
    failurePackage: { ...record.failurePackage, artifactRevisionHash },
    updatedAt: nowIso(),
  };
}

export function acquireForPrFeedback(record: DeliveryLifecycleRecord): DeliveryLifecycleRecord {
  if (record.prFeedbackCount >= MAX_PR_FEEDBACK_ATTEMPTS) {
    return {
      ...record,
      status: "blocked",
      failurePackage: {
        reason: "pr_feedback_attempt_cap_reached",
        writtenAt: nowIso(),
      },
      updatedAt: nowIso(),
    };
  }
  return {
    ...record,
    status: "pr_feedback",
    prFeedbackCount: record.prFeedbackCount + 1,
    updatedAt: nowIso(),
  };
}

export function completeDeliveryLifecycle(record: DeliveryLifecycleRecord): DeliveryLifecycleRecord {
  return { ...record, status: "completed", updatedAt: nowIso() };
}

export class PortfolioDeliveryLifecycleStore {
  readonly path: string;

  constructor(cwd: string, sessionId: string) {
    this.path = join(cwd, SPINE_STATE_ROOT, "delivery-lifecycle", `${sessionId}.json`);
  }

  async load(): Promise<DeliveryLifecycleRecord | undefined> {
    return readJsonFile<DeliveryLifecycleRecord>(this.path);
  }

  async ensure(input: DeliveryLifecycleInput): Promise<DeliveryLifecycleRecord> {
    return withFileLock(this.path, async () => {
      const existing = await this.load();
      if (existing) return existing;
      const record: DeliveryLifecycleRecord = {
        schemaVersion: 1,
        sessionId: input.sessionId,
        workflowRunId: input.workflowRunId,
        projectId: input.projectId,
        status: "active",
        retryCount: 0,
        prFeedbackCount: 0,
        lastEvidenceAt: input.lastEvidenceAt ?? nowIso(input.now),
        updatedAt: nowIso(input.now),
      };
      await writeJsonAtomic(this.path, record);
      return record;
    });
  }

  async save(record: DeliveryLifecycleRecord): Promise<DeliveryLifecycleRecord> {
    return withFileLock(this.path, async () => {
      const next = { ...record, updatedAt: nowIso() };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }
}
