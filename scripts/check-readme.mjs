#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CI_DESCRIPTION_PREFIX = "`npm run ci` runs";
const DEVELOPMENT_SECTION_HEADING = /^## Development\b.*$/m;
export const MIN_OPEN_ROADMAP_SEEDS = 3;

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
const REGISTERED_TOOL_PATTERN = /name:\s*"(multica_(?:spine|workflow)_[a-z0-9_]+)"/g;

export function extractRegisteredToolNames(extensionSource = "") {
  return [...extensionSource.matchAll(REGISTERED_TOOL_PATTERN)].map((match) => match[1]).sort();
}

export function validateReadmeToolAlignment(content, extensionSource = "") {
  const errors = [];
  const registered = extractRegisteredToolNames(extensionSource);
  const missing = registered.filter((name) => !content.includes(`\`${name}\``));
  if (missing.length > 0) {
    errors.push(`README omits registered tool references: ${missing.join(", ")}`);
  }
  return { ok: errors.length === 0, errors, registered, missing };
}

const PACKAGE_CONTENTS_SECTION_HEADING = /^## Package contents\b.*$/m;

/**
 * Normalize a `files` entry or a README table path so that `dist/`, `dist`,
 * `./dist/` and `dist\\` all compare equal. npm `files` entries are
 * directory-prefixes with a trailing slash, while README rows may use either
 * form.
 */
export function normalizePackageContentsPath(path = "") {
  return String(path)
    .trim()
    .replace(/\r/g, "")
    .replace(/`/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\/+$/, "");
}

function extractPackageContentsSection(content) {
  const headingMatch = content.match(PACKAGE_CONTENTS_SECTION_HEADING);
  if (!headingMatch) {
    return null;
  }
  const rest = content.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

/**
 * Return the first-column paths of the `## Package contents` table, in order.
 */
export function extractReadmePackageContentsPaths(content = "") {
  content = content.replace(/\r\n/g, "\n");
  const section = extractPackageContentsSection(content);
  if (section === null) {
    return null;
  }

  return section.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      return [];
    }
    const cells = trimmed
      .split("|")
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .map((cell) => cell.trim());
    const first = cells[0] ?? "";
    const path = normalizePackageContentsPath(first);
    // Skip the header row and the `---` separator row, including GFM
    // alignment colons such as `:---`, `---:`, and `:---:`.
    if (!path || path === "Path" || /^:?-{2,}:?$/.test(path)) {
      return [];
    }
    return [path];
  });
}

/**
 * Validate that the README `## Package contents` table lists exactly the
 * `package.json` `files` entries: every shipped path documented, and no
 * documented path that the package does not ship.
 */
