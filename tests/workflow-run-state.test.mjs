import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  WorkflowRunStateStore,
  hashWorkflowRunLedger,
  stageAttemptKey,
} = await import("../lib/workflow-run-state.ts");

test("WorkflowRunStateStore creates a ledger with an initial seeded stage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-run-state-"));
  const store = new WorkflowRunStateStore(cwd);

  const ledger = await store.create({
    workflowRunId: "run_123",
    multicaProjectId: "proj_123",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    adapterBundleHash: "a".repeat(64),
    executionMode: "autonomous_until_final",
    initialStageId: "capture_interview",
  });

  assert.equal(ledger.workflowStatus, "waiting");
  assert.equal(ledger.stages.capture_interview.status, "seeded");
  assert.equal(stageAttemptKey("run_123", "capture_interview", 1), "run_123:capture_interview:1");
});

test("WorkflowRunStateStore keeps arbitrary run identifiers inside its state root", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-run-path-safety-"));
  const store = new WorkflowRunStateStore(cwd);
  const path = store.ledgerPath("../../escape");

  assert.ok(path.startsWith(store.root));
  assert.doesNotMatch(path, /\.\.\/|\.\.\\/);
});

test("WorkflowRunStateStore records stage updates, artifacts, and question answers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-run-state-update-"));
  const store = new WorkflowRunStateStore(cwd);
  await store.create({
    workflowRunId: "run_123",
    multicaProjectId: "proj_123",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    adapterBundleHash: "a".repeat(64),
    executionMode: "interactive",
    initialStageId: "capture_interview",
  });

  await store.upsertStage("run_123", {
    stageId: "capture_interview",
    status: "produced",
    attempt: 1,
    issueId: "issue_123",
    assignedAgentId: "agent_123",
    artifactHashes: [],
  });

  await store.recordArtifact("run_123", {
    artifactSchemaVersion: 1,
    workflowRunId: "run_123",
    stageId: "capture_interview",
    producerIssueId: "issue_123",
    producerRunId: "run_attempt_1",
    attempt: 1,
    adapterBundleHash: "a".repeat(64),
    inputArtifactHashes: [],
    outputPath: "Artifacts/workflows/run_123/00-idea-capture.md",
    outputHash: "b".repeat(64),
    status: "immutable",
  });

  const updated = await store.recordQuestion("run_123", {
    questionId: "q1",
    questionTaskId: "issue_question_1",
    resolverAgentId: "agent_research",
    answerStatus: "researched",
    sourceRefs: ["https://example.test"],
    confidence: "medium",
    answerHash: "c".repeat(64),
  });

  assert.equal(updated.artifacts.length, 1);
  assert.equal(updated.questions.length, 1);
  assert.ok(updated.stages.capture_interview.artifactHashes.includes("b".repeat(64)));
  assert.equal(hashWorkflowRunLedger(updated).length, 64);
});

test("WorkflowRunStateStore rejects cross-run artifacts and conflicting question answers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-run-state-integrity-"));
  const store = new WorkflowRunStateStore(cwd);
  await store.create({
    workflowRunId: "run_123",
    multicaProjectId: "proj_123",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    adapterBundleHash: "a".repeat(64),
    executionMode: "interactive",
    initialStageId: "capture_interview",
  });

  await assert.rejects(
    () => store.recordArtifact("run_123", {
      artifactSchemaVersion: 1,
      workflowRunId: "run_other",
      stageId: "capture_interview",
      producerIssueId: "issue_123",
      producerRunId: "attempt_1",
      attempt: 1,
      adapterBundleHash: "a".repeat(64),
      inputArtifactHashes: [],
      outputPath: "Artifacts/run/00.md",
      outputHash: "b".repeat(64),
      status: "immutable",
    }),
    /Artifact workflow run mismatch/,
  );

  const question = {
    questionId: "q1",
    questionTaskId: "task_1",
    resolverAgentId: "agent_1",
    answerStatus: "researched",
    sourceRefs: [],
    confidence: "high",
    answerHash: "c".repeat(64),
  };
  await store.recordQuestion("run_123", question);
  await store.recordQuestion("run_123", question);
  await assert.rejects(
    () => store.recordQuestion("run_123", { ...question, answerHash: "d".repeat(64) }),
    /already has a different answer hash/,
  );
});

