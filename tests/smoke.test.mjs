import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("package declares extension-only pi resources", () => {
  assert.deepEqual(packageJson.pi, { extensions: ["./extensions"] });
  assert.ok(packageJson.files.includes("extensions/"));
  assert.ok(packageJson.files.includes("lib/"));
  assert.ok(!packageJson.files.includes("skills/"));
  assert.ok(!packageJson.files.includes("prompts/"));
  assert.ok(!packageJson.files.includes("themes/"));
});

test("package is discoverable as a Pi package", () => {
  assert.ok(packageJson.keywords.includes("pi-package"));
});

test("package uses public publish config", () => {
  assert.equal(packageJson.publishConfig.access, "public");
});
