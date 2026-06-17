import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { default: extension } = await import("../extensions/index.ts");

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
    "multica_spine_add_evidence",
    "multica_spine_bind",
    "multica_spine_context",
    "multica_spine_handoff",
    "multica_spine_link_pr",
    "multica_spine_next",
    "multica_spine_verify",
  ]);
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
  assert.equal(response.details.evaluation.status, "VERIFIED");

  response = await callTool(fake.tools, "multica_spine_verify", {}, ctx);
  assert.equal(response.details.evaluation.verified, true);
  assert.equal(response.details.evaluation.status, "VERIFIED");
});
