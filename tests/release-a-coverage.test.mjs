import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatIdeaEntryHumanResult } from "../lib/idea-entry-human.ts";
import { resolveIdeaEntryConfig } from "../lib/idea-entry-config.ts";
import { IdeaInvocationReservationStore, hashNormalizedInput } from "../lib/idea-entry-reservation.ts";
import { IdeaSessionManifestStore } from "../lib/idea-session-manifest.ts";
import { buildVaultIdeaNoteMarkdown, parseVaultIdeaNoteFrontmatter, validateVaultIdeaNoteForWrite } from "../lib/vault-idea-note.ts";
import { buildOperationsViewV1, decodeOperationsCursor, encodeOperationsCursor, mapWorkflowOperationsError, wrapUnknownOperationsError, WorkflowOperationsError } from "../lib/operations-view.ts";
import { renderOperationsReport, renderOperationsViewHuman, renderOperationsViewJson, shouldUseColor, truncateGraphemes } from "../lib/operations-renderer.ts";
import { runBoundedHydration, runCancellableCommand, DEFAULT_HYDRATION_BUDGET } from "../lib/operations-hydration.ts";
import { buildRetentionDryRunReport, classifyRetentionCandidate, retentionReportFingerprint } from "../lib/retention-classifier.ts";
import { deriveReviewJournalLifecycle, HumanFinalReviewJournalStore, runResumableHumanFinalReview } from "../lib/workflow-human-final-review-journal.ts";
import { rebuildIdeaSessionInventory, IdeaSessionInventoryStore } from "../lib/idea-session-inventory.ts";
import { createHermesCompositeManifest } from "../lib/hermes-adapter.ts";
import { ProjectWorkflowBindingStore } from "../lib/project-workflow-binding-store.ts";
import { WorkflowRunStateStore } from "../lib/workflow-run-state.ts";
import { SPINE_STATE_ROOT } from "../lib/types.ts";

const emptyInventory = (records = []) => ({ schemaVersion: 1, generation: 2, rebuiltAt: new Date().toISOString(), sessionsRoot: "/tmp", records });

test("formatIdeaEntryHumanResult branches", () => {
  assert.match(formatIdeaEntryHumanResult({ ok: false, error: "x" }), /failed/);
  assert.match(formatIdeaEntryHumanResult({ ok: true, parentIdentifier: "DOT-1", sessionId: "s1", mode: "live" }), /DOT-1/);
  assert.match(formatIdeaEntryHumanResult({ ok: true, sessionId: "s1", mode: "offline-plan" }), /offline-plan/);
  assert.match(formatIdeaEntryHumanResult({ ok: true, workflowRunId: "run1", result: "done", next: "next" }), /done/);
});

test("resolveIdeaEntryConfig paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cfg-"));
  await writeFile(join(cwd, ".pi-idea-entry.json"), JSON.stringify({ vaultRoot: "vault", sessionsRoot: "sessions" }), "utf8");
  const flag = await resolveIdeaEntryConfig({ flagVaultRoot: join(cwd, "v"), flagSessionsRoot: join(cwd, "s"), cwd });
  assert.equal(flag.source, "flag");
  const env = await resolveIdeaEntryConfig({ env: { PI_VAULT_ROOT: join(cwd, "ev"), PI_IDEA_SESSIONS_ROOT: join(cwd, "es") }, cwd });
  assert.equal(env.source, "environment");
  const project = await resolveIdeaEntryConfig({ projectConfigPath: join(cwd, ".pi-idea-entry.json"), cwd });
  assert.equal(project.source, "project-config");
  const discovered = await resolveIdeaEntryConfig({ cwd });
  assert.equal(discovered.source, "repo-discovery");
  const emptyCfg = await mkdtemp(join(tmpdir(), "nocfg-"));
  await assert.rejects(() => resolveIdeaEntryConfig({ cwd: emptyCfg }));
});

test("reservation conflict and update", async () => {
  const root = await mkdtemp(join(tmpdir(), "res-"));
  const store = new IdeaInvocationReservationStore(root);
  await store.reserve({ invocationToken: "tok", normalizedInput: "Build a long enough idea seed" });
  await assert.rejects(() => store.reserve({ invocationToken: "tok", normalizedInput: "Different long enough idea seed" }));
  const updated = await store.update("tok", { status: "completed", workflowRunId: "run1" });
  assert.equal(updated.workflowRunId, "run1");
  assert.equal(hashNormalizedInput("a  b"), hashNormalizedInput("a b"));
});

