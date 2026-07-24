import { spawn } from "node:child_process";
import { access, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * Thin wrappers around the `multica` CLI for workflow-adapter live operations.
 *
 * Metadata tools shell out to `multica issue metadata list|set|delete`.
 * Issue/project/autopilot helpers cover stage issue create/assign/update/status,
 * parent summary writeback, and controller autopilot triggers. All commands force
 * `--output json` where supported and return parsed objects via injectable runners
 * so tests can swap fixture-backed executors without hiding product gaps.
 */

/** Default executable name. Resolved via PATH (e.g. `multica.exe` on Windows). */
export const DEFAULT_MULTICA_EXECUTABLE = "multica";

/** Metadata value type as accepted by the CLI's `--type` flag. */
export type MetadataValueType = "string" | "number" | "bool";

/** A single metadata value as exchanged with the CLI. */
export type MetadataValue = string | number | boolean;

/** The flat key/value object returned by `multica issue metadata ... --output json`. */
export type MetadataMap = Record<string, unknown>;

export interface RunMulticaOptions {
  /** Working directory for the subprocess. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override the executable name/path. Defaults to `multica`. */
  executable?: string;
  /** Environment for the subprocess. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface MulticaCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type MetadataSubcommand = "list" | "set" | "delete";

/**
 * Infer the CLI `--type` from a JS value so the exact runtime type is preserved
 * across the wire. Without this, a JS string `"42"` would be JSON-sniffed by the
 * CLI into the number `42`; inferring `string` forces it to stay a string.
 */
export function inferMetadataType(value: MetadataValue): MetadataValueType {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  return "string";
}

/** Render a metadata value into the literal `--value` string the CLI expects. */
export function renderMetadataValue(value: MetadataValue): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Build the argv for a `multica issue metadata <subcommand>` call, always with
 * `--output json`. Arguments are returned as a literal array (never a shell
 * string) so callers can pass them to `spawn` without shell escaping.
 */
export function buildMetadataArgs(
  subcommand: MetadataSubcommand,
  issueIdentifier: string,
  extra: { key?: string; value?: MetadataValue; type?: MetadataValueType } = {},
): string[] {
  const args = ["issue", "metadata", subcommand, issueIdentifier, "--output", "json"];
  if (extra.key !== undefined) {
    args.push("--key", extra.key);
  }
  if (extra.value !== undefined) {
    args.push("--value", renderMetadataValue(extra.value));
  }
  if (extra.type) {
    args.push("--type", extra.type);
  }
  return args;
}

/**
 * Parse the JSON object printed by the metadata commands. Empty output is
 * treated as an empty map; non-object output is rejected.
 */
export function parseMetadataJson(stdout: string): MetadataMap {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`multica metadata: failed to parse JSON output: ${(error as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("multica metadata: expected a JSON object from the CLI");
  }
  return parsed as MetadataMap;
}

/**
 * Run the `multica` CLI with the given argv. The executable is invoked directly
 * (no shell), so arguments are passed literally without escaping or injection
 * risk. Resolves with stdout/stderr on success; rejects with a descriptive
 * error (including stderr) on a non-zero exit or spawn failure.
 */
export function runMultica(args: string[], options: RunMulticaOptions = {}): Promise<MulticaCommandResult> {
  const executable = options.executable ?? DEFAULT_MULTICA_EXECUTABLE;
  const env = options.env ?? process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString("utf8")));
    child.on("error", (error) => {
      reject(new Error(`Failed to spawn multica CLI (${executable}): ${error.message}`));
    });
    child.on("close", (code) => {
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        const detail = (stderr || stdout).trim();
        const cmd = [executable, ...args].join(" ");
        reject(new Error(`multica command failed (exit ${exitCode}): ${cmd}${detail ? `: ${detail}` : ""}`));
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}

/** A runner that executes a multica argv and returns raw command output. */
export type MulticaRunner = (args: string[], options: RunMulticaOptions) => Promise<MulticaCommandResult>;

export interface MetadataClient {
  list(issueIdentifier: string, options?: RunMulticaOptions): Promise<MetadataMap>;
  set(
    issueIdentifier: string,
    key: string,
    value: MetadataValue,
    type: MetadataValueType | undefined,
    options?: RunMulticaOptions,
  ): Promise<MetadataMap>;
  delete(issueIdentifier: string, key: string, options?: RunMulticaOptions): Promise<MetadataMap>;
}

/**
 * Build a metadata client over an injectable runner. Production code passes the
 * real {@link runMultica}; tests pass a fake runner to assert on argv and canned
 * JSON without spawning the CLI.
 */
export function createMetadataClient(runner: MulticaRunner): MetadataClient {
  return {
    async list(issueIdentifier, options = {}) {
      const result = await runner(buildMetadataArgs("list", issueIdentifier), options);
      return parseMetadataJson(result.stdout);
    },
    async set(issueIdentifier, key, value, type, options = {}) {
      const resolvedType = type ?? inferMetadataType(value);
      const result = await runner(buildMetadataArgs("set", issueIdentifier, { key, value, type: resolvedType }), options);
      return parseMetadataJson(result.stdout);
    },
    async delete(issueIdentifier, key, options = {}) {
      const result = await runner(buildMetadataArgs("delete", issueIdentifier, { key }), options);
      return parseMetadataJson(result.stdout);
    },
  };
}

/** Default metadata client backed by the real `multica` CLI. */
export const metadataClient: MetadataClient = createMetadataClient(runMultica);

/** Parsed JSON object from any multica `--output json` command. */
export function parseJsonOutput(stdout: string, label = "multica"): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label}: failed to parse JSON output: ${(error as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}: expected a JSON object from the CLI`);
  }
  return parsed as Record<string, unknown>;
}

