import { posix } from "node:path";
import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import type { ProjectWorkflowBinding } from "./project-workflow-binding.ts";
import { StringEnum } from "./schema.ts";
import type { WorkflowCatalogManifest, WorkflowSourceBundle } from "./workflow-catalog.ts";
import { resolveStageActivation } from "./workflow-catalog.ts";
import type {
  WorkflowArtifactEnvelope,
  WorkflowQuestionRecord,
  WorkflowReviewRecord,
  WorkflowRunStateLedger,
} from "./workflow-run-state.ts";
import { assertValid, uniqueValues, validateSchema } from "./validation.ts";

export const HERMES_ADAPTER_ID = "hermes-idea-to-build";
export const HERMES_ADAPTER_VERSION = 1;
export const HERMES_SPEC_REVIEW_STAGE_ID = "spec_review";
export const HERMES_SPEC_FIX_STAGE_ID = "spec_fix";
export const HERMES_FINAL_STAGE_ID = "final_package";
export const HERMES_MAX_FIX_CYCLES = 2;

export const HERMES_PINNED_SOURCE_BUNDLES = [
  {
    name: "hermes-agent-idea-workflow",
    sourceUrl: "https://github.com/AkoliteZA/hermes-agent-idea-workflow",
    sourceCommit: "acf82c9a169050c06ed33b9514ac1e17b6ccb68c",
    sourceContentHash: "3256bd8ed9da5daf59d75b6ed99fb9519b14b15f55b75bc44cbab8e421d4cec3",
    license: "MIT",
  },
  {
    name: "hermes-agent-supwerpowers-chatgpt",
    sourceUrl: "https://github.com/AkoliteZA/hermes-agent-supwerpowers-chatgpt",
    sourceCommit: "5db0d93e7acfd81a7e9f4a64a257d65501102684",
    sourceContentHash: "8609d6b0da22beaed153a7d2fb86144bdf81815de50a60f8f6af270df75a4269",
    license: "MIT",
  },
] as const satisfies readonly WorkflowSourceBundle[];

const IDEA_BUNDLE = "hermes-agent-idea-workflow";
const SUPERPOWERS_BUNDLE = "hermes-agent-supwerpowers-chatgpt";

