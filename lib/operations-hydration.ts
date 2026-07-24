import { spawn, type ChildProcess } from "node:child_process";
import { Type, type Static } from "typebox";
import { StringEnum } from "./schema.ts";

export interface CancellableRunResult { exitCode: number; stdout: string; stderr: string; timedOut: boolean; aborted: boolean }
export interface CancellableRunOptions { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal; executable?: string }

export function runCancellableCommand(args: string[], options: CancellableRunOptions = {}): { promise: Promise<CancellableRunResult>; child: ChildProcess } {
  const executable = options.executable ?? "multica";
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdoutChunks: string[] = []; const stderrChunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString("utf8")));
  let settled = false; let timedOut = false; let aborted = false; let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<CancellableRunResult>((resolve) => {
    const settle = (exitCode: number) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve({ exitCode, stdout: stdoutChunks.join(""), stderr: stderrChunks.join(""), timedOut, aborted }); };
    const killChild = () => { if (!child.killed) { child.kill("SIGTERM"); setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 250).unref(); } };
    if (options.timeoutMs && options.timeoutMs > 0) timer = setTimeout(() => { timedOut = true; killChild(); }, options.timeoutMs);
    options.signal?.addEventListener("abort", () => { aborted = true; killChild(); }, { once: true });
    child.on("error", () => settle(1)); child.on("close", (code) => settle(code ?? 1));
  });
  return { promise, child };
}

export const HydrationBudgetSchema = Type.Object({ maxConcurrent: Type.Integer({ minimum: 1, maximum: 4 }), perSourceTimeoutMs: Type.Integer({ minimum: 1 }), totalTimeoutMs: Type.Integer({ minimum: 1 }) });
export type HydrationBudget = Static<typeof HydrationBudgetSchema>;
export const DEFAULT_HYDRATION_BUDGET: HydrationBudget = { maxConcurrent: 4, perSourceTimeoutMs: 5_000, totalTimeoutMs: 15_000 };
export const HydrationSourceStatusSchema = StringEnum(["local", "fresh", "stale", "failed", "unknown"]);
export interface HydrationSourceResult { sourceId: string; status: Static<typeof HydrationSourceStatusSchema>; repairCommand?: string; error?: string }

export async function runBoundedHydration<T>(tasks: Array<{ sourceId: string; run: (signal: AbortSignal) => Promise<T> }>, budget: HydrationBudget = DEFAULT_HYDRATION_BUDGET, parentSignal?: AbortSignal) {
  const controller = new AbortController(); parentSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  const totalTimer = setTimeout(() => controller.abort(), budget.totalTimeoutMs);
  const results: Array<{ sourceId: string; value?: T; result: HydrationSourceResult }> = []; let index = 0; let timedOut = false;
  async function worker() {
    while (index < tasks.length) {
      if (controller.signal.aborted) return; const current = tasks[index]; index += 1;
      const sourceController = new AbortController(); const sourceTimer = setTimeout(() => sourceController.abort(), budget.perSourceTimeoutMs);
      const onParentAbort = () => sourceController.abort(); controller.signal.addEventListener("abort", onParentAbort, { once: true });
      try { const value = await current.run(sourceController.signal); results.push({ sourceId: current.sourceId, value, result: { sourceId: current.sourceId, status: "fresh" } }); }
      catch (error) { const abortedRun = sourceController.signal.aborted || controller.signal.aborted; if (controller.signal.aborted && !sourceController.signal.aborted) timedOut = true; results.push({ sourceId: current.sourceId, result: { sourceId: current.sourceId, status: abortedRun ? "unknown" : "failed", error: error instanceof Error ? error.message : String(error), repairCommand: `/skill:idea-status --workflow-run-id ${current.sourceId} --refresh` } }); }
      finally { clearTimeout(sourceTimer); controller.signal.removeEventListener("abort", onParentAbort); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(budget.maxConcurrent, tasks.length) }, () => worker()));
  clearTimeout(totalTimer); return { results, timedOut };
}
