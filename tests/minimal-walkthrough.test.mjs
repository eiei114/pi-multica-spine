import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateSpine } from "../lib/state-machine.ts";
import { SpineStateStore } from "../lib/state-store.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(repoRoot, "examples/minimal-walkthrough/fixture");

test("minimal walkthrough fixture evaluates to VERIFIED", async () => {
  const store = new SpineStateStore(fixtureRoot);
  const snapshot = await store.context();
  const evaluation = evaluateSpine(snapshot.task);
  assert.equal(evaluation.status, "VERIFIED");
  assert.equal(evaluation.verified, true);
  assert.deepEqual(evaluation.missing, []);
  assert.equal(snapshot.task?.issue.identifier, "TASK-45");
});

test("example READMEs document npm run walkthrough", () => {
  for (const rel of [
    "examples/minimal-walkthrough/README.md",
    "examples/workflow-campaign-walkthrough/README.md",
  ]) {
    const content = readFileSync(join(repoRoot, rel), "utf8");
    assert.match(content, /npm run walkthrough/, `${rel} should mention npm run walkthrough`);
  }
});
