import { spawn } from "node:child_process";

/**
 * Thin wrapper around the `multica` CLI's `issue metadata` subcommands.
 *
 * The spine's own tools (bind, link_pr, add_evidence, handoff, verify) manage
 * repo-local state. The metadata tools here are different: they are genuine
 * CLI wrappers that shell out to `multica issue metadata list|set|delete`,
 * force `--output json`, and return the parsed key/value map so work agents
 * can read and write per-issue metadata without hand-rolling CLI flags.
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
