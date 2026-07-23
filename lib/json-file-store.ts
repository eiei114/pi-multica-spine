import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function removeStaleLock(lockPath: string, staleLockMs: number): Promise<boolean> {
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs <= staleLockMs) return false;
    await rm(lockPath, { force: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export async function withFileLock<T>(
  targetPath: string,
  mutation: () => Promise<T>,
  options: { timeoutMs?: number; staleLockMs?: number } = {},
): Promise<T> {
  const lockPath = `${targetPath}.lock`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await removeStaleLock(lockPath, staleLockMs)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for workflow state lock: ${lockPath}`);
      }
      await sleep(LOCK_RETRY_MS);
      continue;
    }

    try {
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
      return await mutation();
    } finally {
      await handle.close();
      await rm(lockPath, { force: true });
    }
  }
}
