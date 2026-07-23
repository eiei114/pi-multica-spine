#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateSpine } from "../../lib/state-machine.ts";
import { SpineStateStore } from "../../lib/state-store.ts";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixture");

const store = new SpineStateStore(fixtureRoot);
const snapshot = await store.context();
const evaluation = evaluateSpine(snapshot.task);
const verified = evaluation.status === "VERIFIED" && evaluation.verified === true;

console.log(JSON.stringify({
  issue: snapshot.task?.issue?.identifier,
  status: evaluation.status,
  verified,
  missing: evaluation.missing,
}, null, 2));

if (!verified) {
  process.exitCode = 1;
}
