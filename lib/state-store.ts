import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { checkGitCompletion } from "./git-completion-checker.ts";
import { evaluateSpine } from "./state-machine.ts";
import {
  SPINE_STATE_ROOT,
  type CurrentBinding,
  type EvidenceRecord,
  type HandoffRecord,
  type IssueBinding,
  type PrBinding,
  type SpineContextSnapshot,
  type SpineTaskState,
} from "./types.ts";

export interface BindInput {
  issueIdentifier: string;
  issueUrl?: string;
  issueTitle?: string;
}

export interface LinkPrInput {
  prUrl: string;
  prNumber?: number;
  prHeadSha?: string;
  prBranch?: string;
  prTitle?: string;
  prBody?: string;
  metadata?: Record<string, unknown>;
  writebackRecorded?: boolean;
}

export interface EvidenceInput {
  kind: EvidenceRecord["kind"];
  command?: string;
  exitCode?: number;
  summary: string;
  outputExcerpt?: string;
}

export interface HandoffInput {
  done: string[];
  changed: string[];
  verification: string[];
  blockers?: string[];
  next?: string[];
  risks?: string[];
}

export function safeIssueIdentifier(issueIdentifier: string): string {
  const trimmed = issueIdentifier.trim();
  const ascii = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 8);
  return `${ascii || "issue"}-${digest}`;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPortablePath(path: string): string {
  return path.split(String.fromCharCode(92)).join("/");
}

export class SpineStateStore {
  readonly cwd: string;
  readonly root: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT);
  }

  currentPath(): string {
    return join(this.root, "current.json");
  }

  taskPath(issueIdentifier: string): string {
    return join(this.root, "tasks", `${safeIssueIdentifier(issueIdentifier)}.json`);
  }

  async loadCurrent(): Promise<CurrentBinding | undefined> {
    return readJson<CurrentBinding>(this.currentPath());
  }

  async loadActiveTask(): Promise<SpineTaskState | undefined> {
    const current = await this.loadCurrent();
    if (!current) return undefined;
    return readJson<SpineTaskState>(join(this.root, current.taskFile));
  }

  async context(): Promise<SpineContextSnapshot> {
    const current = await this.loadCurrent();
    const task = current ? await this.loadActiveTask() : undefined;
    return {
      root: relative(this.cwd, this.root) || SPINE_STATE_ROOT,
      current,
      task,
      evaluation: evaluateSpine(task),
    };
  }

  async bind(input: BindInput): Promise<SpineContextSnapshot> {
    const issueIdentifier = input.issueIdentifier.trim();
    if (!issueIdentifier) throw new Error("issueIdentifier is required");

    const now = new Date().toISOString();
    const path = this.taskPath(issueIdentifier);
    const existing = await readJson<SpineTaskState>(path);
    const issue: IssueBinding = {
      identifier: issueIdentifier,
      url: input.issueUrl,
      title: input.issueTitle,
      boundAt: existing?.issue.boundAt ?? now,
    };
    const task: SpineTaskState = {
      issue,
      pr: existing?.pr,
      evidence: existing?.evidence ?? [],
      handoff: existing?.handoff,
      verifiedAt: existing?.verifiedAt,
      updatedAt: now,
    };
    await writeJson(path, task);

    const current: CurrentBinding = {
      issueIdentifier,
      taskFile: toPortablePath(relative(this.root, path)),
      updatedAt: now,
    };
    await writeJson(this.currentPath(), current);
    return this.context();
  }

  async linkPr(input: LinkPrInput): Promise<SpineContextSnapshot> {
    if (!input.prUrl.trim()) throw new Error("prUrl is required");
    const task = await this.requireActiveTask();
    const now = new Date().toISOString();
    task.pr = {
      prUrl: input.prUrl.trim(),
      prNumber: input.prNumber,
      prHeadSha: input.prHeadSha,
      prBranch: input.prBranch,
      prTitle: input.prTitle,
      prBody: input.prBody,
      metadata: input.metadata,
      writebackRecorded: input.writebackRecorded,
      linkedAt: now,
    } satisfies PrBinding;
    task.updatedAt = now;
    task.verifiedAt = undefined;
    await this.writeActiveTask(task);
    return this.context();
  }

  async addEvidence(input: EvidenceInput): Promise<SpineContextSnapshot> {
    if (!input.summary.trim()) throw new Error("summary is required");
    const task = await this.requireActiveTask();
    const now = new Date().toISOString();
    task.evidence.push({ ...input, summary: input.summary.trim(), timestamp: now });
    task.updatedAt = now;
    task.verifiedAt = undefined;
    await this.writeActiveTask(task);
    return this.context();
  }

  async handoff(input: HandoffInput): Promise<SpineContextSnapshot> {
    const task = await this.requireActiveTask();
    const now = new Date().toISOString();
    task.handoff = { ...input, timestamp: now } satisfies HandoffRecord;
    task.updatedAt = now;
    task.verifiedAt = undefined;
    await this.writeActiveTask(task);
    return this.context();
  }

  async verify(): Promise<SpineContextSnapshot> {
    const task = await this.loadActiveTask();
    const gitCompletion = checkGitCompletion(this.cwd, task);
    const evaluation = evaluateSpine(task, gitCompletion);
    if (task && evaluation.missing.length === 0) {
      task.verifiedAt = new Date().toISOString();
      task.updatedAt = task.verifiedAt;
      await this.writeActiveTask(task);
    }
    const verifiedTask = await this.loadActiveTask();
    const verifiedEvaluation = evaluateSpine(verifiedTask, gitCompletion);
    const current = await this.loadCurrent();
    return {
      root: relative(this.cwd, this.root) || SPINE_STATE_ROOT,
      current,
      task: verifiedTask,
      evaluation: verifiedEvaluation,
    };
  }

  private async requireActiveTask(): Promise<SpineTaskState> {
    const task = await this.loadActiveTask();
    if (!task) throw new Error("No active issue. Call multica_spine_bind first.");
    return task;
  }

  private async writeActiveTask(task: SpineTaskState): Promise<void> {
    await writeJson(this.taskPath(task.issue.identifier), task);
  }
}
