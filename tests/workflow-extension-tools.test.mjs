import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { default: extension, _setWorkflowLiveCliForTests } = await import("../extensions/index.ts");
import { buildWorkflowLiveCli } from "../lib/workflow-live-cli.ts";
import { createAutopilotClient, createIssueClient, createMetadataClient, createProjectClient } from "../lib/multica-cli.ts";

function installFixtureWorkflowLiveCli() {
  const runner = async (args) => {
    if (args[0] === "project") {
      return { exitCode: 0, stdout: JSON.stringify({ id: args[2] }), stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "create") {
      return { exitCode: 0, stdout: JSON.stringify({ id: "issue_fixture_1", status: "todo" }), stderr: "" };
    }
    if (args[0] === "issue" && args[2] === "metadata") {
      return { exitCode: 0, stdout: "{}", stderr: "" };
    }
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  _setWorkflowLiveCliForTests(
    buildWorkflowLiveCli(
      createIssueClient(runner),
      createMetadataClient(runner),
      createProjectClient(runner),
      createAutopilotClient(runner),
    ),
  );
}

installFixtureWorkflowLiveCli();

function createFakePi() {
  const tools = new Map();
  const handlers = new Map();
  return {
    tools,
    handlers,
    api: {
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
      on(event, handler) {
        handlers.set(event, handler);
      },
    },
  };
}

function fakeCtx(cwd) {
  return {
    cwd,
    hasUI: false,
    ui: { setStatus() {} },
  };
}

async function callTool(tools, name, params, ctx) {
  const tool = tools.get(name);
  assert.ok(tool, `${name} registered`);
  const prepared = tool.prepareArguments ? tool.prepareArguments(params) : params;
  return tool.execute("test-call", prepared, undefined, undefined, ctx);
}

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
    projectGrants: ["design_doc", "implementation_spec"],
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

test("workflow adapter tools can persist catalog, binding, run, stage, artifact, and question state", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-workflow-tools-"));
  const ctx = fakeCtx(cwd);

  let response = await callTool(fake.tools, "multica_workflow_catalog_put", { manifest: sampleManifest() }, ctx);
  assert.equal(response.details.entries[0].status, "quarantined");

  response = await callTool(fake.tools, "multica_workflow_catalog_transition", {
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    status: "audited",
  }, ctx);
  assert.equal(response.details.entries[0].status, "audited");

  response = await callTool(fake.tools, "multica_workflow_catalog_transition", {
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    status: "active",
  }, ctx);
  assert.equal(response.details.entries[0].status, "active");

  response = await callTool(fake.tools, "multica_workflow_binding_put", { binding: sampleBinding() }, ctx);
  assert.equal(response.details.bindings[0].multicaProjectId, "proj_123");

  response = await callTool(fake.tools, "multica_workflow_run_create", {
    projectIdOrKey: "proj_123",
    workflowRunId: "run_123",
  }, ctx);
  assert.equal(response.details.ledger.currentStageId, "capture_interview");

  response = await callTool(fake.tools, "multica_workflow_stage_transition", {
    workflowRunId: "run_123",
    stageId: "capture_interview",
    status: "produced",
  }, ctx);
  assert.equal(response.details.ledger.stages.capture_interview.status, "produced");

  response = await callTool(fake.tools, "multica_workflow_artifact_record", {
    workflowRunId: "run_123",
    artifact: {
      artifactSchemaVersion: 1,
      workflowRunId: "run_123",
      stageId: "capture_interview",
      producerIssueId: "issue_123",
      producerRunId: "run_attempt_1",
      attempt: 1,
      adapterBundleHash: "b".repeat(64),
      inputArtifactHashes: [],
      outputPath: "Artifacts/workflows/run_123/00-idea-capture.md",
      outputHash: "c".repeat(64),
      status: "immutable",
    },
  }, ctx);
  assert.equal(response.details.ledger.artifacts.length, 1);

  response = await callTool(fake.tools, "multica_workflow_stage_transition", {
    workflowRunId: "run_123",
    stageId: "capture_interview",
    status: "accepted",
  }, ctx);
  assert.equal(response.details.ledger.stages.capture_interview.status, "accepted");

  response = await callTool(fake.tools, "multica_workflow_question_record", {
    workflowRunId: "run_123",
    question: {
      questionId: "q1",
      questionTaskId: "task_1",
      resolverAgentId: "agent_research",
      answerStatus: "researched",
      sourceRefs: ["https://example.test"],
      confidence: "high",
      answerHash: "d".repeat(64),
    },
  }, ctx);
  assert.equal(response.details.ledger.questions.length, 1);

  response = await callTool(fake.tools, "multica_workflow_parent_summary", {
    projectIdOrKey: "proj_123",
    workflowRunId: "run_123",
    workflowStage: "capture_interview",
    workflowStatus: "waiting",
    workflowStatePointer: ".multica-spine/workflow-runs/run_123/state-ledger.json",
  }, ctx);
  assert.equal(response.details.summary.workflow_adapter_id, "hermes-idea-workflow");
  assert.match(response.details.summary.workflow_state_pointer, /^\.multica-spine\/workflow-runs\//);
});

test("binding rejects inactive catalog entries", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-workflow-inactive-"));
  const ctx = fakeCtx(cwd);

  await callTool(fake.tools, "multica_workflow_catalog_put", { manifest: sampleManifest() }, ctx);
  await assert.rejects(
    () => callTool(fake.tools, "multica_workflow_binding_put", { binding: sampleBinding() }, ctx),
    /Cannot bind inactive workflow adapter/,
  );
});

test("artifact recording rejects paths outside the binding artifact root", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-workflow-artifact-root-"));
  const ctx = fakeCtx(cwd);

  await callTool(fake.tools, "multica_workflow_catalog_put", { manifest: sampleManifest() }, ctx);
  await callTool(fake.tools, "multica_workflow_catalog_transition", {
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    status: "audited",
  }, ctx);
  await callTool(fake.tools, "multica_workflow_catalog_transition", {
    adapterId: "hermes-idea-workflow",
    adapterVersion: 1,
    status: "active",
  }, ctx);
  await callTool(fake.tools, "multica_workflow_binding_put", { binding: sampleBinding() }, ctx);
  await callTool(fake.tools, "multica_workflow_run_create", { projectIdOrKey: "proj_123", workflowRunId: "run_123" }, ctx);

  await assert.rejects(
    () => callTool(fake.tools, "multica_workflow_artifact_record", {
      workflowRunId: "run_123",
      artifact: {
        artifactSchemaVersion: 1,
        workflowRunId: "run_123",
        stageId: "capture_interview",
        producerIssueId: "issue_123",
        producerRunId: "run_attempt_1",
        attempt: 1,
        adapterBundleHash: "b".repeat(64),
        inputArtifactHashes: [],
        outputPath: "../outside.md",
        outputHash: "c".repeat(64),
        status: "immutable",
      },
    }, ctx),
    /must stay under binding artifactRoot/,
  );
});

