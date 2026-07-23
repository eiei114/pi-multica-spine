import { join } from "node:path";
import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { StringEnum } from "./schema.ts";
import { safeIssueIdentifier } from "./state-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";
import type { WorkflowControllerLease } from "./workflow-controller-autopilot.ts";
import { WorkflowControllerLeaseStore } from "./workflow-controller-autopilot.ts";

export const WorkflowAgentTemplateSchema = Type.Object({
  templateId: Type.String({ minLength: 1 }),
  templateVersion: Type.Integer({ minimum: 1 }),
  capabilityProfile: Type.String({ minLength: 1 }),
  namePrefix: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  instructions: Type.String({ minLength: 1 }),
  instructionVersion: Type.String({ minLength: 1 }),
  runtimeId: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
  thinkingLevel: Type.Optional(Type.String({ minLength: 1 })),
  skillIds: Type.Array(Type.String({ minLength: 1 })),
  maxConcurrentTasks: Type.Literal(1),
  permissionMode: Type.Literal("private"),
});
export type WorkflowAgentTemplate = Static<typeof WorkflowAgentTemplateSchema>;

export const WorkflowAgentFactoryStateSchema = StringEnum(["created", "ready"]);
export type WorkflowAgentFactoryState = Static<typeof WorkflowAgentFactoryStateSchema>;

export const WorkflowAgentFactoryRecordSchema = Type.Object({
  idempotencyKey: Type.String({ minLength: 1 }),
  projectId: Type.String({ minLength: 1 }),
  agentId: Type.String({ minLength: 1 }),
  agentName: Type.String({ minLength: 1 }),
  templateId: Type.String({ minLength: 1 }),
  templateVersion: Type.Integer({ minimum: 1 }),
  runtimeId: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
  thinkingLevel: Type.Optional(Type.String({ minLength: 1 })),
  instructionVersion: Type.String({ minLength: 1 }),
  state: WorkflowAgentFactoryStateSchema,
  createdAt: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ minLength: 1 }),
});
export type WorkflowAgentFactoryRecord = Static<typeof WorkflowAgentFactoryRecordSchema>;

export interface WorkflowAgentFactoryAuthority {
  workflowRunId: string;
  holderId: string;
  fencingToken: number;
  expectedLeaseExpiry: string;
}

export interface WorkflowAgentFactoryInput extends WorkflowAgentFactoryAuthority {
  projectId: string;
  templateId: string;
  capabilityProfile: string;
}

export interface RuntimeCapabilityCatalog {
  listRuntimes(): Promise<Array<{ runtimeId: string; models: Array<{ model: string; thinkingLevels?: string[] }> }>>;
}

export interface AgentInventoryClient {
  listAgents(projectId: string): Promise<Array<{
    agentId: string;
    name: string;
    runtimeId: string;
    model: string;
    thinkingLevel?: string;
    instructions?: string;
    permissionMode?: string;
    status?: string;
  }>>;
  getAgent(agentId: string): Promise<{
    agentId: string;
    name: string;
    runtimeId: string;
    model: string;
    thinkingLevel?: string;
    instructions: string;
    permissionMode: string;
    maxConcurrentTasks?: number;
  }>;
  createAgent(input: {
    projectId: string;
    name: string;
    description: string;
    instructions: string;
    runtimeId: string;
    model: string;
    thinkingLevel?: string;
    permissionMode: "private";
    maxConcurrentTasks: 1;
  }): Promise<{ agentId: string }>;
  listAgentSkills(agentId: string): Promise<string[]>;
  addAgentSkill(agentId: string, skillId: string): Promise<void>;
}

const FORBIDDEN_TEMPLATE_KEYS = new Set([
  "customEnv",
  "custom_env",
  "mcpConfig",
  "mcp_config",
  "customArgs",
  "custom_args",
  "visibility",
  "publicAccess",
  "public_access",
  "agentFactory",
  "agent_factory",
]);

