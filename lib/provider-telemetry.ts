import { join } from "node:path";
import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { StringEnum } from "./schema.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";

export const TELEMETRY_BASELINE_REFRESH_MS = 6 * 60 * 60 * 1000;
export const TELEMETRY_JITTER_RATIO = 0.1;

export const TelemetryStatusSchema = StringEnum(["observed", "inferred", "stale", "unavailable"]);
export type TelemetryStatus = Static<typeof TelemetryStatusSchema>;

export const TelemetrySourceSchema = StringEnum([
  "official_api",
  "response_header",
  "runtime_usage",
  "dashboard",
  "local_accounting",
]);
export type TelemetrySource = Static<typeof TelemetrySourceSchema>;

export const ProviderUsageSchema = Type.Object({
  requestCount: Type.Optional(Type.Integer({ minimum: 0 })),
  inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type ProviderUsage = Static<typeof ProviderUsageSchema>;

export const ProviderRateLimitSchema = Type.Object({
  requestLimit: Type.Optional(Type.Integer({ minimum: 0 })),
  requestRemaining: Type.Optional(Type.Integer({ minimum: 0 })),
  requestResetAt: Type.Optional(Type.String({ minLength: 1 })),
  tokenLimit: Type.Optional(Type.Integer({ minimum: 0 })),
  tokenRemaining: Type.Optional(Type.Integer({ minimum: 0 })),
  tokenResetAt: Type.Optional(Type.String({ minLength: 1 })),
});
export type ProviderRateLimit = Static<typeof ProviderRateLimitSchema>;

export const ProviderBudgetSchema = Type.Object({
  remainingUsd: Type.Optional(Type.Number({ minimum: 0 })),
  exhausted: Type.Optional(Type.Boolean()),
});
export type ProviderBudget = Static<typeof ProviderBudgetSchema>;

export const ProviderTelemetrySnapshotSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  snapshotId: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  provider: Type.String({ minLength: 1 }),
  accountRef: Type.String({ minLength: 1 }),
  modelFamily: Type.Optional(Type.String({ minLength: 1 })),
  collectedAt: Type.String({ minLength: 1 }),
  nextRefreshAt: Type.String({ minLength: 1 }),
  source: TelemetrySourceSchema,
  status: TelemetryStatusSchema,
  usage: Type.Optional(ProviderUsageSchema),
  rateLimit: Type.Optional(ProviderRateLimitSchema),
  budget: Type.Optional(ProviderBudgetSchema),
  retryAfter: Type.Optional(Type.String({ minLength: 1 })),
  provenance: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});
export type ProviderTelemetrySnapshot = Static<typeof ProviderTelemetrySnapshotSchema>;

export interface ProviderScope {
  provider: string;
  accountRef: string;
  modelFamily?: string;
}

export type TelemetryPreflightDecision =
  | { kind: "eligible"; snapshotId: string; ageMs: number }
  | { kind: "refresh_required"; reason: string }
  | { kind: "fallback_allowed"; reason: string }
  | { kind: "blocked"; reason: string; retryAt?: string };

export interface WorkflowTelemetryPolicy {
  staleFallbackAllowed?: boolean;
  minimumRefreshIntervalMs?: number;
}

export interface ProviderTelemetryCollector {
  readonly provider: string;
  collect(scope: ProviderScope): Promise<ProviderTelemetrySnapshot>;
}

export interface ProviderRunObservationSource {
  observeRunHeaders(runId: string): Promise<Record<string, string>>;
}

const ALLOWED_OBSERVATION_HEADERS = new Set([
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-reset-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-tokens",
  "retry-after",
  "anthropic-ratelimit-requests-limit",
  "anthropic-ratelimit-requests-remaining",
  "anthropic-ratelimit-requests-reset",
  "anthropic-ratelimit-tokens-limit",
  "anthropic-ratelimit-tokens-remaining",
  "anthropic-ratelimit-tokens-reset",
]);

function normalizeHeaderKey(key: string): string {
  return key.trim().toLowerCase();
}

export function filterAllowedObservationHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = normalizeHeaderKey(key);
    if (!ALLOWED_OBSERVATION_HEADERS.has(normalized)) continue;
    if (/authorization|cookie|api[-_]?key/i.test(key)) continue;
    filtered[normalized] = value;
  }
  return filtered;
}

