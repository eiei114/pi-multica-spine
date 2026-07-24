import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

import { importSpineLib, importSpineLibs, spinePackageRoot } from "../scripts/spine-lib-import.mjs";

test("spinePackageRoot resolves repository root from scripts/", () => {
  const root = spinePackageRoot(new URL("../scripts/spine-lib-import.mjs", import.meta.url).href);
  assert.equal(root, resolve(fileURLToPath(new URL("..", import.meta.url))));
});

test("importSpineLib loads jsonl-digest exports", async () => {
  const mod = await importSpineLib(import.meta.url, "jsonl-digest.ts");
  assert.equal(typeof mod.computeJsonlDigest, "function");
  assert.equal(typeof mod.digestJsonlFileContent, "function");
});

test("importSpineLibs merges multiple lib modules", async () => {
  const mod = await importSpineLibs(import.meta.url, [
    "hash.ts",
    "jsonl-digest.ts",
  ]);
  assert.equal(typeof mod.sha256Hex, "function");
  assert.equal(typeof mod.computeJsonlDigest, "function");
});
