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

async function main() {
  npm(["run", "build"], { stdio: "inherit" });

  const packJson = npm(["pack", "--json"]).trim();
  const packed = JSON.parse(packJson);
  const tarballName = packed[0]?.filename ?? packed[0]?.id;
  if (!tarballName) {
    throw new Error(`npm pack --json did not return a filename: ${packJson}`);
  }
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

    console.log(
      JSON.stringify(
        {
          ok: true,
          tarball: tarballName,
          digestPreview: parsed.digest.slice(0, 16),
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