export interface IssueRecord {
  id: string;
  identifier?: string;
  title?: string;
  status?: string;
  project_id?: string;
  parent_issue_id?: string;
  stage?: number;
  assignee_id?: string;
  assignee_type?: string;
  metadata?: MetadataMap;
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  parentIssueId?: string;
  stage?: number;
  projectId?: string;
  status?: string;
  assigneeId?: string;
  priority?: string;
}

export interface UpdateIssueInput {
  title?: string;
  status?: string;
  stage?: number;
  assigneeId?: string;
  projectId?: string;
}

export function buildIssueGetArgs(issueIdentifier: string): string[] {
  return ["issue", "get", issueIdentifier, "--output", "json"];
}

export function buildIssueCreateArgs(input: CreateIssueInput): string[] {
  const args = ["issue", "create", "--title", input.title, "--output", "json"];
  if (input.description) args.push("--description", input.description);
  if (input.parentIssueId) args.push("--parent", input.parentIssueId);
  if (input.stage !== undefined) args.push("--stage", String(input.stage));
  if (input.projectId) args.push("--project", input.projectId);
  if (input.status) args.push("--status", input.status);
  if (input.assigneeId) args.push("--assignee-id", input.assigneeId);
  if (input.priority) args.push("--priority", input.priority);
  return args;
}

export function buildIssueAssignArgs(issueIdentifier: string, assigneeId: string): string[] {
  return ["issue", "assign", issueIdentifier, "--to-id", assigneeId, "--output", "json"];
}

export function buildIssueUpdateArgs(issueIdentifier: string, input: UpdateIssueInput): string[] {
  const args = ["issue", "update", issueIdentifier, "--output", "json"];
  if (input.title) args.push("--title", input.title);
  if (input.status) args.push("--status", input.status);
  if (input.stage !== undefined) args.push("--stage", String(input.stage));
  if (input.assigneeId) args.push("--assignee-id", input.assigneeId);
  if (input.projectId) args.push("--project", input.projectId);
  return args;
}

export function buildIssueStatusArgs(issueIdentifier: string, status: string): string[] {
  return ["issue", "status", issueIdentifier, status, "--output", "json"];
}

export function buildProjectGetArgs(projectId: string): string[] {
  return ["project", "get", projectId, "--output", "json"];
}

export function buildProjectListArgs(): string[] {
  return ["project", "list", "--output", "json"];
}

export function buildProjectCreateArgs(input: { title: string; description: string; status?: string }): string[] {
  const args = ["project", "create", "--title", input.title, "--description", input.description];
  if (input.status) args.push("--status", input.status);
  args.push("--output", "json");
  return args;
}

export function buildProjectStatusArgs(projectId: string, status: string): string[] {
  return ["project", "status", projectId, "--set", status, "--output", "json"];
}

export function buildAutopilotTriggerArgs(autopilotId: string): string[] {
  return ["autopilot", "trigger", autopilotId, "--output", "json"];
}

export function buildRuntimeListArgs(): string[] {
  return ["runtime", "list", "--output", "json"];
}

export function buildRuntimeUsageArgs(provider?: string, accountRef?: string): string[] {
  const args = ["runtime", "usage", "--output", "json"];
  if (provider) args.push("--provider", provider);
  if (accountRef) args.push("--account", accountRef);
  return args;
}

export function buildAgentListArgs(projectId?: string): string[] {
  const args = ["agent", "list", "--output", "json"];
  if (projectId) args.push("--project", projectId);
  return args;
}

