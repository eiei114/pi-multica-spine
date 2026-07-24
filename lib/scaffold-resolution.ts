import { join } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import type { BuildTargetSurface } from "./build-template-catalog.ts";
import { resolveBuildTemplateForSurface } from "./build-template-catalog.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export const SCAFFOLD_RECEIPT_STEPS = [
  "template_resolved",
  "repository_created",
  "runtime_cloned",
  "resource_attached",
] as const;

export type ScaffoldReceiptStep = (typeof SCAFFOLD_RECEIPT_STEPS)[number];

export interface ScaffoldReceiptIdentity {
  repositoryOwner: string;
  repositoryName: string;
  repositoryUrl?: string;
  templateRevision: string;
  resourceId?: string;
}

export interface ScaffoldReceipt {
  schemaVersion: 1;
  sessionId: string;
  workflowRunId: string;
  projectId: string;
  targetSurface: BuildTargetSurface;
  templateId: string;
  status: "in_progress" | "completed" | "blocked";
  completedSteps: ScaffoldReceiptStep[];
  identities: ScaffoldReceiptIdentity;
  retryCount: number;
  blockedReason?: string;
  updatedAt: string;
}

export interface ScaffoldResolutionInput {
  sessionId: string;
  workflowRunId: string;
  projectId: string;
  targetSurface: BuildTargetSurface;
  templateId: string;
  projectTitle: string;
  repositoryOwner?: string;
}

export interface ScaffoldCollaborators {
  createRepository(input: { owner: string; name: string; templateRevision: string }): Promise<{ url: string }>;
  cloneRepository(input: { url: string; runtimeId: string }): Promise<{ clonePath: string }>;
  attachProjectResource(input: { projectId: string; resourceType: string; clonePath: string }): Promise<{ resourceId: string }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "product";
}

export function nextScaffoldReceiptStep(receipt: ScaffoldReceipt): ScaffoldReceiptStep | undefined {
  return SCAFFOLD_RECEIPT_STEPS.find((step) => !receipt.completedSteps.includes(step));
}

export function assertScaffoldPreflight(input: { targetSurface?: BuildTargetSurface; templateId?: string }): void {
  if (!input.targetSurface) throw new Error("Scaffold resolution requires target_surface");
  if (!input.templateId) throw new Error("Scaffold resolution requires template_id");
}

export class ScaffoldReceiptStore {
  readonly path: string;

  constructor(cwd: string, sessionId: string) {
    this.path = join(cwd, SPINE_STATE_ROOT, "scaffold-receipts", `${sessionId}.json`);
  }

  async load(): Promise<ScaffoldReceipt | undefined> {
    return readJsonFile<ScaffoldReceipt>(this.path);
  }

  async start(input: ScaffoldResolutionInput): Promise<ScaffoldReceipt> {
    assertScaffoldPreflight(input);
    return withFileLock(this.path, async () => {
      const existing = await this.load();
      if (existing) return existing;
      const receipt: ScaffoldReceipt = {
        schemaVersion: 1,
        sessionId: input.sessionId,
        workflowRunId: input.workflowRunId,
        projectId: input.projectId,
        targetSurface: input.targetSurface,
        templateId: input.templateId,
        status: "in_progress",
        completedSteps: [],
        identities: {
          repositoryOwner: input.repositoryOwner ?? "eiei114",
          repositoryName: slugifyTitle(input.projectTitle),
          templateRevision: resolveBuildTemplateForSurface(input.targetSurface, input.templateId).pinnedRevision.revision,
        },
        retryCount: 0,
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, receipt);
      return receipt;
    });
  }

  async completeStep(step: ScaffoldReceiptStep, identities: Partial<ScaffoldReceiptIdentity> = {}): Promise<ScaffoldReceipt> {
    return withFileLock(this.path, async () => {
      const receipt = await this.load();
      if (!receipt) throw new Error("Scaffold receipt not found");
      if (receipt.completedSteps.includes(step)) return receipt;
      const completedSteps = [...receipt.completedSteps, step];
      const next: ScaffoldReceipt = {
        ...receipt,
        completedSteps,
        identities: { ...receipt.identities, ...identities },
        status: completedSteps.length === SCAFFOLD_RECEIPT_STEPS.length ? "completed" : "in_progress",
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }

  async recordRetryFailure(reason: string): Promise<ScaffoldReceipt> {
    return withFileLock(this.path, async () => {
      const receipt = await this.load();
      if (!receipt) throw new Error("Scaffold receipt not found");
      const retryCount = receipt.retryCount + 1;
      const next: ScaffoldReceipt = {
        ...receipt,
        retryCount,
        status: retryCount >= 2 ? "blocked" : "in_progress",
        blockedReason: retryCount >= 2 ? reason : receipt.blockedReason,
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }
}

export async function resolveScaffoldedResources(
  input: ScaffoldResolutionInput,
  collaborators: ScaffoldCollaborators,
  store: ScaffoldReceiptStore,
): Promise<ScaffoldReceipt> {
  assertScaffoldPreflight(input);
  const template = resolveBuildTemplateForSurface(input.targetSurface, input.templateId);
  let receipt = await store.start(input);
  const step = nextScaffoldReceiptStep(receipt);
  if (!step) return receipt;
  try {
    if (step === "template_resolved") {
      receipt = await store.completeStep(step, { templateRevision: template.pinnedRevision.revision });
    } else if (step === "repository_created") {
      const repo = await collaborators.createRepository({
        owner: receipt.identities.repositoryOwner,
        name: receipt.identities.repositoryName,
        templateRevision: template.pinnedRevision.revision,
      });
      receipt = await store.completeStep(step, { repositoryUrl: repo.url });
    } else if (step === "runtime_cloned") {
      if (!receipt.identities.repositoryUrl) throw new Error("Repository URL missing for clone step");
      await collaborators.cloneRepository({
        url: receipt.identities.repositoryUrl,
        runtimeId: template.pinnedRevision.runtimeContract.runtimeId,
      });
      receipt = await store.completeStep(step);
    } else if (step === "resource_attached") {
      const resource = await collaborators.attachProjectResource({
        projectId: input.projectId,
        resourceType: template.pinnedRevision.runtimeContract.resourceType,
        clonePath: receipt.identities.repositoryUrl ?? "",
      });
      receipt = await store.completeStep(step, { resourceId: resource.resourceId });
    }
    return receipt;
  } catch (error) {
    return store.recordRetryFailure(error instanceof Error ? error.message : String(error));
  }
}
