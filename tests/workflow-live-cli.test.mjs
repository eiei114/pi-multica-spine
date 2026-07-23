import assert from "node:assert/strict";
import test from "node:test";

import { createParentWorkflowIssueSummary } from "../lib/project-workflow-binding.ts";
import {
  buildWorkflowLiveCli,
  createWorkflowLiveCli,
  parentSummaryMetadataEntries,
  stageWritebackMetadataEntries,
  WORKFLOW_COMPLETION_AUTHORITY,
  WorkflowProductGapError,
} from "../lib/workflow-live-cli.ts";
import { seedWorkflowStageLive } from "../lib/workflow-controller.ts";
import {
  createAutopilotClient,
  createIssueClient,
  createMetadataClient,
  createProjectClient,
} from "../lib/multica-cli.ts";

const sampleBinding = {
  schemaVersion: 1,
  multicaProjectId: "415010b1-f28a-4ae4-9042-ddeb00800029",
  projectKey: "SPINE",
  adapterId: "hermes-idea-workflow",
  adapterVersion: 1,
  artifactRoot: "Artifacts/workflows",
  projectGrants: ["design_doc"],
  humanOwnedActions: ["release"],
  roleRoutes: {
    interview: { agentId: "b37ce518-3592-4b31-ad02-df6a5bdd267e" },
  },
  autoAdvancePolicy: "autonomous",
  executionMode: "autonomous_until_final",
  humanGate: "start_and_final",
  deliveryPolicy: {
    prRequired: true,
    releaseAllowed: true,
    productionAllowed: false,
    destructiveAllowed: false,
  },
};

function fixtureRunner() {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "create") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ id: "stage-issue-1", identifier: "DOT-9001", status: "todo", assignee_id: "b37ce518-3592-4b31-ad02-df6a5bdd267e" }),
        stderr: "",
      };
    }
    if (args[0] === "issue" && args[1] === "metadata" && args[2] === "set") {
      const keyIndex = args.indexOf("--key");
      const valueIndex = args.indexOf("--value");
      const key = keyIndex >= 0 ? args[keyIndex + 1] : "unknown";
      const value = valueIndex >= 0 ? args[valueIndex + 1] : "";
      return { exitCode: 0, stdout: JSON.stringify({ [key]: value }), stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "metadata" && args[2] === "list") {
      return { exitCode: 0, stdout: JSON.stringify({ workflow_run_id: "run-live-1", completion_authority: WORKFLOW_COMPLETION_AUTHORITY }), stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "status") {
      return { exitCode: 0, stdout: JSON.stringify({ id: args[2], status: args[3] }), stderr: "" };
    }
    if (args[0] === "project") {
      return { exitCode: 0, stdout: JSON.stringify({ id: args[2], title: "pi-multica-spine Maintenance" }), stderr: "" };
    }
    if (args[0] === "autopilot") {
      return { exitCode: 0, stdout: JSON.stringify({ autopilot_id: args[2], status: "triggered" }), stderr: "" };
    }
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  return { calls, runner };
}

test("parentSummaryMetadataEntries always sets completion_authority=workflow_controller", () => {
  const summary = createParentWorkflowIssueSummary({
    binding: sampleBinding,
    workflowRunId: "run-live-1",
    workflowBundleHash: "a".repeat(64),
    workflowStage: "capture_interview",
    workflowStatus: "waiting",
    workflowStatePointer: ".multica-spine/workflow-runs/run-live-1/state-ledger.json",
    workflowStateHash: "b".repeat(64),
  });
  const entries = parentSummaryMetadataEntries(summary);
  assert.equal(entries.completion_authority, WORKFLOW_COMPLETION_AUTHORITY);
  assert.equal(entries.workflow_run_id, "run-live-1");
  assert.equal(Object.keys(entries).at(-1), "workflow_state_hash");
});

test("stageWritebackMetadataEntries includes PR and artifact lineage keys", () => {
  const entries = stageWritebackMetadataEntries({
    issueIdentifier: "stage-issue-1",
    prUrl: "https://github.com/eiei114/pi-multica-spine/pull/99",
    prNumber: 99,
    prHeadSha: "abc123",
    prBranch: "feat/live",
    artifact: {
      artifactSchemaVersion: 1,
      workflowRunId: "run-live-1",
      stageId: "capture_interview",
      producerIssueId: "stage-issue-1",
      producerRunId: "run_attempt_1",
      attempt: 1,
      adapterBundleHash: "a".repeat(64),
      inputArtifactHashes: [],
      outputPath: "Artifacts/workflows/run-live-1/00.md",
      outputHash: "c".repeat(64),
      status: "immutable",
    },
  });
  assert.equal(entries.completion_authority, WORKFLOW_COMPLETION_AUTHORITY);
  assert.equal(entries.pr_number, 99);
  assert.equal(entries.workflow_artifact_output_hash, "c".repeat(64));
});

test("stageWritebackMetadataEntries prevents extra metadata from overriding completion authority", () => {
  const entries = stageWritebackMetadataEntries({
    issueIdentifier: "stage-issue-1",
    prUrl: "https://example.test/expected",
    extra: {
      completion_authority: "worker",
      pr_url: "https://example.test/spoofed",
      workflow_artifact_output_hash: "d".repeat(64),
    },
  });
  assert.equal(entries.completion_authority, WORKFLOW_COMPLETION_AUTHORITY);
  assert.equal(entries.pr_url, "https://example.test/expected");
  assert.equal(entries.workflow_artifact_output_hash, undefined);
});

test("createWorkflowLiveCli creates stage issues and writes parent summary via fixture runner", async () => {
  const { calls, runner } = fixtureRunner();
  const liveCli = createWorkflowLiveCli(runner);
  await liveCli.verifyProject(sampleBinding.multicaProjectId);
  const issue = await liveCli.createStageIssue({
    title: "Workflow stage: capture_interview",
    parentIssueId: "parent-issue-1",
    projectId: sampleBinding.multicaProjectId,
    assigneeId: sampleBinding.roleRoutes.interview.agentId,
  });
  assert.equal(issue.id, "stage-issue-1");
  const summary = createParentWorkflowIssueSummary({
    binding: sampleBinding,
    workflowRunId: "run-live-1",
    workflowBundleHash: "a".repeat(64),
    workflowStage: "capture_interview",
    workflowStatus: "waiting",
    workflowStatePointer: ".multica-spine/workflow-runs/run-live-1/state-ledger.json",
    workflowStateHash: "b".repeat(64),
  });
  await liveCli.writeParentSummary("parent-issue-1", summary);
  assert.equal(summary.completion_authority, WORKFLOW_COMPLETION_AUTHORITY);
  const runMetadata = await liveCli.readRunMetadata("parent-issue-1");
  assert.equal(runMetadata.completion_authority, WORKFLOW_COMPLETION_AUTHORITY);
  const autopilot = await liveCli.triggerAutopilot("auto-1");
  assert.equal(autopilot.status, "triggered");
  assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "create"));
  assert.ok(calls.some((args) => args[0] === "autopilot" && args[1] === "trigger"));
});

