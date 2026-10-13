import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseWorkflow = await readFile(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8");
const publishWorkflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

function triggers(text) {
  return text.split(/^permissions:/m)[0];
}

test("merging code cannot directly or indirectly trigger npm publish or release", () => {
  const release = triggers(releaseWorkflow);
  assert.match(release, /on:\r?\n\s+workflow_dispatch:/, "release must be manually triggered only");
  assert.doesNotMatch(release, /^\s+push:/m, "a merge must not start release");
  const publish = triggers(publishWorkflow);
  assert.match(publish, /push:\r?\n\s+tags:/, "publishing must remain version-tag gated");
  assert.doesNotMatch(publish, /^\s+branches:/m, "main branch edits must not publish");
  assert.match(publishWorkflow, /npm publish/);
});
