#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const { PortfolioFleetConfigStore, runFleetPreflight, verifyFleetEvidence } = await importSpineLibs(import.meta.url, [
  "portfolio-fleet-enablement.ts",
  "portfolio-fleet-evidence.ts",
]);

export function parsePortfolioFleetArgs(argv = process.argv.slice(2)) {
  return {
    command: argv.find((arg) => ["status", "preflight", "enable", "disable"].includes(arg)) ?? "status",
    evidencePath: argv.find((arg, index) => argv[index - 1] === "--evidence"),
    cwd: argv.find((arg, index) => argv[index - 1] === "--cwd") ?? process.cwd(),
  };
}

export async function runPortfolioFleetCommand(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const command = options.command ?? "status";
  const store = new PortfolioFleetConfigStore(cwd);
  if (command === "status") return { command, config: await store.load() };
  if (command === "disable") return { command, config: await store.disable() };
  if (!options.evidencePath) throw new Error(`${command} requires --evidence <bundle.json>`);
  const bundle = JSON.parse(await readFile(options.evidencePath, "utf8"));
  const fixtures = await verifyFleetEvidence(bundle, cwd);
  const report = runFleetPreflight(fixtures);
  if (command === "preflight") return { command, report };
  if (command === "enable") return { command, report, config: await store.enable(report) };
  throw new Error(`Unknown fleet command: ${command}`);
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  const args = parsePortfolioFleetArgs();
  runPortfolioFleetCommand({ ...args, evidencePath: args.evidencePath }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
