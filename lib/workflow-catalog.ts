import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { StringEnum } from "./schema.ts";
import { assertValid, type ValidationResult, uniqueValues, validateSchema } from "./validation.ts";

const Sha256Hex = Type.String({ pattern: "^[a-f0-9]{64}$" });
const AdapterId = Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9-]*$" });

export const WorkflowCatalogStatusSchema = StringEnum(["quarantined", "audited", "active", "deprecated", "revoked"]);
export type WorkflowCatalogStatus = Static<typeof WorkflowCatalogStatusSchema>;

export const WorkflowQuestionParallelismSchema = StringEnum(["serial", "bounded"]);
export type WorkflowQuestionParallelism = Static<typeof WorkflowQuestionParallelismSchema>;

export const WorkflowStageActivationSchema = StringEnum(["always", "binding_optional", "controller_conditional"]);
export type WorkflowStageActivation = Static<typeof WorkflowStageActivationSchema>;

export function resolveStageActivation(stage: Pick<WorkflowCatalogStage, "optional" | "activation">): WorkflowStageActivation {
  if (stage.activation) return stage.activation;
  if (stage.optional) return "binding_optional";
  return "always";
}

export const WorkflowSourceBundleSchema = Type.Object({
  name: Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9-]*$" }),
  sourceUrl: Type.String({ minLength: 1 }),
  sourceCommit: Type.String({ pattern: "^[a-f0-9]{40}$" }),
  sourceContentHash: Sha256Hex,
  license: Type.String({ minLength: 1 }),
});
export type WorkflowSourceBundle = Static<typeof WorkflowSourceBundleSchema>;

export const WorkflowCatalogStageSchema = Type.Object({
  stageId: Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9_-]*$" }),
  role: Type.String({ minLength: 1 }),
  optional: Type.Optional(Type.Boolean()),
  activation: Type.Optional(WorkflowStageActivationSchema),
  questionParallelism: Type.Optional(WorkflowQuestionParallelismSchema),
  outputs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  sourceBundle: Type.Optional(Type.String({ minLength: 1 })),
  instructionRefs: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
});
export type WorkflowCatalogStage = Static<typeof WorkflowCatalogStageSchema>;

export const WorkflowCatalogManifestSchema = Type.Object({
  adapterId: AdapterId,
  adapterVersion: Type.Integer({ minimum: 1 }),
  sourceUrl: Type.String({ minLength: 1 }),
  sourceCommit: Type.String({ minLength: 7 }),
  sourceContentHash: Sha256Hex,
  sourceBundles: Type.Optional(Type.Array(WorkflowSourceBundleSchema, { minItems: 1 })),
  derivedBundleHash: Sha256Hex,
  license: Type.String({ minLength: 1 }),
  auditToolVersion: Type.Integer({ minimum: 1 }),
  stateSchemaVersion: Type.Integer({ minimum: 1 }),
  artifactSchemaVersion: Type.Integer({ minimum: 1 }),
  compatibleFrom: Type.Array(Type.Integer({ minimum: 1 })),
  requiredTools: Type.Array(Type.String({ minLength: 1 })),
  sideEffects: Type.Array(Type.String({ minLength: 1 })),
  humanGates: Type.Array(Type.String({ minLength: 1 })),
  roles: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  stages: Type.Array(WorkflowCatalogStageSchema, { minItems: 1 }),
});
export type WorkflowCatalogManifest = Static<typeof WorkflowCatalogManifestSchema>;

export const WorkflowCatalogEntrySchema = Type.Object({
  status: WorkflowCatalogStatusSchema,
  manifestDigest: Sha256Hex,
  manifest: WorkflowCatalogManifestSchema,
  createdAt: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ minLength: 1 }),
});
export type WorkflowCatalogEntry = Static<typeof WorkflowCatalogEntrySchema>;

const catalogTransitions: Record<WorkflowCatalogStatus, readonly WorkflowCatalogStatus[]> = {
  quarantined: ["quarantined", "audited", "revoked"],
  audited: ["audited", "active", "deprecated", "revoked"],
  active: ["active", "deprecated", "revoked"],
  deprecated: ["deprecated", "active", "revoked"],
  revoked: ["revoked"],
};