export function validateReadmePackageContents(content = "", packageFiles = []) {
  const errors = [];
  const expected = (Array.isArray(packageFiles) ? packageFiles : [])
    .map((entry) => normalizePackageContentsPath(entry))
    .filter((entry) => entry.length > 0);

  const documented = extractReadmePackageContentsPaths(content);
  if (documented === null) {
    errors.push("README Package contents section missing");
    return { ok: false, errors, documented: [], missing: expected, extra: [] };
  }
  if (expected.length === 0) {
    errors.push("package.json files list unavailable for README Package contents validation");
    return { ok: false, errors, documented, missing: [], extra: [] };
  }

  const documentedSet = new Set(documented);
  const expectedSet = new Set(expected);
  const missing = expected.filter((entry) => !documentedSet.has(entry));
  const extra = documented.filter((entry) => !expectedSet.has(entry));

  if (missing.length > 0) {
    errors.push(`README Package contents table omits files entries: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    errors.push(
      `README Package contents table lists paths not in package.json files: ${extra.join(", ")}`,
    );
  }

  return { ok: errors.length === 0, errors, documented, missing, extra };
}

export const README_DOCS_SECTION_ENTRIES = [
  {
    path: "docs/workflow-ops-checklist.md",
    description: "daily sandbox / Maintenance rehearsal path",
  },
  {
    path: "docs/workflow-sandbox-live-execute-runbook.md",
    description: "live sandbox `--execute` path",
  },
  {
    path: "docs/workflow-production-live-execute-runbook.md",
    description: "live Maintenance `--execute` path",
  },
];

export function buildReadmeDocsSectionLine({ path, description }) {
  return `- [\`${path}\`](${path}) — ${description}`;
}

export function validateReadmeDocsSectionAlignment(content) {
  content = content.replace(/\r\n/g, "\n");
  const errors = [];
  const headingMatch = content.match(/^## Docs\b.*$/m);
  if (!headingMatch) {
    return { ok: false, errors: ["README Docs section missing"] };
  }
  const rest = content.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = rest.search(/^## /m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const lines = section.split("\n");
  for (const entry of README_DOCS_SECTION_ENTRIES) {
    const expectedLine = buildReadmeDocsSectionLine(entry);
    const matchingLines = lines.filter((line) => line === expectedLine);
    if (matchingLines.length !== 1) {
      errors.push(`README Docs section missing or drifted entry: ${entry.path}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function extractRoadmapDocumentedVersions(content = "") {
  const publishedMatch = content.match(
    /^\|\s*Published version\s*\|\s*\*\*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\*\*/m,
  );
  const workingTreeMatch = content.match(
    /^\|\s*Working-tree version\s*\|\s*`(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)`/m,
  );
  return {
    published: publishedMatch?.[1] ?? null,
    workingTree: workingTreeMatch?.[1] ?? null,
  };
}

function extractRoadmapCandidateSection(content) {
  const headingMatch = content.match(/^## Candidate maintenance seeds\b.*$/m);
  if (!headingMatch) {
    return null;
  }
  const rest = content.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

export function extractOpenRoadmapSeeds(content = "") {
  const section = extractRoadmapCandidateSection(content);
  if (section === null) {
    return null;
  }

  return section.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      return [];
    }
    const cells = trimmed
      .split("|")
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .map((cell) => cell.trim());
    const [id, task = "", estimate = "", scopeNote = ""] = cells;
    if (!/^R-MNT-\d+$/.test(id ?? "")) {
      return [];
    }
    return [{ id, task, estimate, scopeNote }];
  });
}

function hasRoadmapSeedScope(seed) {
  return [seed.task, seed.estimate, seed.scopeNote].every((value) => value.trim().length > 0);
}

export function validateRoadmapFreshness(content, packageVersion, { minOpenSeeds = MIN_OPEN_ROADMAP_SEEDS } = {}) {
  const errors = [];
  const versions = extractRoadmapDocumentedVersions(content);
  if (!versions.published) {
    errors.push("ROADMAP Published version is missing or not a semantic version");
  }

  if (!packageVersion) {
    errors.push("package.json version unavailable for ROADMAP freshness validation");
  }
  if (!versions.workingTree) {
    errors.push("ROADMAP Working-tree version is missing or not a semantic version");
  } else if (packageVersion && versions.workingTree !== packageVersion) {
    errors.push(`ROADMAP Working-tree version ${versions.workingTree} does not match package.json version ${packageVersion}`);
  }

  const openSeeds = extractOpenRoadmapSeeds(content);
  if (openSeeds === null) {
    errors.push("ROADMAP Candidate maintenance seeds section missing");
    return { ok: false, errors, versions, openSeeds: [], scopedSeeds: [] };
  }

  const unscopedSeeds = openSeeds.filter((seed) => !hasRoadmapSeedScope(seed));
  if (unscopedSeeds.length > 0) {
    errors.push(
      `ROADMAP open seed entries missing scope notes (Task, Est., and Why needed): ${unscopedSeeds.map((seed) => seed.id).join(", ")}`,
    );
  }

  const scopedSeeds = openSeeds.filter(hasRoadmapSeedScope);
  if (scopedSeeds.length < minOpenSeeds) {
    errors.push(
      `ROADMAP requires at least ${minOpenSeeds} open seed entries with scope notes; found ${scopedSeeds.length}`,
    );
  }

  return { ok: errors.length === 0, errors, versions, openSeeds, scopedSeeds };
}

export function validateReadme(content, { version, ciScript, extensionSource, roadmapContent, packageFiles, validateRegisteredTools = false, validateDocsSection = false, validatePackageContents = false } = {}) {
  content = content.replace(/\r\n/g, "\n");
  const errors = [];
  const fenceLines = content.split("\n").filter((line) => FENCE.test(line.trim()));
  if (fenceLines.length % 2 !== 0) {
    errors.push(`unbalanced fenced code blocks (${fenceLines.length} fence lines)`);
  }

  const pinMatch = content.match(
    /```[^\n]*\npi install npm:pi-multica-spine@(\d+\.\d+\.\d+)\n```/,
  );
  const roadmapVersions = roadmapContent === undefined
    ? null
    : extractRoadmapDocumentedVersions(roadmapContent);
  if (!pinMatch) {
    errors.push("missing install pin example: pi install npm:pi-multica-spine@<version>");
  } else {
    // The install pin must match a version we can actually justify: prefer the
    // ROADMAP "Published version" when a roadmap is supplied, otherwise fall
    // back to the package.json version. Either way the check still runs, so a
    // stale pin cannot pass merely because roadmapContent was omitted.
    const expectedPin = roadmapVersions?.published ?? version;
    if (expectedPin && pinMatch[1] !== expectedPin) {
      const source = roadmapVersions?.published
        ? `ROADMAP published version ${roadmapVersions.published}`
        : `package.json version ${version}`;
      errors.push(`install pin example @${pinMatch[1]} does not match ${source}`);
    }
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

  if (validateRegisteredTools) {
    if (!extensionSource) {
      errors.push("extension entry source required for registered tool alignment but was unavailable");
    } else {
      const toolAlignment = validateReadmeToolAlignment(content, extensionSource);
      errors.push(...toolAlignment.errors);
    }
  }

  if (validateDocsSection) {
    const docsAlignment = validateReadmeDocsSectionAlignment(content);
    errors.push(...docsAlignment.errors);
  }

  if (validatePackageContents) {
    const packageContents = validateReadmePackageContents(content, packageFiles);
    errors.push(...packageContents.errors);
  }

  if (roadmapContent !== undefined) {
    const roadmapFreshness = validateRoadmapFreshness(roadmapContent, version);
    errors.push(...roadmapFreshness.errors);
  }

  return { ok: errors.length === 0, errors };
}

export function runCheckReadme({
  readmePath = "README.md",
  packageJsonPath = "package.json",
  extensionPath = "extensions/index.ts",
  roadmapPath = "ROADMAP.md",
} = {}) {
  const content = readFileSync(readmePath, "utf8");
  let version;
  let ciScript;
  let packageFiles;
  let extensionSource;
  let roadmapContent;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    version = pkg.version;
    ciScript = pkg.scripts?.ci;
    packageFiles = Array.isArray(pkg.files) ? pkg.files : [];
  } catch {
    // optional version alignment when package.json is unavailable
    console.error(`unable to read package manifest: ${packageJsonPath}`);
    return 1;
  }
  try {
    extensionSource = readFileSync(extensionPath, "utf8");
  } catch {
    console.error(`unable to read extension entry: ${extensionPath}`);
    return 1;
  }
  try {
    roadmapContent = readFileSync(roadmapPath, "utf8");
  } catch {
    console.error(`unable to read roadmap: ${roadmapPath}`);
    return 1;
  }
  const result = validateReadme(content, {
    version,
    ciScript,
    extensionSource,
    roadmapContent,
    packageFiles,
    validateRegisteredTools: true,
    validateDocsSection: true,
    validatePackageContents: true,
  });
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    return 1;
  }
  console.log("readme ok");
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  process.exitCode = runCheckReadme();
}
