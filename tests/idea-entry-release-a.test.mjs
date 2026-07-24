import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoughIdea, IdeaInvocationReservationStore } from "../lib/idea-entry-reservation.ts";
test("normalizeRoughIdea", () => assert.equal(normalizeRoughIdea("  a  b "), "a b"));
test("reservation reuse", async () => {
  const store = new IdeaInvocationReservationStore("C:/tmp/res-" + Date.now());
  const input = "Build a long enough idea seed";
  const a = await store.reserve({ invocationToken: "t1", normalizedInput: input });
  const b = await store.reserve({ invocationToken: "t1", normalizedInput: input });
  assert.equal(a.sessionId, b.sessionId);
});
