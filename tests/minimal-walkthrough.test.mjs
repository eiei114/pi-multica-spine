import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateSpine } from "../lib/state-machine.ts";
import { SpineStateStore } from "../lib/state-store.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(repoRoot, "examples/minimal-walkthrough/fixture");

// Proves the fixture really sits inside a git work tree, independently of the
// production checker under assertion. Deliberately not imported from
// lib/git-completion-checker.ts: a guard that reuses the code it guards would
// skip itself if that code regressed.
function gitWorkTreeRoot(cwd) {
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2000,
    }).trim();
    // A repository rooted at a filesystem root is also not a usable checkout for
    // git completion, so it does not count as one here.
    if (!topLevel) return undefined;
    return resolve(topLevel) === parse(resolve(topLevel)).root ? undefined : topLevel;
  } catch {
    return undefined;
  }
}

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

test("minimal walkthrough README states that the example skips verify-only checks", () => {
  const readme = readFileSync(join(repoRoot, "examples/minimal-walkthrough/README.md"), "utf8");
  // The example calls evaluateSpine(task) only; multica_spine_verify also runs the
  // git completion and local import closure checks. The README must keep saying so.
  assert.match(readme, /`multica_spine_verify` adds two checks/);
  assert.match(readme, /git completion/);
  assert.match(readme, /local import closure/);
  assert.match(readme, /does not mean `multica_spine_verify` will pass/);
  assert.doesNotMatch(
    readme,
    /same fields `multica_spine_verify` checks/i,
    "README must not claim the fixture covers everything multica_spine_verify checks",
  );
});

test("fixture stores a placeholder prHeadSha, so SpineStateStore.verify reports it as stale", async (t) => {
  // `checkGitCompletion()` returns `{ checked: false, blockers: [] }` when git
  // cannot resolve a work tree (a source snapshot or installed tarball has no
  // .git), so the stale-SHA blocker does not exist there. Only skip outside a
  // checkout; inside one the assertion below still runs.
  const workTreeRoot = gitWorkTreeRoot(fixtureRoot);
  if (!workTreeRoot) {
    t.skip(`skipped: ${fixtureRoot} is not inside a git checkout, so git completion is not checked`);
    return;
  }

  const store = new SpineStateStore(fixtureRoot);
  const snapshot = await store.context();
  // A short placeholder can never equal a full HEAD sha, so the blocker below is
  // deterministic inside any git checkout and pins the README's documented divergence.
  assert.doesNotMatch(snapshot.task?.pr?.prHeadSha ?? "", /^[0-9a-f]{40}$/);

  const verified = await store.verify();
  assert.equal(verified.evaluation.verified, false);
  assert.ok(
    verified.evaluation.missing.includes("git: PR head SHA metadata is stale"),
    `expected the stale PR head SHA blocker, got ${JSON.stringify(verified.evaluation.missing)}`,
  );
});
