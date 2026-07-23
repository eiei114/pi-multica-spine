import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import type { ProviderTelemetrySnapshot, TelemetryPreflightDecision } from "./provider-telemetry.ts";
import { evaluateTelemetryPreflight } from "./provider-telemetry.ts";
import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import type { WorkflowCatalogManifest, WorkflowCatalogStage } from "./workflow-catalog.ts";
import { StringEnum } from "./schema.ts";
import { assertValid, validateSchema } from "./validation.ts";

export const WorkflowCostClassSchema = StringEnum(["low", "normal", "high", "protected"]);
export type WorkflowCostClass = Static<typeof WorkflowCostClassSchema>;

export const WorkflowRouteCandidateSchema = Type.Object({
  agentId: Type.String({ minLength: 1 }),
  runtimeId: Type.String({ minLength: 1 }),
  provider: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
  thinkingLevel: Type.Optional(Type.String({ minLength: 1 })),
  capabilities: Type.Array(Type.String({ minLength: 1 })),
  permissionCapabilities: Type.Array(Type.String({ minLength: 1 })),
  priority: Type.Integer(),
});
export type WorkflowRouteCandidate = Static<typeof WorkflowRouteCandidateSchema>;

export const WorkflowCapabilityPoolSchema = Type.Object({
  profileId: Type.String({ minLength: 1 }),
  candidates: Type.Array(WorkflowRouteCandidateSchema, { minItems: 1 }),
  staticFallbackAgentId: Type.Optional(Type.String({ minLength: 1 })),
  telemetryPolicy: Type.Object({
    staleFallbackAllowed: Type.Optional(Type.Boolean()),
    minimumRefreshIntervalMs: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  factoryTemplateId: Type.Optional(Type.String({ minLength: 1 })),
});
export type WorkflowCapabilityPool = Static<typeof WorkflowCapabilityPoolSchema>;

export const WorkflowRouteDecisionRecordSchema = Type.Object({
  stageId: Type.String({ minLength: 1 }),
  attempt: Type.Integer({ minimum: 1 }),
  selectedAgentId: Type.Optional(Type.String({ minLength: 1 })),
  selectedRuntimeId: Type.Optional(Type.String({ minLength: 1 })),
  selectedModel: Type.Optional(Type.String({ minLength: 1 })),
  telemetrySnapshotId: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  snapshotAgeMs: Type.Optional(Type.Integer({ minimum: 0 })),
  selectionReason: Type.String({ minLength: 1 }),
  blockedCandidates: Type.Array(Type.Object({
    agentId: Type.String({ minLength: 1 }),
    reasons: Type.Array(Type.String({ minLength: 1 })),
  })),
  decidedAt: Type.String({ minLength: 1 }),
  inputHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
});
export type WorkflowRouteDecisionRecord = Static<typeof WorkflowRouteDecisionRecordSchema>;

export interface LiveAgentInventoryRecord {
  agentId: string;
  runtimeId: string;
  provider: string;
  model: string;
  thinkingLevel?: string;
  status: "active" | "archived" | "inactive";
  capabilities: string[];
  permissionCapabilities: string[];
  runtimeOnline: boolean;
}

export interface WorkflowRouteSelectionInput {
  stage: WorkflowCatalogStage & {
    capabilityRequirements?: string[];
    permissionRequests?: string[];
    costClass?: WorkflowCostClass;
  };
  attempt: number;
  pool: WorkflowCapabilityPool;
  inventory: readonly LiveAgentInventoryRecord[];
  telemetryByProvider: ReadonlyMap<string, ProviderTelemetrySnapshot | undefined>;
  now: Date;
  effectivePermissions?: string[];
}

export interface WorkflowRouteSelectionResult {
  decision: WorkflowRouteDecisionRecord;
  preflight: TelemetryPreflightDecision;
  provisionRequired: boolean;
}

function candidateMatchesStage(
  candidate: WorkflowRouteCandidate,
  inventory: LiveAgentInventoryRecord,
  stage: WorkflowRouteSelectionInput["stage"],
  effectivePermissions: string[] | undefined,
): string[] {
  const reasons: string[] = [];
  if (inventory.status !== "active") reasons.push("agent_inactive");
  if (!inventory.runtimeOnline) reasons.push("runtime_offline");
  if (inventory.agentId !== candidate.agentId) reasons.push("agent_mismatch");
  if (inventory.runtimeId !== candidate.runtimeId) reasons.push("runtime_mismatch");
  if (inventory.model !== candidate.model) reasons.push("model_mismatch");
  if (candidate.thinkingLevel && inventory.thinkingLevel !== candidate.thinkingLevel) reasons.push("thinking_mismatch");
  for (const capability of stage.capabilityRequirements ?? []) {
    if (!inventory.capabilities.includes(capability) && !candidate.capabilities.includes(capability)) {
      reasons.push(`missing_capability:${capability}`);
    }
  }
  for (const permission of stage.permissionRequests ?? []) {
    const granted = effectivePermissions?.includes(permission) ?? inventory.permissionCapabilities.includes(permission);
    if (!granted) reasons.push(`missing_permission:${permission}`);
  }
  return reasons;
}

export function computeRouteInputHash(input: WorkflowRouteSelectionInput): string {
  return sha256Hex({
    stageId: input.stage.stageId,
    attempt: input.attempt,
    pool: input.pool,
    inventory: input.inventory,
    telemetry: [...input.telemetryByProvider.entries()].map(([provider, snapshot]) => [provider, snapshot?.snapshotId]),
    effectivePermissions: input.effectivePermissions,
  });
}

export function selectWorkflowRoute(input: WorkflowRouteSelectionInput): WorkflowRouteSelectionResult {
  const blockedCandidates: Array<{ agentId: string; reasons: string[] }> = [];
  const inventoryByAgent = new Map(input.inventory.map((item) => [item.agentId, item]));
  const sorted = [...input.pool.candidates].sort((left, right) => left.priority - right.priority || left.agentId.localeCompare(right.agentId));
  let selected: { candidate: WorkflowRouteCandidate; inventory: LiveAgentInventoryRecord } | undefined;
  let preflight: TelemetryPreflightDecision = { kind: "blocked", reason: "no_candidates" };

  for (const candidate of sorted) {
    const inventory = inventoryByAgent.get(candidate.agentId);
    if (!inventory) {
      blockedCandidates.push({ agentId: candidate.agentId, reasons: ["agent_missing"] });
      continue;
    }
    const reasons = candidateMatchesStage(candidate, inventory, input.stage, input.effectivePermissions);
    if (reasons.length) {
      blockedCandidates.push({ agentId: candidate.agentId, reasons });
      continue;
    }
    preflight = evaluateTelemetryPreflight(
      input.telemetryByProvider.get(candidate.provider),
      input.now,
      { costClass: input.stage.costClass, policy: input.pool.telemetryPolicy },
    );
    if (preflight.kind === "blocked" || preflight.kind === "refresh_required") {
      blockedCandidates.push({
        agentId: candidate.agentId,
        reasons: [preflight.kind === "blocked" ? preflight.reason : preflight.reason],
      });
      continue;
    }
    selected = { candidate, inventory };
    break;
  }

  const inputHash = computeRouteInputHash(input);
  const decidedAt = input.now.toISOString();
  if (!selected) {
    return {
      decision: assertValid(validateSchema(WorkflowRouteDecisionRecordSchema, {
        stageId: input.stage.stageId,
        attempt: input.attempt,
        selectionReason: "no_eligible_candidate",
        blockedCandidates,
        decidedAt,
        inputHash,
      }), "Invalid route decision"),
      preflight,
      provisionRequired: Boolean(input.pool.factoryTemplateId),
    };
  }

  const snapshot = input.telemetryByProvider.get(selected.candidate.provider);
  return {
    decision: assertValid(validateSchema(WorkflowRouteDecisionRecordSchema, {
      stageId: input.stage.stageId,
      attempt: input.attempt,
      selectedAgentId: selected.inventory.agentId,
      selectedRuntimeId: selected.inventory.runtimeId,
      selectedModel: selected.inventory.model,
      telemetrySnapshotId: snapshot?.snapshotId,
      snapshotAgeMs: snapshot ? input.now.getTime() - Date.parse(snapshot.collectedAt) : undefined,
      selectionReason: preflight.kind === "fallback_allowed" ? "telemetry_fallback" : "pool_priority",
      blockedCandidates,
      decidedAt,
      inputHash,
    }), "Invalid route decision"),
    preflight,
    provisionRequired: false,
  };
}

export function findExistingRouteDecision(
  records: readonly WorkflowRouteDecisionRecord[] | undefined,
  stageId: string,
  attempt: number,
  inputHash: string,
): WorkflowRouteDecisionRecord | undefined {
  return records?.find((record) =>
    record.stageId === stageId &&
    record.attempt === attempt &&
    record.inputHash === inputHash &&
    record.selectedAgentId,
  );
}

export function resolveStaticFallbackRoute(
  input: WorkflowRouteSelectionInput,
): WorkflowRouteSelectionResult | undefined {
  if (!input.pool.staticFallbackAgentId) return undefined;
  const inventory = input.inventory.find((item) => item.agentId === input.pool.staticFallbackAgentId && item.status === "active");
  if (!inventory) return undefined;
  const inputHash = computeRouteInputHash(input);
  const preflight = evaluateTelemetryPreflight(
    input.telemetryByProvider.get(inventory.provider),
    input.now,
    { costClass: input.stage.costClass, policy: input.pool.telemetryPolicy },
  );
  if (preflight.kind === "blocked" || preflight.kind === "refresh_required") return undefined;
  return {
    decision: assertValid(validateSchema(WorkflowRouteDecisionRecordSchema, {
      stageId: input.stage.stageId,
      attempt: input.attempt,
      selectedAgentId: inventory.agentId,
      selectedRuntimeId: inventory.runtimeId,
      selectedModel: inventory.model,
      telemetrySnapshotId: input.telemetryByProvider.get(inventory.provider)?.snapshotId,
      selectionReason: "static_fallback",
      blockedCandidates: [],
      decidedAt: input.now.toISOString(),
      inputHash,
    }), "Invalid route decision"),
    preflight,
    provisionRequired: false,
  };
}

export function assertNoAgentModelMutation(command: string): void {
  if (/\bagent\s+update\b/.test(command) && /--model\b/.test(command)) {
    throw new Error("Routing must not mutate agent models via multica agent update --model");
  }
}

export function resolveCapabilityPool(
  binding: ProjectWorkflowBinding,
  profileId: string,
): WorkflowCapabilityPool | undefined {
  return binding.capabilityPools?.find((pool) => pool.profileId === profileId);
}