const HERMES_STAGES = [
  { stageId: "capture", role: "capture", outputs: ["00-idea-capture.md"], sourceBundle: IDEA_BUNDLE, instructionRefs: ["idea-superpowers-suite/SKILL.md"] },
  { stageId: "question_resolution", role: "question_resolver", questionParallelism: "serial", outputs: ["01-question-resolution.md"], sourceBundle: IDEA_BUNDLE, instructionRefs: ["idea-superpowers-suite/SKILL.md", "idea-superpowers-suite/references/interview-question-bank.md"] },
  { stageId: "design_doc", role: "designer", outputs: ["02-design-doc.md"], sourceBundle: IDEA_BUNDLE, instructionRefs: ["idea-to-design-doc/SKILL.md"] },
  { stageId: "ui_design_brief", role: "ui_designer", activation: "binding_optional" as const, outputs: ["03-ui-design-brief.md"], sourceBundle: IDEA_BUNDLE, instructionRefs: ["idea-to-ui-design-brief/SKILL.md"] },
  { stageId: "implementation_spec", role: "spec_author", outputs: ["04-implementation-spec.md"], sourceBundle: IDEA_BUNDLE, instructionRefs: ["idea-to-implementation-doc/SKILL.md"] },
  { stageId: "build_handoff", role: "handoff_author", outputs: ["05-agent-build-handoff.md"], sourceBundle: IDEA_BUNDLE, instructionRefs: ["idea-to-implementation-doc/SKILL.md", "idea-to-implementation-doc/templates/agent-build-handoff-template.md"] },
  { stageId: HERMES_SPEC_REVIEW_STAGE_ID, role: "spec_reviewer", outputs: ["06-spec-review.md"], sourceBundle: IDEA_BUNDLE, instructionRefs: ["idea-superpowers-suite/SKILL.md"] },
  { stageId: HERMES_SPEC_FIX_STAGE_ID, role: "spec_author", activation: "controller_conditional" as const, outputs: ["06a-spec-fix.md"], sourceBundle: IDEA_BUNDLE, instructionRefs: ["idea-to-implementation-doc/SKILL.md"] },
  { stageId: "implementation_plan", role: "planner", outputs: ["07-implementation-plan.md"], sourceBundle: SUPERPOWERS_BUNDLE, instructionRefs: ["superpowers-writing-plans.md"] },
  { stageId: "implementation", role: "implementer", outputs: ["08-build-report.md"], sourceBundle: SUPERPOWERS_BUNDLE, instructionRefs: ["superpowers-executing-plans.md", "superpowers-test-driven-development.md"] },
  { stageId: "spec_compliance_review", role: "spec_reviewer", outputs: ["09-spec-compliance-review.md"], sourceBundle: SUPERPOWERS_BUNDLE, instructionRefs: ["superpowers-requesting-code-review.md"] },
  { stageId: "code_quality_review", role: "code_reviewer", outputs: ["10-code-quality-review.md"], sourceBundle: SUPERPOWERS_BUNDLE, instructionRefs: ["superpowers-requesting-code-review.md", "superpowers-receiving-code-review.md"] },
  { stageId: "verification", role: "verifier", outputs: ["11-verification-report.md"], sourceBundle: SUPERPOWERS_BUNDLE, instructionRefs: ["superpowers-verification-before-completion.md"] },
  { stageId: HERMES_FINAL_STAGE_ID, role: "finalizer", outputs: ["12-final-output-package.md"], sourceBundle: SUPERPOWERS_BUNDLE, instructionRefs: ["superpowers-finishing-a-development-branch.md", "superpowers-verification-before-completion.md"] },
] as const;

const HERMES_ROLES = [...new Set(HERMES_STAGES.map((stage) => stage.role))];

export function createHermesCompositeManifest(): WorkflowCatalogManifest {
  const sourceBundles = HERMES_PINNED_SOURCE_BUNDLES.map((bundle) => ({ ...bundle }));
  const derivedBundleHash = sha256Hex({
    adapterId: HERMES_ADAPTER_ID,
    adapterVersion: HERMES_ADAPTER_VERSION,
    sourceBundles,
    stages: HERMES_STAGES,
    runnerVersion: 1,
  });
  return {
    adapterId: HERMES_ADAPTER_ID,
    adapterVersion: HERMES_ADAPTER_VERSION,
    sourceUrl: sourceBundles[0].sourceUrl,
    sourceCommit: sourceBundles[0].sourceCommit,
    sourceContentHash: sourceBundles[0].sourceContentHash,
    sourceBundles,
    derivedBundleHash,
    license: "MIT",
    auditToolVersion: 1,
    stateSchemaVersion: 1,
    artifactSchemaVersion: 1,
    compatibleFrom: [],
    requiredTools: [
      "multica_workflow_controller_tick",
      "multica_workflow_artifact_record",
      "multica_workflow_hermes_question_answer",
      "multica_workflow_hermes_review_decide",
    ],
    sideEffects: ["multica_issue_write", "project_artifact_write"],
    humanGates: ["start", "final_review"],
    roles: HERMES_ROLES,
    stages: HERMES_STAGES.map((stage) => ({
      ...stage,
      outputs: [...stage.outputs],
      instructionRefs: [...stage.instructionRefs],
    })),
  };
}

export interface HermesStageExecutionPacket {
  adapterId: string;
  adapterVersion: number;
  adapterBundleHash: string;
  stageId: string;
  role: string;
  sourceBundle: string;
  sourceCommit: string;
  sourceContentHash: string;
  instructionRefs: string[];
  outputs: string[];
  questionParallelism?: "serial" | "bounded";
}