test("manifest writeOnce and patch", async () => {
  const canary = await mkdtemp(join(tmpdir(), "man-"));
  const store = new IdeaSessionManifestStore(canary);
  const base = { sessionId: "s1", invocationToken: "tok", normalizedInputHash: "a".repeat(64), canaryPath: canary, lifecycleStatus: "planned" };
  await store.writeOnce(base);
  await store.writeOnce(base);
  await assert.rejects(() => store.writeOnce({ ...base, sessionId: "s2" }));
  await store.patch({ lifecycleStatus: "active" });
  const loaded = await store.load();
  assert.equal(loaded.lifecycleStatus, "active");
  const emptyManifest = await mkdtemp(join(tmpdir(), "man2-"));
  await assert.rejects(() => new IdeaSessionManifestStore(emptyManifest).patch({ lifecycleStatus: "active" }));
});

test("vault idea note validation", () => {
  const md = buildVaultIdeaNoteMarkdown("A sufficiently long product idea", { status: "planned", parentIdentifier: "DOT-1", workflowRunId: "run1", canaryPath: "/tmp" });
  assert.equal(validateVaultIdeaNoteForWrite(md).ok, true);
  const parsed = parseVaultIdeaNoteFrontmatter(md);
  assert.equal(parsed.workflow_lane, "idea-to-build");
  assert.equal(parsed.workflow_run_id, "run1");
  const minimal = buildVaultIdeaNoteMarkdown("A sufficiently long product idea");
  assert.equal(validateVaultIdeaNoteForWrite(minimal).ok, true);
  for (const bad of ["no frontmatter", "---\nfoo: bar\n---\n", "---\nidea_note_schema_version: 9\nstatus: planned\nready_for_multica: false\nworkflow_lane: idea-to-build\n---\n"]) {
    const badParsed = parseVaultIdeaNoteFrontmatter(bad);
    assert.ok("error" in badParsed);
    assert.equal(validateVaultIdeaNoteForWrite(bad).ok, false);
  }
});

test("operations view states and cursor", () => {
  const record = (overrides) => ({ sessionId: "s1", invocationToken: "t", canaryPath: "/c", workflowRunId: "run1", lifecycleStatus: "final_package", stateUpdatedAt: "2026-01-02T00:00:00.000Z", manifestPresent: true, ledgerPresent: true, corrupt: false, parentIdentifier: "DOT-1", ...overrides });
  const inv = emptyInventory([record({}), record({ sessionId: "s2", workflowRunId: "run2", lifecycleStatus: "blocked", stateUpdatedAt: "2026-01-03T00:00:00.000Z" }), record({ sessionId: "s3", workflowRunId: "run3", lifecycleStatus: "reviewed_cleanup_pending", stateUpdatedAt: "2026-01-04T00:00:00.000Z" }), record({ sessionId: "s4", workflowRunId: "run4", lifecycleStatus: "starting_failed", stateUpdatedAt: "2026-01-05T00:00:00.000Z" }), record({ sessionId: "s5", workflowRunId: "run5", corrupt: true, corruptReason: "bad", lifecycleStatus: "active", stateUpdatedAt: "2026-01-06T00:00:00.000Z" })]);
  const complete = buildOperationsViewV1({ command: "idea-status", inventory: inv, hydration: [{ sourceId: "run9", status: "unknown", repairCommand: "/skill:idea-status --refresh" }] });
  assert.equal(complete.dataState, "CORRUPT_SOURCE");
  const noMatch = buildOperationsViewV1({ command: "idea-status", inventory: inv, workflowRunId: "missing" });
  assert.equal(noMatch.dataState, "NO_MATCHES");
  const cursor = encodeOperationsCursor({ schemaVersion: 1, inventoryGeneration: 2, queryHash: "idea-status::status", lastSortKey: "2026-01-02T00:00:00.000Z:s1" });
  const paged = buildOperationsViewV1({ command: "idea-status", inventory: inv, cursor: decodeOperationsCursor(cursor), pageSize: 1 });
  assert.equal(paged.truncated, true);
  const clean = buildOperationsViewV1({ command: "idea-status", inventory: emptyInventory([record({ lifecycleStatus: "active" })]), retentionDryRun: true });
  assert.equal(clean.nextAction.reasonCode, "RETENTION_REPORT");
  const err = mapWorkflowOperationsError(new WorkflowOperationsError("CONFIG_ERROR", "bad"));
  assert.equal(err.exitCode, 64);
  const internal = mapWorkflowOperationsError(wrapUnknownOperationsError(new Error("boom")));
  assert.equal(internal.exitCode, 70);
  assert.throws(() => decodeOperationsCursor(Buffer.from(JSON.stringify({ schemaVersion: 9 }), "utf8").toString("base64url")));
});

