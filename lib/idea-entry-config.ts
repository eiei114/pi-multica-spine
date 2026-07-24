import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Type, type Static } from "typebox";

import { StringEnum } from "./schema.ts";
import { assertValid, validateSchema } from "./validation.ts";

export const IdeaEntryConfigSchema = Type.Object({
  vaultRoot: Type.Optional(Type.String({ minLength: 1 })),
  sessionsRoot: Type.Optional(Type.String({ minLength: 1 })),
  vaultIdeaRelativeDir: Type.Optional(Type.String({ minLength: 1 })),
});

export type IdeaEntryConfigFile = Static<typeof IdeaEntryConfigSchema>;

export interface ResolvedIdeaEntryConfig {
  vaultRoot?: string;
  sessionsRoot?: string;
  vaultIdeaRelativeDir: string;
  source: "flag" | "environment" | "project-config" | "repo-discovery";
}

export interface ResolveIdeaEntryConfigInput {
  flagVaultRoot?: string;
  flagSessionsRoot?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  projectConfigPath?: string;
}

const DEFAULT_VAULT_IDEA_RELATIVE_DIR = "4_Project/Multica-Agent-Strategy/Ideas";
const CONFIG_FILENAMES = [".pi-idea-entry.json", ".multica-spine/idea-entry.json"];

async function readProjectConfig(configPath: string): Promise<IdeaEntryConfigFile | undefined> {
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return assertValid(validateSchema(IdeaEntryConfigSchema, raw), `Invalid idea entry config: ${configPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function discoverProjectConfig(cwd: string): Promise<{ path: string; config: IdeaEntryConfigFile } | undefined> {
  let current = resolve(cwd);
  for (let depth = 0; depth < 8; depth += 1) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(current, name);
      const config = await readProjectConfig(candidate);
      if (config) return { path: candidate, config };
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function normalizeRoot(value: string | undefined, cwd: string): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}

export async function resolveIdeaEntryConfig(input: ResolveIdeaEntryConfigInput = {}): Promise<ResolvedIdeaEntryConfig> {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();

  if (input.flagVaultRoot || input.flagSessionsRoot) {
    return {
      vaultRoot: normalizeRoot(input.flagVaultRoot, cwd),
      sessionsRoot: normalizeRoot(input.flagSessionsRoot, cwd),
      vaultIdeaRelativeDir: DEFAULT_VAULT_IDEA_RELATIVE_DIR,
      source: "flag",
    };
  }

  const envVault = env.PI_VAULT_ROOT?.trim();
  const envSessions = env.PI_IDEA_SESSIONS_ROOT?.trim();
  if (envVault || envSessions) {
    return {
      vaultRoot: normalizeRoot(envVault, cwd),
      sessionsRoot: normalizeRoot(envSessions, cwd),
      vaultIdeaRelativeDir: DEFAULT_VAULT_IDEA_RELATIVE_DIR,
      source: "environment",
    };
  }

  if (input.projectConfigPath) {
    const config = await readProjectConfig(input.projectConfigPath);
    if (config) {
      return {
        vaultRoot: normalizeRoot(config.vaultRoot, cwd),
        sessionsRoot: normalizeRoot(config.sessionsRoot, cwd),
        vaultIdeaRelativeDir: config.vaultIdeaRelativeDir ?? DEFAULT_VAULT_IDEA_RELATIVE_DIR,
        source: "project-config",
      };
    }
  }

  const discovered = await discoverProjectConfig(cwd);
  if (discovered) {
    const { config } = discovered;
    return {
      vaultRoot: normalizeRoot(config.vaultRoot, cwd),
      sessionsRoot: normalizeRoot(config.sessionsRoot, cwd),
      vaultIdeaRelativeDir: config.vaultIdeaRelativeDir ?? DEFAULT_VAULT_IDEA_RELATIVE_DIR,
      source: "repo-discovery",
    };
  }

  throw new Error(
    "Idea entry config not found. Set --vault-root, PI_VAULT_ROOT, or add .pi-idea-entry.json in the project tree.",
  );
}

export const IdeaInvocationStatusSchema = StringEnum([
  "reserved",
  "mutating",
  "completed",
  "failed",
]);
