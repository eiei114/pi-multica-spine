import { createHermesCompositeManifest, HERMES_SPEC_REVIEW_STAGE_ID } from "./hermes-adapter.ts";
import type { IdeaLocalArtifactRegistry } from "./idea-local-artifact.ts";
import { assertArtifactBundleUnchanged, validatePromotionReadyArtifacts } from "./idea-local-artifact.ts";
import { resolveImplementationProject, type ImplementationProject, type ImplementationProjectClient } from "./idea-project-promotion.ts";
import {
  buildPortfolioAdmissionPlan,
  isPortfolioSlotAvailable,
  PortfolioQueueStore,
  selectPortfolioCandidate,
  type PortfolioCandidate,
} from "./portfolio-queue.ts";
import {
  assertPromotionReceiptCanResume,
  detectRouteGap,
  nextPromotionReceiptStep,
  PromotionReceiptStore,
  type PromotionReceipt,
  type PromotionReceiptStep,
} from "./promotion-receipt.ts";
import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { ProjectWorkflowBindingStore } from "./project-workflow-binding-store.ts";
import { createParentWorkflowIssueSummary } from "./project-workflow-binding.ts";
import { sha256Hex } from "./hash.ts";
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
  artifactBundleHash: string;
  artifacts: PromotionArtifactInput[];
  dryRun?: boolean;
}

export interface AutomaticPromotionDeps {
  cwd: string;
  projects: ImplementationProjectClient;
  buildBinding(project: ImplementationProject): ProjectWorkflowBinding;
  createParentIssue(input: { projectId: string; title: string; description: string }): Promise<{ id: string; identifier?: string }>;
  activateProject?(projectId: string): Promise<void>;
  liveCli: WorkflowLiveCli;
  runStore: WorkflowRunStateStore;
  bindingStore: ProjectWorkflowBindingStore;
  queueStore?: PortfolioQueueStore;
  receiptStore?: PromotionReceiptStore;
}

export interface AutomaticPromotionResult {
  mode: "dry-run" | "promoted" | "reused" | "skipped" | "blocked";
  plan?: ReturnType<typeof buildPortfolioAdmissionPlan>;
  candidate?: PortfolioCandidate;
  receipt?: PromotionReceipt;
  project?: ImplementationProject;
  reusedProject?: boolean;
  parent?: { id: string; identifier?: string };
  binding?: ProjectWorkflowBinding;
  ledger?: Awaited<ReturnType<WorkflowRunStateStore["load"]>>;
  firstStage?: Awaited<ReturnType<typeof seedWorkflowStageLive>>;
  reason?: string;
}

function assertPromotionEligible(input: AutomaticPromotionInput, binding: ProjectWorkflowBinding): void {
  if (!input.sessionId || !input.workflowRunId) throw new Error("Automatic promotion requires stable session and workflow run ids");
  if (!input.artifacts.some((artifact) => artifact.stageId === "build_handoff")) {
    throw new Error("Automatic promotion requires immutable build_handoff artifact");
  }
  if (binding.executionMode !== "autonomous_until_final" || binding.humanGate !== "final_only") {
    throw new Error("Automatic promotion requires autonomous_until_final final_only binding");
  }
}

