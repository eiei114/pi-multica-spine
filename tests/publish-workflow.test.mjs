import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publishWorkflow = await readFile(
  new URL("../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);

function extractOnBlock(content) {
  const match = content.match(/^on:\n([\s\S]*?)(?=^[a-z]|\npermissions)/m);
  assert.ok(match, "publish.yml must declare an on: block");
  return match[1];
}

test("publish.yml has no push trigger to prevent duplicate publish runs (DOT-881)", () => {
  const onBlock = extractOnBlock(publishWorkflow);
  assert.ok(
    !/^ {2}push\s*:/m.test(onBlock),
    "push trigger must be absent so a version bump publishes through one path only",
  );
});

test("publish.yml keeps workflow_dispatch for auto-release handoff", () => {
  const onBlock = extractOnBlock(publishWorkflow);
  assert.match(onBlock, /workflow_dispatch:/);
  assert.match(onBlock, /workflow_dispatch:[\s\S]*?^ {4}inputs:\s*$[\s\S]*?^ {6}ref:\s*$/m);
});

test("publish.yml keeps release.published as a secondary publish path", () => {
  const onBlock = extractOnBlock(publishWorkflow);
  assert.match(onBlock, /release:/);
  assert.match(onBlock, /types:\s*\[published\]/);
});
