#!/usr/bin/env node
import { runGuardedGitNetworkShellCommand, formatGitTransportFailure } from "./git-network-guard.ts";

function parseArgs(argv) {
  let payload;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--payload" && argv[i + 1]) {
      payload = argv[i + 1];
      i += 1;
    }
  }
  if (!payload) {
    throw new Error("Missing --payload <base64url>");
  }
  const command = Buffer.from(payload, "base64url").toString("utf8");
  return { command };
}

async function main() {
  const { command } = parseArgs(process.argv);
  const result = await runGuardedGitNetworkShellCommand(command, { cwd: process.cwd() });

  if (result.output) {
    process.stdout.write(result.output);
  }

  if (result.failure) {
    process.stderr.write(`\n${formatGitTransportFailure(result.failure)}\n`);
  }

  process.exit(result.exitCode === 0 && !result.idleHang ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
