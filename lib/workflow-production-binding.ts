import { createHermesCompositeManifest } from "./hermes-adapter.ts";
import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";

export const PRODUCTION_PROJECT_ID = "415010b1-f28a-4ae4-9042-ddeb00800029";
export const PRODUCTION_PROJECT_NAME = "pi-multica-spine Maintenance";
export const PRODUCTION_REPO_PATH = "C:/Users/Keisu/Projects/OSS/pi-multica-spine";
export const PRODUCTION_DAEMON_ID = "019e4c75-0504-7591-8646-260b510ce726";
export const PRODUCTION_WORKER_AGENT_ID = "b37ce518-3592-4b31-ad02-df6a5bdd267e";

export interface ProductionBindingPlan {
  multicaProjectId: string;
  projectName: string;
  repoPath: string;
  daemonId: string;
  adapterId: string;
  adapterVersion: number;
  artifactRoot: string;
  deliveryPolicy: ProjectWorkflowBinding["deliveryPolicy"];
  humanOwnedActions: string[];
  enabledOptionalStages: string[];
}

export function buildProductionWorkflowBinding(multicaProjectId = PRODUCTION_PROJECT_ID): ProjectWorkflowBinding {
  const manifest = createHermesCompositeManifest();
  const roleRoutes = Object.fromEntries(
    manifest.roles.map((role) => [role, { agentId: PRODUCTION_WORKER_AGENT_ID, capabilityProfile: role }]),
  );
  return {
    schemaVersion: 1,
    multicaProjectId,
    projectKey: "PI-SPINE-PROD",
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: "Artifacts/workflows",
    enabledOptionalStages: [],
    projectGrants: ["design_doc", "implementation", "verification", "release"],
    humanOwnedActions: ["release", "production", "destructive", "billing", "secrets"],
    roleRoutes,
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "start_and_final",
    deliveryPolicy: {
      prRequired: true,
      releaseAllowed: true,
      productionAllowed: false,
      destructiveAllowed: false,
    },
    metadata: {
      binding_tier: "production",
      package_name: "pi-multica-spine",
      color_output_policy: "json_default_opt_in_color",
    },
  };
}

export function buildProductionBindingPlan(): ProductionBindingPlan {
  const manifest = createHermesCompositeManifest();
  const binding = buildProductionWorkflowBinding();
  return {
    multicaProjectId: PRODUCTION_PROJECT_ID,
    projectName: PRODUCTION_PROJECT_NAME,
    repoPath: PRODUCTION_REPO_PATH,
    daemonId: PRODUCTION_DAEMON_ID,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: binding.artifactRoot,
    deliveryPolicy: binding.deliveryPolicy,
    humanOwnedActions: [...(binding.humanOwnedActions ?? [])],
    enabledOptionalStages: [...(binding.enabledOptionalStages ?? [])],
  };
}