export function createHermesStageExecutionPacket(
  manifest: WorkflowCatalogManifest,
  stageId: string,
): HermesStageExecutionPacket {
  if (manifest.adapterId !== HERMES_ADAPTER_ID) throw new Error(`Not a Hermes Adapter manifest: ${manifest.adapterId}`);
  const stage = manifest.stages.find((item) => item.stageId === stageId);
  if (!stage?.sourceBundle || !stage.instructionRefs?.length) {
    throw new Error(`Hermes stage lacks audited instructions: ${stageId}`);
  }
  const source = manifest.sourceBundles?.find((bundle) => bundle.name === stage.sourceBundle);
  if (!source) throw new Error(`Hermes source bundle not found: ${stage.sourceBundle}`);
  return {
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    adapterBundleHash: manifest.derivedBundleHash,
    stageId,
    role: stage.role,
    sourceBundle: source.name,
    sourceCommit: source.sourceCommit,
    sourceContentHash: source.sourceContentHash,
    instructionRefs: [...stage.instructionRefs],
    outputs: [...(stage.outputs ?? [])],
    questionParallelism: stage.questionParallelism,
  };
}

export interface AuditedBundleSnapshot {
  contentHash: string;
  files: Readonly<Record<string, string>>;
}

export interface AuditedBundleLoader {
  loadByDigest(contentHash: string): Promise<AuditedBundleSnapshot>;
}

function validateAuditedBundleSnapshot(
  bundle: WorkflowSourceBundle,
  snapshot: AuditedBundleSnapshot,
  requiredRefs: readonly string[],
): void {
  if (snapshot.contentHash !== bundle.sourceContentHash) {
    throw new Error(`Audited Hermes bundle digest mismatch for ${bundle.name}`);
  }
  const files = Object.keys(snapshot.files);
  if (files.length === 0) throw new Error(`Audited Hermes bundle is empty: ${bundle.name}`);
  for (const file of files) {
    const normalized = posix.normalize(file.replace(/\\/g, "/"));
    if (
      !normalized ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//.test(normalized)
    ) {
      throw new Error(`Audited Hermes bundle contains unsafe path: ${file}`);
    }
  }
  const availableFiles = new Set(files.map((file) => posix.normalize(file.replace(/\\/g, "/"))));
  for (const instructionRef of requiredRefs) {
    if (!availableFiles.has(instructionRef)) {
      throw new Error(`Audited Hermes bundle is missing instruction ref ${instructionRef}`);
    }
  }
}

export async function loadPinnedHermesBundles(loader: AuditedBundleLoader): Promise<AuditedBundleSnapshot[]> {
  const loaded: AuditedBundleSnapshot[] = [];
  for (const bundle of HERMES_PINNED_SOURCE_BUNDLES) {
    const snapshot = await loader.loadByDigest(bundle.sourceContentHash);
    const requiredRefs = HERMES_STAGES
      .filter((stage) => stage.sourceBundle === bundle.name)
      .flatMap((stage) => [...stage.instructionRefs]);
    validateAuditedBundleSnapshot(bundle, snapshot, requiredRefs);
    loaded.push(snapshot);
  }
  return loaded;
}

export async function loadHermesStageInstructions(
  loader: AuditedBundleLoader,
  manifest: WorkflowCatalogManifest,
  stageId: string,
): Promise<{ packet: HermesStageExecutionPacket; instructions: Array<{ ref: string; content: string }> }> {
  const packet = createHermesStageExecutionPacket(manifest, stageId);
  const source = manifest.sourceBundles?.find((bundle) => bundle.name === packet.sourceBundle);
  if (!source) throw new Error(`Hermes source bundle not found: ${packet.sourceBundle}`);
  const snapshot = await loader.loadByDigest(packet.sourceContentHash);
  validateAuditedBundleSnapshot(source, snapshot, packet.instructionRefs);
  return {
    packet,
    instructions: packet.instructionRefs.map((ref) => ({ ref, content: snapshot.files[ref] })),
  };
}

