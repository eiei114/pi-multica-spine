import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoAgentModelMutation,
  computeRouteInputHash,
  findExistingRouteDecision,
  selectWorkflowRoute,
} from "../lib/workflow-routing.ts";
import { buildProviderTelemetrySnapshot, computeNextRefreshAt } from "../lib/provider-telemetry.ts";

const inventory = [{
  agentId: "agent_a",
  runtimeId: "runtime_1",
  provider: "anthropic",
  model: "claude-sonnet",
  status: "active",
  capabilities: ["design"],
  permissionCapabilities: ["design_doc"],
  runtimeOnline: true,
}];

const pool = {
  profileId: "designer",
  candidates: [{
    agentId: "agent_a",
    runtimeId: "runtime_1",
    provider: "anthropic",
    model: "claude-sonnet",
    capabilities: ["design"],
    permissionCapabilities: ["design_doc"],
    priority: 1,
  }],
  telemetryPolicy: { staleFallbackAllowed: false },
};

test("workflow routing selects eligible candidate and records telemetry snapshot id", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  const snapshot = buildProviderTelemetrySnapshot({
    schemaVersion: 1,
    provider: "anthropic",
    accountRef: "acct_1",
    collectedAt: now.toISOString(),
    nextRefreshAt: computeNextRefreshAt({ provider: "anthropic", accountRef: "acct_1" }, now),
    source: "runtime_usage",
    status: "observed",
    provenance: ["runtime"],
  });
  const input = {
    stage: { stageId: "design_doc", role: "designer", capabilityRequirements: ["design"], permissionRequests: ["design_doc"], costClass: "normal" },
    attempt: 1,
    pool,
    inventory,
    telemetryByProvider: new Map([["anthropic", snapshot]]),
    now,
    effectivePermissions: ["design_doc"],
  };
  const result = selectWorkflowRoute(input);
  assert.equal(result.decision.selectedAgentId, "agent_a");
  assert.equal(result.decision.telemetrySnapshotId, snapshot.snapshotId);
  const hash = computeRouteInputHash(input);
  assert.ok(findExistingRouteDecision([result.decision], "design_doc", 1, hash));
});

test("workflow routing excludes inactive agents and blocked telemetry", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  const staleSnapshot = buildProviderTelemetrySnapshot({
    schemaVersion: 1,
    provider: "anthropic",
    accountRef: "acct_1",
    collectedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    nextRefreshAt: new Date(now.getTime() - 1000).toISOString(),
    source: "runtime_usage",
    status: "stale",
    provenance: ["runtime"],
  });
  const result = selectWorkflowRoute({
    stage: { stageId: "design_doc", role: "designer", costClass: "protected" },
    attempt: 1,
    pool,
    inventory: [{ ...inventory[0], status: "archived" }],
    telemetryByProvider: new Map([["anthropic", staleSnapshot]]),
    now,
  });
  assert.equal(result.decision.selectedAgentId, undefined);
  assert.equal(result.provisionRequired, false);
});

test("workflow routing rejects agent update --model command strings", () => {
  assert.throws(() => assertNoAgentModelMutation("multica agent update agent_1 --model gpt-4"), /must not mutate agent models/);
});
