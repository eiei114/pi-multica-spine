import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ProviderTelemetryStore,
  buildProviderTelemetrySnapshot,
  computeNextRefreshAt,
  deterministicTelemetryJitterMs,
  evaluateTelemetryPreflight,
  filterAllowedObservationHeaders,
  mergeTelemetryObservation,
} from "../lib/provider-telemetry.ts";

test("provider telemetry jitter is deterministic for a scope and window", () => {
  const scope = { provider: "anthropic", accountRef: "acct_1" };
  const now = new Date("2026-07-23T12:00:00.000Z");
  const first = deterministicTelemetryJitterMs(scope, 6 * 60 * 60 * 1000, now);
  const second = deterministicTelemetryJitterMs(scope, 6 * 60 * 60 * 1000, now);
  assert.equal(first, second);
  assert.ok(Math.abs(first) <= 6 * 60 * 60 * 1000 * 0.1);
});

test("provider telemetry preflight blocks unavailable and budget exhausted snapshots", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  assert.equal(evaluateTelemetryPreflight(undefined, now).kind, "blocked");
  const exhausted = buildProviderTelemetrySnapshot({
    schemaVersion: 1,
    provider: "anthropic",
    accountRef: "acct_1",
    collectedAt: now.toISOString(),
    nextRefreshAt: computeNextRefreshAt({ provider: "anthropic", accountRef: "acct_1" }, now),
    source: "runtime_usage",
    status: "observed",
    budget: { exhausted: true },
    provenance: ["runtime"],
  });
  assert.equal(evaluateTelemetryPreflight(exhausted, now).kind, "blocked");
});

test("provider telemetry observation filters secrets and honors retry-after", () => {
  const merged = mergeTelemetryObservation(undefined, {
    headers: {
      Authorization: "secret",
      "x-ratelimit-remaining-requests": "0",
      "retry-after": "2026-07-23T13:00:00.000Z",
    },
    collectedAt: "2026-07-23T12:00:00.000Z",
    source: "response_header",
    provenance: ["run-headers"],
  });
  assert.equal(filterAllowedObservationHeaders({ Authorization: "secret" }).authorization, undefined);
  assert.equal(merged.retryAfter, "2026-07-23T13:00:00.000Z");
  assert.equal(merged.rateLimit?.requestRemaining, 0);
});

test("provider telemetry store persists by scope hash not raw provider path", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "telemetry-store-"));
  const store = new ProviderTelemetryStore(cwd);
  const scope = { provider: "anthropic", accountRef: "acct/special" };
  const snapshot = buildProviderTelemetrySnapshot({
    schemaVersion: 1,
    provider: scope.provider,
    accountRef: scope.accountRef,
    collectedAt: new Date().toISOString(),
    nextRefreshAt: new Date(Date.now() + 1000).toISOString(),
    source: "runtime_usage",
    status: "observed",
    provenance: ["test"],
  });
  await store.save(scope, snapshot);
  const loaded = await store.load(scope);
  assert.equal(loaded?.snapshotId, snapshot.snapshotId);
  assert.ok(!store.snapshotPath(scope).includes("acct/special"));
});