export const HermesResolverRoleSchema = StringEnum(["context", "research", "domain_product", "technical"]);
export type HermesResolverRole = Static<typeof HermesResolverRoleSchema>;

export const HermesQuestionTaskSchema = Type.Object({
  questionId: Type.String({ minLength: 1 }),
  questionTaskId: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  resolverRole: HermesResolverRoleSchema,
  preferenceSensitive: Type.Optional(Type.Boolean()),
  declaredDefault: Type.Optional(Type.String({ minLength: 1 })),
});
export type HermesQuestionTask = Static<typeof HermesQuestionTaskSchema>;

export const HermesProvenanceKindSchema = StringEnum([
  "project_context",
  "external_source",
  "repository",
  "user_statement",
  "declared_default",
  "unresolved",
]);
export type HermesProvenanceKind = Static<typeof HermesProvenanceKindSchema>;

export const HermesAnswerProvenanceSchema = Type.Object({
  kind: HermesProvenanceKindSchema,
  ref: Type.String({ minLength: 1 }),
});
export type HermesAnswerProvenance = Static<typeof HermesAnswerProvenanceSchema>;

export const HermesAnswerArtifactSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  questionId: Type.String({ minLength: 1 }),
  questionTaskId: Type.String({ minLength: 1 }),
  resolverAgentId: Type.String({ minLength: 1 }),
  answerStatus: StringEnum(["observed", "researched", "inferred", "assumed", "unresolved"]),
  answer: Type.String({ minLength: 1 }),
  sourceRefs: Type.Array(Type.String({ minLength: 1 })),
  provenance: Type.Array(HermesAnswerProvenanceSchema, { minItems: 1 }),
  confidence: StringEnum(["high", "medium", "low"]),
  answerHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
});
export type HermesAnswerArtifact = Static<typeof HermesAnswerArtifactSchema>;

export const HermesAnswerInputSchema = Type.Object({
  resolverAgentId: Type.String({ minLength: 1 }),
  answerStatus: StringEnum(["observed", "researched", "inferred", "assumed", "unresolved"]),
  answer: Type.String({ minLength: 1 }),
  sourceRefs: Type.Array(Type.String({ minLength: 1 })),
  provenance: Type.Array(HermesAnswerProvenanceSchema, { minItems: 1 }),
  confidence: StringEnum(["high", "medium", "low"]),
});
export type HermesAnswerInput = Static<typeof HermesAnswerInputSchema>;

function validateHermesAnswerSemantics(task: HermesQuestionTask, input: HermesAnswerInput): void {
  const provenanceKinds = new Set(input.provenance.map((item) => item.kind));
  const provenanceRefs = new Set(input.provenance.map((item) => item.ref));
  for (const sourceRef of input.sourceRefs) {
    if (!provenanceRefs.has(sourceRef)) throw new Error(`Hermes source ref lacks matching provenance: ${sourceRef}`);
  }
  if (input.answerStatus === "researched" && (!input.sourceRefs.length || !provenanceKinds.has("external_source"))) {
    throw new Error("Researched Hermes answers require external source provenance");
  }
  if (input.answerStatus === "unresolved" && input.confidence !== "low") {
    throw new Error("Unresolved Hermes answers must use low confidence");
  }
  if (!task.preferenceSensitive) return;
  if (input.answerStatus === "observed" && provenanceKinds.has("user_statement")) return;
  if (
    input.answerStatus === "assumed" &&
    task.declaredDefault !== undefined &&
    input.answer === task.declaredDefault &&
    provenanceKinds.has("declared_default")
  ) return;
  if (input.answerStatus === "unresolved" && provenanceKinds.has("unresolved")) return;
  throw new Error("Hermes resolver cannot fabricate a user preference");
}

