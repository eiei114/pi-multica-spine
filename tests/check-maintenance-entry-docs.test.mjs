import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkMaintenanceEntryDocs } from "../scripts/check-maintenance-entry-docs.mjs";

const entryPath = "scripts/workflow-maintenance-entry.mjs";
const alignedDoc = "Run `scripts/workflow-maintenance-entry.mjs` with `productionAllowed=false`.\n";
const alignedTree = {
  "README.md": alignedDoc,
  "skills/maintenance-build/SKILL.md": alignedDoc,
  "docs/workflow-ops-checklist.md": alignedDoc,
  // Inert fixture text: the checker reads the script but must not execute it.
  [entryPath]: `// --maintenance-brief
// plan.deliveryPolicy.productionAllowed === false
throw new Error("fixture must not be executed");
`,
};

async function createFixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "spine-maintenance-docs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  return root;
}

test("maintenance docs checker accepts an aligned fixture tree", async (t) => {
  const root = await createFixture(t, alignedTree);

  assert.deepEqual(await checkMaintenanceEntryDocs(root), { ok: true, failures: [] });
});

test("maintenance docs checker reports all file-specific drift", async (t) => {
  const root = await createFixture(t, {
    ...alignedTree,
    "README.md": "Run the maintenance entry with `productionAllowed=false`.\n",
    "skills/maintenance-build/SKILL.md": "Run `scripts/workflow-maintenance-entry.mjs`.\n",
    [entryPath]: "// Outdated maintenance entry stub.\n",
  });

  const result = await checkMaintenanceEntryDocs(root);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures.toSorted(), [
    "README.md: missing scripts/workflow-maintenance-entry.mjs",
    "skills/maintenance-build/SKILL.md: missing productionAllowed=false",
    `${entryPath}: missing production policy guard`,
    `${entryPath}: missing maintenance brief option`,
  ].sort());
});

test("maintenance docs checker reports missing files and rereads repaired fixtures", async (t) => {
  const root = await createFixture(t, alignedTree);
  const checklistPath = "docs/workflow-ops-checklist.md";
  await rm(join(root, checklistPath));
  await rm(join(root, entryPath));

  const result = await checkMaintenanceEntryDocs(root);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures.toSorted(), [
    `${checklistPath}: unable to read (ENOENT)`,
    `${entryPath}: unable to read (ENOENT)`,
  ]);

  await writeFile(join(root, checklistPath), alignedTree[checklistPath], "utf8");
  await writeFile(join(root, entryPath), alignedTree[entryPath], "utf8");
  assert.deepEqual(await checkMaintenanceEntryDocs(root), { ok: true, failures: [] });
});
