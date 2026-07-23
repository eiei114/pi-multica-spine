import { join } from "node:path";
import { Type, type Static } from "typebox";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { createParentWorkflowIssueSummary } from "./project-workflow-binding.ts";
import type { WorkflowCatalogManifest } from "./workflow-catalog.ts";
import {
  canAcceptProducedStage,
  resolveNextStageId,
  seedWorkflowStage,
  seedWorkflowStageLive,
  transitionWorkflowStage,
  transitionWorkflowStageLive,
} from "./workflow-controller.ts";
import type { WorkflowLiveCli } from "./workflow-live-cli.ts";
import { WORKFLOW_COMPLETION_AUTHORITY } from "./workflow-live-cli.ts";
import {
  hashWorkflowRunLedger,
  stageAttemptKey,
  type WorkflowEvent,
  type WorkflowRunStateLedger,
  type WorkflowRunStatus,
  WorkflowRunStateStore,
} from "./workflow-run-state.ts";
import { StringEnum } from "./schema.ts";
import { safeIssueIdentifier } from "./state-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";
import {
  assertHermesProducedStageReady,
  HERMES_ADAPTER_ID,
  HERMES_FINAL_STAGE_ID,
  resolveNextHermesStageTarget,
  type HermesStageTarget,
} from "./hermes-adapter.ts";
import {
  findExistingRouteDecision,
  resolveCapabilityPool,
  resolveStaticFallbackRoute,
  selectWorkflowRoute,
  type LiveAgentInventoryRecord,
} from "./workflow-routing.ts";
import { ProviderTelemetryStore, evaluateTelemetryPreflight } from "./provider-telemetry.ts";
import { rollbackAdapterMigration, WorkflowAdapterMigrationStore } from "./workflow-adapter-migration.ts";

export const DEFAULT_LEASE_TTL_MS = 60_000;
export const DEFAULT_EVENT_SCAN_WINDOW = 50;

export const ControllerTickActionKindSchema = StringEnum([
  "acquire_lease",
  "recover_migration",
  "refresh_telemetry",
  "provision_agent",
  "record_route",
  "validate_produced_stage",
  "seed_next_stage",
  "persist_summary",
  "release_lease",
  "stop",
]);
export type ControllerTickActionKind = Static<typeof ControllerTickActionKindSchema>;

