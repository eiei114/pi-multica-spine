import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  WorkflowControllerLeaseStore,
  assertGenericReconcilerMayAdvance,
  eventDedupeIdentity,
  reconcileWorkflowEvents,
  runControllerAutopilotTick,
  shouldGenericReconcilerSkip,
} = await import("../lib/workflow-controller-autopilot.ts");
const { WorkflowRunStateStore } = await import("../lib/workflow-run-state.ts");
const { WORKFLOW_COMPLETION_AUTHORITY } = await import("../lib/workflow-live-cli.ts");

function sampleManifest() {
  return {
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    sourceUrl: "https://github.com/example/hermes",
    sourceCommit: "acf82c9a169050c06ed33b9514ac1e17b6ccb68c",
    sourceContentHash: "a".repeat(64),
    derivedBundleHash: "b".repeat(64),
    license: "MIT",
    auditToolVersion: 1,
    stateSchemaVersion: 1,
    artifactSchemaVersion: 1,
    compatibleFrom: [],
    requiredTools: ["multica issue create"],
    sideEffects: ["issue creation"],
    humanGates: ["final_review"],
    roles: ["interview", "reviewer"],
    stages: [
      { stageId: "capture_interview", role: "interview", questionParallelism: "serial" },
      { stageId: "spec_review", role: "reviewer" },
    ],
  };
}

function sampleBinding() {
  return {
    schemaVersion: 1,
    multicaProjectId: "proj_123",
    projectKey: "IOS-DEMO",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    artifactRoot: "Artifacts/workflows",
    projectGrants: ["design_doc"],
    humanOwnedActions: ["release", "production", "destructive"],
    roleRoutes: {
      interview: { agentId: "agent_interview" },
      reviewer: { agentId: "agent_review" },
    },
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "start_and_final",
    deliveryPolicy: {
      prRequired: true,
      releaseAllowed: true,
      productionAllowed: true,
      destructiveAllowed: true,
    },
  };
}

async function createRunStore(cwd, stageStatus = "seeded") {
  const store = new WorkflowRunStateStore(cwd);
  await store.create({
    workflowRunId: "run_123",
    multicaProjectId: "proj_123",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    adapterBundleHash: "b".repeat(64),
    executionMode: "autonomous_until_final",
    initialStageId: "capture_interview",
  });
  if (stageStatus !== "seeded") {
    await store.upsertStage("run_123", {
      stageId: "capture_interview",
      status: stageStatus,
      attempt: 1,
      issueId: "issue_123",
      assignedAgentId: "agent_interview",
      artifactHashes: [],
    });
  }
  return store;
}

test("shouldGenericReconcilerSkip blocks workflow_controller-owned stages", () => {
  assert.equal(shouldGenericReconcilerSkip({ completion_authority: WORKFLOW_COMPLETION_AUTHORITY }), true);
  assert.equal(shouldGenericReconcilerSkip({ workflow_managed: true }), true);
  assert.equal(shouldGenericReconcilerSkip({ completion_authority: "worker" }), false);
  assert.throws(
    () => assertGenericReconcilerMayAdvance({ completion_authority: WORKFLOW_COMPLETION_AUTHORITY }, "capture_interview"),
    /Generic reconciler cannot advance/,
  );
});

test("reconcileWorkflowEvents dedupes and rejects stale events", () => {
  const ledger = {
    workflowRunId: "run_123",
    stateVersion: 5,
    stages: {
      capture_interview: { stageId: "capture_interview", attempt: 2 },
    },
  };
  const dedupeKey = eventDedupeIdentity("run_123", "capture_interview", 2);
  assert.equal(dedupeKey, "run_123:capture_interview:2");

  const result = reconcileWorkflowEvents(ledger, [
    { eventId: "e1", workflowRunId: "run_123", stageId: "capture_interview", attempt: 2, stateVersion: 5, timestamp: "t1" },
    { eventId: "e2", workflowRunId: "run_123", stageId: "capture_interview", attempt: 2, stateVersion: 5, timestamp: "t2" },
    { eventId: "e3", workflowRunId: "run_123", stageId: "capture_interview", attempt: 1, stateVersion: 4, timestamp: "t3" },
    { eventId: "e4", workflowRunId: "run_other", stageId: "capture_interview", attempt: 2, stateVersion: 5, timestamp: "t4" },
  ]);

  assert.equal(result.deduped, 1);
  assert.equal(result.rejectedStale, 2);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].eventId, "e1");
});

test("WorkflowControllerLeaseStore rejects double-acquire by another writer", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "controller-lease-"));
  const store = new WorkflowControllerLeaseStore(cwd);
  const now = new Date("2026-07-23T12:00:00.000Z");

  await store.acquire("run_123", "holder_a", { now, leaseTtlMs: 60_000 });
  await assert.rejects(
    () => store.acquire("run_123", "holder_b", { now, leaseTtlMs: 60_000 }),
    /held by another writer/,
  );
});

test("WorkflowControllerLeaseStore adopts orphan lease after expiry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "controller-orphan-"));
  const store = new WorkflowControllerLeaseStore(cwd);
  const acquiredAt = new Date("2026-07-23T12:00:00.000Z");
  const expiredAt = new Date("2026-07-23T12:02:00.000Z");

  const first = await store.acquire("run_123", "holder_dead", { now: acquiredAt, leaseTtlMs: 30_000 });
  const adopted = await store.adoptOrphan("run_123", "holder_new", expiredAt, 60_000);

  assert.equal(first.fencingToken, 1);
  assert.equal(adopted.fencingToken, 2);
  assert.equal(adopted.holderId, "holder_new");
});

