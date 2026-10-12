import assert from "node:assert/strict";
import test from "node:test";

import {
  behaviorAssertions,
  parseJsonLines,
  SDK_VERSIONS,
  VERIFICATION_CONTRACT,
} from "../scripts/pi-sdk-smoke-contract.mjs";

const status = { method: "setStatus", statusKey: "multica-spine", statusText: "Multica spine ready" };
const result = (text) => ({ content: [{ type: "text", text }] });
const bindEvent = (text, isError = false) => ({
  toolName: "multica_spine_bind",
  isError,
  result: result(text),
});

test("Pi SDK behavior-v2 contract records all frozen versions and parses JSONL", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.deepEqual(Object.values(SDK_VERSIONS), ["1.1.0", "1.1.0", "1.1.0", "1.1.0"]);
  assert.deepEqual(parseJsonLines(`not-json\r\n${JSON.stringify({ type: "response" })}\n\n`), [{ type: "response" }]);
});

test("extension_load passes only for the actual Multica status event", () => {
  assert.equal(behaviorAssertions("extension_load", { status })[0].passed, true);
  assert.equal(behaviorAssertions("extension_load", { status: null })[0].passed, false);
});

test("happy_path requires the registered bind tool result and persisted state", () => {
  const valid = {
    advertised: true,
    promptAccepted: true,
    toolEvent: bindEvent("status: BOUND\nissue: PI-SDK-SMOKE-HAPPY"),
    persistedIssueIdentifier: "PI-SDK-SMOKE-HAPPY",
  };
  assert.equal(behaviorAssertions("happy_path", valid)[0].passed, true);
  assert.equal(behaviorAssertions("happy_path", { ...valid, toolEvent: null })[0].passed, false);
  assert.equal(behaviorAssertions("happy_path", { ...valid, persistedIssueIdentifier: null })[0].passed, false);
});

test("error_path requires an observed handled tool error, not merely process success", () => {
  const valid = { promptAccepted: true, toolEvent: bindEvent("issueIdentifier is required", true), settled: true };
  assert.equal(behaviorAssertions("error_path", valid)[0].passed, true);
  assert.equal(behaviorAssertions("error_path", { ...valid, promptAccepted: false })[0].passed, false);
  assert.equal(behaviorAssertions("error_path", { ...valid, toolEvent: null })[0].passed, false);
  assert.equal(behaviorAssertions("error_path", { ...valid, toolEvent: bindEvent("issueIdentifier is required") })[0].passed, false);
  assert.equal(behaviorAssertions("error_path", { ...valid, settled: false })[0].passed, false);
});

test("reload_cleanup rejects missing second-process status, feature result, or clean exits", () => {
  const good = {
    reloadedStatus: status,
    feature: {
      advertised: true,
      promptAccepted: true,
      toolEvent: bindEvent("status: BOUND\nissue: PI-SDK-SMOKE-HAPPY"),
      persistedIssueIdentifier: "PI-SDK-SMOKE-HAPPY",
    },
    firstExitCode: 0,
    secondExitCode: 0,
    hasShutdownError: false,
  };
  const assertions = behaviorAssertions("reload_cleanup", good);
  assert.deepEqual(assertions.map((item) => item.id), [
    "reloaded_extension_registered",
    "reloaded_feature_response",
    "clean_shutdown",
  ]);
  assert.ok(assertions.every((item) => item.passed));
  assert.equal(behaviorAssertions("reload_cleanup", { ...good, reloadedStatus: null })[0].passed, false);
  assert.equal(behaviorAssertions("reload_cleanup", { ...good, feature: { toolEvent: null } })[1].passed, false);
  assert.equal(behaviorAssertions("reload_cleanup", { ...good, secondExitCode: null })[2].passed, false);
  assert.equal(behaviorAssertions("reload_cleanup", { ...good, hasShutdownError: true })[2].passed, false);
});

test("host_shell rejects a wrong local CLI version even with exit zero", () => {
  assert.equal(behaviorAssertions("host_shell", {
    shell: "PowerShell", exitCode: 0, output: "1.1.0", expectedVersion: "1.1.0",
  })[0].passed, true);
  assert.equal(behaviorAssertions("host_shell", {
    shell: "PowerShell", exitCode: 0, output: "0.99.1", expectedVersion: "1.1.0",
  })[0].passed, false);
});