async function executePromotionStep(
  step: PromotionReceiptStep,
  input: AutomaticPromotionInput,
  deps: AutomaticPromotionDeps,
  context: {
    project: ImplementationProject;
    binding: ProjectWorkflowBinding;
    receipt: PromotionReceipt;
    parent?: { id: string; identifier?: string };
    ledger?: NonNullable<Awaited<ReturnType<WorkflowRunStateStore["load"]>>>;
    firstStage?: Awaited<ReturnType<typeof seedWorkflowStageLive>>;
  },
): Promise<typeof context> {
  const receiptStore = deps.receiptStore ?? new PromotionReceiptStore(deps.cwd, input.sessionId);
  const manifest = createHermesCompositeManifest();
  switch (step) {
    case "project_resolved":
      return { ...context, receipt: await receiptStore.completeStep(step, { projectId: context.project.id }) };
    case "binding_saved": {
      await deps.bindingStore.save(context.binding);
      return {
        ...context,
        receipt: await receiptStore.completeStep(step, { bindingHash: sha256Hex(context.binding) }),
      };
    }
    case "parent_created": {
      const parent = await deps.createParentIssue({
        projectId: context.project.id,
        title: `Build: ${input.projectTitle}`,
        description: input.projectDescription,
      });
      return { ...context, parent, receipt: await receiptStore.completeStep(step, { parentIssueId: parent.id }) };
    }
    case "run_created": {
      const ledger = await deps.runStore.create({
        workflowRunId: input.workflowRunId,
        multicaProjectId: context.project.id,
        adapterId: manifest.adapterId,
        adapterVersion: manifest.adapterVersion,
        adapterBundleHash: manifest.derivedBundleHash,
        executionMode: context.binding.executionMode,
      });
      return { ...context, ledger, receipt: await receiptStore.completeStep(step) };
    }
    case "artifacts_imported": {
      if (!context.ledger) throw new Error("Workflow run ledger missing for artifact import");
      let ledger = context.ledger;
      for (const artifact of input.artifacts) {
        ledger = await deps.runStore.upsertStage(input.workflowRunId, {
          stageId: artifact.stageId,
          status: "accepted",
          attempt: 1,
          artifactHashes: [],
        });
        const envelope: WorkflowArtifactEnvelope = {
          artifactSchemaVersion: 1,
          workflowRunId: input.workflowRunId,
          stageId: artifact.stageId,
          producerIssueId: `local:${input.sessionId}`,
          producerRunId: input.sessionId,
          attempt: 1,
          adapterBundleHash: manifest.derivedBundleHash,
          inputArtifactHashes: [],
          outputPath: artifact.outputPath,
          outputHash: artifact.outputHash,
          status: "immutable",
        };
        ledger = await deps.runStore.recordArtifact(input.workflowRunId, envelope);
      }
      return { ...context, ledger, receipt: await receiptStore.completeStep(step) };
    }
    case "parent_summary_written": {
      if (!context.ledger || !context.parent) throw new Error("Parent summary requires parent and ledger");
      await deps.liveCli.writeParentSummary(
        context.parent.id,
        createParentWorkflowIssueSummary({
          binding: context.binding,
          workflowRunId: input.workflowRunId,
          workflowBundleHash: manifest.derivedBundleHash,
          workflowStage: HERMES_SPEC_REVIEW_STAGE_ID,
          workflowStatus: "waiting",
          workflowStatePointer: input.workflowRunId,
          workflowStateHash: hashWorkflowRunLedger(context.ledger),
        }),
      );
      return { ...context, receipt: await receiptStore.completeStep(step) };
    }
    case "spec_review_seeded": {
      if (!context.ledger || !context.parent) throw new Error("Spec review seed requires parent and ledger");
      const seeded = await seedWorkflowStageLive({
        ledger: context.ledger,
        manifest,
        binding: context.binding,
        parentIssueId: context.parent.id,
        stageId: HERMES_SPEC_REVIEW_STAGE_ID,
        attempt: 1,
        liveCli: deps.liveCli,
      });
      const ledger = await deps.runStore.upsertStage(input.workflowRunId, seeded.stage);
      return { ...context, ledger, firstStage: seeded, receipt: await receiptStore.completeStep(step) };
    }
    case "project_activated": {
      if (deps.activateProject) await deps.activateProject(context.project.id);
      return { ...context, receipt: await receiptStore.completeStep(step, { projectId: context.project.id }) };
    }
    default:
      throw new Error(`Unknown promotion receipt step: ${step satisfies never}`);
  }
}