export function createHermesAnswerArtifact(taskInput: HermesQuestionTask, inputValue: HermesAnswerInput): HermesAnswerArtifact {
  const task = assertValid(validateSchema(HermesQuestionTaskSchema, taskInput), "Invalid Hermes Question Task");
  const input = assertValid(validateSchema(HermesAnswerInputSchema, inputValue), "Invalid Hermes Answer input");
  validateHermesAnswerSemantics(task, input);
  const payload = {
    schemaVersion: 1 as const,
    questionId: task.questionId,
    questionTaskId: task.questionTaskId,
    resolverAgentId: input.resolverAgentId,
    answerStatus: input.answerStatus,
    answer: input.answer,
    sourceRefs: [...input.sourceRefs],
    provenance: input.provenance.map((item) => ({ ...item })),
    confidence: input.confidence,
  };
  return assertValid(
    validateSchema(HermesAnswerArtifactSchema, { ...payload, answerHash: sha256Hex(payload) }),
    "Invalid Hermes Answer Artifact",
  );
}

export function resolveHermesQuestionSerially(
  tasksInput: HermesQuestionTask[],
  existingAnswers: readonly WorkflowQuestionRecord[],
  questionId: string,
  input: HermesAnswerInput,
): { artifact: HermesAnswerArtifact; record: WorkflowQuestionRecord } {
  const tasks = tasksInput.map((task) => assertValid(validateSchema(HermesQuestionTaskSchema, task), "Invalid Hermes Question Task"));
  const taskErrors = uniqueValues(tasks.map((task) => task.questionId), "duplicate-question");
  if (taskErrors.length) throw new Error(taskErrors.join(", "));
  const answeredIds = new Set(existingAnswers.map((answer) => answer.questionId));
  const nextTask = tasks.find((task) => !answeredIds.has(task.questionId));
  if (!nextTask) throw new Error("No unresolved Hermes Question Task remains");
  if (nextTask.questionId !== questionId) {
    throw new Error(`Hermes Question Tasks are serial: expected ${nextTask.questionId}, got ${questionId}`);
  }
  const artifact = createHermesAnswerArtifact(nextTask, input);
  return {
    artifact,
    record: {
      questionId: artifact.questionId,
      questionTaskId: artifact.questionTaskId,
      resolverAgentId: artifact.resolverAgentId,
      answerStatus: artifact.answerStatus,
      sourceRefs: artifact.sourceRefs,
      confidence: artifact.confidence,
      answerHash: artifact.answerHash,
      provenance: artifact.provenance.map((item) => `${item.kind}:${item.ref}`),
    },
  };
}

const HERMES_OUTPUT_FILE_BY_STAGE = new Map<string, string>(HERMES_STAGES.map((stage) => [stage.stageId, stage.outputs[0]]));

function expectedHermesOutputFile(stageId: string, attempt: number): string {
  if (stageId === HERMES_SPEC_FIX_STAGE_ID) return `06a-spec-fix-attempt-${attempt}.md`;
  const output = HERMES_OUTPUT_FILE_BY_STAGE.get(stageId);
  if (!output) throw new Error(`Unknown Hermes artifact stage: ${stageId}`);
  if (attempt > 1) return output.replace(/\.md$/, `-attempt-${attempt}.md`);
  return output;
}

