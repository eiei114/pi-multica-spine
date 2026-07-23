#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  digestJsonlFileContent,
  formatJsonlDigestHuman,
  formatJsonlDigestJson,
} from "../dist/lib/jsonl-digest.js";

function stdoutIsTty() {
  return Boolean(process.stdout.isTTY);
}

export function parseJsonlDigestCliArgs(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      human: { type: "boolean", default: false },
      color: { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  return {
    path: positionals[0],
    human: values.human ?? false,
    color: values.color ?? false,
    noColor: values["no-color"] ?? false,
    help: values.help ?? false,
  };
}

export function runJsonlDigestCli(argv = process.argv.slice(2)) {
  const config = parseJsonlDigestCliArgs(argv);
  if (config.help || !config.path) {
    console.error("usage: jsonl-digest [--human] [--color|--no-color] <tasks.jsonl>");
    console.error("  default: JSON output (stable, pipe-friendly)");
    console.error("  --human: human-readable summary; --color when stdout is a TTY unless --no-color");
    return config.help ? 0 : 1;
  }
  const content = readFileSync(config.path, "utf8");
  const result = digestJsonlFileContent(content);
  const useHuman = config.human;
  const useColor = !config.noColor && (config.color || (useHuman && stdoutIsTty()));
  if (useHuman) {
    process.stdout.write(formatJsonlDigestHuman(result, { color: useColor }));
  } else {
    process.stdout.write(formatJsonlDigestJson(result));
  }
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  process.exitCode = runJsonlDigestCli();
}
