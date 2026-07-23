import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { default: extension, _setMetadataClientForTests } = await import("../extensions/index.ts");

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
    ui: {
      setStatus() {},
    },
  };
}

async function callTool(tools, name, params, ctx) {
  const tool = tools.get(name);
  assert.ok(tool, `${name} registered`);
  const prepared = tool.prepareArguments ? tool.prepareArguments(params) : params;
  return tool.execute("test-call", prepared, undefined, undefined, ctx);
}

test("extension registers MVP tools", () => {
  const fake = createFakePi();
  extension(fake.api);

  assert.deepEqual([...fake.tools.keys()].sort(), [
    "multica_workflow_adapter_migration_apply",
    "multica_workflow_adapter_migration_dry_run",
    "multica_workflow_adapter_migration_rollback",
    "multica_workflow_artifact_record",
    "multica_workflow_autopilot_trigger",
    "multica_workflow_binding_get",
    "multica_workflow_binding_list",
    "multica_workflow_binding_put",
    "multica_workflow_catalog_get",
    "multica_workflow_catalog_list",
    "multica_workflow_catalog_put",
    "multica_workflow_catalog_transition",
    "multica_workflow_controller_tick",
    "multica_workflow_hermes_manifest",
    "multica_workflow_hermes_question_answer",
    "multica_workflow_hermes_review_decide",
    "multica_workflow_parent_summary",
    "multica_workflow_permission_check",
    "multica_workflow_question_record",
    "multica_workflow_route_preflight",
    "multica_workflow_run_context",
    "multica_workflow_run_create",
    "multica_workflow_stage_seed",
    "multica_workflow_stage_transition",
    "multica_workflow_telemetry_record",
    "multica_spine_add_evidence",
    "multica_spine_bind",
    "multica_spine_context",
    "multica_spine_handoff",
    "multica_spine_link_pr",
    "multica_spine_metadata_delete",
    "multica_spine_metadata_list",
    "multica_spine_metadata_set",
    "multica_spine_next",
    "multica_spine_verify",
  ].sort());
});

test("extension wraps git network bash commands with transport guard", async () => {
  const fake = createFakePi();
  extension(fake.api);

  const handler = fake.handlers.get("tool_call");
  assert.ok(handler);

  const event = {
    toolName: "bash",
    toolCallId: "call-1",
    input: { command: "git push origin HEAD" },
  };
  await handler(event, fakeCtx("/tmp"));

  assert.match(event.input.command, /git-network-guard-cli\.mjs/);
  assert.equal(event.input.timeout, 600);
});

test("extension preserves existing bash timeout for git network commands", async () => {
  const fake = createFakePi();
  extension(fake.api);

  const handler = fake.handlers.get("tool_call");
  assert.ok(handler);

  const event = {
    toolName: "bash",
    toolCallId: "call-2",
    input: { command: "git fetch origin", timeout: 120 },
  };
  await handler(event, fakeCtx("/tmp"));

  assert.match(event.input.command, /git-network-guard-cli\.mjs/);
  assert.equal(event.input.timeout, 120);
});

test("extension injects short Multica Work Agent Contract only", async () => {
  const fake = createFakePi();
  extension(fake.api);

  const handler = fake.handlers.get("before_agent_start");
  assert.ok(handler);
  const result = await handler({ systemPrompt: "base prompt" });

  assert.match(result.systemPrompt, /You are acting as a Multica Work Agent/);
  assert.match(result.systemPrompt, /multica_spine_verify/);
  assert.doesNotMatch(result.systemPrompt, /Problem Statement/);
  assert.doesNotMatch(result.systemPrompt, /Review Sentinel/);
});

test("bind → next → link_pr → add_evidence → handoff → verify succeeds", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-extension-"));
  const ctx = fakeCtx(cwd);

  let response = await callTool(fake.tools, "multica_spine_bind", { issue_identifier: "TASK-45" }, ctx);
  assert.equal(response.details.evaluation.status, "BOUND");

  response = await callTool(fake.tools, "multica_spine_next", {}, ctx);
  assert.equal(response.details.evaluation.nextAction.tool, "multica_spine_link_pr");

  response = await callTool(fake.tools, "multica_spine_link_pr", {
    pr_url: "https://github.com/eiei114/pi-multica-spine/pull/1",
    pr_number: 1,
    pr_head_sha: "abc123",
    pr_branch: "TASK-45-work-agent-contract",
    writeback_recorded: true,
  }, ctx);
  assert.equal(response.details.evaluation.status, "PR_LINKED");

  response = await callTool(fake.tools, "multica_spine_add_evidence", {
    kind: "test",
    command: "npm run ci",
    exitCode: 0,
    summary: "passed",
  }, ctx);
  assert.equal(response.details.task.evidence.length, 1);

  response = await callTool(fake.tools, "multica_spine_handoff", {
    done: ["Implemented TASK-45"],
    changed: ["extensions/index.ts", "lib/state-store.ts"],
    verification: ["npm run ci passed for https://github.com/eiei114/pi-multica-spine/pull/1"],
  }, ctx);
  assert.equal(response.details.evaluation.status, "HANDOFF_READY");
  assert.equal(response.details.evaluation.verified, false);

  response = await callTool(fake.tools, "multica_spine_verify", {}, ctx);
  assert.equal(response.details.evaluation.verified, true);
  assert.equal(response.details.evaluation.status, "VERIFIED");
});