export function buildAgentGetArgs(agentId: string): string[] {
  return ["agent", "get", agentId, "--output", "json"];
}

export function buildAgentCreateArgs(input: {
  projectId: string;
  name: string;
  description?: string;
  instructions: string;
  runtimeId: string;
  model: string;
  thinkingLevel?: string;
  permissionMode?: string;
  maxConcurrentTasks?: number;
}): string[] {
  const args = [
    "agent", "create",
    "--project", input.projectId,
    "--name", input.name,
    "--instructions", input.instructions,
    "--runtime", input.runtimeId,
    "--model", input.model,
    "--output", "json",
  ];
  if (input.description) args.push("--description", input.description);
  if (input.thinkingLevel) args.push("--thinking", input.thinkingLevel);
  if (input.permissionMode) args.push("--permission-mode", input.permissionMode);
  if (input.maxConcurrentTasks !== undefined) args.push("--max-concurrent-tasks", String(input.maxConcurrentTasks));
  return args;
}

export function buildAgentSkillsAddArgs(agentId: string, skillId: string): string[] {
  return ["agent", "skills", "add", agentId, skillId, "--output", "json"];
}

export function buildAgentSkillsListArgs(agentId: string): string[] {
  return ["agent", "skills", "list", agentId, "--output", "json"];
}