export const WorkflowControllerLeaseSchema = Type.Object({
  workflowRunId: Type.String({ minLength: 1 }),
  holderId: Type.String({ minLength: 1 }),
  fencingToken: Type.Integer({ minimum: 1 }),
  acquiredAt: Type.String({ minLength: 1 }),
  expiresAt: Type.String({ minLength: 1 }),
  releasedAt: Type.Optional(Type.String({ minLength: 1 })),
  lastPersistedStateVersion: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type WorkflowControllerLease = Static<typeof WorkflowControllerLeaseSchema>;

export interface ReconcileEventCandidate {
  eventId: string;
  workflowRunId: string;
  stageId?: string;
  attempt?: number;
  stateVersion?: number;
  timestamp: string;
}

export interface ReconcileEventsResult {
  accepted: ReconcileEventCandidate[];
  deduped: number;
  rejectedStale: number;
}

export interface ControllerTickInput {
  workflowRunId: string;
  holderId: string;
  ledger: WorkflowRunStateLedger;
  lease?: WorkflowControllerLease;
  manifest: WorkflowCatalogManifest;
  binding: ProjectWorkflowBinding;
  parentIssueId?: string;
  liveCli?: WorkflowLiveCli;
  now?: Date;
  leaseTtlMs?: number;
  eventScanWindow?: number;
  statePointer?: string;
  inventory?: readonly LiveAgentInventoryRecord[];
  telemetryStore?: ProviderTelemetryStore;
  migrationStore?: WorkflowAdapterMigrationStore;
}

export interface ControllerTickResult {
  action: ControllerTickActionKind;
  stopped: boolean;
  reason?: string;
  lease?: WorkflowControllerLease;
  ledger: WorkflowRunStateLedger;
  reconcile?: ReconcileEventsResult;
  parentMetadata?: Record<string, unknown>;
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function isLeaseActive(lease: WorkflowControllerLease | undefined, now: Date): boolean {
  if (!lease || lease.releasedAt) return false;
  return Date.parse(lease.expiresAt) > now.getTime();
}

function isTerminalWorkflowStatus(status: WorkflowRunStatus): boolean {
  return status === "completed" || status === "failed";
}

export function shouldGenericReconcilerSkip(metadata: Record<string, unknown>): boolean {
  return metadata.completion_authority === WORKFLOW_COMPLETION_AUTHORITY || metadata.workflow_managed === true;
}

export function assertGenericReconcilerMayAdvance(metadata: Record<string, unknown>, stageId: string): void {
  if (shouldGenericReconcilerSkip(metadata)) {
    throw new Error(`Generic reconciler cannot advance workflow_controller-owned stage: ${stageId}`);
  }
}

export function eventDedupeIdentity(workflowRunId: string, stageId: string, attempt: number): string {
  return stageAttemptKey(workflowRunId, stageId, attempt);
}

export function toReconcileCandidatesFromLedger(ledger: WorkflowRunStateLedger): ReconcileEventCandidate[] {
  return ledger.events.map((event) => ({
    eventId: event.eventId,
    workflowRunId: ledger.workflowRunId,
    stageId: event.stageId,
    attempt: typeof event.details?.attempt === "number" ? event.details.attempt : undefined,
    stateVersion: typeof event.details?.stateVersion === "number" ? event.details.stateVersion : undefined,
    timestamp: event.timestamp,
  }));
}

export function reconcileWorkflowEvents(
  ledger: WorkflowRunStateLedger,
  incoming: ReconcileEventCandidate[],
  options: { scanWindow?: number } = {},
): ReconcileEventsResult {
  const scanWindow = options.scanWindow ?? DEFAULT_EVENT_SCAN_WINDOW;
  const windowed = incoming.slice(-scanWindow);
  const seen = new Set<string>();
  const accepted: ReconcileEventCandidate[] = [];
  let deduped = 0;
  let rejectedStale = 0;

  for (const event of windowed) {
    if (event.workflowRunId !== ledger.workflowRunId) {
      rejectedStale += 1;
      continue;
    }
    const stageId = event.stageId;
    const attempt = event.attempt ?? 1;
    if (!stageId) {
      accepted.push(event);
      continue;
    }
    const dedupeKey = eventDedupeIdentity(event.workflowRunId, stageId, attempt);
    if (seen.has(dedupeKey)) {
      deduped += 1;
      continue;
    }
    const stage = ledger.stages[stageId];
    if (stage && attempt < stage.attempt) {
      rejectedStale += 1;
      continue;
    }
    if (event.stateVersion !== undefined && event.stateVersion < ledger.stateVersion) {
      rejectedStale += 1;
      continue;
    }
    seen.add(dedupeKey);
    accepted.push(event);
  }

  return { accepted, deduped, rejectedStale };
}

export class WorkflowControllerLeaseStore {
  readonly cwd: string;
  readonly root: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT, "workflow-runs");
  }

  leasePath(workflowRunId: string): string {
    return join(this.root, safeIssueIdentifier(workflowRunId), "controller-lease.json");
  }

  async load(workflowRunId: string): Promise<WorkflowControllerLease | undefined> {
    const lease = await readJsonFile<WorkflowControllerLease>(this.leasePath(workflowRunId));
    if (!lease) return undefined;
    return assertValid(validateSchema(WorkflowControllerLeaseSchema, lease), "Invalid workflow controller lease");
  }

  async acquire(
    workflowRunId: string,
    holderId: string,
    options: { now?: Date; leaseTtlMs?: number } = {},
  ): Promise<WorkflowControllerLease> {
    const now = options.now ?? new Date();
    const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    return withFileLock(this.leasePath(workflowRunId), async () => {
      const existing = await this.load(workflowRunId);
      if (existing && isLeaseActive(existing, now)) {
        if (existing.holderId !== holderId) {
          throw new Error(`Workflow run lease held by another writer: ${existing.holderId}`);
        }
        return existing;
      }
      const fencingToken = (existing?.fencingToken ?? 0) + 1;
      const lease: WorkflowControllerLease = {
        workflowRunId,
        holderId,
        fencingToken,
        acquiredAt: nowIso(now),
        expiresAt: new Date(now.getTime() + leaseTtlMs).toISOString(),
        lastPersistedStateVersion: existing?.lastPersistedStateVersion,
      };
      await writeJsonAtomic(this.leasePath(workflowRunId), lease);
      return lease;
    });
  }

  async release(workflowRunId: string, holderId: string, fencingToken: number, now: Date = new Date()): Promise<WorkflowControllerLease> {
    return withFileLock(this.leasePath(workflowRunId), async () => {
      const existing = await this.load(workflowRunId);
      if (!existing || existing.releasedAt) {
        throw new Error(`No active workflow controller lease for ${workflowRunId}`);
      }
      if (existing.holderId !== holderId) {
        throw new Error(`Lease holder mismatch: expected ${existing.holderId}, got ${holderId}`);
      }
      if (existing.fencingToken !== fencingToken) {
        throw new Error(`Lease fencing token mismatch: expected ${existing.fencingToken}, got ${fencingToken}`);
      }
      const released: WorkflowControllerLease = {
        ...existing,
        releasedAt: nowIso(now),
      };
      await writeJsonAtomic(this.leasePath(workflowRunId), released);
      return released;
    });
  }

  async adoptOrphan(workflowRunId: string, holderId: string, now: Date = new Date(), leaseTtlMs = DEFAULT_LEASE_TTL_MS): Promise<WorkflowControllerLease> {
    const existing = await this.load(workflowRunId);
    if (existing && isLeaseActive(existing, now)) {
      throw new Error(`Cannot adopt active lease held by ${existing.holderId}`);
    }
    return this.acquire(workflowRunId, holderId, { now, leaseTtlMs });
  }

  async markSummaryPersisted(
    workflowRunId: string,
    holderId: string,
    fencingToken: number,
    stateVersion: number,
  ): Promise<WorkflowControllerLease> {
    return withFileLock(this.leasePath(workflowRunId), async () => {
      const existing = await this.load(workflowRunId);
      if (!existing || existing.releasedAt) {
        throw new Error(`No active workflow controller lease for ${workflowRunId}`);
      }
      if (existing.holderId !== holderId || existing.fencingToken !== fencingToken) {
        throw new Error(`Lease holder/token mismatch for ${workflowRunId}`);
      }
      const updated: WorkflowControllerLease = {
        ...existing,
        lastPersistedStateVersion: stateVersion,
      };
      await writeJsonAtomic(this.leasePath(workflowRunId), updated);
      return updated;
    });
  }
}

function findProducedStageForValidation(ledger: WorkflowRunStateLedger) {
  for (const stage of Object.values(ledger.stages)) {
    const artifact = [...ledger.artifacts]
      .reverse()
      .find((item) => item.stageId === stage.stageId && item.attempt === stage.attempt);
    if (canAcceptProducedStage(stage, artifact)) {
      return { stage, artifact };
    }
  }
  return undefined;
}

function findSeedTarget(
  ledger: WorkflowRunStateLedger,
  manifest: WorkflowCatalogManifest,
  binding: ProjectWorkflowBinding,
): HermesStageTarget | undefined {
  if (ledger.migration?.status === "preparing") return undefined;
  if (ledger.adapterId === HERMES_ADAPTER_ID) {
    return resolveNextHermesStageTarget(ledger, manifest, binding);
  }
  const currentStageId = ledger.currentStageId;
  if (!currentStageId) {
    const firstStageId = resolveNextStageId(manifest, undefined, binding.enabledOptionalStages);
    return firstStageId ? { stageId: firstStageId, attempt: 1 } : undefined;
  }
  const current = ledger.stages[currentStageId];
  if (!current) return undefined;
  if (current.status !== "accepted") return undefined;
  const nextStageId = resolveNextStageId(manifest, currentStageId, binding.enabledOptionalStages);
  if (!nextStageId) return undefined;
  const existing = ledger.stages[nextStageId];
  return { stageId: nextStageId, attempt: existing?.attempt ?? 1 };
}

async function persistParentSummary(
  input: ControllerTickInput,
  ledger: WorkflowRunStateLedger,
): Promise<Record<string, unknown> | undefined> {
  if (!input.parentIssueId || !input.liveCli) return undefined;
  const summary = createParentWorkflowIssueSummary({
    binding: input.binding,
    workflowRunId: ledger.workflowRunId,
    workflowBundleHash: ledger.adapterBundleHash,
    workflowStage: ledger.currentStageId ?? "pending",
    workflowStatus: ledger.workflowStatus,
    workflowStatePointer: input.statePointer ?? ledger.workflowRunId,
    workflowStateHash: hashWorkflowRunLedger(ledger),
  });
  return input.liveCli.writeParentSummary(input.parentIssueId, summary);
}

function manifestStageForTarget(manifest: WorkflowCatalogManifest, target: HermesStageTarget) {
  return manifest.stages.find((stage) => stage.stageId === target.stageId);
}

function buildRouteSelectionInput(
  input: ControllerTickInput,
  target: HermesStageTarget,
  telemetryByProvider: Map<string, import("./provider-telemetry.ts").ProviderTelemetrySnapshot | undefined>,
) {
  const stage = manifestStageForTarget(input.manifest, target);
  if (!stage) throw new Error(`Unknown manifest stage: ${target.stageId}`);
  const profileId = stage.capabilityProfileId ?? stage.role;
  const pool = resolveCapabilityPool(input.binding, profileId);
  if (!pool) throw new Error(`Missing capability pool: ${profileId}`);
  return {
    stage,
    attempt: target.attempt,
    pool,
    inventory: input.inventory ?? [],
    telemetryByProvider,
    now: input.now ?? new Date(),
  };
}

export async function runControllerAutopilotTick(
  input: ControllerTickInput,
  deps: {
    leaseStore?: WorkflowControllerLeaseStore;
    runStore?: WorkflowRunStateStore;
  } = {},
): Promise<ControllerTickResult> {
  const now = input.now ?? new Date();
  const leaseStore = deps.leaseStore ?? new WorkflowControllerLeaseStore(process.cwd());
  const runStore = deps.runStore ?? new WorkflowRunStateStore(process.cwd());
  let ledger = input.ledger;
  let lease = input.lease ?? (await leaseStore.load(input.workflowRunId));
  const reconcile = reconcileWorkflowEvents(ledger, toReconcileCandidatesFromLedger(ledger), {
    scanWindow: input.eventScanWindow ?? DEFAULT_EVENT_SCAN_WINDOW,
  });

  if (isTerminalWorkflowStatus(ledger.workflowStatus)) {
    return { action: "stop", stopped: true, reason: `workflow_status=${ledger.workflowStatus}`, lease, ledger, reconcile };
  }

  if (!lease || !isLeaseActive(lease, now) || lease.holderId !== input.holderId) {
    if (lease && isLeaseActive(lease, now) && lease.holderId !== input.holderId) {
      return {
        action: "stop",
        stopped: true,
        reason: `lease_held_by=${lease.holderId}`,
        lease,
        ledger,
        reconcile,
      };
    }
    const acquired = lease && !isLeaseActive(lease, now) && !lease.releasedAt
      ? await leaseStore.adoptOrphan(input.workflowRunId, input.holderId, now, input.leaseTtlMs)
      : await leaseStore.acquire(input.workflowRunId, input.holderId, { now, leaseTtlMs: input.leaseTtlMs });
    return {
      action: "acquire_lease",
      stopped: false,
      lease: acquired,
      ledger,
      reconcile,
    };
  }

  if (ledger.migration?.status === "preparing") {
    const migrationStore = input.migrationStore ?? new WorkflowAdapterMigrationStore(process.cwd());
    const snapshot = await migrationStore.loadSnapshot(input.workflowRunId);
    if (snapshot) {
      const rollback = rollbackAdapterMigration(snapshot, input.binding, hashWorkflowRunLedger(ledger), {
        migrationStatus: ledger.migration.status,
      });
      if (!rollback.noOp) {
        ledger = await runStore.setMigrationState(input.workflowRunId, {
          status: rollback.migrationStatus,
          snapshotId: snapshot.snapshotId,
          updatedAt: nowIso(now),
        });
        return {
          action: "recover_migration",
          stopped: false,
          reason: "migration_preparing_recovered",
          lease,
          ledger,
          reconcile,
        };
      }
    }
    return {
      action: "stop",
      stopped: true,
      reason: "migration_preparing",
      lease,
      ledger,
      reconcile,
    };
  }

  const seedTargetForRoute = findSeedTarget(ledger, input.manifest, input.binding);
  if (seedTargetForRoute && input.inventory && input.telemetryStore) {
    const stage = manifestStageForTarget(input.manifest, seedTargetForRoute);
    const telemetryByProvider = new Map<string, import("./provider-telemetry.ts").ProviderTelemetrySnapshot | undefined>();
    const providers = new Set((input.inventory ?? []).map((item) => item.provider));
    for (const provider of providers) {
      telemetryByProvider.set(provider, await input.telemetryStore.load({ provider, accountRef: input.binding.multicaProjectId }));
    }
    const routeInput = buildRouteSelectionInput(input, seedTargetForRoute, telemetryByProvider);
    const inputHash = selectWorkflowRoute(routeInput).decision.inputHash;
    const existingRoute = findExistingRouteDecision(ledger.routeDecisions, seedTargetForRoute.stageId, seedTargetForRoute.attempt, inputHash);
    if (!existingRoute?.selectedAgentId) {
      const staleProvider = [...telemetryByProvider.entries()].find(([, snapshot]) => {
        const preflight = evaluateTelemetryPreflight(snapshot, now, {
          costClass: stage?.costClass,
          policy: routeInput.pool.telemetryPolicy,
        });
        return preflight.kind === "refresh_required";
      });
      if (staleProvider) {
        return {
          action: "refresh_telemetry",
          stopped: false,
          reason: `telemetry_stale:${staleProvider[0]}`,
          lease,
          ledger,
          reconcile,
        };
      }
      const selection = selectWorkflowRoute(routeInput);
      if (!selection.decision.selectedAgentId) {
        if (selection.provisionRequired && routeInput.pool.factoryTemplateId) {
          return {
            action: "provision_agent",
            stopped: false,
            reason: `provision_template:${routeInput.pool.factoryTemplateId}`,
            lease,
            ledger,
            reconcile,
          };
        }
        const fallback = resolveStaticFallbackRoute(routeInput);
        if (!fallback?.decision.selectedAgentId) {
          return {
            action: "stop",
            stopped: true,
            reason: "route_failure",
            lease,
            ledger,
            reconcile,
          };
        }
        ledger = await runStore.recordRouteDecision(input.workflowRunId, fallback.decision);
        return {
          action: "record_route",
          stopped: false,
          lease,
          ledger,
          reconcile,
        };
      }
      ledger = await runStore.recordRouteDecision(input.workflowRunId, selection.decision);
      return {
        action: "record_route",
        stopped: false,
        lease,
        ledger,
        reconcile,
      };
    }
  }

  const produced = findProducedStageForValidation(ledger);
  if (produced) {
    try {
      assertHermesProducedStageReady(ledger, produced.stage.stageId, produced.stage.attempt);
    } catch (error) {
      return {
        action: "stop",
        stopped: true,
        reason: error instanceof Error ? error.message : String(error),
        lease,
        ledger,
        reconcile,
      };
    }
    let nextStage = transitionWorkflowStage(produced.stage, "accepted", produced.artifact);
    if (input.liveCli && nextStage.issueId) {
      nextStage = await transitionWorkflowStageLive(input.liveCli, produced.stage, "accepted", produced.artifact);
    }
    ledger = await runStore.upsertStage(input.workflowRunId, {
      stageId: nextStage.stageId,
      status: nextStage.status,
      attempt: nextStage.attempt,
      issueId: nextStage.issueId,
      assignedAgentId: nextStage.assignedAgentId,
      artifactHashes: nextStage.artifactHashes,
    });
    const shouldComplete = ledger.adapterId === HERMES_ADAPTER_ID
      ? nextStage.stageId === HERMES_FINAL_STAGE_ID
      : !resolveNextStageId(input.manifest, nextStage.stageId, input.binding.enabledOptionalStages);
    if (shouldComplete) {
      ledger = await runStore.setWorkflowStatus(input.workflowRunId, "completed");
    }
    return {
      action: "validate_produced_stage",
      stopped: false,
      lease,
      ledger,
      reconcile,
    };
  }

  const seedTarget = seedTargetForRoute ?? findSeedTarget(ledger, input.manifest, input.binding);
  if (seedTarget) {
    const routeDecision = ledger.routeDecisions?.find((item) => item.stageId === seedTarget.stageId && item.attempt === seedTarget.attempt);
    const selectedAgentId = routeDecision?.selectedAgentId;
    if (input.inventory && input.telemetryStore && !selectedAgentId) {
      return {
        action: "stop",
        stopped: true,
        reason: "route_not_recorded",
        lease,
        ledger,
        reconcile,
      };
    }
    let stage;
    if (input.liveCli && input.parentIssueId) {
      const seeded = await seedWorkflowStageLive({
        ledger,
        manifest: input.manifest,
        binding: input.binding,
        parentIssueId: input.parentIssueId,
        stageId: seedTarget.stageId,
        attempt: seedTarget.attempt,
        assignedAgentId: selectedAgentId,
        liveCli: input.liveCli,
      });
      stage = seeded.stage;
    } else {
      stage = seedWorkflowStage(ledger, input.manifest, input.binding, {
        stageId: seedTarget.stageId,
        attempt: seedTarget.attempt,
        assignedAgentId: selectedAgentId,
      });
    }
    ledger = await runStore.upsertStage(input.workflowRunId, {
      stageId: stage.stageId,
      status: stage.status,
      attempt: stage.attempt,
      issueId: stage.issueId,
      assignedAgentId: stage.assignedAgentId,
      artifactHashes: stage.artifactHashes,
    });
    return {
      action: "seed_next_stage",
      stopped: false,
      lease,
      ledger,
      reconcile,
    };
  }

  const needsSummaryPersist =
    Boolean(input.parentIssueId && input.liveCli) && (lease.lastPersistedStateVersion ?? 0) < ledger.stateVersion;
  if (needsSummaryPersist) {
    const parentMetadata = await persistParentSummary(input, ledger);
    lease = await leaseStore.markSummaryPersisted(
      input.workflowRunId,
      input.holderId,
      lease.fencingToken,
      ledger.stateVersion,
    );
    return {
      action: "persist_summary",
      stopped: false,
      lease,
      ledger,
      reconcile,
      parentMetadata,
    };
  }

  const released = await leaseStore.release(input.workflowRunId, input.holderId, lease.fencingToken, now);
  return {
    action: "release_lease",
    stopped: true,
    reason: "no_pending_controller_work",
    lease: released,
    ledger,
    reconcile,
  };
}

export function isStaleWorkflowEvent(event: WorkflowEvent, ledger: WorkflowRunStateLedger): boolean {
  const stageId = event.stageId;
  if (!stageId) return false;
  const attempt = typeof event.details?.attempt === "number" ? event.details.attempt : undefined;
  const stage = ledger.stages[stageId];
  if (stage && attempt !== undefined && attempt < stage.attempt) return true;
  const stateVersion = typeof event.details?.stateVersion === "number" ? event.details.stateVersion : undefined;
  if (stateVersion !== undefined && stateVersion < ledger.stateVersion) return true;
  return false;
}
