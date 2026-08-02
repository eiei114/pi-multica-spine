#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CI_DESCRIPTION_PREFIX = "`npm run ci` runs";
const DEVELOPMENT_SECTION_HEADING = /^## Development\b.*$/m;

export function extractDevelopmentSection(content) {
  const headingMatch = content.match(DEVELOPMENT_SECTION_HEADING);
  if (!headingMatch) {
    return null;
  }

  const sectionStart = headingMatch.index;
  const rest = content.slice(sectionStart + headingMatch[0].length);
  const nextHeading = rest.search(/^## /m);
  const sectionBody = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return headingMatch[0] + sectionBody;
}

export function extractCiCheckScripts(ciScript = "") {
  return [...ciScript.matchAll(/npm run (check:[a-z0-9-]+)/g)].map((match) => match[1]);
}

export function validateCiReadmeAlignment(content, ciScript) {
  const errors = [];
  const developmentSection = extractDevelopmentSection(content);
  if (!developmentSection) {
    errors.push("Development section missing npm run ci description line");
    return { ok: false, errors };
  }

  const ciLine = developmentSection
    .split("\n")
    .find((line) => line.includes(CI_DESCRIPTION_PREFIX));
  if (!ciLine) {
    errors.push("Development section missing npm run ci description line");
    return { ok: false, errors };
  }

  const missing = extractCiCheckScripts(ciScript).filter((script) => !ciLine.includes(`\`${script}\``));
  if (missing.length > 0) {
    errors.push(`npm run ci description omits check scripts: ${missing.join(", ")}`);
  }

  return { ok: errors.length === 0, errors };
}

const FENCE = /^```/;

export function validateReadme(content, { version, ciScript } = {}) {
  const errors = [];
  const fenceLines = content.split("\n").filter((line) => FENCE.test(line.trim()));
  if (fenceLines.length % 2 !== 0) {
    errors.push(`unbalanced fenced code blocks (${fenceLines.length} fence lines)`);
  }

  const pinMatch = content.match(
    /```[^\n]*\npi install npm:pi-multica-spine@(\d+\.\d+\.\d+)\n```/,
  );
  if (!pinMatch) {
    errors.push("missing install pin example: pi install npm:pi-multica-spine@<version>");
  } else if (version && pinMatch[1] !== version) {
    errors.push(`install pin example @${pinMatch[1]} does not match package.json version ${version}`);
  }

  if (/``npm run ci`/.test(content)) {
    errors.push("Development section has malformed backticks around npm run ci");
  }

  if (/productionAllowed=false\)\.\n\n```\n\nInstall into the current project/.test(content)) {
    errors.push("stray fenced-code closer after maintenance-build entry skill");
  }

  if (ciScript) {
    const ciAlignment = validateCiReadmeAlignment(content, ciScript);
    errors.push(...ciAlignment.errors);
  }

  return { ok: errors.length === 0, errors };
}

export function runCheckReadme({ readmePath = "README.md", packageJsonPath = "package.json" } = {}) {
  const content = readFileSync(readmePath, "utf8");
  let version;
  let ciScript;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    version = pkg.version;
    ciScript = pkg.scripts?.ci;
  } catch {
    // optional version alignment when package.json is unavailable
  }
  const result = validateReadme(content, { version, ciScript });
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    return 1;
  }
  console.log(`readme ok (pin=@${version ?? "unknown"})`);
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  process.exitCode = runCheckReadme();
}