export function validateHermesArtifactLineage(
  ledger: WorkflowRunStateLedger,
  manifest: WorkflowCatalogManifest,
  artifact: WorkflowArtifactEnvelope,
  artifactRoot: string,
): void {
  if (ledger.adapterId !== HERMES_ADAPTER_ID) throw new Error(`Not a Hermes workflow run: ${ledger.workflowRunId}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ledger.workflowRunId)) {
    throw new Error(`Hermes workflowRunId must be a safe artifact path segment: ${ledger.workflowRunId}`);
  }
  const stageIndex = manifest.stages.findIndex((stage) => stage.stageId === artifact.stageId);
  if (stageIndex < 0) throw new Error(`Unknown Hermes artifact stage: ${artifact.stageId}`);
  const expectedPath = posix.join(
    posix.normalize(artifactRoot.replace(/\\/g, "/")),
    ledger.workflowRunId,
    expectedHermesOutputFile(artifact.stageId, artifact.attempt),
  );
  if (posix.normalize(artifact.outputPath.replace(/\\/g, "/")) !== expectedPath) {
    throw new Error(`Hermes artifact path mismatch: expected ${expectedPath}, got ${artifact.outputPath}`);
  }
  if (stageIndex > 0 && artifact.inputArtifactHashes.length === 0) {
    throw new Error(`Hermes artifact ${artifact.stageId} requires input artifact lineage`);
  }
  for (const inputHash of artifact.inputArtifactHashes) {
    const inputArtifact = ledger.artifacts.find((item) => item.outputHash === inputHash);
    if (!inputArtifact) throw new Error(`Hermes input artifact not found: ${inputHash}`);
    if (inputArtifact.status !== "immutable") throw new Error(`Hermes input artifact is superseded: ${inputHash}`);
    const inputIndex = manifest.stages.findIndex((stage) => stage.stageId === inputArtifact.stageId);
    const allowedSameStageReplacement = artifact.supersedesOutputHash === inputHash && inputArtifact.stageId === artifact.stageId;
    const allowedReviewLoop =
      artifact.stageId === HERMES_SPEC_REVIEW_STAGE_ID &&
      inputArtifact.stageId === HERMES_SPEC_FIX_STAGE_ID &&
      inputArtifact.attempt === artifact.attempt - 1;
    if (!allowedSameStageReplacement && !allowedReviewLoop && inputIndex >= stageIndex) {
      throw new Error(`Hermes artifact lineage must point to an earlier stage: ${inputArtifact.stageId} -> ${artifact.stageId}`);
    }
  }
}

export const HermesReviewDecisionInputSchema = Type.Object({
  stageId: Type.Literal(HERMES_SPEC_REVIEW_STAGE_ID),
  attempt: Type.Integer({ minimum: 1 }),
  verdict: StringEnum(["pass", "pass_with_changes", "fail"]),
  findingIds: Type.Array(Type.String({ minLength: 1 })),
  reviewArtifactHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
});
export type HermesReviewDecisionInput = Static<typeof HermesReviewDecisionInputSchema>;

export interface HermesReviewDecision {
  record: Omit<WorkflowReviewRecord, "recordedAt">;
  nextStageId?: string;
  terminalPackage?: {
    needsHumanReview: true;
    workflowRunId: string;
    stageId: string;
    attempt: number;
    verdict: "pass_with_changes" | "fail";
    reason: string;
    findingIds: string[];
    reviewArtifactHash: string;
  };
}

export function evaluateHermesSpecReview(
  ledger: WorkflowRunStateLedger,
  inputValue: HermesReviewDecisionInput,
): HermesReviewDecision {
  const input = assertValid(validateSchema(HermesReviewDecisionInputSchema, inputValue), "Invalid Hermes review decision");
  if (input.stageId !== HERMES_SPEC_REVIEW_STAGE_ID) throw new Error("Hermes review decision must target spec_review");
  const stage = ledger.stages[input.stageId];
  if (!stage || stage.attempt !== input.attempt) throw new Error(`Hermes spec review attempt mismatch: ${input.attempt}`);
  if (stage.status !== "produced") throw new Error(`Hermes spec review must be produced before decision: ${stage.status}`);
  const artifact = ledger.artifacts.find((item) => item.outputHash === input.reviewArtifactHash);
  if (!artifact || artifact.stageId !== input.stageId || artifact.attempt !== input.attempt || artifact.status !== "immutable") {
    throw new Error("Hermes review decision requires the immutable spec review artifact");
  }
  const duplicateFindings = uniqueValues(input.findingIds, "duplicate-finding");
  if (duplicateFindings.length) throw new Error(duplicateFindings.join(", "));
  const terminal = input.verdict === "fail" || (input.verdict === "pass_with_changes" && input.attempt > HERMES_MAX_FIX_CYCLES);
  const record = {
    stageId: input.stageId,
    attempt: input.attempt,
    verdict: input.verdict,
    findingIds: [...input.findingIds].sort(),
    reviewArtifactHash: input.reviewArtifactHash,
    terminal,
  } satisfies Omit<WorkflowReviewRecord, "recordedAt">;
  if (terminal) {
    const terminalVerdict = input.verdict === "fail" ? "fail" : "pass_with_changes";
    return {
      record,
      terminalPackage: {
        needsHumanReview: true,
        workflowRunId: ledger.workflowRunId,
        stageId: input.stageId,
        attempt: input.attempt,
        verdict: terminalVerdict,
        reason: input.verdict === "fail" ? "spec_review_failed" : "spec_review_fix_cycle_cap_reached",
        findingIds: record.findingIds,
        reviewArtifactHash: input.reviewArtifactHash,
      },
    };
  }
  return {
    record,
    nextStageId: input.verdict === "pass" ? "implementation_plan" : HERMES_SPEC_FIX_STAGE_ID,
  };
}

export interface HermesStageTarget {
  stageId: string;
  attempt: number;
}

function nextEnabledHermesStage(
  manifest: WorkflowCatalogManifest,
  binding: ProjectWorkflowBinding,
  currentStageId?: string,
): HermesStageTarget | undefined {
  const enabledOptional = new Set(binding.enabledOptionalStages ?? []);
  let startIndex = 0;
  if (currentStageId) {
    const currentIndex = manifest.stages.findIndex((stage) => stage.stageId === currentStageId);
    if (currentIndex < 0) throw new Error(`Unknown stage in manifest: ${currentStageId}`);
    startIndex = currentIndex + 1;
  }
  for (let index = startIndex; index < manifest.stages.length; index += 1) {
    const stage = manifest.stages[index];
    const activation = resolveStageActivation(stage);
    if (activation === "binding_optional" && !enabledOptional.has(stage.stageId)) continue;
    if (activation === "controller_conditional") continue;
    return { stageId: stage.stageId, attempt: 1 };
  }
  return undefined;
}

export function resolveNextHermesStageTarget(
  ledger: WorkflowRunStateLedger,
  manifest: WorkflowCatalogManifest,
  binding: ProjectWorkflowBinding,
): HermesStageTarget | undefined {
  const currentStageId = ledger.currentStageId;
  if (!currentStageId) return nextEnabledHermesStage(manifest, binding);
  const current = ledger.stages[currentStageId];
  if (!current || current.status !== "accepted") return undefined;
  if (currentStageId === HERMES_SPEC_REVIEW_STAGE_ID) {
    const review = (ledger.reviews ?? []).find((item) => item.stageId === currentStageId && item.attempt === current.attempt);
    if (!review || review.terminal) return undefined;
    if (review.verdict === "pass_with_changes") return { stageId: HERMES_SPEC_FIX_STAGE_ID, attempt: current.attempt };
    return { stageId: "implementation_plan", attempt: 1 };
  }
  if (currentStageId === HERMES_SPEC_FIX_STAGE_ID) {
    return { stageId: HERMES_SPEC_REVIEW_STAGE_ID, attempt: current.attempt + 1 };
  }
  return nextEnabledHermesStage(manifest, binding, currentStageId);
}

export function assertHermesProducedStageReady(ledger: WorkflowRunStateLedger, stageId: string, attempt: number): void {
  if (ledger.adapterId !== HERMES_ADAPTER_ID || stageId !== HERMES_SPEC_REVIEW_STAGE_ID) return;
  const review = (ledger.reviews ?? []).find((item) => item.stageId === stageId && item.attempt === attempt);
  if (!review) throw new Error(`Hermes spec review decision missing for attempt ${attempt}`);
  if (review.terminal) throw new Error(`Hermes spec review is terminal for attempt ${attempt}`);
}