test("operations renderer", () => {
  const view = buildOperationsViewV1({ command: "idea-status", inventory: emptyInventory() });
  assert.match(renderOperationsViewHuman({ ...view, retentionBanner: "RETENTION DRY-RUN — NO FILES WERE DELETED", actionRequired: [{ sessionId: "s1", workflowRunId: "run1", what: "w", why: "y", next: "n", reasonCode: "ACTION_REQUIRED", priority: 1 }], readyItem: { sessionId: "s1", workflowRunId: "run1", label: "l", next: "n", stateUpdatedAt: "t", priority: 1 }, truncated: true, nextCursor: "abc" }, { columns: 80, verbose: true }), /NEXT/);
  assert.match(renderOperationsViewJson(view), /schemaVersion/);
  assert.equal(shouldUseColor(true, {}, true), false);
  assert.equal(truncateGraphemes("abcdef", 3).endsWith("…"), true);
  assert.match(renderOperationsReport(view, { json: false, isTty: true, columns: 120 }), /NEXT/);
});

test("hydration and cancellable command", async () => {
  const node = process.execPath;
  const { promise } = runCancellableCommand(["-e", "console.log('ok')"], { executable: node, timeoutMs: 2000 });
  const result = await promise;
  assert.equal(result.exitCode, 0);
  const bounded = await runBoundedHydration([
    { sourceId: "a", run: async () => "ok" },
    { sourceId: "b", run: async () => { throw new Error("fail"); } },
    { sourceId: "c", run: async (signal) => new Promise((_, reject) => { signal.addEventListener("abort", () => reject(new Error("abort"))); setTimeout(() => reject(new Error("late")), 50); }) },
  ], { maxConcurrent: 2, perSourceTimeoutMs: 5, totalTimeoutMs: 20 });
  assert.ok(bounded.results.length === 3);
});

test("retention classifier matrix", async () => {
  const base = { sessionId: "s1", invocationToken: "t", canaryPath: "", workflowRunId: "run1", lifecycleStatus: "reviewed", stateUpdatedAt: "2026-01-01T00:00:00.000Z", manifestPresent: true, ledgerPresent: false, corrupt: false };
  assert.equal((await classifyRetentionCandidate(base, 1)).state, "unknown");
  const blocked = await classifyRetentionCandidate({ ...base, canaryPath: "/tmp", corrupt: true, corruptReason: "x" }, 1);
  assert.equal(blocked.state, "blocked");
  const report = await buildRetentionDryRunReport([base], 1);
  assert.match(report.banner, /NO FILES WERE DELETED/);
  assert.ok(retentionReportFingerprint(report).length === 64);
});

test("final review committed and derive lifecycle", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hrj2-"));
  const manifest = createHermesCompositeManifest();
  const binding = { schemaVersion: 1, multicaProjectId: "proj", projectKey: "P", adapterId: manifest.adapterId, adapterVersion: manifest.adapterVersion, artifactRoot: ".multica-spine/canary-artifacts", enabledOptionalStages: [], projectGrants: [], humanOwnedActions: [], roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: "agent_worker" }])), autoAdvancePolicy: "autonomous", executionMode: "autonomous_until_final", humanGate: "start_and_final", deliveryPolicy: { prRequired: false, releaseAllowed: false, productionAllowed: false, destructiveAllowed: false } };
  await new ProjectWorkflowBindingStore(cwd).save(binding);
  const runStore = new WorkflowRunStateStore(cwd);
  await runStore.create({ workflowRunId: "run1", multicaProjectId: binding.multicaProjectId, adapterId: manifest.adapterId, adapterVersion: manifest.adapterVersion, adapterBundleHash: manifest.derivedBundleHash, executionMode: binding.executionMode, initialStageId: "capture" });
  await runStore.upsertStage("run1", { stageId: "final_package", status: "accepted", attempt: 1, issueId: "issue_final", assignedAgentId: "agent_worker", artifactHashes: [] });
  let ledger = await runStore.load("run1");
  ledger = { ...ledger, currentStageId: "final_package", workflowStatus: "completed" };
  await runStore.save(ledger);
  const liveCli = { async getIssue(id) { return { id, identifier: "DOT-1", status: "done" }; }, async transitionStageIssue(id, status) { return { id, status }; }, async writeParentSummary() { return {}; } };
  const committed = await runResumableHumanFinalReview({ canaryPath: cwd, projectId: binding.multicaProjectId, parentIssueId: "parent", workflowRunId: "run1" }, { verdict: "approved", reviewer: "t" }, { liveCli, runStore });
  assert.equal(committed.status, "committed");
  const journal = await new HumanFinalReviewJournalStore(cwd).load("run1");
  assert.equal(deriveReviewJournalLifecycle(ledger, journal), "reviewed");
  assert.equal(deriveReviewJournalLifecycle({ ...ledger, workflowStatus: "failed" }), "terminal_failed");
});