function fakeMetadataClient() {
  const calls = [];
  const canned = { pr_url: "https://example/pr/9", count: 3 };
  return {
    calls,
    client: {
      async list(issueIdentifier) {
        calls.push({ method: "list", issueIdentifier });
        return { ...canned };
      },
      async set(issueIdentifier, key, value, type) {
        calls.push({ method: "set", issueIdentifier, key, value, type });
        return { ...canned, [key]: value };
      },
      async delete(issueIdentifier, key) {
        calls.push({ method: "delete", issueIdentifier, key });
        const next = { ...canned };
        delete next[key];
        return next;
      },
    },
  };
}

test("metadata_list uses explicit issueIdentifier and returns parsed metadata", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-metadata-"));
  const ctx = fakeCtx(cwd);
  const { calls, client } = fakeMetadataClient();
  _setMetadataClientForTests(client);

  const response = await callTool(fake.tools, "multica_spine_metadata_list", { issueIdentifier: "DOT-42" }, ctx);

  assert.equal(calls[0].method, "list");
  assert.equal(calls[0].issueIdentifier, "DOT-42");
  assert.equal(response.details.action, "metadata_list");
  assert.equal(response.details.issueIdentifier, "DOT-42");
  assert.equal(response.details.metadata.pr_url, "https://example/pr/9");
  assert.match(response.content[0].text, /issue: DOT-42/);
  assert.match(response.content[0].text, /keys: 2/);
});

test("metadata tools fall back to the bound issue identifier", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-metadata-fallback-"));
  const ctx = fakeCtx(cwd);
  const { calls, client } = fakeMetadataClient();
  _setMetadataClientForTests(client);

  await callTool(fake.tools, "multica_spine_bind", { issue_identifier: "DOT-777" }, ctx);
  await callTool(fake.tools, "multica_spine_metadata_list", {}, ctx);

  assert.equal(calls[0].method, "list");
  assert.equal(calls[0].issueIdentifier, "DOT-777");
});

test("metadata_list rejects when no issue is bound and none is passed", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-metadata-unbound-"));
  const ctx = fakeCtx(cwd);
  const { client } = fakeMetadataClient();
  _setMetadataClientForTests(client);

  await assert.rejects(
    () => callTool(fake.tools, "multica_spine_metadata_list", {}, ctx),
    /issueIdentifier is required/,
  );
});

test("metadata_set forwards key/value/type to the client", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-metadata-set-"));
  const ctx = fakeCtx(cwd);
  const { calls, client } = fakeMetadataClient();
  _setMetadataClientForTests(client);

  const response = await callTool(
    fake.tools,
    "multica_spine_metadata_set",
    { issue_identifier: "DOT-42", key: "deploy_url", value: "https://x", type: "string" },
    ctx,
  );

  assert.equal(calls[0].method, "set");
  assert.equal(calls[0].issueIdentifier, "DOT-42");
  assert.equal(calls[0].key, "deploy_url");
  assert.equal(calls[0].value, "https://x");
  assert.equal(calls[0].type, "string");
  assert.equal(response.details.metadata.deploy_url, "https://x");
});

test("metadata_delete forwards key to the client", async () => {
  const fake = createFakePi();
  extension(fake.api);
  const cwd = await mkdtemp(join(tmpdir(), "spine-metadata-delete-"));
  const ctx = fakeCtx(cwd);
  const { calls, client } = fakeMetadataClient();
  _setMetadataClientForTests(client);

  const response = await callTool(
    fake.tools,
    "multica_spine_metadata_delete",
    { issueIdentifier: "DOT-42", key: "stale_key" },
    ctx,
  );

  assert.equal(calls[0].method, "delete");
  assert.equal(calls[0].issueIdentifier, "DOT-42");
  assert.equal(calls[0].key, "stale_key");
  assert.equal(response.details.action, "metadata_delete");
});
