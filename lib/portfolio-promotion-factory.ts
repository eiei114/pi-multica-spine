import { readFile } from "node:fs/promises";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { AutomaticPromotionDeps } from "./idea-auto-promotion.ts";
import type { ImplementationProject } from "./idea-project-promotion.ts";
import { createHermesCompositeManifest } from "./hermes-adapter.ts";
import { createIssueClient, createProjectClient, runMultica, type MulticaRunner } from "./multica-cli.ts";
import { assertValidProjectWorkflowBinding, type ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { ProjectWorkflowBindingStore } from "./project-workflow-binding-store.ts";
import { WorkflowRunStateStore } from "./workflow-run-state.ts";
import { createWorkflowLiveCli } from "./workflow-live-cli.ts";

const RoleRouteSchema = Type.Object({
  agentId: Type.String({ minLength: 1 }),
  capabilityProfile: Type.Optional(Type.String({ minLength: 1 })),
  notes: Type.Optional(Type.String({ minLength: 1 })),
});

export const PortfolioPromotionFactoryConfigSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  projectTitle: Type.String({ minLength: 1 }),
  projectDescription: Type.String({ minLength: 1 }),
  artifactRoot: Type.String({ minLength: 1 }),
  projectGrants: Type.Array(Type.String({ minLength: 1 })),
  humanOwnedActions: Type.Array(Type.String({ minLength: 1 })),
  roleRoutes: Type.Record(Type.String({ minLength: 1 }), RoleRouteSchema),
  autoAdvancePolicy: Type.Literal("autonomous"),
  executionMode: Type.Literal("autonomous_until_final"),
  humanGate: Type.Literal("final_only"),
  deliveryPolicy: Type.Object({
    prRequired: Type.Boolean(),
    releaseAllowed: Type.Boolean(),
    productionAllowed: Type.Boolean(),
    destructiveAllowed: Type.Boolean(),
  }),
  projectKey: Type.Optional(Type.String({ minLength: 1 })),
  enabledOptionalStages: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  metadata: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
});
export type PortfolioPromotionFactoryConfig = Static<typeof PortfolioPromotionFactoryConfigSchema>;

/** Load only a user-named config file; no default path or environment fallback exists. */
export async function loadExplicitPortfolioPromotionFactoryConfig(path: string): Promise<PortfolioPromotionFactoryConfig> {
  if (!path) throw new Error("Explicit promotion factory config path is required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read explicit promotion factory config: ${(error as Error).message}`);
  }
  if (!Value.Check(PortfolioPromotionFactoryConfigSchema, parsed)) {
    const details = [...Value.Errors(PortfolioPromotionFactoryConfigSchema, parsed)]
      .map((error) => `${"path" in error && error.path ? error.path : "/"}: ${error.message}`).join("; ");
    throw new Error(`Invalid explicit promotion factory config: ${details}`);
  }
  return parsed as PortfolioPromotionFactoryConfig;
}

function projectRecord(value: Record<string, unknown>): ImplementationProject {
  if (typeof value.id !== "string" || !value.id || typeof value.title !== "string" || !value.title || typeof value.status !== "string" || !value.status) {
    throw new Error("Explicit promotion factory requires project list/create responses with id, title, and status");
  }
  return { id: value.id, title: value.title, status: value.status };
}

/**
 * Builds live promotion collaborators only from an explicit, validated operator
 * configuration. Constructing this factory performs no Multica calls.
 */
export function createExplicitPortfolioPromotionFactory(input: {
  cwd: string;
  config: PortfolioPromotionFactoryConfig;
  runner?: MulticaRunner;
}): AutomaticPromotionDeps {
  const runner = input.runner ?? runMultica;
  const projects = createProjectClient(runner);
  const issues = createIssueClient(runner);
  const manifest = createHermesCompositeManifest();

  const buildBinding = (project: ImplementationProject): ProjectWorkflowBinding => assertValidProjectWorkflowBinding({
    schemaVersion: 1,
    multicaProjectId: project.id,
    projectKey: input.config.projectKey,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: input.config.artifactRoot,
    enabledOptionalStages: input.config.enabledOptionalStages ?? [],
    projectGrants: input.config.projectGrants,
    humanOwnedActions: input.config.humanOwnedActions,
    roleRoutes: input.config.roleRoutes,
    autoAdvancePolicy: input.config.autoAdvancePolicy,
    executionMode: input.config.executionMode,
    humanGate: input.config.humanGate,
    deliveryPolicy: input.config.deliveryPolicy,
    metadata: input.config.metadata,
  }, manifest);

  return {
    cwd: input.cwd,
    projects: {
      async list() { return (await projects.list()).map(projectRecord); },
      async create(project) { return projectRecord(await projects.create({ ...project, status: "planned" })); },
    },
    buildBinding,
    async createParentIssue(parent) {
      const created = await issues.create({ ...parent, status: "todo" });
      return { id: created.id, identifier: created.identifier };
    },
    async activateProject(projectId) { await projects.setStatus(projectId, "active"); },
    liveCli: createWorkflowLiveCli(runner),
    runStore: new WorkflowRunStateStore(input.cwd),
    bindingStore: new ProjectWorkflowBindingStore(input.cwd),
  };
}