test("WorkflowRunStateStore rejects encoded path escapes and tolerates reordered duplicate envelopes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-run-state-artifact-safety-"));
  const store = new WorkflowRunStateStore(cwd);
  await store.create({
    workflowRunId: "run_123",
    multicaProjectId: "proj_123",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    adapterBundleHash: "a".repeat(64),
    executionMode: "interactive",
    initialStageId: "capture_interview",
  });

  const artifact = {
    artifactSchemaVersion: 1,
    workflowRunId: "run_123",
    stageId: "capture_interview",
    producerIssueId: "issue_123",
    producerRunId: "attempt_1",
    attempt: 1,
    adapterBundleHash: "a".repeat(64),
    inputArtifactHashes: [],
    outputPath: "Artifacts/run/00.md",
    outputHash: "b".repeat(64),
    status: "immutable",
  };

  await assert.rejects(
    () => store.recordArtifact("run_123", { ...artifact, outputPath: "Artifacts\\..\\..\\secret.txt" }),
    /must be project-relative/,
  );
  await store.recordArtifact("run_123", artifact);
  const reorderedArtifact = {
    status: artifact.status,
    outputHash: artifact.outputHash,
    outputPath: artifact.outputPath,
    inputArtifactHashes: artifact.inputArtifactHashes,
    adapterBundleHash: artifact.adapterBundleHash,
    attempt: artifact.attempt,
    producerRunId: artifact.producerRunId,
    producerIssueId: artifact.producerIssueId,
    stageId: artifact.stageId,
    workflowRunId: artifact.workflowRunId,
    artifactSchemaVersion: artifact.artifactSchemaVersion,
  };
  const ledger = await store.recordArtifact("run_123", reorderedArtifact);
  assert.equal(ledger.artifacts.length, 1);
});

test("WorkflowRunStateStore serializes concurrent mutations and records status events", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-run-state-concurrency-"));
  const store = new WorkflowRunStateStore(cwd);
  await store.create({
    workflowRunId: "run_123",
    multicaProjectId: "proj_123",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    adapterBundleHash: "a".repeat(64),
    executionMode: "interactive",
  });

  await Promise.all(Array.from({ length: 8 }, (_, index) => store.recordQuestion("run_123", {
    questionId: `q${index}`,
    questionTaskId: `task_${index}`,
    resolverAgentId: "agent_1",
    answerStatus: "researched",
    sourceRefs: [],
    confidence: "high",
    answerHash: index.toString(16).padStart(64, "0"),
  })));

  const completed = await store.setWorkflowStatus("run_123", "completed");
  const statusEvents = completed.events.filter((event) => event.eventType === "workflow_status_changed");
  assert.equal(completed.questions.length, 8);
  assert.equal(statusEvents.length, 1);
  assert.deepEqual(statusEvents[0].details, {
    workflowRunId: "run_123",
    oldStatus: "pending",
    newStatus: "completed",
  });
  const unchanged = await store.setWorkflowStatus("run_123", "completed");
  assert.equal(unchanged.events.filter((event) => event.eventType === "workflow_status_changed").length, 1);
  assert.ok((await readdir(store.runRootPath("run_123"))).every((name) => !name.endsWith(".lock") && !name.endsWith(".tmp")));
});

test("WorkflowRunStateStore rejects create calls with a different initial stage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-run-state-create-idempotency-"));
  const store = new WorkflowRunStateStore(cwd);
  const input = {
    workflowRunId: "run_123",
    multicaProjectId: "proj_123",
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    adapterBundleHash: "a".repeat(64),
    executionMode: "interactive",
    initialStageId: "capture_interview",
  };
  await store.create(input);
  await store.create(input);
  await assert.rejects(
    () => store.create({ ...input, initialStageId: "spec_review" }),
    /different creation metadata/,
  );
});
