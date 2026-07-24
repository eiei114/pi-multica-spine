import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutopilotTriggerArgs,
  buildIssueAssignArgs,
  buildIssueCreateArgs,
  buildIssueGetArgs,
  buildIssueStatusArgs,
  buildIssueUpdateArgs,
  buildProjectGetArgs,
  buildProjectListArgs,
  buildProjectCreateArgs,
  buildProjectStatusArgs,
  createIssueClient,
  parseIssueRecord,
  parseJsonOutput,
} from "../lib/multica-cli.ts";

test("buildIssueCreateArgs includes parent, stage, project, assignee, and status", () => {
  assert.deepEqual(
    buildIssueCreateArgs({
      title: "Stage seed",
      description: "workflow stage",
      parentIssueId: "parent-1",
      stage: 2,
      projectId: "proj-1",
      assigneeId: "agent-1",
      status: "todo",
    }),
    [
      "issue",
      "create",
      "--title",
      "Stage seed",
      "--output",
      "json",
      "--description",
      "workflow stage",
      "--parent",
      "parent-1",
      "--stage",
      "2",
      "--project",
      "proj-1",
      "--status",
      "todo",
      "--assignee-id",
      "agent-1",
    ],
  );
});

test("buildIssueAssignArgs and buildIssueStatusArgs force json output", () => {
  assert.deepEqual(buildIssueAssignArgs("issue-1", "agent-1"), [
    "issue",
    "assign",
    "issue-1",
    "--to-id",
    "agent-1",
    "--output",
    "json",
  ]);
  assert.deepEqual(buildIssueStatusArgs("issue-1", "in_progress"), [
    "issue",
    "status",
    "issue-1",
    "in_progress",
    "--output",
    "json",
  ]);
});

test("buildIssueGetArgs, buildIssueUpdateArgs, buildProjectGetArgs, buildAutopilotTriggerArgs", () => {
  assert.deepEqual(buildIssueGetArgs("DOT-1"), ["issue", "get", "DOT-1", "--output", "json"]);
  assert.deepEqual(buildIssueUpdateArgs("DOT-1", { status: "done", stage: 3 }), [
    "issue",
    "update",
    "DOT-1",
    "--output",
    "json",
    "--status",
    "done",
    "--stage",
    "3",
  ]);
  assert.deepEqual(buildProjectGetArgs("proj-1"), ["project", "get", "proj-1", "--output", "json"]);
  assert.deepEqual(buildProjectListArgs(), ["project", "list", "--output", "json"]);
  assert.deepEqual(buildProjectCreateArgs({ title: "App", description: "desc", status: "planned" }), ["project", "create", "--title", "App", "--description", "desc", "--status", "planned", "--output", "json"]);
  assert.deepEqual(buildProjectStatusArgs("proj-1", "active"), ["project", "status", "proj-1", "--set", "active", "--output", "json"]);
  assert.deepEqual(buildAutopilotTriggerArgs("auto-1"), ["autopilot", "trigger", "auto-1", "--output", "json"]);
});

test("parseIssueRecord requires id", () => {
  assert.deepEqual(parseIssueRecord('{"id":"abc","identifier":"DOT-9"}').identifier, "DOT-9");
  assert.throws(() => parseIssueRecord('{"identifier":"DOT-9"}'), /expected issue record with id/);
});

test("parseJsonOutput rejects non-object JSON", () => {
  assert.throws(() => parseJsonOutput("[]"), /expected a JSON object/);
});

test("createIssueClient uses injectable runner", async () => {
  const calls = [];
  const client = createIssueClient(async (args) => {
    calls.push(args);
    return {
      exitCode: 0,
      stdout: JSON.stringify({ id: "issue-live-1", identifier: "DOT-42", status: "todo" }),
      stderr: "",
    };
  });
  const issue = await client.create({
    title: "Workflow stage",
    parentIssueId: "parent-1",
    projectId: "proj-1",
    assigneeId: "agent-1",
  });
  assert.equal(issue.id, "issue-live-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "create");
});
