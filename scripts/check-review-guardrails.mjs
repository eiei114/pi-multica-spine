#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = readJson(join(ROOT, "package.json"));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function walkMarkdown(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(path));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

function releaseTarget() {
  if (Array.isArray(packageJson.workspaces) && packageJson.workspaces.includes("packages/*")) {
    return {
      args: ["pack", "--dry-run", "--json", "--workspace", "create-pi-extension"],
      lockKey: "packages/create-pi-extension",
      manifest: readJson(join(ROOT, "packages", "create-pi-extension", "package.json")),
      prefix: "template/",
    };
  }
  return { args: ["pack", "--dry-run", "--json"], lockKey: "", manifest: packageJson, prefix: "" };
}

function packedFiles() {
  const target = releaseTarget();
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "npm_execpath is required; run this guard through npm run review:guardrails");
  const output = execFileSync(process.execPath, [npmCli, ...target.args], { cwd: ROOT, encoding: "utf8" });
  const result = JSON.parse(output);
  assert.equal(result.length, 1, "npm pack must return exactly one package");
  return { files: new Set(result[0].files.map((item) => item.path)), prefix: target.prefix };
}

function checkReleaseState() {
  const target = releaseTarget();
  const releasePackage = target.manifest;
  const lockPath = join(ROOT, "package-lock.json");
  if (existsSync(lockPath)) {
    const lock = readJson(lockPath);
    assert.equal(
      lock.packages?.[target.lockKey]?.version,
      releasePackage.version,
      `package-lock packages['${target.lockKey}'] version must match ${releasePackage.name}`,
    );
  }

  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const escaped = releasePackage.version.replaceAll(".", "\\.");
  assert.match(changelog, new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"), "CHANGELOG must contain a dated current-version entry");

  for (const path of [join(ROOT, "README.md"), ...walkMarkdown(join(ROOT, "docs"))]) {
    const content = readFileSync(path, "utf8");
    const installPattern = /pi install npm:([^\s`]+)@(\d+\.\d+\.\d+)/g;
    for (const match of content.matchAll(installPattern)) {
      const referencedName = match[1];
      if (referencedName === releasePackage.name) {
        assert.equal(match[2], releasePackage.version, `${relative(ROOT, path)} pins stale package version ${match[2]}`);
      }
    }
  }
}

function checkPackageDocs() {
  const { files, prefix } = packedFiles();
  const sourceRoot = prefix ? join(ROOT, "packages", "create-pi-extension", "template") : ROOT;
  const markdown = [join(sourceRoot, "README.md"), ...walkMarkdown(join(sourceRoot, "docs"))].filter(existsSync);
  for (const source of markdown) {
    const sourceRelative = toPosix(relative(sourceRoot, source));
    assert.ok(files.has(`${prefix}${sourceRelative}`), `${sourceRelative} is documented but absent from npm tarball`);
    const content = readFileSync(source, "utf8");
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#", 1)[0].trim();
      if (!target || /^(?:https?:|mailto:|npm:)/.test(target)) continue;
      const resolved = resolve(dirname(source), decodeURIComponent(target));
      if (!existsSync(resolved)) {
        throw new Error(`${sourceRelative} references missing file ${target}`);
      }
      if (!statSync(resolved).isFile()) continue;
      const targetRelative = toPosix(relative(sourceRoot, resolved));
      assert.ok(files.has(`${prefix}${targetRelative}`), `${sourceRelative} references ${targetRelative}, but npm tarball omits it`);
    }
  }
}

function splitLines(content) {
  return content.split(/\r?\n/);
}

function lineIndent(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

function stripInlineComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote && line[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeScalar(value) {
  return unquote(value).trim().toLowerCase();
}

function mentionsPullRequestTrigger(value) {
  return /\bpull_request(?:_target)?\b/.test(value);
}

function resolveScalarAlias(lines, alias) {
  const anchor = alias.trim().match(/^\*([A-Za-z0-9_-]+)$/)?.[1];
  if (!anchor) return alias;
  const anchorPattern = new RegExp(`&${anchor}\\s+([^#\\s][^#]*)`);
  for (const sourceLine of lines) {
    const match = stripInlineComment(sourceLine).match(anchorPattern);
    if (match) return match[1].trim();
  }
  return alias;
}

function workflowHasPullRequestTrigger(content) {
  const lines = splitLines(content);
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripInlineComment(lines[index]);
    const trimmed = line.trim();
    if (!trimmed || lineIndent(line) !== 0) continue;

    const match = trimmed.match(/^["']?on["']?:\s*(.*)$/);
    if (!match) continue;

    const value = resolveScalarAlias(lines, match[1].trim());
    if (mentionsPullRequestTrigger(value)) return true;
    if (value) return false;

    for (let innerIndex = index + 1; innerIndex < lines.length; innerIndex += 1) {
      const innerLine = stripInlineComment(lines[innerIndex]);
      const innerTrimmed = innerLine.trim();
      if (!innerTrimmed) continue;
      if (lineIndent(innerLine) === 0) break;
      if (mentionsPullRequestTrigger(innerTrimmed)) return true;
    }
    return false;
  }
  return false;
}

function parseFlowPermissions(value) {
  const entries = new Map();
  const inner = value.trim().slice(1, -1).trim();
  if (!inner) return entries;

  for (const part of inner.split(",")) {
    const separator = part.indexOf(":");
    if (separator === -1) continue;
    const key = unquote(part.slice(0, separator));
    const permissionValue = part.slice(separator + 1);
    entries.set(key.trim(), normalizeScalar(permissionValue));
  }
  return entries;
}

function parsePermissionsBlock(lines, index, indent, value) {
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith("{") && trimmedValue.endsWith("}")) {
    return { indent, line: index + 1, kind: "map", entries: parseFlowPermissions(trimmedValue) };
  }
  if (trimmedValue) {
    return { indent, line: index + 1, kind: "scalar", value: normalizeScalar(trimmedValue) };
  }

  const entries = new Map();
  for (let innerIndex = index + 1; innerIndex < lines.length; innerIndex += 1) {
    const line = stripInlineComment(lines[innerIndex]);
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (lineIndent(line) <= indent) break;

    const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!match) continue;
    entries.set(match[1], normalizeScalar(match[2]));
  }

  return { indent, line: index + 1, kind: "map", entries };
}

function findPermissionBlocks(content) {
  const lines = splitLines(content);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripInlineComment(lines[index]);
    const trimmed = line.trim();
    const match = trimmed.match(/^permissions:\s*(.*)$/);
    if (!match) continue;
    blocks.push(parsePermissionsBlock(lines, index, lineIndent(line), match[1]));
  }
  return blocks;
}

function permissionProblems(block, relativePath, { requireContentsRead }) {
  const scope = block.indent === 0 ? "top-level permissions" : `job-level permissions at line ${block.line}`;
  if (block.kind !== "map") {
    return [`${relativePath}:${block.line}: PR workflow ${scope} must be an explicit map with contents: read`];
  }

  const problems = [];
  if (requireContentsRead && block.entries.get("contents") !== "read") {
    problems.push(`${relativePath}:${block.line}: PR workflow top-level permissions must include contents: read`);
  }

  for (const [permission, value] of block.entries) {
    if (value === "write") {
      problems.push(`${relativePath}:${block.line}: PR workflow ${scope} must not grant ${permission}: write`);
    }
  }
  return problems;
}

function findStepStart(lines, usesIndex, usesIndent) {
  for (let index = usesIndex; index >= 0; index -= 1) {
    const line = stripInlineComment(lines[index]);
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = lineIndent(line);
    if (indent <= usesIndent && trimmed.startsWith("- ")) {
      return { index, indent };
    }
    if (indent < usesIndent) break;
  }
  return { index: usesIndex, indent: usesIndent };
}

function findStepEnd(lines, stepStartIndex, stepIndent) {
  for (let index = stepStartIndex + 1; index < lines.length; index += 1) {
    const line = stripInlineComment(lines[index]);
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = lineIndent(line);
    if (indent < stepIndent) return index;
    if (indent === stepIndent && trimmed.startsWith("- ")) return index;
  }
  return lines.length;
}

function findCheckoutSteps(content) {
  const lines = splitLines(content);
  const steps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripInlineComment(lines[index]);
    if (!/^\s*(?:-\s*)?uses:\s*actions\/checkout@/i.test(line)) continue;

    const usesIndent = lineIndent(line);
    const start = findStepStart(lines, index, usesIndent);
    const end = findStepEnd(lines, start.index, start.indent);
    const stepLines = lines.slice(start.index, end).map(stripInlineComment);
    const persistCredentialsFalse = stepLines.some((stepLine) =>
      /^\s*persist-credentials:\s*["']?false["']?\s*$/i.test(stepLine),
    );

    steps.push({ line: index + 1, persistCredentialsFalse });
  }
  return steps;
}

export function validateWorkflowGuardrails({ relativePath = "workflow.yml", content }) {
  const problems = [];
  if (!workflowHasPullRequestTrigger(content)) return problems;

  const permissionBlocks = findPermissionBlocks(content);
  const topLevelPermissions = permissionBlocks.find((block) => block.indent === 0);
  if (!topLevelPermissions) {
    problems.push(`${relativePath}: PR workflow must declare top-level permissions with contents: read`);
  } else {
    problems.push(...permissionProblems(topLevelPermissions, relativePath, { requireContentsRead: true }));
  }

  for (const block of permissionBlocks.filter((permissionBlock) => permissionBlock.indent > 0)) {
    problems.push(...permissionProblems(block, relativePath, { requireContentsRead: false }));
  }

  for (const checkout of findCheckoutSteps(content)) {
    if (!checkout.persistCredentialsFalse) {
      problems.push(`${relativePath}:${checkout.line}: actions/checkout in a PR workflow must set persist-credentials: false`);
    }
  }

  return problems;
}

function workflowFiles(root) {
  const workflowDirectories = [
    join(root, ".github", "workflows"),
    join(root, "packages", "create-pi-extension", "template", ".github", "workflows"),
  ];
  const files = [];
  const seen = new Set();

  for (const directory of workflowDirectories) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (seen.has(path)) continue;
      seen.add(path);
      files.push(path);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function checkWorkflowGuardrails(root = ROOT) {
  const failures = [];
  for (const path of workflowFiles(root)) {
    const relativePath = toPosix(relative(root, path));
    const content = readFileSync(path, "utf8");
    failures.push(...validateWorkflowGuardrails({ relativePath, content }));
  }

  assert.deepEqual(failures, [], `Review guardrail G8 failed:\n- ${failures.join("\n- ")}`);
}

function checkErrorFailClosedContract() {
  const testScript = packageJson.scripts?.test ?? "";
  const fixturePath = join(ROOT, "tests", "error-contract.test.mjs");
  assert.ok(testScript.includes("tests/error-contract.test.mjs"), "npm test must run G5 error-path contract fixtures");
  assert.ok(existsSync(join(ROOT, "lib", "error-contract.ts")), "G5 fail-closed error classifier must exist");
  assert.ok(existsSync(fixturePath), "G5 valid/invalid error fixtures must exist");
  const fixtureContent = readFileSync(fixturePath, "utf8");
  for (const sentinel of ["validFixtures", "invalidFixtures", "fallbackAfterCanonicalRecheck"]) {
    assert.ok(fixtureContent.includes(sentinel), `G5 fixture must retain ${sentinel}`);
  }
}

function main() {
  checkReleaseState();
  checkPackageDocs();
  checkErrorFailClosedContract();
  checkWorkflowGuardrails();
  console.log("Review guardrails G1/G2/G5/G8 passed");
}

const mainPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (mainPath && fileURLToPath(import.meta.url) === mainPath) {
  main();
}
