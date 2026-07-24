import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  BUILD_TEMPLATE_CATALOG_ENTRIES,
  BuildTemplateCatalogStore,
  catalogDigest,
  getApprovedBuildTemplate,
  resolveBuildTemplateForSurface,
} = await import("../lib/build-template-catalog.ts");

test("build template catalog registers ios web and windows baselines", () => {
  assert.equal(BUILD_TEMPLATE_CATALOG_ENTRIES.length, 3);
  const ios = getApprovedBuildTemplate("ios-swiftui-agent-app");
  const web = getApprovedBuildTemplate("astro-web-private");
  const windows = getApprovedBuildTemplate("tauri-windows-react");
  assert.equal(ios.targetSurface, "ios");
  assert.equal(web.targetSurface, "web");
  assert.equal(windows.targetSurface, "windows");
  assert.ok(ios.pinnedRevision.docs.includes("AGENTS.md"));
  assert.ok(web.pinnedRevision.checks.includes("ci_build"));
  assert.ok(windows.pinnedRevision.runtimeContract.builderRole.includes("windows"));
});

test("catalog revision pinning rejects surface mismatch", () => {
  assert.throws(
    () => resolveBuildTemplateForSurface("web", "ios-swiftui-agent-app"),
    /does not match target surface/,
  );
  assert.throws(() => getApprovedBuildTemplate("missing"), /not approved/);
  assert.equal(catalogDigest().length, 64);
});

test("build template catalog store syncs approved entries to disk", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "build-template-catalog-"));
  const store = new BuildTemplateCatalogStore(cwd);
  const synced = await store.sync();
  assert.equal(synced.entries.length, BUILD_TEMPLATE_CATALOG_ENTRIES.length);
  const loaded = await store.load();
  assert.equal(loaded.digest, synced.digest);
});
