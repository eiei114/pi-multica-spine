import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildVaultIdeaNoteMarkdown,
  buildVaultIdeaNotePath,
  runWorkflowVaultIdeaEntry,
} from "../scripts/workflow-vault-idea-entry.mjs";

test("buildVaultIdeaNotePath uses dated slug under Ideas", () => {
  const notePath = buildVaultIdeaNotePath("C:/vault", "Build a habit tracker with offline sync", {
    now: new Date("2026-07-24T12:00:00.000Z"),
  });
  assert.equal(
    notePath.replace(/\\/g, "/"),
    "C:/vault/4_Project/Multica-Agent-Strategy/Ideas/2026-07-24-build-a-habit-tracker-with-offline-sync.md",
  );
});

test("buildVaultIdeaNoteMarkdown keeps ready_for_multica false", () => {
  const md = buildVaultIdeaNoteMarkdown("A sufficiently long product idea", {
    now: new Date("2026-07-24T12:00:00.000Z"),
    parentIdentifier: "DOT-9999",
    workflowRunId: "canary-20260724",
  });
  assert.match(md, /ready_for_multica: false/);
  assert.match(md, /multica_parent: DOT-9999/);
});

test("runWorkflowVaultIdeaEntry offline plan writes vault note", async () => {
  const root = await mkdtemp(join(tmpdir(), "vault-idea-entry-"));
  const report = await runWorkflowVaultIdeaEntry({
    vaultRoot: join(root, "vault"),
    sessionsRoot: join(root, "sessions"),
    roughIdea: "Build a CLI that summarizes JSONL tasks for weekly review",
    sessionSuffix: `vault-ci-${Date.now()}`,
  });
  assert.equal(report.ok, true);
  assert.equal(report.mode, "offline-plan");
  assert.match(report.vaultIdeaNote, /Ideas/);
  assert.equal(report.skillCommand, "/skill:idea-to-build");
});
