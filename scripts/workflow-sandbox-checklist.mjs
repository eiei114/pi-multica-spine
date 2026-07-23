#!/usr/bin/env node
/**
 * Automated workflow ops checklist (R-MNT-17).
 * Offline mode is CI-safe; --live adds multica CLI preflight when available.
 */
import { access, constants } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importSpineLib } from "./spine-lib-import.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const { clearStaleDaemonTaskContext } = await importSpineLib(import.meta.url, "multica-cli.ts");

const {
  buildSandboxCanaryPlan,
  parseWorkflowSandboxCanaryArgs,
} = await import("./workflow-sandbox-canary.mjs");

export function parseWorkflowSandboxChecklistArgs(argv = process.argv.slice(2)) {
  const live = argv.includes("--live");
  const json = argv.includes("--json") || !argv.includes("--plain");
  return { live, json };
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { encoding: "utf8" });
  return result.status === 0;
}

function multicaAuthProbe() {
  const result = spawnSync("multica", ["whoami", "--output", "json"], { encoding: "utf8" });
  if (result.status !== 0) {
    return { ok: false, detail: (result.stderr || result.stdout || "multica whoami failed").trim() };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim() || "{}");
    return { ok: true, detail: parsed.email ?? parsed.id ?? "authenticated" };
  } catch {
    return { ok: true, detail: "authenticated" };
  }
}

export async function runWorkflowSandboxChecklist(options = {}) {
  const live = options.live ?? false;
  const canaryPath = options.canaryPath ?? buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs([])).canaryPath;
  const checks = [];

  const distLib = join(repoRoot, "dist", "lib", "hash.js");
  if (await pathExists(distLib)) {
    checks.push({ id: "dist-lib", ok: true, message: "dist/lib present (build artifacts available)" });
  } else {
    checks.push({
      id: "dist-lib",
      ok: false,
      message: "dist/lib missing — run npm run build before live sandbox ops",
    });
  }

  const plan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(["--dry-run", "--canary-path", canaryPath]));
  const policyOk =
    plan.deliveryPolicy.productionAllowed === false &&
    plan.deliveryPolicy.destructiveAllowed === false &&
    plan.mode === "dry-run";
  checks.push({
    id: "sandbox-dry-run-plan",
    ok: policyOk,
    message: policyOk
      ? `sandbox dry-run plan ok (mode=${plan.mode}, productionAllowed=false)`
      : "sandbox dry-run plan failed delivery policy or mode checks",
  });

  checks.push({
    id: "blocked-project-guard",
    ok: (() => {
      try {
        buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs([
          "--apply",
          "--project-id",
          "415010b1-f28a-4ae4-9042-ddeb00800029",
        ]));
        return false;
      } catch (error) {
        return /blocked production project/i.test(String(error?.message ?? error));
      }
    })(),
    message: "explicit blocked production project id is refused on apply",
  });

  const cleared = await clearStaleDaemonTaskContext(canaryPath);
  checks.push({
    id: "daemon-marker",
    ok: true,
    message: cleared
      ? `cleared stale daemon marker under ${canaryPath}`
      : `no stale daemon marker under ${canaryPath}`,
  });

  if (live) {
    const multicaPresent = commandExists("multica");
    checks.push({
      id: "multica-cli",
      ok: multicaPresent,
      message: multicaPresent ? "multica CLI found on PATH" : "multica CLI not found on PATH",
    });
    if (multicaPresent) {
      const auth = multicaAuthProbe();
      checks.push({
        id: "multica-auth",
        ok: auth.ok,
        message: auth.ok ? `multica authenticated (${auth.detail})` : auth.detail,
      });
    }
  } else {
    checks.push({
      id: "multica-cli",
      ok: true,
      skipped: true,
      message: "multica CLI check skipped (offline mode; pass --live to require)",
    });
    checks.push({
      id: "multica-auth",
      ok: true,
      skipped: true,
      message: "multica auth check skipped (offline mode)",
    });
  }

  const failed = checks.filter((item) => !item.ok && !item.skipped);
  return {
    ok: failed.length === 0,
    mode: live ? "live" : "offline",
    canaryPath,
    checks,
    nextSteps: live
      ? [
          "node scripts/workflow-sandbox-canary.mjs --dry-run",
          "node scripts/workflow-sandbox-canary.mjs --apply",
        ]
      : [
          "npm run build",
          "node scripts/workflow-sandbox-checklist.mjs --live",
          "node scripts/workflow-sandbox-canary.mjs --dry-run",
        ],
  };
}

async function main() {
  const { live, json } = parseWorkflowSandboxChecklistArgs();
  const report = await runWorkflowSandboxChecklist({ live });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const check of report.checks) {
      const mark = check.skipped ? "~" : check.ok ? "ok" : "FAIL";
      console.log(`${mark} ${check.id}: ${check.message}`);
    }
    console.log(report.ok ? "\nworkflow sandbox checklist ok" : "\nworkflow sandbox checklist failed");
  }
  if (!report.ok) process.exitCode = 1;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