export function parseJsonArrayOutput(stdout: string, label: string): Record<string, unknown>[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label}: failed to parse JSON output: ${(error as Error).message}`);
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[];
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown[] }).items)) {
    return ((parsed as { items: unknown[] }).items)
      .filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[];
  }
  return [parsed as Record<string, unknown>];
}

export interface AgentRecord {
  id: string;
  name?: string;
  runtime_id?: string;
  model?: string;
  thinking_level?: string;
  instructions?: string;
  permission_mode?: string;
  max_concurrent_tasks?: number;
  status?: string;
  project_id?: string;
}

export interface RuntimeRecord {
  id: string;
  online?: boolean;
  models?: Array<{ model: string; thinking_levels?: string[] }>;
}

export interface AgentClient {
  list(projectId?: string, options?: RunMulticaOptions): Promise<AgentRecord[]>;
  get(agentId: string, options?: RunMulticaOptions): Promise<AgentRecord>;
  create(input: Parameters<typeof buildAgentCreateArgs>[0], options?: RunMulticaOptions): Promise<AgentRecord>;
  listSkills(agentId: string, options?: RunMulticaOptions): Promise<string[]>;
  addSkill(agentId: string, skillId: string, options?: RunMulticaOptions): Promise<void>;
}

export interface RuntimeClient {
  list(options?: RunMulticaOptions): Promise<RuntimeRecord[]>;
  usage(provider?: string, accountRef?: string, options?: RunMulticaOptions): Promise<Record<string, unknown>>;
}

export function createAgentClient(runner: MulticaRunner): AgentClient {
  return {
    async list(projectId, options = {}) {
      const result = await runner(buildAgentListArgs(projectId), options);
      return parseJsonArrayOutput(result.stdout, "multica agent list") as unknown as AgentRecord[];
    },
    async get(agentId, options = {}) {
      const result = await runner(buildAgentGetArgs(agentId), options);
      return parseJsonOutput(result.stdout, "multica agent get") as unknown as AgentRecord;
    },
    async create(input, options = {}) {
      const result = await runner(buildAgentCreateArgs(input), options);
      return parseJsonOutput(result.stdout, "multica agent create") as unknown as AgentRecord;
    },
    async listSkills(agentId, options = {}) {
      const result = await runner(buildAgentSkillsListArgs(agentId), options);
      const items = parseJsonArrayOutput(result.stdout, "multica agent skills list");
      return items.map((item) => String(item.id ?? item.skill_id ?? item.name ?? "")).filter(Boolean);
    },
    async addSkill(agentId, skillId, options = {}) {
      await runner(buildAgentSkillsAddArgs(agentId, skillId), options);
    },
  };
}

export function createRuntimeClient(runner: MulticaRunner): RuntimeClient {
  return {
    async list(options = {}) {
      const result = await runner(buildRuntimeListArgs(), options);
      return parseJsonArrayOutput(result.stdout, "multica runtime list") as unknown as RuntimeRecord[];
    },
    async usage(provider, accountRef, options = {}) {
      const result = await runner(buildRuntimeUsageArgs(provider, accountRef), options);
      return parseJsonOutput(result.stdout, "multica runtime usage");
    },
  };
}

export const agentClient: AgentClient = createAgentClient(runMultica);
export const runtimeClient: RuntimeClient = createRuntimeClient(runMultica);

export function parseIssueRecord(stdout: string): IssueRecord {
  const parsed = parseJsonOutput(stdout, "multica issue");
  if (typeof parsed.id !== "string" || !parsed.id) {
    throw new Error("multica issue: expected issue record with id");
  }
  return parsed as unknown as IssueRecord;
}

export interface IssueClient {
  get(issueIdentifier: string, options?: RunMulticaOptions): Promise<IssueRecord>;
  create(input: CreateIssueInput, options?: RunMulticaOptions): Promise<IssueRecord>;
  assign(issueIdentifier: string, assigneeId: string, options?: RunMulticaOptions): Promise<IssueRecord>;
  update(issueIdentifier: string, input: UpdateIssueInput, options?: RunMulticaOptions): Promise<IssueRecord>;
  setStatus(issueIdentifier: string, status: string, options?: RunMulticaOptions): Promise<IssueRecord>;
}

export interface ProjectClient {
  list(options?: RunMulticaOptions): Promise<Record<string, unknown>[]>;
  get(projectId: string, options?: RunMulticaOptions): Promise<Record<string, unknown>>;
  create(input: { title: string; description: string; status?: string }, options?: RunMulticaOptions): Promise<Record<string, unknown>>;
  setStatus(projectId: string, status: string, options?: RunMulticaOptions): Promise<Record<string, unknown>>;
}

export interface AutopilotClient {
  trigger(autopilotId: string, options?: RunMulticaOptions): Promise<Record<string, unknown>>;
}

export function createIssueClient(runner: MulticaRunner): IssueClient {
  return {
    async get(issueIdentifier, options = {}) {
      const result = await runner(buildIssueGetArgs(issueIdentifier), options);
      return parseIssueRecord(result.stdout);
    },
    async create(input, options = {}) {
      const result = await runner(buildIssueCreateArgs(input), options);
      return parseIssueRecord(result.stdout);
    },
    async assign(issueIdentifier, assigneeId, options = {}) {
      const result = await runner(buildIssueAssignArgs(issueIdentifier, assigneeId), options);
      return parseIssueRecord(result.stdout);
    },
    async update(issueIdentifier, input, options = {}) {
      const result = await runner(buildIssueUpdateArgs(issueIdentifier, input), options);
      return parseIssueRecord(result.stdout);
    },
    async setStatus(issueIdentifier, status, options = {}) {
      const result = await runner(buildIssueStatusArgs(issueIdentifier, status), options);
      return parseIssueRecord(result.stdout);
    },
  };
}

export function createProjectClient(runner: MulticaRunner): ProjectClient {
  return {
    async list(options = {}) {
      const result = await runner(buildProjectListArgs(), options);
      return parseJsonArrayOutput(result.stdout, "multica project list");
    },
    async get(projectId, options = {}) {
      const result = await runner(buildProjectGetArgs(projectId), options);
      return parseJsonOutput(result.stdout, "multica project");
    },
    async create(input, options = {}) {
      const result = await runner(buildProjectCreateArgs(input), options);
      return parseJsonOutput(result.stdout, "multica project create");
    },
    async setStatus(projectId, status, options = {}) {
      const result = await runner(buildProjectStatusArgs(projectId, status), options);
      return parseJsonOutput(result.stdout, "multica project status");
    },
  };
}

export function createAutopilotClient(runner: MulticaRunner): AutopilotClient {
  return {
    async trigger(autopilotId, options = {}) {
      const result = await runner(buildAutopilotTriggerArgs(autopilotId), options);
      return parseJsonOutput(result.stdout, "multica autopilot");
    },
  };
}

/** Default issue client backed by the real `multica` CLI. */
export const issueClient: IssueClient = createIssueClient(runMultica);

/** Default project client backed by the real `multica` CLI. */
export const projectClient: ProjectClient = createProjectClient(runMultica);

const DAEMON_TASK_CONTEXT_RELATIVE = join(".multica", "daemon_task_context.json");

/**
 * Remove a leftover `.multica/daemon_task_context.json` marker when not running
 * inside an agent task. Multica CLI rejects user tokens when this file exists.
 */
export async function clearStaleDaemonTaskContext(cwd = process.cwd()): Promise<boolean> {
  const path = join(cwd, DAEMON_TASK_CONTEXT_RELATIVE);
  try {
    await access(path);
  } catch {
    return false;
  }
  await unlink(path);
  return true;
}

/** Default autopilot client backed by the real `multica` CLI. */
export const autopilotClient: AutopilotClient = createAutopilotClient(runMultica);
