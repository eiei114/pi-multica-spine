import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface LocalImportClosureCheck {
  checked: boolean;
  localIssuePath?: string;
  readyForMultica?: boolean;
  closed: boolean;
  instruction?: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".multica-spine", "dist", "build", ".next"]);
const SCAN_RELATIVE_ROOTS = ["Issues", "issues", join("4_Project", "Multica-Agent-Strategy", "Issues")];
const MAX_SCAN_DEPTH = 6;
const MAX_FILES = 120;

export const LOCAL_IMPORT_CLOSURE_INSTRUCTION =
  "Set ready_for_multica: false on the linked local issue markdown before reporting done. This prevents import-local-issues from resetting a completed Multica issue to backlog.";

export function parseFrontmatterValue(source: string, key: string): string | undefined {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return undefined;
  const frontmatter = normalized.slice(4, end);
  const pattern = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = frontmatter.match(pattern);
  if (!match) return undefined;
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

export function isReadyForMulticaImport(source: string): boolean {
  const value = parseFrontmatterValue(source, "ready_for_multica");
  return value?.toLowerCase() === "true";
}

export function frontmatterMatchesIssue(source: string, issueIdentifier: string): boolean {
  const trimmed = issueIdentifier.trim();
  if (!trimmed) return false;
  const multicaIssueId = parseFrontmatterValue(source, "multica_issue_id");
  const multicaIssue = parseFrontmatterValue(source, "multica_issue");
  return multicaIssueId === trimmed || multicaIssue === trimmed;
}

async function readMarkdownHead(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf8");
    return content.slice(0, 8192);
  } catch {
    return undefined;
  }
}

async function walkMarkdownFiles(dir: string, depth: number, output: string[]): Promise<void> {
  if (depth > MAX_SCAN_DEPTH || output.length >= MAX_FILES) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (output.length >= MAX_FILES) return;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkMarkdownFiles(fullPath, depth + 1, output);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      output.push(fullPath);
    }
  }
}

export async function discoverLocalIssuePath(cwd: string, issueIdentifier: string): Promise<string | undefined> {
  const candidates: string[] = [];

  for (const relativeRoot of SCAN_RELATIVE_ROOTS) {
    const root = resolve(cwd, relativeRoot);
    if (!existsSync(root)) continue;
    await walkMarkdownFiles(root, 0, candidates);
  }

  for (const path of candidates) {
    const head = await readMarkdownHead(path);
    if (!head || !frontmatterMatchesIssue(head, issueIdentifier)) continue;
    return path;
  }

  return undefined;
}

export async function checkLocalImportClosure(
  cwd: string,
  issueIdentifier: string,
  localIssuePath?: string,
): Promise<LocalImportClosureCheck> {
  const resolvedPath = localIssuePath
    ? resolve(cwd, localIssuePath)
    : await discoverLocalIssuePath(cwd, issueIdentifier);

  if (!resolvedPath) {
    return { checked: false, closed: true };
  }

  const head = await readMarkdownHead(resolvedPath);
  if (!head) {
    return { checked: true, localIssuePath: toPortablePath(cwd, resolvedPath), closed: true };
  }

  const readyForMultica = isReadyForMulticaImport(head);
  const closed = !readyForMultica;
  return {
    checked: true,
    localIssuePath: toPortablePath(cwd, resolvedPath),
    readyForMultica,
    closed,
    instruction: closed ? undefined : LOCAL_IMPORT_CLOSURE_INSTRUCTION,
  };
}

function toPortablePath(cwd: string, absolutePath: string): string {
  const rel = relative(cwd, absolutePath);
  return rel.split(String.fromCharCode(92)).join("/") || absolutePath;
}
