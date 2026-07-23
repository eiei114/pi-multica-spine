import assert from "node:assert/strict";
import test from "node:test";

import {
  computeJsonlDigest,
  formatJsonlDigestHuman,
  formatJsonlDigestJson,
  parseJsonlLines,
} from "../lib/jsonl-digest.ts";

test("computeJsonlDigest returns stable sorted digest", () => {
  const lines = ['{"id":"t1","status":"open"}', '{"id":"t2","status":"done"}', '{"id":"t3","status":"open"}'];
  const first = computeJsonlDigest(lines);
  const second = computeJsonlDigest(lines);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.counts, { done: 1, open: 2 });
  assert.equal(first.lineCount, 3);
});

test("formatJsonlDigestJson is single-line JSON", () => {
  const json = formatJsonlDigestJson({ counts: { open: 1 }, lineCount: 1, digest: "a".repeat(64) });
  assert.equal(JSON.parse(json.trim()).lineCount, 1);
});

test("formatJsonlDigestHuman supports plain and color modes", () => {
  const result = { counts: { open: 2, done: 1 }, lineCount: 3, digest: "b".repeat(64) };
  const plain = formatJsonlDigestHuman(result, { color: false });
  assert.match(plain, /open: 2/);
  assert.doesNotMatch(plain, /\u001B/);
  const colored = formatJsonlDigestHuman(result, { color: true });
  assert.match(colored, /\u001B\[/);
});

test("parseJsonlLines ignores blank lines", () => {
  assert.equal(parseJsonlLines('{"status":"open"}\n\n').length, 1);
});