test("runControllerAutopilotTick performs one bounded action per tick", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "controller-tick-"));
  const runStore = await createRunStore(cwd);
  const leaseStore = new WorkflowControllerLeaseStore(cwd);
  const manifest = sampleManifest();
  const binding = sampleBinding();
  const now = new Date("2026-07-23T12:00:00.000Z");

  let ledger = await runStore.load("run_123");

  const acquire = await runControllerAutopilotTick(
    { workflowRunId: "run_123", holderId: "controller_a", ledger, manifest, binding, now },
    { leaseStore, runStore },
  );
  assert.equal(acquire.action, "acquire_lease");
  assert.equal(acquire.stopped, false);

  ledger = acquire.ledger;
  const release = await runControllerAutopilotTick(
    {
      workflowRunId: "run_123",
      holderId: "controller_a",
      ledger,
      lease: acquire.lease,
      manifest,
      binding,
      now,
    },
    { leaseStore, runStore },
  );
  assert.equal(release.action, "release_lease");
  assert.equal(release.stopped, true);
});

test("runControllerAutopilotTick seeds the next stage after acceptance", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "controller-seed-"));
  const runStore = await createRunStore(cwd, "accepted");
  const leaseStore = new WorkflowControllerLeaseStore(cwd);
  const manifest = sampleManifest();
  const binding = sampleBinding();
  const now = new Date("2026-07-23T12:00:00.000Z");

  const lease = await leaseStore.acquire("run_123", "controller_a", { now });
  const ledger = await runStore.load("run_123");

  const seeded = await runControllerAutopilotTick(
    {
      workflowRunId: "run_123",
      holderId: "controller_a",
      ledger,
      lease,
      manifest,
      binding,
      now,
    },
    { leaseStore, runStore },
  );

  assert.equal(seeded.action, "seed_next_stage");
  assert.equal(seeded.ledger.stages.spec_review.status, "seeded");
});

test("runControllerAutopilotTick validates one produced stage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "controller-validate-"));
  const runStore = await createRunStore(cwd, "produced");
  const leaseStore = new WorkflowControllerLeaseStore(cwd);
  const manifest = sampleManifest();
  const binding = sampleBinding();
  const now = new Date("2026-07-23T12:00:00.000Z");

  await runStore.recordArtifact("run_123", {
    artifactSchemaVersion: 1,
    workflowRunId: "run_123",
    stageId: "capture_interview",
    producerIssueId: "issue_123",
    producerRunId: "attempt_1",
    attempt: 1,
    adapterBundleHash: "b".repeat(64),
    inputArtifactHashes: [],
    outputPath: "Artifacts/workflows/run_123/00.md",
    outputHash: "c".repeat(64),
    status: "immutable",
  });

  const lease = await leaseStore.acquire("run_123", "controller_a", { now });
  let ledger = await runStore.load("run_123");

  const validated = await runControllerAutopilotTick(
    {
      workflowRunId: "run_123",
      holderId: "controller_a",
      ledger,
      lease,
      manifest,
      binding,
      now,
    },
    { leaseStore, runStore },
  );

  assert.equal(validated.action, "validate_produced_stage");
  assert.equal(validated.ledger.stages.capture_interview.status, "accepted");
});

test("runControllerAutopilotTick stops when another writer holds the lease", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "controller-reject-"));
  const runStore = await createRunStore(cwd);
  const leaseStore = new WorkflowControllerLeaseStore(cwd);
  const manifest = sampleManifest();
  const binding = sampleBinding();
  const now = new Date("2026-07-23T12:00:00.000Z");

  const lease = await leaseStore.acquire("run_123", "holder_a", { now });
  const ledger = await runStore.load("run_123");

  const blocked = await runControllerAutopilotTick(
    {
      workflowRunId: "run_123",
      holderId: "holder_b",
      ledger,
      lease,
      manifest,
      binding,
      now,
    },
    { leaseStore, runStore },
  );

  assert.equal(blocked.action, "stop");
  assert.equal(blocked.reason, "lease_held_by=holder_a");
});

test("runControllerAutopilotTick persists parent summary once per state version", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "controller-persist-"));
  const runStore = await createRunStore(cwd);
  const leaseStore = new WorkflowControllerLeaseStore(cwd);
  const manifest = sampleManifest();
  const binding = sampleBinding();
  const now = new Date("2026-07-23T12:00:00.000Z");
  let writeCount = 0;
  const liveCli = {
    writeParentSummary: async () => {
      writeCount += 1;
      return { workflow_status: "waiting" };
    },
  };

  const lease = await leaseStore.acquire("run_123", "controller_a", { now });
  const ledger = await runStore.load("run_123");

  const persisted = await runControllerAutopilotTick(
    {
      workflowRunId: "run_123",
      holderId: "controller_a",
      ledger,
      lease,
      manifest,
      binding,
      parentIssueId: "parent_123",
      liveCli,
      now,
    },
    { leaseStore, runStore },
  );

  assert.equal(persisted.action, "persist_summary");
  assert.equal(writeCount, 1);
  assert.equal(persisted.lease?.lastPersistedStateVersion, ledger.stateVersion);

  const released = await runControllerAutopilotTick(
    {
      workflowRunId: "run_123",
      holderId: "controller_a",
      ledger: persisted.ledger,
      lease: persisted.lease,
      manifest,
      binding,
      parentIssueId: "parent_123",
      liveCli,
      now,
    },
    { leaseStore, runStore },
  );

  assert.equal(released.action, "release_lease");
  assert.equal(writeCount, 1);
});
