import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  LOCAL_IMPORT_CLOSURE_INSTRUCTION,
  checkLocalImportClosure,
  discoverLocalIssuePath,
  frontmatterMatchesIssue,
  isReadyForMulticaImport,
  parseFrontmatterValue,
} = await import("../lib/local-import-closure-checker.ts");
const { evaluateSpine } = await import("../lib/state-machine.ts");

const OPEN_ISSUE = `---
title: Example issue
ready_for_multica: true
multica_issue: DOT-99
multica_issue_id: 11111111-1111-1111-1111-111111111111
---
# Example
`;

const CLOSED_ISSUE = `---
title: Example issue
ready_for_multica: false
multica_issue: DOT-99
multica_issue_id: 11111111-1111-1111-1111-111111111111
---
# Example
`;

test("parseFrontmatterValue reads ready_for_multica and multica identifiers", () => {
  assert.equal(parseFrontmatterValue(OPEN_ISSUE, "ready_for_multica"), "true");
  assert.equal(parseFrontmatterValue(CLOSED_ISSUE, "ready_for_multica"), "false");
  assert.equal(parseFrontmatterValue(OPEN_ISSUE, "multica_issue"), "DOT-99");
});

test("frontmatterMatchesIssue accepts multica_issue and multica_issue_id", () => {
  assert.equal(frontmatterMatchesIssue(OPEN_ISSUE, "DOT-99"), true);
  assert.equal(frontmatterMatchesIssue(OPEN_ISSUE, "11111111-1111-1111-1111-111111111111"), true);
  assert.equal(frontmatterMatchesIssue(OPEN_ISSUE, "DOT-100"), false);
});

test("isReadyForMulticaImport is true only when ready_for_multica is true", () => {
  assert.equal(isReadyForMulticaImport(OPEN_ISSUE), true);
  assert.equal(isReadyForMulticaImport(CLOSED_ISSUE), false);
  assert.equal(isReadyForMulticaImport("---\ntitle: no flag\n---\n"), false);
});

test("discoverLocalIssuePath finds issue markdown under Issues/", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "spine-local-import-"));
  await mkdir(join(cwd, "Issues"), { recursive: true });
  await writeFile(join(cwd, "Issues", "01-example.md"), OPEN_ISSUE, "utf8");

  const discovered = await discoverLocalIssuePath(cwd, "DOT-99");
  assert.equal(discovered, join(cwd, "Issues", "01-example.md"));
});

test("checkLocalImportClosure blocks when ready_for_multica is still true", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "spine-local-import-open-"));
  await mkdir(join(cwd, "Issues"), { recursive: true });
  const issuePath = join(cwd, "Issues", "01-example.md");
  await writeFile(issuePath, OPEN_ISSUE, "utf8");

  const check = await checkLocalImportClosure(cwd, "DOT-99");
  assert.equal(check.checked, true);
  assert.equal(check.closed, false);
  assert.equal(check.readyForMultica, true);
  assert.equal(check.instruction, LOCAL_IMPORT_CLOSURE_INSTRUCTION);
});

test("checkLocalImportClosure passes when ready_for_multica is false", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "spine-local-import-closed-"));
  await mkdir(join(cwd, "Issues"), { recursive: true });
  await writeFile(join(cwd, "Issues", "01-example.md"), CLOSED_ISSUE, "utf8");

  const check = await checkLocalImportClosure(cwd, "DOT-99");
  assert.equal(check.checked, true);
  assert.equal(check.closed, true);
  assert.equal(check.readyForMultica, false);
});

test("evaluateSpine reports local import closure missing item", () => {
  const task = {
    issue: { identifier: "DOT-99", boundAt: "2026-01-01T00:00:00.000Z" },
    pr: {
      prUrl: "https://github.com/eiei114/pi-multica-spine/pull/1",
      prNumber: 1,
      prHeadSha: "abc123",
      prBranch: "DOT-99-work",
      prBody: "Multica Issue: DOT-99",
      writebackRecorded: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
    },
    evidence: [{ kind: "test", summary: "passed", timestamp: "2026-01-01T00:00:00.000Z" }],
    handoff: {
      done: ["Implemented DOT-99"],
      changed: ["Issues/01-example.md"],
      verification: ["npm run ci passed"],
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const evaluation = evaluateSpine(task, undefined, {
    checked: true,
    localIssuePath: "Issues/01-example.md",
    readyForMultica: true,
    closed: false,
    instruction: LOCAL_IMPORT_CLOSURE_INSTRUCTION,
  });

  assert.equal(evaluation.verified, false);
  assert.ok(evaluation.missing.includes("local import closure"));
  assert.equal(evaluation.nextAction.tool, "edit");
});
