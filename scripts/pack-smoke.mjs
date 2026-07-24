#!/usr/bin/env node
/**
 * Pack the package, install the tarball into a temp directory, and exercise a
 * published CLI path (`scripts/jsonl-digest.mjs` → `dist/lib`).
 *
 * No network publish. Safe for local + CI.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function npm(args, opts = {}) {
  const cwd = opts.cwd ?? root;
  const stdio = opts.stdio ?? ["ignore", "pipe", "pipe"];
  // Windows: spawn npm.cmd without a shell often throws EINVAL; use shell there only.
  if (process.platform === "win32") {
    const command = ["npm", ...args.map(shellQuote)].join(" ");
    return execSync(command, { cwd, encoding: "utf8", stdio, shell: true });
  }
  return execFileSync("npm", args, { cwd, encoding: "utf8", stdio });
}

function parseNpmPackFilename(stdout) {
  // Prefer plain `npm pack` last non-empty line (stable across npm JSON shapes).
  const lines = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("npm "));
  const fromPlain = [...lines].reverse().find((line) => line.endsWith(".tgz"));
  if (fromPlain) return fromPlain;

  // Fallback: npm pack --json may be an array, a flat object, or a name→entry map.
  const trimmed = String(stdout).trim();
  const startCandidates = ["[", "{"].map((ch) => trimmed.indexOf(ch)).filter((idx) => idx >= 0);
  if (startCandidates.length === 0) {
    throw new Error(`npm pack produced no tarball name: ${trimmed.slice(0, 200)}`);
  }
  const packed = JSON.parse(trimmed.slice(Math.min(...startCandidates)));
  const entries = Array.isArray(packed)
    ? packed
    : packed?.filename
      ? [packed]
      : Object.values(packed ?? {});
  const tarballName = entries.find((entry) => typeof entry?.filename === "string")?.filename;
  if (!tarballName) {
    throw new Error(`npm pack did not return a filename: ${trimmed.slice(0, 400)}`);
  }
  return tarballName;
}

async function main() {
  npm(["run", "build"], { stdio: "inherit" });

  // Plain pack: last line is the tarball filename (avoids npm --json shape churn).
  const tarballName = parseNpmPackFilename(npm(["pack"]));
  const tarballPath = join(root, tarballName);

  const smokeRoot = await mkdtemp(join(tmpdir(), "pi-multica-spine-pack-smoke-"));
  const fixtureDir = join(smokeRoot, "fixture");
  await mkdir(fixtureDir, { recursive: true });

  try {
    npm(["init", "-y"], { cwd: smokeRoot, stdio: "ignore" });
    npm(["install", tarballPath], { cwd: smokeRoot, stdio: "inherit" });

    const pkgRoot = join(smokeRoot, "node_modules", "pi-multica-spine");
    const digestCli = join(pkgRoot, "scripts", "jsonl-digest.mjs");
    const distMarker = join(pkgRoot, "dist", "lib", "jsonl-digest.js");

    await readFile(distMarker);
    await readFile(digestCli);

    const jsonlPath = join(fixtureDir, "tasks.jsonl");
    await writeFile(
      jsonlPath,
      `${JSON.stringify({ id: "t1", title: "pack-smoke" })}\n`,
      "utf8",
    );

    const digestOut = execFileSync(process.execPath, [digestCli, jsonlPath], {
      cwd: smokeRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const parsed = JSON.parse(digestOut);
    if (!parsed?.digest || typeof parsed.digest !== "string") {
      throw new Error(`digest CLI output missing digest field: ${digestOut}`);
    }

    const sessionsRoot = join(smokeRoot, "sessions");
    const ideaStatusCli = join(pkgRoot, "scripts", "workflow-idea-status.mjs");
    const ideaStatusEmptyOut = execFileSync(
      process.execPath,
      [ideaStatusCli, "--json", "--sessions-root", sessionsRoot],
      { cwd: smokeRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const ideaStatusEmpty = JSON.parse(ideaStatusEmptyOut);
    if (!ideaStatusEmpty?.schemaVersion || ideaStatusEmpty.dataState !== "NO_IDEA_SESSIONS") {
      throw new Error(`idea-status empty smoke failed: ${ideaStatusEmptyOut.slice(0, 400)}`);
    }

    const ideaEntryCli = join(pkgRoot, "scripts", "workflow-idea-entry.mjs");
    const ideaEntryOut = execFileSync(
      process.execPath,
      [
        ideaEntryCli,
        "--rough-idea",
        "Pack smoke offline idea entry validation seed",
        "--dry-run",
        "--session-suffix",
        "pack-smoke",
        "--sessions-root",
        sessionsRoot,
      ],
      { cwd: smokeRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const ideaEntry = JSON.parse(ideaEntryOut);
    if (!ideaEntry?.ok || ideaEntry.mode !== "offline-plan") {
      throw new Error(`idea-entry smoke failed: ${ideaEntryOut.slice(0, 400)}`);
    }

    const ideaStatusOut = execFileSync(
      process.execPath,
      [ideaStatusCli, "--json", "--sessions-root", sessionsRoot, "--rebuild"],
      { cwd: smokeRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const ideaStatus = JSON.parse(ideaStatusOut);
    if (!ideaStatus?.schemaVersion || ideaStatus.summary.total < 1) {
      throw new Error(`idea-status populated smoke failed: ${ideaStatusOut.slice(0, 400)}`);
    }

    const ideaToBuildSkill = join(pkgRoot, "skills", "idea-to-build", "SKILL.md");
    const ideaStatusSkill = join(pkgRoot, "skills", "idea-status", "SKILL.md");
    await readFile(ideaToBuildSkill);
    await readFile(ideaStatusSkill);

    console.log(
      JSON.stringify(
        {
          ok: true,
          tarball: tarballName,
          digestPreview: parsed.digest.slice(0, 16),
          ideaEntryCanaryPath: ideaEntry.canaryPath,
          ideaStatusDataState: ideaStatus.dataState,
          smokeRoot,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(tarballPath, { force: true });
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
