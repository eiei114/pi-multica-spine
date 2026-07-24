import { isAbsolute, posix } from "node:path";
import { Type, type Static } from "typebox";
import type { WorkflowCatalogManifest } from "./workflow-catalog.ts";
import { resolveStageActivation } from "./workflow-catalog.ts";
import { WorkflowCapabilityPoolSchema } from "./workflow-routing.ts";
import { StringEnum } from "./schema.ts";
import { assertValid, type ValidationResult, uniqueValues, validateSchema } from "./validation.ts";

export const WorkflowExecutionModeSchema = StringEnum(["interactive", "autonomous_until_final"]);
export type WorkflowExecutionMode = Static<typeof WorkflowExecutionModeSchema>;

export const WorkflowHumanGateSchema = StringEnum(["manual", "start_only", "start_and_final", "final_only"]);
export type WorkflowHumanGate = Static<typeof WorkflowHumanGateSchema>;

export const WorkflowAutoAdvancePolicySchema = StringEnum(["manual", "after_accept", "autonomous"]);
export type WorkflowAutoAdvancePolicy = Static<typeof WorkflowAutoAdvancePolicySchema>;

export const WorkflowBindingRoleRouteSchema = Type.Object({
  agentId: Type.String({ minLength: 1 }),
  capabilityProfile: Type.Optional(Type.String({ minLength: 1 })),
  notes: Type.Optional(Type.String({ minLength: 1 })),
});
export type WorkflowBindingRoleRoute = Static<typeof WorkflowBindingRoleRouteSchema>;

export const WorkflowDeliveryPolicySchema = Type.Object({
  prRequired: Type.Boolean(),
  releaseAllowed: Type.Boolean(),
  productionAllowed: Type.Boolean(),
  destructiveAllowed: Type.Boolean(),
});
export type WorkflowDeliveryPolicy = Static<typeof WorkflowDeliveryPolicySchema>;

export const ProjectWorkflowBindingSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  multicaProjectId: Type.String({ minLength: 1 }),
  projectKey: Type.Optional(Type.String({ minLength: 1 })),
  adapterId: Type.String({ minLength: 1 }),
  adapterVersion: Type.Integer({ minimum: 1 }),
  artifactRoot: Type.String({ minLength: 1 }),
  enabledOptionalStages: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  projectGrants: Type.Array(Type.String({ minLength: 1 })),
  humanOwnedActions: Type.Array(Type.String({ minLength: 1 })),
  roleRoutes: Type.Record(Type.String({ minLength: 1 }), WorkflowBindingRoleRouteSchema),
  autoAdvancePolicy: WorkflowAutoAdvancePolicySchema,
  executionMode: WorkflowExecutionModeSchema,
  humanGate: WorkflowHumanGateSchema,
  deliveryPolicy: WorkflowDeliveryPolicySchema,
  capabilityPools: Type.Optional(Type.Array(WorkflowCapabilityPoolSchema)),
  metadata: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
});
export type ProjectWorkflowBinding = Static<typeof ProjectWorkflowBindingSchema>;

export const WorkflowIssueStatusSchema = StringEnum(["pending", "waiting", "running", "blocked", "failed", "completed"]);
export type WorkflowIssueStatus = Static<typeof WorkflowIssueStatusSchema>;

export const ParentWorkflowIssueSummarySchema = Type.Object({
  workflow_managed: Type.Literal(true),
  workflow_run_id: Type.String({ minLength: 1 }),
  workflow_adapter_id: Type.String({ minLength: 1 }),
  workflow_adapter_version: Type.Integer({ minimum: 1 }),
  workflow_bundle_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  workflow_stage: Type.String({ minLength: 1 }),
  workflow_status: WorkflowIssueStatusSchema,
  workflow_state_pointer: Type.String({ minLength: 1 }),
  workflow_state_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  completion_authority: Type.Literal("workflow_controller"),
  needs_human_review: Type.Boolean(),
});
export type ParentWorkflowIssueSummary = Static<typeof ParentWorkflowIssueSummarySchema>;

function isRelativeArtifactRoot(root: string): boolean {
  if (!root.trim()) return false;
  if (isAbsolute(root)) return false;
  if (/^[A-Za-z]:[\\/]/.test(root)) return false;
  const normalized = posix.normalize(root.replace(/\\/g, "/"));
  return !normalized.startsWith("../") && normalized !== "..";
}

