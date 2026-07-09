import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetadataArgs,
  createMetadataClient,
  inferMetadataType,
  parseMetadataJson,
  renderMetadataValue,
} from "../lib/multica-cli.ts";

test("buildMetadataArgs: list always forces --output json", () => {
  assert.deepEqual(buildMetadataArgs("list", "DOT-1"), [
    "issue",
    "metadata",
    "list",
    "DOT-1",
    "--output",
    "json",
  ]);
});

test("buildMetadataArgs: set includes key, value, and inferred type", () => {
  assert.deepEqual(buildMetadataArgs("set", "DOT-1", { key: "pr_url", value: "https://x", type: "string" }), [
    "issue",
    "metadata",
    "set",
    "DOT-1",
    "--output",
    "json",
    "--key",
    "pr_url",
    "--value",
    "https://x",
    "--type",
    "string",
  ]);
});

test("buildMetadataArgs: delete only adds --key", () => {
  assert.deepEqual(buildMetadataArgs("delete", "DOT-1", { key: "stale_key" }), [
    "issue",
    "metadata",
    "delete",
    "DOT-1",
    "--output",
    "json",
    "--key",
    "stale_key",
  ]);
});

test("renderMetadataValue: booleans become true/false strings", () => {
  assert.equal(renderMetadataValue(true), "true");
  assert.equal(renderMetadataValue(false), "false");
});

test("renderMetadataValue: numbers and strings pass through String()", () => {
  assert.equal(renderMetadataValue(42), "42");
  assert.equal(renderMetadataValue(3.14), "3.14");
  assert.equal(renderMetadataValue("hello"), "hello");
});

test("inferMetadataType: preserves JS type as CLI type", () => {
  assert.equal(inferMetadataType(true), "bool");
  assert.equal(inferMetadataType(0), "number");
  assert.equal(inferMetadataType("42"), "string"); // critical: numeric-looking string stays string
  assert.equal(inferMetadataType("hello"), "string");
});

test("parseMetadataJson: parses a flat object", () => {
  assert.deepEqual(parseMetadataJson('{"a":1,"b":"x","c":true}'), { a: 1, b: "x", c: true });
});

test("parseMetadataJson: empty output yields empty map", () => {
  assert.deepEqual(parseMetadataJson(""), {});
  assert.deepEqual(parseMetadataJson("   \n"), {});
});

test("parseMetadataJson: rejects non-object JSON", () => {
  assert.throws(() => parseMetadataJson("[]"), /expected a JSON object/);
  assert.throws(() => parseMetadataJson("null"), /expected a JSON object/);
  assert.throws(() => parseMetadataJson("42"), /expected a JSON object/);
});

test("parseMetadataJson: surfaces JSON parse errors", () => {
  assert.throws(() => parseMetadataJson("{not json"), /failed to parse JSON output/);
});

function fakeRunner() {
  const calls = [];
  const runner = async (args, _options) => {
    calls.push(args);
    // Echo the canned metadata object regardless of subcommand.
    return { exitCode: 0, stdout: JSON.stringify({ pr_url: "https://example/pr/1", count: 7 }), stderr: "" };
  };
  return { calls, runner };
}

function failingRunner(stderr, exitCode = 1) {
  const calls = [];
  const runner = async (args, _options) => {
    calls.push(args);
    const err = new Error(
      `multica command failed (exit ${exitCode}): multica ${args.join(" ")}${stderr ? `: ${stderr}` : ""}`,
    );
    throw err;
  };
  return { calls, runner };
}

test("createMetadataClient.list builds list argv and parses result", async () => {
  const { calls, runner } = fakeRunner();
  const client = createMetadataClient(runner);
  const metadata = await client.list("DOT-9");
  assert.deepEqual(calls[0], ["issue", "metadata", "list", "DOT-9", "--output", "json"]);
  assert.deepEqual(metadata, { pr_url: "https://example/pr/1", count: 7 });
});

test("createMetadataClient.set infers type when none provided", async () => {
  const { calls, runner } = fakeRunner();
  const client = createMetadataClient(runner);
  await client.set("DOT-9", "deploy_url", "https://x", undefined);
  // string value -> forced --type string so numeric-looking strings survive
  assert.deepEqual(calls[0], [
    "issue",
    "metadata",
    "set",
    "DOT-9",
    "--output",
    "json",
    "--key",
    "deploy_url",
    "--value",
    "https://x",
    "--type",
    "string",
  ]);
});

test("createMetadataClient.set respects explicit bool type", async () => {
  const { calls, runner } = fakeRunner();
  const client = createMetadataClient(runner);
  await client.set("DOT-9", "flag", "true", "bool");
  assert.deepEqual(calls[0], [
    "issue",
    "metadata",
    "set",
    "DOT-9",
    "--output",
    "json",
    "--key",
    "flag",
    "--value",
    "true",
    "--type",
    "bool",
  ]);
});

test("createMetadataClient.set renders native number value", async () => {
  const { calls, runner } = fakeRunner();
  const client = createMetadataClient(runner);
  await client.set("DOT-9", "count", 42, undefined);
  assert.deepEqual(calls[0], [
    "issue",
    "metadata",
    "set",
    "DOT-9",
    "--output",
    "json",
    "--key",
    "count",
    "--value",
    "42",
    "--type",
    "number",
  ]);
});

test("createMetadataClient.delete builds delete argv with key only", async () => {
  const { calls, runner } = fakeRunner();
  const client = createMetadataClient(runner);
  await client.delete("DOT-9", "stale_key");
  assert.deepEqual(calls[0], ["issue", "metadata", "delete", "DOT-9", "--output", "json", "--key", "stale_key"]);
});

test("createMetadataClient propagates CLI failures", async () => {
  const { runner } = failingRunner('issue ref "NOPE" is not a recognized issue reference', 1);
  const client = createMetadataClient(runner);
  await assert.rejects(() => client.list("NOPE"), /not a recognized issue reference/);
});