export function assertValidWorkflowAgentTemplate(input: unknown): WorkflowAgentTemplate {
  if (input && typeof input === "object") {
    for (const key of Object.keys(input as Record<string, unknown>)) {
      if (FORBIDDEN_TEMPLATE_KEYS.has(key)) {
        throw new Error(`Workflow agent template forbids field: ${key}`);
      }
    }
  }
  return assertValid(validateSchema(WorkflowAgentTemplateSchema, input), "Invalid workflow agent template");
}

export function buildAgentFactoryIdempotencyKey(input: {
  projectId: string;
  capabilityProfile: string;
  template: WorkflowAgentTemplate;
}): string {
  return sha256Hex({
    projectId: input.projectId,
    capabilityProfile: input.capabilityProfile,
    template: `${input.template.templateId}@${input.template.templateVersion}`,
    runtimeId: input.template.runtimeId,
    model: input.template.model,
    thinkingLevel: input.template.thinkingLevel ?? "",
    instructionVersion: input.template.instructionVersion,
  });
}

export function buildDeterministicAgentName(template: WorkflowAgentTemplate, idempotencyKey: string): string {
  return `${template.namePrefix}-${idempotencyKey.slice(0, 12)}`;
}

export async function assertControllerLeaseAuthority(
  leaseStore: WorkflowControllerLeaseStore,
  authority: WorkflowAgentFactoryAuthority,
  now: Date = new Date(),
): Promise<WorkflowControllerLease> {
  const lease = await leaseStore.load(authority.workflowRunId);
  if (!lease || lease.releasedAt) throw new Error("Agent factory requires an active controller lease");
  if (lease.holderId !== authority.holderId) throw new Error("Agent factory lease holder mismatch");
  if (lease.fencingToken !== authority.fencingToken) throw new Error("Agent factory stale fencing token");
  if (Date.parse(lease.expiresAt) <= now.getTime()) throw new Error("Agent factory lease expired");
  if (Date.parse(authority.expectedLeaseExpiry) !== Date.parse(lease.expiresAt)) {
    throw new Error("Agent factory expected lease expiry mismatch");
  }
  return lease;
}

export async function validateRuntimeModelCompatibility(
  catalog: RuntimeCapabilityCatalog,
  template: WorkflowAgentTemplate,
): Promise<void> {
  const runtimes = await catalog.listRuntimes();
  const runtime = runtimes.find((item) => item.runtimeId === template.runtimeId);
  if (!runtime) throw new Error(`Runtime catalog unavailable for ${template.runtimeId}`);
  const model = runtime.models.find((item) => item.model === template.model);
  if (!model) throw new Error(`Unsupported model ${template.model} for runtime ${template.runtimeId}`);
  if (template.thinkingLevel && model.thinkingLevels && !model.thinkingLevels.includes(template.thinkingLevel)) {
    throw new Error(`Unsupported thinking level ${template.thinkingLevel} for model ${template.model}`);
  }
}

export class WorkflowAgentFactoryStore {
  readonly cwd: string;
  readonly root: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT, "workflow-agent-factory");
  }

  recordPath(projectId: string, idempotencyKey: string): string {
    return join(this.root, safeIssueIdentifier(projectId), `${idempotencyKey}.json`);
  }

  async load(projectId: string, idempotencyKey: string): Promise<WorkflowAgentFactoryRecord | undefined> {
    const record = await readJsonFile<WorkflowAgentFactoryRecord>(this.recordPath(projectId, idempotencyKey));
    if (!record) return undefined;
    return assertValid(validateSchema(WorkflowAgentFactoryRecordSchema, record), "Invalid agent factory record");
  }

  async save(record: WorkflowAgentFactoryRecord): Promise<WorkflowAgentFactoryRecord> {
    const validated = assertValid(validateSchema(WorkflowAgentFactoryRecordSchema, record), "Invalid agent factory record");
    await withFileLock(this.recordPath(validated.projectId, validated.idempotencyKey), async () => {
      await writeJsonAtomic(this.recordPath(validated.projectId, validated.idempotencyKey), validated);
    });
    return validated;
  }
}

