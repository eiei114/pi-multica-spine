import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { checkPrBinding, recommendedPrBodyLine } = await import("../lib/pr-binding-checker.ts");
const { evaluateSpine } = await import("../lib/state-machine.ts");
const { safeIssueIdentifier, SpineStateStore } = await import("../lib/state-store.ts");

test("SpineStateStore binds opaque issue identifiers and preserves canonical ID", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "spine-bind-"));
  const store = new SpineStateStore(cwd);

  const snapshot = await store.bind({ issueIdentifier: "TASK/45 日本語", issueUrl: "https://example.test/issue" });

  assert.equal(snapshot.task.issue.identifier, "TASK/45 日本語");
  assert.match(snapshot.current.taskFile, /^tasks\//);
  assert.match(snapshot.current.taskFile, /\.json$/);
  assert.equal(snapshot.evaluation.status, "BOUND");

  const taskJson = JSON.parse(await readFile(store.taskPath("TASK/45 日本語"), "utf8"));
  assert.equal(taskJson.issue.identifier, "TASK/45 日本語");
});

test("safeIssueIdentifier creates ASCII filenames without changing stored IDs", () => {
  assert.match(safeIssueIdentifier("TASK-45"), /^task-45-[a-f0-9]{8}$/);
  assert.match(safeIssueIdentifier("課題/45"), /^45-[a-f0-9]{8}$|^issue-[a-f0-9]{8}$/);
});

test("SpineStateMachine returns actionable missing items", () => {
  assert.deepEqual(evaluateSpine(undefined).missing, ["active issue identifier"]);

  const base = {
    issue: { identifier: "TASK-45", boundAt: "2026-01-01T00:00:00.000Z" },
    evidence: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const bindingOnly = evaluateSpine(base);
  assert.equal(bindingOnly.status, "BOUND");
  assert.ok(bindingOnly.missing.includes("PR URL"));

  const prLinked = evaluateSpine({
    ...base,
    pr: {
      prUrl: "https://github.com/eiei114/pi-multica-spine/pull/1",
      prNumber: 1,
      prHeadSha: "abc123",
      prBranch: "TASK-45-work-agent-contract",
      writebackRecorded: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  assert.equal(prLinked.status, "PR_LINKED");
  assert.deepEqual(prLinked.missing, ["verification evidence", "handoff"]);

  const evidenceReady = evaluateSpine({
    ...base,
    pr: {
      prUrl: "https://github.com/eiei114/pi-multica-spine/pull/1",
      prNumber: 1,
      prHeadSha: "abc123",
      prBranch: "TASK-45-work-agent-contract",
      writebackRecorded: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
    },
    evidence: [{ kind: "test", summary: "tests passed", timestamp: "2026-01-01T00:00:00.000Z" }],
  });
  assert.equal(evidenceReady.status, "EVIDENCE_READY");
  assert.deepEqual(evidenceReady.missing, ["handoff"]);
});

test("verified state requires issue, PR reference, writeback, evidence, and handoff", () => {
  const task = {
    issue: { identifier: "TASK-45", boundAt: "2026-01-01T00:00:00.000Z" },
    pr: {
      prUrl: "https://github.com/eiei114/pi-multica-spine/pull/1",
      prNumber: 1,
      prHeadSha: "abc123",
      prBranch: "feature/no-issue",
      prBody: "Multica Issue: TASK-45",
      writebackRecorded: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
    },
    evidence: [{ kind: "command", command: "npm run ci", exitCode: 0, summary: "passed", timestamp: "2026-01-01T00:00:00.000Z" }],
    handoff: {
      done: ["Implemented TASK-45"],
      changed: ["lib and extension tools"],
      verification: ["npm run ci passed for https://github.com/eiei114/pi-multica-spine/pull/1"],
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const evaluation = evaluateSpine(task);
  assert.equal(evaluation.status, "VERIFIED");
  assert.equal(evaluation.verified, true);
  assert.deepEqual(evaluation.missing, []);
});

test("PrBindingChecker accepts issue identifier in branch, title, body, or metadata without DOT assumptions", () => {
  assert.equal(checkPrBinding("TASK-45", { prUrl: "u", prBranch: "TASK-45-work", linkedAt: "t" }).ok, true);
  assert.equal(checkPrBinding("TASK-45", { prUrl: "u", prTitle: "TASK-45 contract", linkedAt: "t" }).ok, true);
  assert.equal(checkPrBinding("TASK-45", { prUrl: "u", prBody: recommendedPrBodyLine("TASK-45"), linkedAt: "t" }).ok, true);
  assert.equal(checkPrBinding("ABC-9", { prUrl: "u", metadata: { source: "ABC-9" }, linkedAt: "t" }).ok, true);
  assert.equal(checkPrBinding("TASK-45", { prUrl: "u", prBranch: "feature/nope", linkedAt: "t" }).ok, false);
});

const { checkGitCompletion } = await import("../lib/git-completion-checker.ts");

test("evaluateSpine blocks verified state when git completion blockers exist", () => {
  const task = {
    issue: { identifier: "TASK-45", boundAt: "2026-01-01T00:00:00.000Z" },
    pr: {
      prUrl: "https://github.com/eiei114/pi-multica-spine/pull/1",
      prNumber: 1,
      prHeadSha: "abc123",
      prBranch: "TASK-45-work-agent-contract",
      writebackRecorded: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
    },
    evidence: [{ kind: "command", command: "npm run ci", exitCode: 0, summary: "passed", timestamp: "2026-01-01T00:00:00.000Z" }],
    handoff: {
      done: ["Implemented TASK-45"],
      changed: ["lib and extension tools"],
      verification: ["npm run ci passed for https://github.com/eiei114/pi-multica-spine/pull/1"],
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const evaluation = evaluateSpine(task, {
    checked: true,
    blockers: ["git: local commits not pushed to remote"],
    nextAction: "Push with git push --force-with-lease.",
  });

  assert.equal(evaluation.verified, false);
  assert.equal(evaluation.status, "HANDOFF_READY");
  assert.ok(evaluation.missing.includes("git: local commits not pushed to remote"));
  assert.equal(evaluation.nextAction.tool, "git");
});

test("checkGitCompletion ignores spine state files but detects dirty worktree", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "spine-git-check-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd });
  await writeFile(join(cwd, "README.md"), "# test\n");
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });

  await mkdir(join(cwd, ".multica-spine", "tasks"), { recursive: true });
  await writeFile(join(cwd, ".multica-spine", "current.json"), "{}\n");
  assert.deepEqual(checkGitCompletion(cwd).blockers, []);

  await writeFile(join(cwd, "changed.ts"), "const value = 1;\n");
  assert.ok(checkGitCompletion(cwd).blockers.some((item) => item.startsWith("git: working tree")));
});
