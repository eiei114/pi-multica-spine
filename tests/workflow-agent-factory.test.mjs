import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WorkflowAgentFactoryStore,
  assertControllerLeaseAuthority,
  buildAgentFactoryIdempotencyKey,
  buildDeterministicAgentName,
  provisionWorkflowAgent,
} from "../lib/workflow-agent-factory.ts";
import { WorkflowControllerLeaseStore } from "../lib/workflow-controller-autopilot.ts";

const template = {
  templateId: "sandbox-worker",
  templateVersion: 1,
  capabilityProfile: "implementer",
  namePrefix: "wf-worker",
  description: "Sandbox worker",
  instructions: "Implement stage output only.",
  instructionVersion: "v1",
  runtimeId: "runtime_1",
  model: "claude-sonnet",
  skillIds: ["skill_impl"],
  maxConcurrentTasks: 1,
  permissionMode: "private",
};

test("agent factory idempotency key is deterministic", () => {
  const key = buildAgentFactoryIdempotencyKey({
    projectId: "proj_1",
    capabilityProfile: "implementer",
    template,
  });
  assert.equal(key, buildAgentFactoryIdempotencyKey({
    projectId: "proj_1",
    capabilityProfile: "implementer",
    template,
  }));
  assert.match(buildDeterministicAgentName(template, key), /^wf-worker-/);
});

test("agent factory rejects stale fencing token", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "factory-lease-"));
  const leaseStore = new WorkflowControllerLeaseStore(cwd);
  const lease = await leaseStore.acquire("run_1", "controller_a");
  await assert.rejects(
    () => assertControllerLeaseAuthority(leaseStore, {
      workflowRunId: "run_1",
      holderId: "controller_a",
      fencingToken: lease.fencingToken + 1,
      expectedLeaseExpiry: lease.expiresAt,
    }),
    /stale fencing token/,
  );
});

test("agent factory adopts deterministic existing agent and binds skills additively", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "factory-prov-"));
  const leaseStore = new WorkflowControllerLeaseStore(cwd);
  const factoryStore = new WorkflowAgentFactoryStore(cwd);
  const lease = await leaseStore.acquire("run_1", "controller_a");
  const idempotencyKey = buildAgentFactoryIdempotencyKey({
    projectId: "proj_1",
    capabilityProfile: "implementer",
    template,
  });
  const agentName = buildDeterministicAgentName(template, idempotencyKey);
  const agents = new Map();
  const inventory = {
    async listAgents() {
      return [...agents.values()];
    },
    async getAgent(agentId) {
      return agents.get(agentId);
    },
    async createAgent(input) {
      const agentId = `agent_${agents.size + 1}`;
      const record = {
        agentId,
        name: input.name,
        runtimeId: input.runtimeId,
        model: input.model,
        instructions: input.instructions,
        permissionMode: input.permissionMode,
        maxConcurrentTasks: input.maxConcurrentTasks,
      };
      agents.set(agentId, record);
      return { agentId };
    },
    async listAgentSkills(agentId) {
      return agents.get(agentId)?.skills ?? [];
    },
    async addAgentSkill(agentId, skillId) {
      const record = agents.get(agentId);
      record.skills = [...new Set([...(record.skills ?? []), skillId])];
    },
  };
  const runtimeCatalog = {
    async listRuntimes() {
      return [{ runtimeId: "runtime_1", models: [{ model: "claude-sonnet" }] }];
    },
  };
  const authority = {
    workflowRunId: "run_1",
    holderId: "controller_a",
    fencingToken: lease.fencingToken,
    expectedLeaseExpiry: lease.expiresAt,
  };
  const first = await provisionWorkflowAgent({
    ...authority,
    projectId: "proj_1",
    templateId: template.templateId,
    capabilityProfile: template.capabilityProfile,
  }, {
    leaseStore,
    factoryStore,
    templates: new Map([[template.templateId, template]]),
    inventory,
    runtimeCatalog,
  });
  const second = await provisionWorkflowAgent({
    ...authority,
    projectId: "proj_1",
    templateId: template.templateId,
    capabilityProfile: template.capabilityProfile,
  }, {
    leaseStore,
    factoryStore,
    templates: new Map([[template.templateId, template]]),
    inventory,
    runtimeCatalog,
  });
  assert.equal(first.agentId, second.agentId);
  assert.equal(first.agentName, agentName);
  assert.deepEqual(await inventory.listAgentSkills(first.agentId), ["skill_impl"]);
});
