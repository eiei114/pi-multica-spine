import assert from "node:assert/strict";
import test from "node:test";

import {
  computeJsonlDigest,
  extractJsonlRecordStatus,
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

test("extractJsonlRecordStatus reads top-level status without nested false positives", () => {
  assert.equal(extractJsonlRecordStatus('{"id":"t1","status":"open"}'), "open");
  assert.equal(extractJsonlRecordStatus('{"meta":{"status":"ignored"},"status":"done"}'), "done");
  assert.equal(extractJsonlRecordStatus('{"id":"t1"}'), "unknown");
  assert.equal(extractJsonlRecordStatus('{"status":42}'), "42");
  assert.equal(extractJsonlRecordStatus("not-json"), "unknown");
});

test("extractJsonlRecordStatus matches JSON.parse semantics on hostile shapes", () => {
  const inputs = [
    '{"status":"first","status":"last"}',
    '{"status":"done"} trailing',
    '{"status":1e3}',
    '{"status":-12.5e2}',
    '{"status":[]}',
    '{"status":{}}',
    '{"status":true}',
    '{"status":null}',
    '{"status":"a\\nb"}',
    '{"status":"\\q"}',
    '{"a":"\\q","status":"x"}',
    '{"status":"x",}',
    '{"status" "x"}',
    '{"status":"unterminated}',
    '{"status":{"a":1}}',
    '{"status":[1,2]}',
    '{"meta":{"status":"in"},"status":"top"}',
    '{"status" : "spaced" }',
    '{}',
    '{"Status":"caps"}',
    '{"statusX":"y"}',
    '  {"status":"pad"}  ',
    '{"status":01}',
    '{"status":+1}',
    '[{"status":"arr"}]',
    '"bare"',
    '',
  ];
  for (const input of inputs) {
    let expected;
    try {
      const record = JSON.parse(input);
      expected =
        record !== null && typeof record === "object" && !Array.isArray(record) && "status" in record
          ? String(record.status)
          : String(record?.status ?? "unknown");
    } catch {
      expected = "unknown";
    }
    assert.equal(extractJsonlRecordStatus(input), expected, `mismatch for ${input}`);
  }
});

test("computeJsonlDigest fast path matches JSON.parse fallback digest", () => {
  const lines = [
    '{"id":"t1","status":"open","metadata":{"status":"ignored"}}',
    '{"id":"t2","status":"done"}',
    '{"id":"t3","status":"open"}',
    '{"id":"t4","status":null}',
    '{"id":"t5"}',
  ];
  const result = computeJsonlDigest(lines);
  assert.deepEqual(result.counts, { done: 1, null: 1, open: 2, unknown: 1 });
  assert.equal(result.lineCount, 5);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});
