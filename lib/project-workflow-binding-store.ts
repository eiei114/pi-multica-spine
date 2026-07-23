import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { safeIssueIdentifier } from "./state-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { ProjectWorkflowBindingSchema, type ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { assertValid, validateSchema } from "./validation.ts";
import type { WorkflowLiveCli } from "./workflow-live-cli.ts";

export class ProjectWorkflowBindingStore {
  readonly cwd: string;
  readonly root: string;
  readonly liveCli?: WorkflowLiveCli;

  constructor(cwd: string, options: { liveCli?: WorkflowLiveCli } = {}) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT, "workflow-bindings");
    this.liveCli = options.liveCli;
  }

  bindingPath(multicaProjectId: string): string {
    return join(this.root, `${safeIssueIdentifier(multicaProjectId)}.json`);
  }

  async save(binding: ProjectWorkflowBinding): Promise<ProjectWorkflowBinding> {
    const validated = assertValid(validateSchema(ProjectWorkflowBindingSchema, binding), "Invalid project workflow binding");
    if (this.liveCli) {
      await this.liveCli.verifyProject(validated.multicaProjectId);
    }
    const path = this.bindingPath(validated.multicaProjectId);
    return withFileLock(path, async () => {
      await writeJsonAtomic(path, validated);
      return validated;
    });
  }

  async getByProjectId(multicaProjectId: string): Promise<ProjectWorkflowBinding | undefined> {
    const binding = await readJsonFile<ProjectWorkflowBinding>(this.bindingPath(multicaProjectId));
    if (!binding) return undefined;
    return assertValid(validateSchema(ProjectWorkflowBindingSchema, binding), "Invalid project workflow binding");
  }

  async get(projectIdOrKey: string): Promise<ProjectWorkflowBinding | undefined> {
    const direct = await this.getByProjectId(projectIdOrKey);
    if (direct) return direct;
    const all = await this.list();
    return all.find((binding) => binding.projectKey === projectIdOrKey);
  }

  async list(): Promise<ProjectWorkflowBinding[]> {
    try {
      const files = await readdir(this.root, { withFileTypes: true });
      const bindings: ProjectWorkflowBinding[] = [];
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".json")) continue;
        const binding = await readJsonFile<ProjectWorkflowBinding>(join(this.root, file.name));
        if (binding) {
          bindings.push(assertValid(validateSchema(ProjectWorkflowBindingSchema, binding), "Invalid project workflow binding"));
        }
      }
      return bindings.sort((left, right) => left.multicaProjectId.localeCompare(right.multicaProjectId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
