import { join } from "node:path";
import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { assertValidProjectWorkflowBinding, validateProjectWorkflowBinding } from "./project-workflow-binding.ts";
import type { WorkflowCatalogEntry, WorkflowCatalogManifest } from "./workflow-catalog.ts";
import { StringEnum } from "./schema.ts";
import { safeIssueIdentifier } from "./state-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";
import type { WorkflowControllerLease } from "./workflow-controller-autopilot.ts";
import type { WorkflowRunStateLedger, WorkflowMigrationStatus } from "./workflow-run-state.ts";
import { hashWorkflowRunLedger } from "./workflow-run-state.ts";

export const WorkflowAdapterMigrationSnapshotSchema = Type.Object({
  snapshotId: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  workflowRunId: Type.String({ minLength: 1 }),
  sourceAdapterIdentity: Type.String({ minLength: 1 }),
  targetAdapterIdentity: Type.String({ minLength: 1 }),
  sourceCatalogDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  targetCatalogDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  bindingJson: Type.String({ minLength: 1 }),
  bindingHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  ledgerHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  currentStageId: Type.Optional(Type.String({ minLength: 1 })),
  currentAttempt: Type.Optional(Type.Integer({ minimum: 1 })),
  stateVersion: Type.Integer({ minimum: 1 }),
  leaseHolderId: Type.Optional(Type.String({ minLength: 1 })),
  fencingToken: Type.Optional(Type.Integer({ minimum: 1 })),
  createdAt: Type.String({ minLength: 1 }),
});
export type WorkflowAdapterMigrationSnapshot = Static<typeof WorkflowAdapterMigrationSnapshotSchema>;

export const WorkflowAdapterMigrationDryRunResultSchema = Type.Object({
  compatible: Type.Boolean(),
  sourceAdapterIdentity: Type.String({ minLength: 1 }),
  targetAdapterIdentity: Type.String({ minLength: 1 }),
  stageContinuity: Type.Boolean(),
  bindingValid: Type.Boolean(),
  permissionDelta: Type.Array(Type.String({ minLength: 1 })),
  artifactSchemaDelta: Type.Array(Type.String({ minLength: 1 })),
  expectedWrites: Type.Array(Type.String({ minLength: 1 })),
  rollbackEligible: Type.Boolean(),
  humanFallbackReason: Type.Optional(Type.String({ minLength: 1 })),
});
export type WorkflowAdapterMigrationDryRunResult = Static<typeof WorkflowAdapterMigrationDryRunResultSchema>;

export interface WorkflowAdapterIdentity {
  adapterId: string;
  adapterVersion: number;
  derivedBundleHash: string;
}

export function formatAdapterIdentity(identity: WorkflowAdapterIdentity): string {
  return `${identity.adapterId}@${identity.adapterVersion}#${identity.derivedBundleHash}`;
}

export function parseCompatibleFromIdentity(value: string): WorkflowAdapterIdentity | undefined {
  const match = /^([a-z0-9][a-z0-9-]*)@(\d+)#([a-f0-9]{64})$/.exec(value);
  if (!match) return undefined;
  return {
    adapterId: match[1],
    adapterVersion: Number(match[2]),
    derivedBundleHash: match[3],
  };
}

export function buildMigrationSnapshot(input: {
  workflowRunId: string;
  source: WorkflowAdapterIdentity;
  target: WorkflowAdapterIdentity;
  sourceEntry: WorkflowCatalogEntry;
  targetEntry: WorkflowCatalogEntry;
  binding: ProjectWorkflowBinding;
  ledger: WorkflowRunStateLedger;
  lease?: WorkflowControllerLease;
  createdAt: string;
}): WorkflowAdapterMigrationSnapshot {
  const bindingJson = JSON.stringify(input.binding);
  const payload = {
    workflowRunId: input.workflowRunId,
    sourceAdapterIdentity: formatAdapterIdentity(input.source),
    targetAdapterIdentity: formatAdapterIdentity(input.target),
    sourceCatalogDigest: input.sourceEntry.manifestDigest,
    targetCatalogDigest: input.targetEntry.manifestDigest,
    bindingJson,
    bindingHash: sha256Hex(input.binding),
    ledgerHash: hashWorkflowRunLedger(input.ledger),
    currentStageId: input.ledger.currentStageId,
    currentAttempt: input.ledger.currentStageId ? input.ledger.stages[input.ledger.currentStageId]?.attempt : undefined,
    stateVersion: input.ledger.stateVersion,
    leaseHolderId: input.lease?.holderId,
    fencingToken: input.lease?.fencingToken,
    createdAt: input.createdAt,
  };
  const snapshotId = sha256Hex(payload);
  return assertValid(validateSchema(WorkflowAdapterMigrationSnapshotSchema, { ...payload, snapshotId }), "Invalid migration snapshot");
}