test("inventory rebuild from manifest", async () => {
  const sessionsRoot = await mkdtemp(join(tmpdir(), "inv-"));
  const canary = join(sessionsRoot, "session-a");
  await mkdir(join(canary, SPINE_STATE_ROOT), { recursive: true });
  await new IdeaSessionManifestStore(canary).writeOnce({ sessionId: "s1", invocationToken: "tok", normalizedInputHash: "a".repeat(64), canaryPath: canary, lifecycleStatus: "planned" });
  const rebuilt = await rebuildIdeaSessionInventory(sessionsRoot);
  assert.equal(rebuilt.records.length, 1);
  const swapped = await new IdeaSessionInventoryStore(sessionsRoot).rebuildAndSwap(999);
  assert.ok(swapped.generation >= 1);
});

test("idea entry config invalid file and custom relative dir", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cfg2-"));
  const bad = join(cwd, ".pi-idea-entry.json");
  await writeFile(bad, "{not-json", "utf8");
  await assert.rejects(() => resolveIdeaEntryConfig({ projectConfigPath: bad, cwd }));
  const customRoot = await mkdtemp(join(tmpdir(), "cfg3-"));
  const good = join(customRoot, ".multica-spine", "idea-entry.json");
  await mkdir(dirname(good), { recursive: true });
  await writeFile(good, JSON.stringify({ vaultRoot: "v", sessionsRoot: "s", vaultIdeaRelativeDir: "Ideas/Custom" }), "utf8");
  const cfg = await resolveIdeaEntryConfig({ cwd: customRoot });
  assert.equal(cfg.vaultIdeaRelativeDir, "Ideas/Custom");
});

test("reservation missing update", async () => {
  const root = await mkdtemp(join(tmpdir(), "res2-"));
  const store = new IdeaInvocationReservationStore(root);
  await assert.rejects(() => store.update("missing", { status: "failed" }));
});

test("vault note frontmatter edge cases", () => {
  const badStatus = "---\nidea_note_schema_version: 1\nstatus: bogus\nready_for_multica: false\nworkflow_lane: idea-to-build\n---\n";
  assert.ok("error" in parseVaultIdeaNoteFrontmatter(badStatus));
  const badReady = "---\nidea_note_schema_version: 1\nstatus: planned\nready_for_multica: maybe\nworkflow_lane: idea-to-build\n---\n";
  assert.ok("error" in parseVaultIdeaNoteFrontmatter(badReady));
  const badLane = "---\nidea_note_schema_version: 1\nstatus: planned\nready_for_multica: false\nworkflow_lane: other\n---\n";
  assert.ok("error" in parseVaultIdeaNoteFrontmatter(badLane));
});

test("operations view action branches and helpers", () => {
  const mk = (lifecycleStatus, extra = {}) => ({ sessionId: "s1", invocationToken: "t", canaryPath: "/c", workflowRunId: "run1", lifecycleStatus, stateUpdatedAt: "2026-01-01T00:00:00.000Z", manifestPresent: true, ledgerPresent: true, corrupt: false, ...extra });
  const blocked = buildOperationsViewV1({ command: "idea-status", inventory: emptyInventory([mk("blocked")]) });
  assert.equal(blocked.actionRequired[0].reasonCode, "ACTION_REQUIRED");
  const timed = buildOperationsViewV1({ command: "idea-status", inventory: emptyInventory([mk("active")]), hydration: [{ sourceId: "run1", status: "failed", repairCommand: "fix" }] });
  assert.equal(timed.dataState, "PARTIAL");
  const partial = buildOperationsViewV1({ command: "idea-status", inventory: emptyInventory([mk("active")]), hydration: [{ sourceId: "x", status: "unknown" }] });
  assert.equal(partial.dataState, "PARTIAL");
  const readyOnly = buildOperationsViewV1({ command: "idea-status", inventory: emptyInventory([mk("final_package", { parentIdentifier: "DOT-1" })]) });
  assert.equal(readyOnly.nextAction.reasonCode, "READY_FOR_REVIEW");
  const err2 = mapWorkflowOperationsError(new WorkflowOperationsError("CURSOR_MISMATCH", "bad"));
  assert.equal(err2.exitCode, 2);
  assert.equal(wrapUnknownOperationsError(new WorkflowOperationsError("INTERNAL_ERROR", "x")).message, "x");
});