export async function autoPromoteIdeaSession(
  input: AutomaticPromotionInput,
  deps: AutomaticPromotionDeps,
): Promise<AutomaticPromotionResult> {
  const existingLedger = await deps.runStore.load(input.workflowRunId);
  if (existingLedger) return { mode: "reused", ledger: existingLedger };

  const queueStore = deps.queueStore ?? new PortfolioQueueStore(deps.cwd);
  const receiptStore = deps.receiptStore ?? new PromotionReceiptStore(deps.cwd, input.sessionId);
  const queueState = await queueStore.load();
  await queueStore.enqueue({
    sessionId: input.sessionId,
    workflowRunId: input.workflowRunId,
    projectTitle: input.projectTitle,
    artifactBundleHash: input.artifactBundleHash,
  });
  const refreshedQueue = await queueStore.load();
  const candidate = selectPortfolioCandidate({
    entries: refreshedQueue.entries,
    activeSessionId: refreshedQueue.activeSessionId,
    plannedProjects: await deps.projects.list(),
  });
  if (!candidate || candidate.entry.sessionId !== input.sessionId) {
    return { mode: "skipped", reason: "not_selected_by_portfolio_queue" };
  }
  const plan = buildPortfolioAdmissionPlan(candidate);
  if (input.dryRun) return { mode: "dry-run", plan, candidate };

  const resolved = await resolveImplementationProject({
    projectTitle: input.projectTitle,
    projectDescription: input.projectDescription,
    client: deps.projects,
  });
  const binding = deps.buildBinding(resolved.project);
  assertPromotionEligible(input, binding);
  const routeGap = detectRouteGap({
    requiredRoles: ["spec_reviewer"],
    roleRoutes: binding.roleRoutes,
  });
  if (routeGap) {
    await queueStore.skip(input.sessionId, routeGap);
    await receiptStore.start({
      sessionId: input.sessionId,
      workflowRunId: input.workflowRunId,
      artifactBundleHash: input.artifactBundleHash,
      projectTitle: input.projectTitle,
    });
    await receiptStore.block(routeGap);
    return { mode: "blocked", reason: routeGap, candidate };
  }
  if (!isPortfolioSlotAvailable(refreshedQueue)) {
    return { mode: "blocked", reason: "portfolio_slot_unavailable", candidate };
  }

  let receipt = await receiptStore.start({
    sessionId: input.sessionId,
    workflowRunId: input.workflowRunId,
    artifactBundleHash: input.artifactBundleHash,
    projectTitle: input.projectTitle,
  });
  assertPromotionReceiptCanResume(receipt, input);
  await queueStore.admit(input.sessionId);

  let context: {
    project: ImplementationProject;
    binding: ProjectWorkflowBinding;
    receipt: PromotionReceipt;
    parent?: { id: string; identifier?: string };
    ledger?: NonNullable<Awaited<ReturnType<WorkflowRunStateStore["load"]>>>;
    firstStage?: Awaited<ReturnType<typeof seedWorkflowStageLive>>;
  } = { project: resolved.project, binding, receipt };
  let step = nextPromotionReceiptStep(receipt);
  while (step) {
    context = await executePromotionStep(step, input, deps, context);
    receipt = context.receipt;
    step = nextPromotionReceiptStep(receipt);
  }

  await queueStore.activate(input.sessionId);
  return {
    mode: "promoted",
    candidate,
    receipt,
    project: resolved.project,
    reusedProject: resolved.reused,
    parent: context.parent,
    binding: context.binding,
    ledger: context.ledger,
    firstStage: context.firstStage,
  };
}

export function artifactsFromRegistry(registry: IdeaLocalArtifactRegistry): PromotionArtifactInput[] {
  validatePromotionReadyArtifacts(registry);
  return registry.artifacts.map((artifact) => ({
    stageId: artifact.stageId,
    outputPath: artifact.outputPath,
    outputHash: artifact.contentHash,
  }));
}

export function assertPromotionArtifactContinuity(
  registry: IdeaLocalArtifactRegistry,
  expectedBundleHash: string,
): void {
  assertArtifactBundleUnchanged(registry, expectedBundleHash);
}
