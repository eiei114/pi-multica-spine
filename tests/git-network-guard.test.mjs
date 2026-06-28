import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  GIT_TRANSPORT_FAILURE_MARKER,
  GIT_TRANSPORT_HANG_MARKER,
  buildGuardedGitNetworkBashCommand,
  classifyGitTransportFailure,
  formatGitTransportFailure,
  isGitNetworkShellCommand,
  redactGitCommand,
  runGuardedGitNetworkShellCommand,
} from "../lib/git-network-guard.ts";

test("isGitNetworkShellCommand detects network git subcommands", () => {
  assert.equal(isGitNetworkShellCommand("git push origin HEAD"), true);
  assert.equal(isGitNetworkShellCommand("git fetch --all"), true);
  assert.equal(isGitNetworkShellCommand("git pull --rebase origin main"), true);
  assert.equal(isGitNetworkShellCommand("git ls-remote origin"), true);
  assert.equal(isGitNetworkShellCommand("git status"), false);
  assert.equal(isGitNetworkShellCommand("echo git push"), false);
});

test("classifyGitTransportFailure distinguishes idle hang from auth errors", () => {
  const idle = classifyGitTransportFailure("git push origin HEAD", "", {
    idleTimeoutMs: 180_000,
    idleHang: true,
  });
  assert.equal(idle.kind, "idle_hang");
  assert.match(formatGitTransportFailure(idle), /not generic agent silence/);

  const auth = classifyGitTransportFailure(
    "git push origin HEAD",
    "fatal: Authentication failed for 'https://github.com/example/repo.git/'",
    { idleTimeoutMs: 180_000 },
  );
  assert.equal(auth.kind, "auth");
  assert.match(formatGitTransportFailure(auth), new RegExp(GIT_TRANSPORT_FAILURE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(formatGitTransportFailure(auth), new RegExp(GIT_TRANSPORT_HANG_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const credentialPrompt = classifyGitTransportFailure(
    "git push origin HEAD",
    "fatal: terminal prompts disabled",
    { idleTimeoutMs: 180_000 },
  );
  assert.equal(credentialPrompt.kind, "credential_prompt");

  const emptyNonHang = classifyGitTransportFailure("git push origin HEAD", "", {
    idleTimeoutMs: 180_000,
    idleHang: false,
  });
  assert.notEqual(emptyNonHang.kind, "idle_hang");
});

test("formatGitTransportFailure redacts credentials in command output", () => {
  const redacted = redactGitCommand("git push https://user:ghp_secretToken12345678901234567890@github.com/org/repo.git HEAD");
  assert.doesNotMatch(redacted, /ghp_secretToken/);
  assert.match(redacted, /\*\*\*@github\.com/);

  const failure = classifyGitTransportFailure(
    "git push https://token@github.com/org/repo.git HEAD",
    "",
    { idleTimeoutMs: 180_000, idleHang: true },
  );
  const formatted = formatGitTransportFailure(failure);
  assert.doesNotMatch(formatted, /token@github/);
  assert.match(formatted, /\*\*\*@github/);

  const hangFailure = classifyGitTransportFailure("git ls-remote origin", "", {
    idleTimeoutMs: 180_000,
    idleHang: true,
  });
  const hangFormatted = formatGitTransportFailure(hangFailure);
  assert.match(hangFormatted, new RegExp(GIT_TRANSPORT_HANG_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(hangFormatted, /next_steps:/);
});

test("runGuardedGitNetworkShellCommand aborts silent subprocesses", async () => {
  const fixture = new URL("./fixtures/silent-hang.mjs", import.meta.url);
  const command = `node "${fileURLToPath(fixture)}"`;

  const started = Date.now();
  const result = await runGuardedGitNetworkShellCommand(command, {
    idleTimeoutMs: 500,
    wallClockTimeoutMs: 5_000,
  });
  const elapsed = Date.now() - started;

  assert.equal(result.idleHang, true);
  assert.ok(elapsed < 5_000);
  assert.equal(result.failure?.kind, "idle_hang");
});

test("buildGuardedGitNetworkBashCommand wraps command for CLI runner", () => {
  const wrapped = buildGuardedGitNetworkBashCommand("git push origin HEAD");
  assert.match(wrapped, /git-network-guard-cli\.mjs/);
  assert.match(wrapped, /--payload /);
});