test("hydration timeout and abort paths", async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = await runBoundedHydration([{ sourceId: "a", run: async () => "x" }], DEFAULT_HYDRATION_BUDGET, controller.signal);
  assert.ok(aborted.results.length === 1);
  const node = process.execPath;
  const { promise, child } = runCancellableCommand(["-e", "setTimeout(()=>{}, 5000)"], { executable: node, timeoutMs: 20 });
  const timed = await promise;
  assert.equal(timed.timedOut, true);
  child.kill?.();
});

test("retention eligible and blocked deep paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ret-"));
  const manifest = createHermesCompositeManifest();
  const binding = { schemaVersion: 1, multicaProjectId: "proj", projectKey: "P", adapterId: manifest.adapterId, adapterVersion: manifest.adapterVersion, artifactRoot: ".multica-spine/canary-artifacts", enabledOptionalStages: [], projectGrants: [], humanOwnedActions: [], roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: "agent_worker" }])), autoAdvancePolicy: "autonomous", executionMode: "autonomous_until_final", humanGate: "start_and_final", deliveryPolicy: { prRequired: false, releaseAllowed: false, productionAllowed: false, destructiveAllowed: false } };
  await new ProjectWorkflowBindingStore(cwd).save(binding);
  const runStore = new WorkflowRunStateStore(cwd);
  await runStore.create({ workflowRunId: "run1", multicaProjectId: binding.multicaProjectId, adapterId: manifest.adapterId, adapterVersion: manifest.adapterVersion, adapterBundleHash: manifest.derivedBundleHash, executionMode: binding.executionMode, initialStageId: "capture" });
  let ledger = await runStore.load("run1");
  ledger = { ...ledger, currentStageId: "final_package", workflowStatus: "completed" };
  await runStore.save(ledger);
  const liveCli = { async getIssue(id) { return { id, identifier: "DOT-1", status: "done" }; }, async transitionStageIssue(id, status) { return { id, status }; }, async writeParentSummary() { return {}; } };
  await runResumableHumanFinalReview({ canaryPath: cwd, projectId: binding.multicaProjectId, parentIssueId: "parent", workflowRunId: "run1" }, { verdict: "approved", reviewer: "t" }, { liveCli, runStore });
  const journalPath = join(cwd, SPINE_STATE_ROOT, "review-journal", "run1.json");
  const journal = JSON.parse(await (await import("node:fs/promises")).readFile(journalPath, "utf8"));
  journal.updatedAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
  await writeFile(journalPath, JSON.stringify(journal), "utf8");
  const record = { sessionId: "s1", invocationToken: "t", canaryPath: cwd, workflowRunId: "run1", lifecycleStatus: "reviewed", stateUpdatedAt: journal.updatedAt, manifestPresent: true, ledgerPresent: true, corrupt: false };
  const young = await classifyRetentionCandidate(record, 2, { now: new Date(), syntheticExternalEvidence: true });
  assert.equal(young.state, "eligible_for_future_review");
  const noSynth = await classifyRetentionCandidate(record, 2, { now: new Date() });
  assert.equal(noSynth.state, "blocked");
  const noLedger = await classifyRetentionCandidate({ ...record, workflowRunId: "missing" }, 2);
  assert.equal(noLedger.state, "unknown");
});

