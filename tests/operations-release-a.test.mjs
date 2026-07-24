import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationsViewV1 } from "../lib/operations-view.ts";
import { escapeTerminalText } from "../lib/operations-renderer.ts";
test("empty inventory", () => {
  const view = buildOperationsViewV1({ command: "idea-status", inventory: { schemaVersion: 1, generation: 1, rebuiltAt: new Date().toISOString(), sessionsRoot: "/tmp", records: [] } });
  assert.equal(view.dataState, "NO_IDEA_SESSIONS");
});
test("escape", () => assert.match(escapeTerminalText("a\u202eb"), /\\u202e/));
