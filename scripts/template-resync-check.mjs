#!/usr/bin/env node
/**
 * Periodic pi-extension-template hygiene check (DOT-823 / R-MNT-18).
 * Compares repo workflow + package guardrails against the recorded baseline.
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

export const TEMPLATE_RESYNC_BASELINE = {
  templateRef: "pi-extension-template@0.1.6",
  piPeerBaseline: "0.80.x",
  piPeerPackages: [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ],
  expectedPeerMajor: "0.80",
  lastReviewed: "2026-07-24",
};

export const TEMPLATE_RESYNC_RULES = [
  {
    id: "ci-checkout-v7",
    file: ".github/workflows/ci.yml",
    pattern: /actions\/checkout@v7/,
    note: "CI checkout major matches template",
  },
  {
    id: "ci-setup-node-v6",
    file: ".github/workflows/ci.yml",
    pattern: /actions\/setup-node@v6/,
    note: "CI setup-node major matches template",
  },
  {
    id: "publish-checkout-v7",
    file: ".github/workflows/publish.yml",
    pattern: /actions\/checkout@v7/,
    note: "Publish checkout major matches template",
  },
  {
    id: "publish-curl-precheck",
    file: ".github/workflows/publish.yml",
    pattern: /registry\.npmjs\.org/,
    note: "Publish uses registry HTTP pre-check (adopted v0.7.2)",
  },
  {
    id: "publish-skip-before-setup-node",
    file: ".github/workflows/publish.yml",
    pattern: /Skip already published version[\s\S]*Setup Node\.js/,
    note: "Registry skip step precedes setup-node OIDC",
  },
  {
    id: "publish-no-push-trigger",
    file: ".github/workflows/publish.yml",
  },
  {
    id: "package-pi-extensions-only",
    file: "package.json",
    pattern: /"extensions":\s*\[\s*"\.\/extensions"\s*\]/,
    note: "Package ships extension entry (skills allowed via pi.skills)",
  },
  {
    id: "package-pi-idea-skill",
    file: "package.json",
    pattern: /"skills":\s*\[\s*"\.\/skills\/idea-to-build"\s*\]/,
    note: "Package registers idea-to-build slash entry skill",
  },
  {
    id: "package-public-publish",
    file: "package.json",
    pattern: /"access":\s*"public"/,
    note: "npm publishConfig.access is public",
  },
  {
    id: "spine-lib-import",
    file: "scripts/spine-lib-import.mjs",
    pattern: /export async function importSpineLib/,
    note: "CLI scripts use spine-lib-import helper",
  },
];

function extractOnBlock(content) {
  const match = content.match(/^on:\n([\s\S]*?)(?=^[a-z]|\npermissions)/m);
  return match?.[1] ?? "";
}

export function evaluatePiPeerVersions(packageJson, baseline = TEMPLATE_RESYNC_BASELINE) {
  const failures = [];
  const observed = {};
  for (const pkg of baseline.piPeerPackages) {
    const peerRange = packageJson.peerDependencies?.[pkg];
    const devRange = packageJson.devDependencies?.[pkg];
    observed[pkg] = { peerRange, devRange };
    if (peerRange !== "*") {
      failures.push(`${pkg}: peerDependencies expected "*" got ${JSON.stringify(peerRange)}`);
    }
    if (!devRange || !String(devRange).includes(baseline.expectedPeerMajor)) {
      failures.push(`${pkg}: devDependencies expected ${baseline.piPeerBaseline} range got ${JSON.stringify(devRange)}`);
    }
  }
  return {
    id: "pi-peer-versions",
    ok: failures.length === 0,
    note: `Pi peer packages align with template ${baseline.piPeerBaseline}`,
    detail: failures.length === 0 ? "matched" : failures.join("; "),
    observed,
  };
}

export async function evaluateTemplateResyncRule(rule, readText) {
  const relativePath = rule.file;
  const content = await readText(relativePath);
  if (rule.id === "publish-no-push-trigger") {
    const onBlock = extractOnBlock(content);
    const ok = !/^ {2}push\s*:/m.test(onBlock);
    return {
      id: rule.id,
      file: relativePath,
      ok,
      note: rule.note ?? "publish.yml has no push trigger (DOT-881 single path)",
      detail: ok ? "no push trigger in on:" : "unexpected push trigger found",
    };
  }
  const ok = rule.pattern.test(content);
  return {
    id: rule.id,
    file: relativePath,
    ok,
    note: rule.note ?? rule.id,
    detail: ok ? "matched" : `pattern missing in ${relativePath}`,
  };
}

export async function runTemplateResyncCheck(options = {}) {
  const rules = options.rules ?? TEMPLATE_RESYNC_RULES;
  const readText =
    options.readText ??
    (async (relativePath) => readFile(join(repoRoot, relativePath), "utf8"));
  const results = [];
  for (const rule of rules) {
    results.push(await evaluateTemplateResyncRule(rule, readText));
  }
  const packageJson = options.packageJson ?? JSON.parse(await readText("package.json"));
  results.push(evaluatePiPeerVersions(packageJson));
  const failures = results.filter((item) => !item.ok);
  return {
    ok: failures.length === 0,
    baseline: TEMPLATE_RESYNC_BASELINE,
    results,
    failures: failures.map((item) => `${item.id}: ${item.detail}`),
  };
}

async function main() {
  const report = await runTemplateResyncCheck();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
