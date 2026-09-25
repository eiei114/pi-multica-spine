import assert from "node:assert/strict";
import test from "node:test";
import { classifyErrorForCli, fallbackAfterCanonicalRecheck } from "../lib/error-contract.ts";

const validFixtures = [
  { name: "missing", error: Object.assign(new Error("config not found"), { code: "ENOENT" }), exitCode: 66, retryable: false },
  { name: "invalid", error: new SyntaxError("bad json"), exitCode: 65, retryable: false },
  { name: "conflict", error: Object.assign(new Error("already exists"), { code: "EEXIST" }), exitCode: 73, retryable: false },
  { name: "permission", error: Object.assign(new Error("denied"), { code: "EACCES" }), exitCode: 77, retryable: false },
  { name: "network", error: Object.assign(new Error("reset"), { code: "ECONNRESET" }), exitCode: 75, retryable: true },
];

const invalidFixtures = [
  Object.assign(new Error("disk full is not a safe fallback"), { code: "ENOSPC" }),
  Object.assign(new Error("plain runtime bug"), { code: "ERR_ASSERTION" }),
  new Error("unclassified error"),
];

test("known error fixtures classify to distinct fail-closed CLI contracts", () => {
  for (const fixture of validFixtures) {
    const classified = classifyErrorForCli(fixture.error);
    assert.equal(classified.kind, fixture.name);
    assert.equal(classified.exitCode, fixture.exitCode);
    assert.equal(classified.retryable, fixture.retryable);
    assert.match(classified.message, new RegExp(`^${fixture.name}:`));
  }
});

test("unexpected error fixtures rethrow instead of collapsing to fallback", () => {
  for (const error of invalidFixtures) {
    assert.throws(() => classifyErrorForCli(error), (thrown) => thrown === error);
  }
});

test("missing fallback rechecks canonical state before creating replacement", async () => {
  const calls = [];
  const result = await fallbackAfterCanonicalRecheck(
    async () => {
      calls.push("action");
      throw Object.assign(new Error("missing candidate"), { code: "ENOENT" });
    },
    async () => {
      calls.push("readCanonical");
      return "canonical";
    },
    async () => {
      calls.push("fallback");
      return "fallback";
    },
  );

  assert.equal(result, "canonical");
  assert.deepEqual(calls, ["action", "readCanonical"]);
});

test("missing fallback runs when canonical state is absent", async () => {
  const calls = [];
  const result = await fallbackAfterCanonicalRecheck(
    async () => {
      calls.push("action");
      throw Object.assign(new Error("missing candidate"), { code: "ENOENT" });
    },
    async () => {
      calls.push("readCanonical");
      return undefined;
    },
    async () => {
      calls.push("fallback");
      return "fallback";
    },
  );

  assert.equal(result, "fallback");
  assert.deepEqual(calls, ["action", "readCanonical", "fallback"]);
});

test("check-mode style fallback is not reached for non-missing known errors", async () => {
  const calls = [];
  const permission = Object.assign(new Error("denied"), { code: "EPERM" });
  await assert.rejects(
    () =>
      fallbackAfterCanonicalRecheck(
        async () => {
          calls.push("action");
          throw permission;
        },
        async () => {
          calls.push("readCanonical");
          return undefined;
        },
        async () => {
          calls.push("fallback");
          return "fallback";
        },
      ),
    (thrown) => thrown === permission,
  );

  assert.deepEqual(calls, ["action"]);
});