test("stage acceptance ignores artifacts from prior attempts", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-workflow-attempt-artifact-"));
  const ctx = fakeCtx(cwd);

  await callTool(fake.tools, "multica_workflow_catalog_put", { manifest: sampleManifest() }, ctx);
  for (const status of ["audited", "active"]) {
    await callTool(fake.tools, "multica_workflow_catalog_transition", {
      adapterId: "hermes-idea-workflow",
      adapterVersion: 1,
      status,
    }, ctx);
  }
  await callTool(fake.tools, "multica_workflow_binding_put", { binding: sampleBinding() }, ctx);
  await callTool(fake.tools, "multica_workflow_run_create", { projectIdOrKey: "proj_123", workflowRunId: "run_123" }, ctx);
  await callTool(fake.tools, "multica_workflow_stage_transition", {
    workflowRunId: "run_123",
    stageId: "capture_interview",
    status: "produced",
  }, ctx);
  await callTool(fake.tools, "multica_workflow_artifact_record", {
    workflowRunId: "run_123",
    artifact: {
      artifactSchemaVersion: 1,
      workflowRunId: "run_123",
      stageId: "capture_interview",
      producerIssueId: "issue_123",
      producerRunId: "run_attempt_1",
      attempt: 1,
      adapterBundleHash: "b".repeat(64),
      inputArtifactHashes: [],
      outputPath: "Artifacts/workflows/run_123/attempt-1.md",
      outputHash: "c".repeat(64),
      status: "immutable",
    },
  }, ctx);
  await callTool(fake.tools, "multica_workflow_stage_transition", {
    workflowRunId: "run_123",
    stageId: "capture_interview",
    status: "retrying",
  }, ctx);
  await callTool(fake.tools, "multica_workflow_stage_seed", {
    workflowRunId: "run_123",
    stageId: "capture_interview",
    attempt: 2,
  }, ctx);
  await callTool(fake.tools, "multica_workflow_stage_transition", {
    workflowRunId: "run_123",
    stageId: "capture_interview",
    status: "produced",
  }, ctx);

  await assert.rejects(
    () => callTool(fake.tools, "multica_workflow_stage_transition", {
      workflowRunId: "run_123",
      stageId: "capture_interview",
      status: "accepted",
    }, ctx),
    /Cannot accept stage without produced status and artifact/,
  );
});

test("workflow permission check surfaces granted and blocked capabilities", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-workflow-permission-"));
  const ctx = fakeCtx(cwd);

  const response = await callTool(fake.tools, "multica_workflow_permission_check", {
    adapterRequest: ["design_doc", "release"],
    projectGrant: ["design_doc", "release"],
    stageGrant: ["design_doc"],
    issueBoundary: ["design_doc"],
    agentCapability: ["design_doc"],
  }, ctx);

  assert.deepEqual(response.details.granted, ["design_doc"]);
  assert.deepEqual(response.details.blocked, ["release"]);
});
