import { existsSync } from "node:fs";
import { join, parse, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { SpineTaskState } from "./types.ts";

export interface GitCompletionCheck {
  checked: boolean;
  blockers: string[];
  nextAction?: string;
  branchStatus?: string;
  headSha?: string;
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 2000 }).trim();
  } catch {
    return undefined;
  }
}

function gitDir(cwd: string): string | undefined {
  return git(cwd, ["rev-parse", "--git-dir"]);
}

function gitTopLevel(cwd: string): string | undefined {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

function isFilesystemRoot(path: string): boolean {
  const normalized = resolve(path);
  return normalized === parse(normalized).root;
}

function hasGitState(cwd: string, dir: string, fileOrDir: string): boolean {
  const absolute = dir.startsWith("/") || /^[A-Za-z]:[\/]/.test(dir) ? dir : join(cwd, dir);
  return existsSync(join(absolute, fileOrDir));
}

function dirtyLines(cwd: string): string[] {
  const status = git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (!status) return [];
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      const path = line.slice(3).replace(/^"|"$/g, "");
      return !path.startsWith(".multica-spine/") && path !== ".multica-spine";
    });
}

function hasLeftoverConflictMarkers(cwd: string): boolean {
  const unstaged = git(cwd, ["diff", "--check"]);
  const staged = git(cwd, ["diff", "--cached", "--check"]);
  return `${unstaged ?? ""}\n${staged ?? ""}`.includes("leftover conflict marker");
}

function branchHasUnpushedCommits(branchStatus?: string): boolean {
  return Boolean(branchStatus && /\[(?:[^\]]*,\s*)?ahead \d+/.test(branchStatus));
}

export function checkGitCompletion(cwd: string, task?: SpineTaskState): GitCompletionCheck {
  const dir = gitDir(cwd);
  const topLevel = gitTopLevel(cwd);
  if (!dir || !topLevel || isFilesystemRoot(topLevel)) return { checked: false, blockers: [] };

  const blockers: string[] = [];
  const branchStatus = git(cwd, ["status", "--short", "--branch"])
    ?.split(/\r?\n/)[0]
    ?.trim();
  const headSha = git(cwd, ["rev-parse", "HEAD"]);

  if (hasGitState(cwd, dir, "rebase-merge") || hasGitState(cwd, dir, "rebase-apply")) {
    blockers.push("git: rebase in progress");
  }
  if (hasGitState(cwd, dir, "MERGE_HEAD")) blockers.push("git: merge in progress");
  if (hasLeftoverConflictMarkers(cwd)) blockers.push("git: leftover conflict markers");

  const dirty = dirtyLines(cwd);
  if (dirty.length > 0) blockers.push(`git: working tree has uncommitted changes (${dirty.length})`);

  if (branchHasUnpushedCommits(branchStatus)) blockers.push("git: local commits not pushed to remote");

  if (task?.pr?.prHeadSha && headSha && task.pr.prHeadSha !== headSha) {
    blockers.push("git: PR head SHA metadata is stale");
  }

  let nextAction: string | undefined;
  if (blockers.includes("git: local commits not pushed to remote")) {
    nextAction = "Push the current branch. If history was rewritten by rebase and CI passed, run `git push --force-with-lease` without asking the user.";
  } else if (blockers.length > 0) {
    nextAction = "Finish git cleanup, run verification, update PR metadata/evidence, then run multica_spine_verify again.";
  }

  return { checked: true, blockers, nextAction, branchStatus, headSha };
}
