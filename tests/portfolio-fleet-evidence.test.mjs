import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { sha256Hex } = await import("../lib/hash.ts");
const { verifyFleetEvidence } = await import("../lib/portfolio-fleet-evidence.ts");
const { runPortfolioFleetCommand } = await import("../scripts/workflow-portfolio-fleet.mjs");

async function bundle(cwd) {
  const ids = ["ios_walkthrough", "web_walkthrough", "windows_walkthrough", "daily_relic_pilot", "runtime_routes"];
  const records = await Promise.all(ids.map(async (id) => {
    const artifactPath = `${id}.txt`;
    const content = `${id}: verified\n`;
    await writeFile(join(cwd, artifactPath), content);
    return { id, artifactPath, artifactHash: sha256Hex(content) };
  }));
  return { schemaVersion: 1, records };
}

test("fleet preflight refuses missing or altered evidence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "fleet-evidence-"));
  await assert.rejects(verifyFleetEvidence({ schemaVersion: 1, records: [] }, cwd), /Missing verifiable/);
  const valid = await bundle(cwd);
  valid.records[0].artifactHash = "a".repeat(64);
  await assert.rejects(verifyFleetEvidence(valid, cwd), /hash mismatch/);
});

test("fleet command enables only from verified evidence bundle", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "fleet-command-"));
  const evidencePath = join(cwd, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(await bundle(cwd)));
  const preflight = await runPortfolioFleetCommand({ command: "preflight", cwd, evidencePath });
  assert.equal(preflight.report.ok, true);
  const enabled = await runPortfolioFleetCommand({ command: "enable", cwd, evidencePath });
  assert.equal(enabled.config.enabled, true);
});