export function computeTelemetryScopeHash(scope: ProviderScope): string {
  return sha256Hex({
    provider: scope.provider,
    accountRef: scope.accountRef,
    modelFamily: scope.modelFamily ?? "",
  });
}

export function computeSnapshotId(payload: Omit<ProviderTelemetrySnapshot, "snapshotId">): string {
  return sha256Hex(payload);
}

export function deterministicTelemetryJitterMs(
  scope: ProviderScope,
  refreshWindowMs: number,
  now: Date,
): number {
  const seed = sha256Hex({ scope, windowStart: Math.floor(now.getTime() / refreshWindowMs) });
  const fraction = Number.parseInt(seed.slice(0, 8), 16) / 0xffff_ffff;
  const spread = refreshWindowMs * TELEMETRY_JITTER_RATIO;
  return Math.round((fraction * 2 - 1) * spread);
}

export function computeNextRefreshAt(
  scope: ProviderScope,
  collectedAt: Date,
  options: {
    baselineMs?: number;
    minimumIntervalMs?: number;
    retryAfter?: string;
  } = {},
): string {
  if (options.retryAfter) {
    const retryMs = Date.parse(options.retryAfter);
    if (!Number.isNaN(retryMs)) return new Date(retryMs).toISOString();
  }
  const baselineMs = options.baselineMs ?? TELEMETRY_BASELINE_REFRESH_MS;
  const minimumIntervalMs = options.minimumIntervalMs ?? 0;
  const jitterMs = deterministicTelemetryJitterMs(scope, baselineMs, collectedAt);
  const refreshMs = Math.max(baselineMs + jitterMs, minimumIntervalMs);
  return new Date(collectedAt.getTime() + refreshMs).toISOString();
}

export function buildProviderTelemetrySnapshot(
  input: Omit<ProviderTelemetrySnapshot, "snapshotId">,
): ProviderTelemetrySnapshot {
  const snapshotId = computeSnapshotId(input);
  return assertValid(
    validateSchema(ProviderTelemetrySnapshotSchema, { ...input, snapshotId }),
    "Invalid provider telemetry snapshot",
  );
}

export function mergeTelemetryObservation(
  existing: ProviderTelemetrySnapshot | undefined,
  observation: {
    headers: Record<string, string>;
    collectedAt: string;
    source: TelemetrySource;
    provenance: string[];
  },
): ProviderTelemetrySnapshot {
  const allowed = filterAllowedObservationHeaders(observation.headers);
  const rateLimit: ProviderRateLimit = { ...(existing?.rateLimit ?? {}) };
  const retryAfter = allowed["retry-after"];
  for (const [key, value] of Object.entries(allowed)) {
    if (key.includes("limit") && key.includes("request")) rateLimit.requestLimit = Number(value);
    if (key.includes("remaining") && key.includes("request")) rateLimit.requestRemaining = Number(value);
    if (key.includes("reset") && key.includes("request")) rateLimit.requestResetAt = value;
    if (key.includes("limit") && key.includes("token")) rateLimit.tokenLimit = Number(value);
    if (key.includes("remaining") && key.includes("token")) rateLimit.tokenRemaining = Number(value);
    if (key.includes("reset") && key.includes("token")) rateLimit.tokenResetAt = value;
  }
  if (existing?.rateLimit?.requestResetAt && rateLimit.requestResetAt) {
    if (Date.parse(rateLimit.requestResetAt) < Date.parse(existing.rateLimit.requestResetAt)) {
      rateLimit.requestRemaining = existing.rateLimit.requestRemaining;
      rateLimit.requestResetAt = existing.rateLimit.requestResetAt;
    }
  }
  const scope = {
    provider: existing?.provider ?? "unknown",
    accountRef: existing?.accountRef ?? "unknown",
    modelFamily: existing?.modelFamily,
  };
  const collectedAt = observation.collectedAt;
  const payload = {
    schemaVersion: 1 as const,
    provider: scope.provider,
    accountRef: scope.accountRef,
    modelFamily: scope.modelFamily,
    collectedAt,
    nextRefreshAt: computeNextRefreshAt(scope, new Date(collectedAt), { retryAfter }),
    source: observation.source,
    status: "observed" as const,
    rateLimit: Object.keys(rateLimit).length ? rateLimit : undefined,
    retryAfter,
    provenance: [...new Set([...(existing?.provenance ?? []), ...observation.provenance])],
  };
  return buildProviderTelemetrySnapshot(payload);
}

