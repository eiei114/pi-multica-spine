import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";

import { clearStaleDaemonTaskContext } from "../lib/multica-cli.ts";

test("clearStaleDaemonTaskContext removes marker when present", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-spine-daemon-"));
  const marker = join(root, ".multica", "daemon_task_context.json");
  await mkdir(join(root, ".multica"), { recursive: true });
  await writeFile(marker, "{}", "utf8");
  const removed = await clearStaleDaemonTaskContext(root);
  assert.equal(removed, true);
  const again = await clearStaleDaemonTaskContext(root);
  assert.equal(again, false);
});

test("clearStaleDaemonTaskContext is no-op when marker missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-spine-daemon-"));
  const removed = await clearStaleDaemonTaskContext(root);
  assert.equal(removed, false);
});