test("final review conflict and failure paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hrj3-"));
  const manifest = createHermesCompositeManifest();
  const binding = { schemaVersion: 1, multicaProjectId: "proj", projectKey: "P", adapterId: manifest.adapterId, adapterVersion: manifest.adapterVersion, artifactRoot: ".multica-spine/canary-artifacts", enabledOptionalStages: [], projectGrants: [], humanOwnedActions: [], roleRoutes: Object.fromEntries(manifest.roles.map((role) => [role, { agentId: "agent_worker" }])), autoAdvancePolicy: "autonomous", executionMode: "autonomous_until_final", humanGate: "start_and_final", deliveryPolicy: { prRequired: false, releaseAllowed: false, productionAllowed: false, destructiveAllowed: false } };
  await new ProjectWorkflowBindingStore(cwd).save(binding);
  const runStore = new WorkflowRunStateStore(cwd);
  await runStore.create({ workflowRunId: "run1", multicaProjectId: binding.multicaProjectId, adapterId: manifest.adapterId, adapterVersion: manifest.adapterVersion, adapterBundleHash: manifest.derivedBundleHash, executionMode: binding.executionMode, initialStageId: "capture" });
  let ledger = await runStore.load("run1");
  ledger = { ...ledger, currentStageId: "final_package", workflowStatus: "completed" };
  await runStore.save(ledger);
  const liveCli = { async getIssue(id) { return { id, identifier: "DOT-1", status: "in_review" }; }, async transitionStageIssue(id, status) { return { id, status }; }, async writeParentSummary() { throw new Error("fail metadata"); } };
  await assert.rejects(() => runResumableHumanFinalReview({ canaryPath: cwd, projectId: binding.multicaProjectId, parentIssueId: "parent", workflowRunId: "run1" }, { verdict: "approved", reviewer: "t" }, { liveCli, runStore }));
  const journal = await new HumanFinalReviewJournalStore(cwd).load("run1");
  assert.equal(journal.status, "failed");
  await assert.rejects(() => runResumableHumanFinalReview({ canaryPath: cwd, projectId: binding.multicaProjectId, parentIssueId: "parent", workflowRunId: "run1" }, { verdict: "rejected", reviewer: "t" }, { liveCli, runStore }));
  assert.equal(deriveReviewJournalLifecycle({ ...ledger, workflowStatus: "blocked" }), "blocked");
  assert.equal(deriveReviewJournalLifecycle(ledger, { status: "reviewed_cleanup_pending" }), "reviewed_cleanup_pending");
});

test("formatIdeaEntryHumanResult workflowRunId next", () => {
  assert.match(formatIdeaEntryHumanResult({ ok: true, workflowRunId: "run1", sessionId: "s1" }), /run1/);
});

test("reservation auto token", async () => {
  const store = new IdeaInvocationReservationStore(await mkdtemp(join(tmpdir(), "res3-")));
  const r = await store.reserve({ normalizedInput: "Build a long enough idea seed" });
  assert.ok(r.invocationToken.length > 8);
});

test("vault missing schema version", () => {
  const bad = "---\nstatus: planned\nready_for_multica: false\nworkflow_lane: idea-to-build\n---\n";
  assert.ok("error" in parseVaultIdeaNoteFrontmatter(bad));
});

test("operations renderer wide layout and color", () => {
  const view = buildOperationsViewV1({ command: "idea-status", inventory: emptyInventory([{ sessionId: "s1", invocationToken: "t", canaryPath: "/c", workflowRunId: "run1", lifecycleStatus: "final_package", stateUpdatedAt: "2026-01-01T00:00:00.000Z", manifestPresent: true, ledgerPresent: true, corrupt: false }]) });
  assert.match(renderOperationsViewHuman({ ...view, actionRequired: [{ sessionId: "s1", workflowRunId: "run1", what: "what", why: "why", next: "next", reasonCode: "ACTION_REQUIRED", priority: 1 }] }, { columns: 120 }), /\| Why:/);
  assert.equal(shouldUseColor(true, {}, false), true);
});

test("hydration spawn error", async () => {
  const { promise } = runCancellableCommand([], { executable: "definitely-not-a-real-binary-xyz", timeoutMs: 100 });
  const result = await promise;
  assert.equal(result.exitCode, 1);
});

test("retention extra branches", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ret2-"));
  const record = { sessionId: "s1", invocationToken: "t", canaryPath: cwd, workflowRunId: "run1", lifecycleStatus: "reviewed", stateUpdatedAt: "2026-01-01T00:00:00.000Z", manifestPresent: true, ledgerPresent: true, corrupt: false };
  assert.equal((await classifyRetentionCandidate({ ...record, canaryPath: undefined }, 1)).state, "unknown");
  assert.equal((await classifyRetentionCandidate(record, 0)).state, "unknown");
  await assert.rejects(() => runResumableHumanFinalReview({ canaryPath: cwd, projectId: "p", parentIssueId: "parent", workflowRunId: "run1" }, { verdict: "approved", reviewer: "t" }, { liveCli: { async getIssue() { return { id: "p", identifier: "DOT-1", status: "open" }; }, async transitionStageIssue() { return {}; }, async writeParentSummary() { return {}; } } }));
});