test("buildWorkflowLiveCli transitions stage issue status through issue client", async () => {
  const { calls, runner } = fixtureRunner();
  const liveCli = buildWorkflowLiveCli(
    createIssueClient(runner),
    createMetadataClient(runner),
    createProjectClient(runner),
    createAutopilotClient(runner),
  );
  const issue = await liveCli.transitionStageIssue("stage-issue-1", "in_progress");
  assert.equal(issue.status, "in_progress");
  assert.deepEqual(calls.find((args) => args[1] === "status"), ["issue", "status", "stage-issue-1", "in_progress", "--output", "json"]);
});

test("seedWorkflowStageLive writes controller metadata before assigning the worker", async () => {
  const calls = [];
  const liveCli = {
    async getIssue(issueIdentifier) {
      calls.push({ action: "get-parent", issueIdentifier });
      return { id: issueIdentifier, project_id: sampleBinding.multicaProjectId };
    },
    async createStageIssue(input) {
      calls.push({ action: "create", input });
      return { id: "stage-issue-1", identifier: "DOT-9001" };
    },
    async writeStageWriteback(input) {
      calls.push({ action: "writeback", input });
      return {};
    },
    async assignStageIssue(issueIdentifier, assigneeId) {
      calls.push({ action: "assign", issueIdentifier, assigneeId });
      return { id: issueIdentifier, assignee_id: assigneeId };
    },
  };
  const ledger = { workflowRunId: "run-live-1", adapterBundleHash: "a".repeat(64), stages: {} };
  const manifest = {
    stages: [{
      stageId: "capture_interview",
      role: "interview",
      sourceBundle: "hermes-agent-idea-workflow",
      instructionRefs: ["idea-superpowers-suite/SKILL.md"],
      outputs: ["00-idea-capture.md"],
    }],
  };

  const seeded = await seedWorkflowStageLive({
    ledger,
    manifest,
    binding: sampleBinding,
    parentIssueId: "parent-issue-1",
    liveCli,
  });

  assert.equal(seeded.issueId, "stage-issue-1");
  assert.deepEqual(calls.map((call) => call.action), ["get-parent", "create", "writeback", "assign"]);
  assert.equal(calls[1].input.stage, 1);
  assert.equal(calls[1].input.assigneeId, undefined);
  assert.match(calls[1].input.description, /source_bundle=hermes-agent-idea-workflow/);
  assert.match(calls[1].input.description, /instruction_refs=idea-superpowers-suite\/SKILL\.md/);
  assert.equal(calls[2].input.extra.completion_authority, WORKFLOW_COMPLETION_AUTHORITY);
});

test("seedWorkflowStageLive rejects a parent issue from another project before creation", async () => {
  let created = false;
  const liveCli = {
    async getIssue(issueIdentifier) {
      return { id: issueIdentifier, project_id: "other-project" };
    },
    async createStageIssue() {
      created = true;
      return { id: "stage-issue-1" };
    },
  };

  await assert.rejects(
    () => seedWorkflowStageLive({
      ledger: { workflowRunId: "run-live-1", stages: {} },
      manifest: { stages: [{ stageId: "capture_interview", role: "interview" }] },
      binding: sampleBinding,
      parentIssueId: "parent-issue-1",
      liveCli,
    }),
    /parent issue project mismatch/,
  );
  assert.equal(created, false);
});

test("WorkflowProductGapError only wraps missing CLI capabilities, not missing resources", async () => {
  const missingCapability = createWorkflowLiveCli(async () => {
    throw new Error("unknown command metadata");
  });
  await assert.rejects(
    () => missingCapability.readRunMetadata("DOT-1"),
    (error) => error instanceof WorkflowProductGapError && error.capability === "issue.metadata.list",
  );

  const missingResource = createWorkflowLiveCli(async () => {
    throw new Error("project not found: missing-project");
  });
  await assert.rejects(
    () => missingResource.verifyProject("missing-project"),
    (error) => !(error instanceof WorkflowProductGapError) && /project not found/.test(error.message),
  );
});
