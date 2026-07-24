import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createHermesCompositeManifest } = await import("../lib/hermes-adapter.ts");
const { createExplicitPortfolioPromotionFactory, loadExplicitPortfolioPromotionFactoryConfig } = await import("../lib/portfolio-promotion-factory.ts");

function config() {
  const manifest = createHermesCompositeManifest();
  return {
    schemaVersion: 1,
    projectTitle: "Daily Relic iOS",
    projectDescription: "Operator supervised pilot",
    artifactRoot: "Artifacts/workflows",
    projectGrants: ["implementation"],
    humanOwnedActions: ["release", "production", "destructive"],
    roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: `agent-${role}` }])),
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "final_only",
    deliveryPolicy: { prRequired: true, releaseAllowed: true, productionAllowed: false, destructiveAllowed: false },
  };
}

test("explicit factory has no ambient side effects and uses literal project CLI argv", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "portfolio-factory-"));
  const calls = [];
  const deps = createExplicitPortfolioPromotionFactory({
    cwd,
    config: config(),
    runner: async (args) => {
      calls.push(args);
      if (args[1] === "list") return { exitCode: 0, stdout: '[{"id":"p1","title":"Daily Relic iOS","status":"planned"}]', stderr: "" };
      if (args[1] === "create") return { exitCode: 0, stdout: '{"id":"p2","title":"New","status":"planned"}', stderr: "" };
      return { exitCode: 0, stdout: '{"id":"p1","title":"Daily Relic iOS","status":"active"}', stderr: "" };
    },
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(await deps.projects.list(), [{ id: "p1", title: "Daily Relic iOS", status: "planned" }]);
  await deps.projects.create({ title: "New", description: "desc" });
  await deps.activateProject("p1");
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [["project", "list"], ["project", "create"], ["project", "status"]]);
  assert.equal(deps.buildBinding({ id: "p1", title: "Daily Relic iOS", status: "planned" }).humanGate, "final_only");
});

test("factory config is loaded only from an explicit valid file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "portfolio-factory-config-"));
  const path = join(cwd, "factory.json");
  await writeFile(path, JSON.stringify(config()), "utf8");
  assert.equal((await loadExplicitPortfolioPromotionFactoryConfig(path)).projectTitle, "Daily Relic iOS");
  await assert.rejects(loadExplicitPortfolioPromotionFactoryConfig(""), /config path is required/);
  await writeFile(path, "{}", "utf8");
  await assert.rejects(loadExplicitPortfolioPromotionFactoryConfig(path), /Invalid explicit promotion factory config/);
});