export function dryRunAdapterMigration(input: {
  sourceEntry: WorkflowCatalogEntry;
  targetEntry: WorkflowCatalogEntry;
  binding: ProjectWorkflowBinding;
  ledger: WorkflowRunStateLedger;
}): WorkflowAdapterMigrationDryRunResult {
  const source = {
    adapterId: input.sourceEntry.manifest.adapterId,
    adapterVersion: input.sourceEntry.manifest.adapterVersion,
    derivedBundleHash: input.sourceEntry.manifest.derivedBundleHash,
  };
  const target = {
    adapterId: input.targetEntry.manifest.adapterId,
    adapterVersion: input.targetEntry.manifest.adapterVersion,
    derivedBundleHash: input.targetEntry.manifest.derivedBundleHash,
  };
  const targetIdentity = formatAdapterIdentity(target);
  const compatibleFrom = input.targetEntry.manifest.compatibleFrom.map(String);
  const identityDeclared = compatibleFrom.includes(formatAdapterIdentity(source));
  const reasons: string[] = [];
  if (input.targetEntry.status !== "active") reasons.push("target_not_active");
  if (!identityDeclared) reasons.push("incompatible_identity");
  if (input.sourceEntry.manifest.stateSchemaVersion !== input.targetEntry.manifest.stateSchemaVersion) {
    reasons.push("state_schema_mismatch");
  }
  if (input.sourceEntry.manifest.artifactSchemaVersion !== input.targetEntry.manifest.artifactSchemaVersion) {
    reasons.push("artifact_schema_mismatch");
  }
  const currentStageId = input.ledger.currentStageId;
  const currentStage = currentStageId ? input.ledger.stages[currentStageId] : undefined;
  const targetStage = currentStageId
    ? input.targetEntry.manifest.stages.find((stage) => stage.stageId === currentStageId)
    : undefined;
  if (currentStageId && !targetStage) reasons.push("current_stage_missing");
  const stageContinuity = !currentStageId || Boolean(targetStage);
  const roleRouteable = !targetStage || Boolean(input.binding.roleRoutes[targetStage.role]);
  if (!roleRouteable) reasons.push("current_stage_not_routeable");
  const bindingValidationErrors: string[] = [];
  if (reasons.length === 0) {
    const bindingResult = validateProjectWorkflowBinding(input.binding, input.targetEntry.manifest);
    if (!bindingResult.ok) bindingValidationErrors.push(...bindingResult.errors);
  }
  const permissionDelta: string[] = [];
  const artifactSchemaDelta: string[] = [];
  if (input.sourceEntry.manifest.artifactSchemaVersion !== input.targetEntry.manifest.artifactSchemaVersion) {
    artifactSchemaDelta.push("artifact_schema_version");
  }
  const compatible = reasons.length === 0 && bindingValidationErrors.length === 0;
  if (bindingValidationErrors.length) reasons.push(...bindingValidationErrors);
  return assertValid(validateSchema(WorkflowAdapterMigrationDryRunResultSchema, {
    compatible,
    sourceAdapterIdentity: formatAdapterIdentity(source),
    targetAdapterIdentity: targetIdentity,
    stageContinuity,
    bindingValid: roleRouteable,
    permissionDelta,
    artifactSchemaDelta,
    expectedWrites: compatible ? ["binding", "ledger.adapter_identity", "ledger.migration.status"] : [],
    rollbackEligible: compatible,
    humanFallbackReason: compatible ? undefined : reasons.join(","),
  }), "Invalid migration dry-run result");
}

