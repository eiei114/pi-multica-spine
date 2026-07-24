import { createHermesCompositeManifest, HERMES_SPEC_REVIEW_STAGE_ID } from "./hermes-adapter.ts";
import { resolveImplementationProject, type ImplementationProject, type ImplementationProjectClient } from "./idea-project-promotion.ts";
import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { ProjectWorkflowBindingStore } from "./project-workflow-binding-store.ts";
import { createParentWorkflowIssueSummary } from "./project-workflow-binding.ts";
import { hashWorkflowRunLedger, WorkflowRunStateStore, type WorkflowArtifactEnvelope } from "./workflow-run-state.ts";
import { seedWorkflowStageLive } from "./workflow-controller.ts";
import type { WorkflowLiveCli } from "./workflow-live-cli.ts";

export interface PromotionArtifactInput {
  stageId: string;
  outputPath: string;
  outputHash: string;
}

export interface AutomaticPromotionInput {
  sessionId: string;
  workflowRunId: string;
  projectTitle: string;
  projectDescription: string;
  artifacts: PromotionArtifactInput[];
}

export interface AutomaticPromotionDeps {
  projects: ImplementationProjectClient;
  buildBinding(project: ImplementationProject): ProjectWorkflowBinding;
  createParentIssue(input: { projectId: string; title: string; description: string }): Promise<{ id: string; identifier?: string }>;
  liveCli: WorkflowLiveCli;
  runStore: WorkflowRunStateStore;
  bindingStore: ProjectWorkflowBindingStore;
}

function assertPromotionEligible(input: AutomaticPromotionInput, binding: ProjectWorkflowBinding): void {
  if (!input.sessionId || !input.workflowRunId) throw new Error("Automatic promotion requires stable session and workflow run ids");
  if (!input.artifacts.some((artifact) => artifact.stageId === "build_handoff")) throw new Error("Automatic promotion requires immutable build_handoff artifact");
  if (binding.executionMode !== "autonomous_until_final" || binding.humanGate !== "final_only") {
    throw new Error("Automatic promotion requires autonomous_until_final final_only binding");
  }
}

export async function autoPromoteIdeaSession(input: AutomaticPromotionInput, deps: AutomaticPromotionDeps) {
  const existing = await deps.runStore.load(input.workflowRunId);
  if (existing) return { mode: "reused" as const, ledger: existing };
  const resolved = await resolveImplementationProject({ projectTitle: input.projectTitle, projectDescription: input.projectDescription, client: deps.projects });
  const binding = deps.buildBinding(resolved.project);
  assertPromotionEligible(input, binding);
  await deps.bindingStore.save(binding);
  const parent = await deps.createParentIssue({ projectId: resolved.project.id, title: `Build: ${input.projectTitle}`, description: input.projectDescription });
  const manifest = createHermesCompositeManifest();
  let ledger = await deps.runStore.create({ workflowRunId: input.workflowRunId, multicaProjectId: resolved.project.id, adapterId: manifest.adapterId, adapterVersion: manifest.adapterVersion, adapterBundleHash: manifest.derivedBundleHash, executionMode: binding.executionMode });
  for (const artifact of input.artifacts) {
    ledger = await deps.runStore.upsertStage(input.workflowRunId, { stageId: artifact.stageId, status: "accepted", attempt: 1, artifactHashes: [] });
    const envelope: WorkflowArtifactEnvelope = { artifactSchemaVersion: 1, workflowRunId: input.workflowRunId, stageId: artifact.stageId, producerIssueId: `local:${input.sessionId}`, producerRunId: input.sessionId, attempt: 1, adapterBundleHash: manifest.derivedBundleHash, inputArtifactHashes: [], outputPath: artifact.outputPath, outputHash: artifact.outputHash, status: "immutable" };
    ledger = await deps.runStore.recordArtifact(input.workflowRunId, envelope);
  }
  await deps.liveCli.writeParentSummary(parent.id, createParentWorkflowIssueSummary({ binding, workflowRunId: input.workflowRunId, workflowBundleHash: manifest.derivedBundleHash, workflowStage: HERMES_SPEC_REVIEW_STAGE_ID, workflowStatus: "waiting", workflowStatePointer: input.workflowRunId, workflowStateHash: hashWorkflowRunLedger(ledger) }));
  const seeded = await seedWorkflowStageLive({ ledger, manifest, binding, parentIssueId: parent.id, stageId: HERMES_SPEC_REVIEW_STAGE_ID, attempt: 1, liveCli: deps.liveCli });
  ledger = await deps.runStore.upsertStage(input.workflowRunId, seeded.stage);
  return { mode: "promoted" as const, project: resolved.project, reusedProject: resolved.reused, parent, binding, ledger, firstStage: seeded };
}