function validateCatalogSemantics(manifest: WorkflowCatalogManifest): string[] {
  const errors = [
    ...uniqueValues(manifest.roles, "duplicate-role"),
    ...uniqueValues(manifest.requiredTools, "duplicate-tool"),
    ...uniqueValues(manifest.sideEffects, "duplicate-side-effect"),
    ...uniqueValues(manifest.humanGates, "duplicate-human-gate"),
    ...uniqueValues(manifest.compatibleFrom.map(String), "duplicate-compatible-from"),
    ...uniqueValues(manifest.stages.map((stage) => stage.stageId), "duplicate-stage"),
    ...uniqueValues((manifest.sourceBundles ?? []).map((bundle) => bundle.name), "duplicate-source-bundle"),
    ...uniqueValues((manifest.sourceBundles ?? []).map((bundle) => bundle.sourceContentHash), "duplicate-source-content-hash"),
  ];

  if (manifest.sourceBundles?.length) {
    const primary = manifest.sourceBundles[0];
    if (
      primary.sourceUrl !== manifest.sourceUrl ||
      primary.sourceCommit !== manifest.sourceCommit ||
      primary.sourceContentHash !== manifest.sourceContentHash
    ) {
      errors.push("source-bundle-primary-mismatch");
    }
  }

  const roleSet = new Set(manifest.roles);
  const sourceBundleNames = new Set((manifest.sourceBundles ?? []).map((bundle) => bundle.name));
  for (const stage of manifest.stages) {
    if (!roleSet.has(stage.role)) {
      errors.push(`unknown-stage-role:${stage.stageId}:${stage.role}`);
    }
    if (stage.sourceBundle && !sourceBundleNames.has(stage.sourceBundle)) {
      errors.push(`unknown-stage-source-bundle:${stage.stageId}:${stage.sourceBundle}`);
    }
    if ((stage.sourceBundle && !stage.instructionRefs?.length) || (!stage.sourceBundle && stage.instructionRefs?.length)) {
      errors.push(`stage-source-instructions-must-be-paired:${stage.stageId}`);
    }
  }

  return errors;
}

export function validateWorkflowCatalogManifest(input: unknown): ValidationResult<WorkflowCatalogManifest> {
  const base = validateSchema(WorkflowCatalogManifestSchema, input);
  if (!base.ok) return base;

  const semanticErrors = validateCatalogSemantics(base.value);
  if (semanticErrors.length > 0) {
    return { ok: false, errors: semanticErrors };
  }
  return base;
}

export function assertValidWorkflowCatalogManifest(input: unknown): WorkflowCatalogManifest {
  return assertValid(validateWorkflowCatalogManifest(input), "Invalid workflow catalog manifest");
}

export function createWorkflowCatalogEntry(
  manifestInput: WorkflowCatalogManifest,
  status: WorkflowCatalogStatus = "quarantined",
): WorkflowCatalogEntry {
  const manifest = assertValidWorkflowCatalogManifest(manifestInput);
  const timestamp = new Date().toISOString();
  return {
    status,
    manifestDigest: sha256Hex(manifest),
    manifest,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function canTransitionWorkflowCatalogStatus(from: WorkflowCatalogStatus, to: WorkflowCatalogStatus): boolean {
  return catalogTransitions[from].includes(to);
}

export function transitionWorkflowCatalogEntry(
  entryInput: WorkflowCatalogEntry,
  nextStatus: WorkflowCatalogStatus,
): WorkflowCatalogEntry {
  const entry = assertValid(validateSchema(WorkflowCatalogEntrySchema, entryInput), "Invalid workflow catalog entry");
  if (!canTransitionWorkflowCatalogStatus(entry.status, nextStatus)) {
    throw new Error(`Invalid workflow catalog transition: ${entry.status} -> ${nextStatus}`);
  }
  if (entry.status === nextStatus) return entry;
  return {
    ...entry,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  };
}