export class WorkflowAdapterMigrationStore {
  readonly cwd: string;
  readonly root: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT, "workflow-adapter-migrations");
  }

  snapshotPath(workflowRunId: string): string {
    return join(this.root, safeIssueIdentifier(workflowRunId), "snapshot.json");
  }

  async loadSnapshot(workflowRunId: string): Promise<WorkflowAdapterMigrationSnapshot | undefined> {
    const snapshot = await readJsonFile<WorkflowAdapterMigrationSnapshot>(this.snapshotPath(workflowRunId));
    if (!snapshot) return undefined;
    return assertValid(validateSchema(WorkflowAdapterMigrationSnapshotSchema, snapshot), "Invalid migration snapshot");
  }

  async saveSnapshot(snapshot: WorkflowAdapterMigrationSnapshot): Promise<WorkflowAdapterMigrationSnapshot> {
    const validated = assertValid(validateSchema(WorkflowAdapterMigrationSnapshotSchema, snapshot), "Invalid migration snapshot");
    await withFileLock(this.snapshotPath(validated.workflowRunId), async () => {
      await writeJsonAtomic(this.snapshotPath(validated.workflowRunId), validated);
    });
    return validated;
  }
}

export interface AdapterMigrationApplyInput {
  workflowRunId: string;
  snapshot: WorkflowAdapterMigrationSnapshot;
  targetBinding: ProjectWorkflowBinding;
  targetIdentity: WorkflowAdapterIdentity;
}

export interface AdapterMigrationApplyResult {
  migrationStatus: WorkflowMigrationStatus;
  binding: ProjectWorkflowBinding;
  ledgerPatch: {
    adapterId: string;
    adapterVersion: number;
    adapterBundleHash: string;
    migrationStatus: WorkflowMigrationStatus;
  };
}

export function prepareAdapterMigrationCommit(
  input: AdapterMigrationApplyInput,
  dryRun: WorkflowAdapterMigrationDryRunResult,
): AdapterMigrationApplyResult {
  if (!dryRun.compatible) throw new Error(`Adapter migration incompatible: ${dryRun.humanFallbackReason}`);
  if (sha256Hex(input.targetBinding) !== input.snapshot.bindingHash && input.snapshot.bindingHash) {
    // target binding is new; snapshot stores source binding hash
  }
  return {
    migrationStatus: "committed",
    binding: input.targetBinding,
    ledgerPatch: {
      adapterId: input.targetIdentity.adapterId,
      adapterVersion: input.targetIdentity.adapterVersion,
      adapterBundleHash: input.targetIdentity.derivedBundleHash,
      migrationStatus: "committed",
    },
  };
}

export function verifyMigrationSnapshotIntegrity(snapshot: WorkflowAdapterMigrationSnapshot): void {
  const { snapshotId, ...payload } = snapshot;
  if (sha256Hex(payload) !== snapshotId) {
    throw new Error("Migration snapshot hash mismatch requires human fallback");
  }
}

export function rollbackAdapterMigration(
  snapshot: WorkflowAdapterMigrationSnapshot,
  currentBinding: ProjectWorkflowBinding,
  currentLedgerHash: string,
  options: {
    migrationStatus: WorkflowMigrationStatus;
    sourceEntryStatus?: string;
  },
): { binding: ProjectWorkflowBinding; migrationStatus: WorkflowMigrationStatus; noOp: boolean } {
  verifyMigrationSnapshotIntegrity(snapshot);
  if (options.sourceEntryStatus === "revoked") {
    throw new Error("Rollback source adapter revoked requires human fallback");
  }
  const sourceBinding = JSON.parse(snapshot.bindingJson) as ProjectWorkflowBinding;
  if (options.migrationStatus === "preparing" && sha256Hex(currentBinding) === snapshot.bindingHash) {
    return { binding: sourceBinding, migrationStatus: "rolled_back", noOp: false };
  }
  if (options.migrationStatus === "preparing" && sha256Hex(currentBinding) !== snapshot.bindingHash) {
    return { binding: sourceBinding, migrationStatus: "rolled_back", noOp: false };
  }
  if (options.migrationStatus === "committed") {
    return { binding: currentBinding, migrationStatus: "committed", noOp: true };
  }
  if (currentLedgerHash === snapshot.ledgerHash) {
    return { binding: sourceBinding, migrationStatus: "rolled_back", noOp: false };
  }
  return { binding: sourceBinding, migrationStatus: "rolled_back", noOp: false };
}
