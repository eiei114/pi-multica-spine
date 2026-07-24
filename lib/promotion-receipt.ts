import { join } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export const PROMOTION_RECEIPT_STEPS = [
  "project_resolved",
  "binding_saved",
  "parent_created",
  "run_created",
  "artifacts_imported",
  "parent_summary_written",
  "spec_review_seeded",
  "project_activated",
] as const;

export type PromotionReceiptStep = (typeof PROMOTION_RECEIPT_STEPS)[number];

export interface PromotionReceiptIdentity {
  projectId?: string;
  parentIssueId?: string;
  workflowRunId: string;
  bindingHash?: string;
}

export interface PromotionReceipt {
  schemaVersion: 1;
  sessionId: string;
  workflowRunId: string;
  artifactBundleHash: string;
  projectTitle: string;
  status: "in_progress" | "completed" | "blocked";
  completedSteps: PromotionReceiptStep[];
  identities: PromotionReceiptIdentity;
  blockedReason?: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function nextPromotionReceiptStep(receipt: PromotionReceipt): PromotionReceiptStep | undefined {
  return PROMOTION_RECEIPT_STEPS.find((step) => !receipt.completedSteps.includes(step));
}

export function assertPromotionReceiptCanResume(
  receipt: PromotionReceipt,
  input: { artifactBundleHash: string; projectTitle: string },
): void {
  if (receipt.artifactBundleHash !== input.artifactBundleHash) {
    throw new Error("Promotion receipt artifact bundle hash mismatch");
  }
  if (receipt.projectTitle !== input.projectTitle) {
    throw new Error("Promotion receipt project title mismatch");
  }
}

export class PromotionReceiptStore {
  readonly path: string;

  constructor(cwd: string, sessionId: string) {
    this.path = join(cwd, SPINE_STATE_ROOT, "promotion-receipts", `${sessionId}.json`);
  }

  async load(): Promise<PromotionReceipt | undefined> {
    return readJsonFile<PromotionReceipt>(this.path);
  }

  async start(input: {
    sessionId: string;
    workflowRunId: string;
    artifactBundleHash: string;
    projectTitle: string;
  }): Promise<PromotionReceipt> {
    return withFileLock(this.path, async () => {
      const existing = await this.load();
      if (existing) return existing;
      const receipt: PromotionReceipt = {
        schemaVersion: 1,
        sessionId: input.sessionId,
        workflowRunId: input.workflowRunId,
        artifactBundleHash: input.artifactBundleHash,
        projectTitle: input.projectTitle,
        status: "in_progress",
        completedSteps: [],
        identities: { workflowRunId: input.workflowRunId },
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, receipt);
      return receipt;
    });
  }

  async completeStep(
    step: PromotionReceiptStep,
    identities: Partial<PromotionReceiptIdentity> = {},
  ): Promise<PromotionReceipt> {
    return withFileLock(this.path, async () => {
      const receipt = await this.load();
      if (!receipt) throw new Error("Promotion receipt not found");
      if (receipt.completedSteps.includes(step)) return receipt;
      const completedSteps = [...receipt.completedSteps, step];
      const next: PromotionReceipt = {
        ...receipt,
        completedSteps,
        identities: { ...receipt.identities, ...identities },
        status: completedSteps.length === PROMOTION_RECEIPT_STEPS.length ? "completed" : "in_progress",
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }

  async block(reason: string): Promise<PromotionReceipt> {
    return withFileLock(this.path, async () => {
      const receipt = await this.load();
      if (!receipt) throw new Error("Promotion receipt not found");
      const next: PromotionReceipt = { ...receipt, status: "blocked", blockedReason: reason, updatedAt: nowIso() };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }
}

export interface RouteGapCheckInput {
  requiredRoles: readonly string[];
  roleRoutes: Readonly<Record<string, { agentId: string } | undefined>>;
}

export function detectRouteGap(input: RouteGapCheckInput): string | undefined {
  for (const role of input.requiredRoles) {
    if (!input.roleRoutes[role]?.agentId) return `missing_route:${role}`;
  }
  return undefined;
}

export function shouldSkipCandidateForRouteGap(routeGap?: string): boolean {
  return Boolean(routeGap);
}