export function evaluateTelemetryPreflight(
  snapshot: ProviderTelemetrySnapshot | undefined,
  now: Date,
  options: {
    costClass?: "low" | "normal" | "high" | "protected";
    policy?: WorkflowTelemetryPolicy;
  } = {},
): TelemetryPreflightDecision {
  if (!snapshot || snapshot.status === "unavailable") {
    return { kind: "blocked", reason: "telemetry_unavailable" };
  }
  const ageMs = now.getTime() - Date.parse(snapshot.collectedAt);
  const fresh = now.getTime() < Date.parse(snapshot.nextRefreshAt);
  if (snapshot.retryAfter && Date.parse(snapshot.retryAfter) > now.getTime()) {
    return { kind: "blocked", reason: "rate_limited", retryAt: snapshot.retryAfter };
  }
  if (snapshot.budget?.exhausted) {
    return { kind: "blocked", reason: "budget_exhausted" };
  }
  if (snapshot.rateLimit?.requestRemaining === 0) {
    return { kind: "blocked", reason: "request_quota_exhausted", retryAt: snapshot.rateLimit.requestResetAt };
  }
  if (fresh && snapshot.status !== "stale") {
    return { kind: "eligible", snapshotId: snapshot.snapshotId, ageMs };
  }
  const protectedStage = options.costClass === "protected" || options.costClass === "high";
  if (protectedStage) {
    return { kind: "refresh_required", reason: "stale_protected_stage" };
  }
  if (options.policy?.staleFallbackAllowed) {
    return { kind: "fallback_allowed", reason: "stale_low_risk_fallback" };
  }
  return { kind: "refresh_required", reason: "stale_snapshot" };
}

export class ProviderTelemetryStore {
  readonly cwd: string;
  readonly root: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT, "provider-telemetry");
  }

  snapshotPath(scope: ProviderScope): string {
    const scopeHash = computeTelemetryScopeHash(scope);
    return join(this.root, `${scopeHash}.json`);
  }

  async load(scope: ProviderScope): Promise<ProviderTelemetrySnapshot | undefined> {
    const snapshot = await readJsonFile<ProviderTelemetrySnapshot>(this.snapshotPath(scope));
    if (!snapshot) return undefined;
    return assertValid(validateSchema(ProviderTelemetrySnapshotSchema, snapshot), "Invalid provider telemetry snapshot");
  }

  async save(scope: ProviderScope, snapshot: ProviderTelemetrySnapshot): Promise<ProviderTelemetrySnapshot> {
    const validated = assertValid(validateSchema(ProviderTelemetrySnapshotSchema, snapshot), "Invalid provider telemetry snapshot");
    await withFileLock(this.snapshotPath(scope), async () => {
      await writeJsonAtomic(this.snapshotPath(scope), validated);
    });
    return validated;
  }
}

export class MulticaRuntimeUsageTelemetryCollector implements ProviderTelemetryCollector {
  readonly provider: string;
  private readonly listUsage: (provider: string, accountRef: string) => Promise<ProviderUsage | undefined>;

  constructor(
    provider: string,
    listUsage: (provider: string, accountRef: string) => Promise<ProviderUsage | undefined>,
  ) {
    this.provider = provider;
    this.listUsage = listUsage;
  }

  async collect(scope: ProviderScope): Promise<ProviderTelemetrySnapshot> {
    const collectedAt = new Date();
    const usage = await this.listUsage(scope.provider, scope.accountRef);
    return buildProviderTelemetrySnapshot({
      schemaVersion: 1,
      provider: scope.provider,
      accountRef: scope.accountRef,
      modelFamily: scope.modelFamily,
      collectedAt: collectedAt.toISOString(),
      nextRefreshAt: computeNextRefreshAt(scope, collectedAt),
      source: "runtime_usage",
      status: usage ? "observed" : "unavailable",
      usage,
      provenance: ["multica runtime usage"],
    });
  }
}
