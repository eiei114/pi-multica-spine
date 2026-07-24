export interface ImplementationProject {
  id: string;
  title: string;
  status: string;
}

export interface ImplementationProjectClient {
  list(): Promise<ImplementationProject[]>;
  create(input: { title: string; description: string }): Promise<ImplementationProject>;
}

export interface ResolveImplementationProjectInput {
  projectTitle: string;
  projectDescription: string;
  client: ImplementationProjectClient;
}

export interface ResolvedImplementationProject {
  project: ImplementationProject;
  reused: boolean;
}

export async function resolveImplementationProject(
  input: ResolveImplementationProjectInput,
): Promise<ResolvedImplementationProject> {
  const exactPlanned = (await input.client.list())
    .filter((project) => project.title === input.projectTitle && project.status === "planned");
  if (exactPlanned.length > 1) {
    throw new Error(`Multiple planned Multica projects match implementation title: ${input.projectTitle}`);
  }
  if (exactPlanned.length === 1) return { project: exactPlanned[0], reused: true };
  return {
    project: await input.client.create({ title: input.projectTitle, description: input.projectDescription }),
    reused: false,
  };
}

export function buildImplementationSpineHandoff(input: {
  project: ImplementationProject;
  workflowRunId: string;
}): {
  projectId: string;
  projectTitle: string;
  workflowRunId: string;
  spineRequired: true;
  nextAction: string;
} {
  return {
    projectId: input.project.id,
    projectTitle: input.project.title,
    workflowRunId: input.workflowRunId,
    spineRequired: true,
    nextAction: "Create or select the implementation issue in this project, then call multica_spine_bind before implementation work starts.",
  };
}