function validateBindingSemantics(binding: ProjectWorkflowBinding, manifest?: WorkflowCatalogManifest): string[] {
  const errors = [
    ...uniqueValues(binding.projectGrants, "duplicate-project-grant"),
    ...uniqueValues(binding.humanOwnedActions, "duplicate-human-owned-action"),
    ...uniqueValues(binding.enabledOptionalStages ?? [], "duplicate-enabled-optional-stage"),
  ];

  if (!isRelativeArtifactRoot(binding.artifactRoot)) {
    errors.push("artifact-root-must-be-project-relative");
  }

  if (binding.executionMode === "autonomous_until_final" && !["start_and_final", "final_only"].includes(binding.humanGate)) {
    errors.push("autonomous-until-final-requires-final-human-gate");
  }

  const requiredHumanActions: string[] = [];
  if (binding.deliveryPolicy.releaseAllowed) requiredHumanActions.push("release");
  if (binding.deliveryPolicy.productionAllowed) requiredHumanActions.push("production");
  if (binding.deliveryPolicy.destructiveAllowed) requiredHumanActions.push("destructive");
  const humanOwnedActionSet = new Set(binding.humanOwnedActions);
  for (const action of requiredHumanActions) {
    if (!humanOwnedActionSet.has(action)) {
      errors.push(`missing-human-owned-action:${action}`);
    }
  }

  if (manifest) {
    if (binding.adapterId !== manifest.adapterId) {
      errors.push(`adapter-id-mismatch:${binding.adapterId}:${manifest.adapterId}`);
    }
    if (binding.adapterVersion !== manifest.adapterVersion) {
      errors.push(`adapter-version-mismatch:${binding.adapterVersion}:${manifest.adapterVersion}`);
    }

    const manifestRoles = new Set(manifest.roles);
    const optionalStages = new Set(
      manifest.stages
        .filter((stage) => resolveStageActivation(stage) === "binding_optional")
        .map((stage) => stage.stageId),
    );
    const boundRoles = Object.keys(binding.roleRoutes);
    for (const role of manifest.roles) {
      if (!binding.roleRoutes[role]) errors.push(`missing-role-route:${role}`);
    }
    for (const role of boundRoles) {
      if (!manifestRoles.has(role)) errors.push(`unknown-role-route:${role}`);
    }
    for (const stageId of binding.enabledOptionalStages ?? []) {
      if (!optionalStages.has(stageId)) errors.push(`enabled-stage-is-not-optional:${stageId}`);
    }
  }

  return errors;
}

export function validateProjectWorkflowBinding(
  input: unknown,
  manifest?: WorkflowCatalogManifest,
): ValidationResult<ProjectWorkflowBinding> {
  const base = validateSchema(ProjectWorkflowBindingSchema, input);
  if (!base.ok) return base;
  const semanticErrors = validateBindingSemantics(base.value, manifest);
  if (semanticErrors.length > 0) {
    return { ok: false, errors: semanticErrors };
  }
  return base;
}

export function assertValidProjectWorkflowBinding(
  input: unknown,
  manifest?: WorkflowCatalogManifest,
): ProjectWorkflowBinding {
  return assertValid(validateProjectWorkflowBinding(input, manifest), "Invalid project workflow binding");
}

export function createParentWorkflowIssueSummary(input: {
  binding: ProjectWorkflowBinding;
  workflowRunId: string;
  workflowBundleHash: string;
  workflowStage: string;
  workflowStatus: WorkflowIssueStatus;
  workflowStatePointer: string;
  workflowStateHash: string;
  needsHumanReview?: boolean;
}): ParentWorkflowIssueSummary {
  const summary: ParentWorkflowIssueSummary = {
    workflow_managed: true,
    workflow_run_id: input.workflowRunId,
    workflow_adapter_id: input.binding.adapterId,
    workflow_adapter_version: input.binding.adapterVersion,
    workflow_bundle_hash: input.workflowBundleHash,
    workflow_stage: input.workflowStage,
    workflow_status: input.workflowStatus,
    workflow_state_pointer: input.workflowStatePointer,
    workflow_state_hash: input.workflowStateHash,
    completion_authority: "workflow_controller",
    needs_human_review: input.needsHumanReview ?? false,
  };
  if (Object.keys(summary).length > 15) {
    throw new Error(`Parent workflow issue summary exceeds metadata budget: ${Object.keys(summary).length} keys`);
  }
  return assertValid(validateSchema(ParentWorkflowIssueSummarySchema, summary), "Invalid parent workflow issue summary");
}