export async function provisionWorkflowAgent(
  input: WorkflowAgentFactoryInput,
  deps: {
    leaseStore: WorkflowControllerLeaseStore;
    factoryStore: WorkflowAgentFactoryStore;
    templates: ReadonlyMap<string, WorkflowAgentTemplate>;
    inventory: AgentInventoryClient;
    runtimeCatalog: RuntimeCapabilityCatalog;
    now?: Date;
  },
): Promise<WorkflowAgentFactoryRecord> {
  await assertControllerLeaseAuthority(deps.leaseStore, input, deps.now);
  const template = deps.templates.get(input.templateId);
  if (!template) throw new Error(`Unknown workflow agent template: ${input.templateId}`);
  if (template.capabilityProfile !== input.capabilityProfile) {
    throw new Error(`Template capability profile mismatch: ${template.capabilityProfile} != ${input.capabilityProfile}`);
  }
  assertValidWorkflowAgentTemplate(template);
  await validateRuntimeModelCompatibility(deps.runtimeCatalog, template);

  const idempotencyKey = buildAgentFactoryIdempotencyKey({
    projectId: input.projectId,
    capabilityProfile: input.capabilityProfile,
    template,
  });
  const existing = await deps.factoryStore.load(input.projectId, idempotencyKey);
  if (existing?.state === "ready") return existing;

  const agentName = buildDeterministicAgentName(template, idempotencyKey);
  const agents = await deps.inventory.listAgents(input.projectId);
  const sameName = agents.find((agent) => agent.name === agentName);
  if (sameName) {
    const details = await deps.inventory.getAgent(sameName.agentId);
    const mismatch =
      details.runtimeId !== template.runtimeId ||
      details.model !== template.model ||
      details.instructions !== template.instructions;
    if (mismatch) throw new Error(`Deterministic agent name collision with incompatible configuration: ${agentName}`);
    const skills = await deps.inventory.listAgentSkills(sameName.agentId);
    for (const skillId of template.skillIds) {
      if (!skills.includes(skillId)) await deps.inventory.addAgentSkill(sameName.agentId, skillId);
    }
    const now = (deps.now ?? new Date()).toISOString();
    return deps.factoryStore.save({
      idempotencyKey,
      projectId: input.projectId,
      agentId: sameName.agentId,
      agentName,
      templateId: template.templateId,
      templateVersion: template.templateVersion,
      runtimeId: template.runtimeId,
      model: template.model,
      thinkingLevel: template.thinkingLevel,
      instructionVersion: template.instructionVersion,
      state: "ready",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  const created = await deps.inventory.createAgent({
    projectId: input.projectId,
    name: agentName,
    description: template.description,
    instructions: `${template.instructions}\n\nStage work only. Do not create Agents, Issues, or next Stages.`,
    runtimeId: template.runtimeId,
    model: template.model,
    thinkingLevel: template.thinkingLevel,
    permissionMode: "private",
    maxConcurrentTasks: 1,
  });

  const createdRecord: WorkflowAgentFactoryRecord = {
    idempotencyKey,
    projectId: input.projectId,
    agentId: created.agentId,
    agentName,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    runtimeId: template.runtimeId,
    model: template.model,
    thinkingLevel: template.thinkingLevel,
    instructionVersion: template.instructionVersion,
    state: "created",
    createdAt: (deps.now ?? new Date()).toISOString(),
    updatedAt: (deps.now ?? new Date()).toISOString(),
  };
  await deps.factoryStore.save(createdRecord);

  for (const skillId of template.skillIds) {
    await deps.inventory.addAgentSkill(created.agentId, skillId);
  }
  const readBack = await deps.inventory.getAgent(created.agentId);
  const boundSkills = await deps.inventory.listAgentSkills(created.agentId);
  if (
    readBack.runtimeId !== template.runtimeId ||
    readBack.model !== template.model ||
    readBack.permissionMode !== "private" ||
    (readBack.maxConcurrentTasks ?? 1) !== 1
  ) {
    throw new Error("Agent factory read-back mismatch after create");
  }
  for (const skillId of template.skillIds) {
    if (!boundSkills.includes(skillId)) throw new Error(`Missing bound skill after create: ${skillId}`);
  }

  return deps.factoryStore.save({ ...createdRecord, state: "ready", updatedAt: (deps.now ?? new Date()).toISOString() });
}
