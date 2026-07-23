import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeIssueIdentifier } from "./state-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { ProjectWorkflowBindingSchema, type ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { assertValid, validateSchema } from "./validation.ts";

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

export class ProjectWorkflowBindingStore {
  readonly cwd: string;
  readonly root: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT, "workflow-bindings");
  }

  bindingPath(multicaProjectId: string): string {
    return join(this.root, `${safeIssueIdentifier(multicaProjectId)}.json`);
  }

  async save(binding: ProjectWorkflowBinding): Promise<ProjectWorkflowBinding> {
    const validated = assertValid(validateSchema(ProjectWorkflowBindingSchema, binding), "Invalid project workflow binding");
    await writeJson(this.bindingPath(validated.multicaProjectId), validated);
    return validated;
  }

  async getByProjectId(multicaProjectId: string): Promise<ProjectWorkflowBinding | undefined> {
    const binding = await readJson<ProjectWorkflowBinding>(this.bindingPath(multicaProjectId));
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
        const binding = await readJson<ProjectWorkflowBinding>(join(this.root, file.name));
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
