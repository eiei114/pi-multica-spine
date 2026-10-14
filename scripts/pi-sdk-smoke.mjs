import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  behaviorAssertions,
  EXTENSION_LOAD_ERROR_PATTERN,
  SDK_VERSIONS,
  UNHANDLED_ERROR_PATTERN,
  VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
// Routine CI/local runs write to the documented, git-ignored .ci-tmp scratch
// path. Refresh the committed record only with an explicit --write-evidence (or
// the legacy --update-curated-report alias).
const writesEvidence = process.argv.includes("--write-evidence")
  || process.argv.includes("--update-curated-report");
const reportPath = writesEvidence
  ? resolve(root, "docs/verification/pi-sdk-smoke.json")
  : resolve(root, ".ci-tmp/pi-sdk-smoke.json");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const piPackageRoot = resolve(root, "node_modules/@earendil-works/pi-coding-agent");
const piManifest = JSON.parse(readFileSync(resolve(piPackageRoot, "package.json"), "utf8"));
const piCli = resolve(piPackageRoot, piManifest.bin.pi);
const SDK_NAMES = Object.keys(SDK_VERSIONS);
const PROBE_TIMEOUT_MS = 15_000;
const CLEANUP_GRACE_MS = 1_000;
const TOOL_NAME = "multica_spine_bind";

function readInstalledSdkVersions() {
  return Object.fromEntries(SDK_NAMES.map((name) => [
    name,
    JSON.parse(readFileSync(resolve(root, "node_modules", name, "package.json"), "utf8")).version,
  ]));
}

const sdkVersions = readInstalledSdkVersions();
assert.deepEqual(sdkVersions, SDK_VERSIONS, "the installed Pi SDK must match the frozen wave versions");
for (const name of SDK_NAMES) {
  assert.equal(manifest.devDependencies?.[name], SDK_VERSIONS[name], `${name} must be pinned exactly for tests`);
}

function makeIsolatedDirs() {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-multica-spine-sdk-smoke-"));
  const cwd = join(tempRoot, "workspace");
  const agentDir = join(tempRoot, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  return { tempRoot, cwd, agentDir };
}

async function startOfflineProvider(agentDir, issueIdentifier) {
  const requests = [];
  const errors = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const toolNames = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter(Boolean);
      requests.push({ model: body.model, toolNames });

      if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
        throw new Error(`Unexpected offline provider request: ${request.method} ${request.url}`);
      }

      const callTool = requests.length === 1;
      const chunksToSend = callTool
        ? [
            {
              id: `pi-smoke-${requests.length}`,
              object: "chat.completion.chunk",
              created: 0,
              model: "spine-smoke",
              choices: [{
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [{
                    index: 0,
                    id: "pi-smoke-bind-call",
                    type: "function",
                    function: { name: TOOL_NAME, arguments: JSON.stringify({ issueIdentifier }) },
                  }],
                },
                finish_reason: null,
              }],
            },
            {
              id: `pi-smoke-${requests.length}`,
              object: "chat.completion.chunk",
              created: 0,
              model: "spine-smoke",
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            },
          ]
        : [
            {
              id: `pi-smoke-${requests.length}`,
              object: "chat.completion.chunk",
              created: 0,
              model: "spine-smoke",
              choices: [{
                index: 0,
                delta: { role: "assistant", content: "Deterministic local Pi SDK smoke response." },
                finish_reason: null,
              }],
            },
            {
              id: `pi-smoke-${requests.length}`,
              object: "chat.completion.chunk",
              created: 0,
              model: "spine-smoke",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            },
          ];

      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "close",
      });
      for (const chunk of chunksToSend) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    })().catch((error) => {
      errors.push(error instanceof Error ? error.message : String(error));
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("offline provider failed");
    });
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "offline provider must bind to a local TCP port");
  writeFileSync(join(agentDir, "models.json"), `${JSON.stringify({
    providers: {
      "pi-sdk-smoke": {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: "openai-completions",
        apiKey: "local-only",
        models: [{
          id: "spine-smoke",
          name: "Pi Multica Spine Offline Smoke",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 8192,
          maxTokens: 128,
        }],
      },
    },
  }, null, 2)}\n`, "utf8");

  return { server, requests, errors };
}

function startRpcHost({ cwd, agentDir }) {
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
  for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]) {
    delete env[key];
  }
  const args = [
    piCli,
    "--provider", "pi-sdk-smoke",
    "--model", "spine-smoke",
    "--api-key", "local-only",
    "--thinking", "off",
    "--mode", "rpc",
    "--no-session",
    "--no-extensions",
    "--extension", root,
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-mcp",
  ];
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const host = {
    child,
    records: [],
    parseErrors: [],
    stdout: "",
    stderr: "",
    buffer: "",
    closed: undefined,
    redactions: [root, cwd, agentDir],
    deadline: Date.now() + PROBE_TIMEOUT_MS,
  };
  host.closePromise = new Promise((resolveClose) => {
    child.once("close", (code, signal) => {
      host.closed = { code, signal };
      resolveClose(host.closed);
    });
  });
  child.once("error", (error) => host.parseErrors.push(`child process error: ${error.message}`));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    host.stdout += chunk;
    host.buffer += chunk;
    while (host.buffer.includes("\n")) {
      const newline = host.buffer.indexOf("\n");
      const line = host.buffer.slice(0, newline).replace(/\r$/, "");
      host.buffer = host.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        host.records.push(JSON.parse(line));
      } catch {
        host.parseErrors.push(`invalid Pi RPC record: ${line}`);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { host.stderr += chunk; });
  return host;
}

function sendRpc(host, command) {
  if (host.closed) throw new Error(`Pi RPC exited before command ${command.type}`);
  host.child.stdin.write(`${JSON.stringify(command)}\n`);
}

async function waitUntil(host, predicate, description) {
  while (Date.now() < host.deadline) {
    const match = predicate();
    if (match) return match;
    if (host.closed) throw new Error(`Pi RPC exited before ${description}: ${JSON.stringify(host.closed)}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Pi RPC timed out after ${PROBE_TIMEOUT_MS} ms waiting for ${description}`);
}

async function waitForReady(host) {
  sendRpc(host, { id: "smoke-state", type: "get_state" });
  const response = await waitUntil(
    host,
    () => host.records.find((record) => record.id === "smoke-state" && record.command === "get_state"),
    "get_state response",
  );
  if (response.success !== true) throw new Error(`Pi RPC get_state failed: ${JSON.stringify(response)}`);
  return response.data;
}

async function runPrompt(host, issueIdentifier) {
  sendRpc(host, {
    id: "smoke-prompt",
    type: "prompt",
    message: `Use ${TOOL_NAME} exactly once with issueIdentifier ${issueIdentifier}. Do not call any other tool.`,
  });
  const promptResponse = await waitUntil(
    host,
    () => host.records.find((record) => record.id === "smoke-prompt" && record.command === "prompt"),
    "prompt acceptance response",
  );
  const settled = await waitUntil(host, () => host.records.find((record) => record.type === "agent_settled"), "agent_settled");
  const toolEvent = host.records.find((record) => record.type === "tool_execution_end" && record.toolName === TOOL_NAME);
  return { promptResponse, settled, toolEvent };
}

async function stopRpcHost(host) {
  if (!host) return { code: null, signal: null, forced: false };
  if (!host.closed) {
    try {
      host.child.stdin.end();
    } catch {
      // The close result below is authoritative if the child already exited.
    }
    const graceDeadline = Date.now() + CLEANUP_GRACE_MS;
    const waitUntilTime = async (deadline) => {
      if (host.closed) return host.closed;
      return Promise.race([
        host.closePromise,
        new Promise((resolveDelay) => setTimeout(() => resolveDelay(undefined), Math.max(0, deadline - Date.now()))),
      ]);
    };
    let closed = await waitUntilTime(Date.now() + 700);
    let forced = false;
    if (!closed) {
      forced = true;
      host.child.kill("SIGTERM");
      closed = await waitUntilTime(Date.now() + Math.max(0, graceDeadline - Date.now()));
    }
    if (!closed) {
      host.child.kill("SIGKILL");
      closed = await waitUntilTime(graceDeadline);
    }
    return { ...(closed ?? { code: null, signal: null }), forced };
  }
  return { ...host.closed, forced: false };
}

function statusEvent(host) {
  return host.records.find((record) => record.type === "extension_ui_request"
    && record.method === "setStatus" && record.statusKey === "multica-spine");
}

function persistedIssueIdentifier(cwd) {
  try {
    const current = JSON.parse(readFileSync(resolve(cwd, ".multica-spine/current.json"), "utf8"));
    const task = JSON.parse(readFileSync(resolve(cwd, ".multica-spine", current.taskFile), "utf8"));
    return task.issue.identifier;
  } catch {
    return undefined;
  }
}

async function closeServer(provider) {
  if (!provider) return;
  await new Promise((resolveClose) => {
    provider.server.close(resolveClose);
    provider.server.closeAllConnections();
  });
}

function allOutput(host) {
  return `${host?.stdout ?? ""}${host?.stderr ?? ""}`;
}

function capturedRpcOutput(host) {
  return host.records.flatMap((record) => {
    if (record.type === "extension_ui_request" && record.method === "setStatus") {
      return [{ type: record.type, method: record.method, statusKey: record.statusKey, statusText: record.statusText }];
    }
    if (record.command === "prompt" && record.type === "response") {
      return [{ type: record.type, command: record.command, success: record.success, data: record.data }];
    }
    if (record.type === "tool_execution_start" && record.toolName === TOOL_NAME) {
      return [{ type: record.type, toolName: record.toolName, args: record.args }];
    }
    if (record.type === "tool_execution_end" && record.toolName === TOOL_NAME) {
      const output = (record.result?.content ?? [])
        .filter((item) => item?.type === "text")
        .map((item) => item.text);
      return [{ type: record.type, toolName: record.toolName, isError: record.isError, output }];
    }
    if (record.type === "agent_settled") return [{ type: record.type, aborted: record.aborted }];
    return [];
  });
}

function outputEvidence(hosts, details = {}) {
  return JSON.stringify({
    command: "npm run smoke:pi",
    captured_pi_rpc_output: hosts.filter(Boolean).map(capturedRpcOutput),
    ...details,
  }, null, 2);
}

function providerRequestEvidence(provider) {
  return provider.requests.map(({ model, toolNames }) => ({
    model,
    bindToolAdvertised: toolNames.includes(TOOL_NAME),
  }));
}

function caseResult(name, exitCode, assertions, evidence, fullOutputs = "") {
  const output = typeof fullOutputs === "string" ? fullOutputs : fullOutputs.join("\n");
  const unhandledErrors = [...output.matchAll(/UnhandledPromiseRejection|uncaught exception|shutdown error/gi)].length;
  const loadErrors = [...output.matchAll(/Failed to load extension|Error loading extension/gi)].length;
  return {
    name,
    command: "npm run smoke:pi",
    exit_code: exitCode,
    passed: exitCode === 0 && unhandledErrors === 0 && loadErrors === 0 && assertions.every((item) => item.passed),
    evidence,
    assertions,
    unhandledErrors,
    loadErrors,
  };
}

function failedCase(name, error, hosts = []) {
  const requiredIds = {
    extension_load: ["extension_registered"],
    happy_path: ["feature_response"],
    error_path: ["handled_error"],
    reload_cleanup: ["reloaded_extension_registered", "reloaded_feature_response", "clean_shutdown"],
    host_shell: ["native_shell_boundary"],
  }[name];
  const assertions = requiredIds.map((id) => ({
    id,
    expected: "The actual Pi SDK compatibility behavior described by the smoke contract is observed.",
    observed: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    passed: false,
  }));
  return caseResult(name, 1, assertions, outputEvidence(hosts, {
    error: error instanceof Error ? error.message : String(error),
    stderr: hosts.filter(Boolean).map((host) => host.stderr).filter(Boolean),
  }), hosts.map(allOutput).join("\n"));
}

async function runExtensionLoadCase() {
  const dirs = makeIsolatedDirs();
  let provider;
  let host;
  try {
    provider = await startOfflineProvider(dirs.agentDir, "PI-SDK-SMOKE-LOAD");
    host = startRpcHost(dirs);
    await waitForReady(host);
    const status = statusEvent(host);
    const stop = await stopRpcHost(host);
    const hostOutput = allOutput(host);
    const evidence = outputEvidence([host], { shutdown: stop });
    const assertions = behaviorAssertions("extension_load", { status });
    const result = caseResult("extension_load", stop.code, assertions, evidence, hostOutput);
    result.passed &&= !stop.forced;
    return result;
  } catch (error) {
    const stop = await stopRpcHost(host);
    return failedCase("extension_load", error, host ? [{ ...host, stderr: `${host.stderr}\nshutdown=${JSON.stringify(stop)}` }] : []);
  } finally {
    await closeServer(provider);
    rmSync(dirs.tempRoot, { recursive: true, force: true });
  }
}

async function runFeatureCase(name, issueIdentifier) {
  const dirs = makeIsolatedDirs();
  let provider;
  let host;
  try {
    provider = await startOfflineProvider(dirs.agentDir, issueIdentifier);
    host = startRpcHost(dirs);
    await waitForReady(host);
    const prompt = await runPrompt(host, issueIdentifier);
    const stop = await stopRpcHost(host);
    const hostOutput = allOutput(host);
    const observed = {
      advertised: provider.requests[0]?.toolNames.includes(TOOL_NAME) === true,
      providerErrors: provider.errors,
      promptAccepted: prompt.promptResponse.success === true && prompt.promptResponse.data?.disposition === "started",
      toolEvent: prompt.toolEvent,
      persistedIssueIdentifier: persistedIssueIdentifier(dirs.cwd),
      settled: prompt.settled?.type === "agent_settled",
    };
    const assertions = behaviorAssertions(name, observed);
    const result = caseResult(name, stop.code, assertions,
      outputEvidence([host], {
        provider_requests: providerRequestEvidence(provider),
        provider_errors: provider.errors,
        shutdown: stop,
      }),
      hostOutput);
    result.passed &&= !stop.forced && provider.errors.length === 0;
    return result;
  } catch (error) {
    const stop = await stopRpcHost(host);
    return failedCase(name, error, host ? [{ ...host, stderr: `${host.stderr}\nshutdown=${JSON.stringify(stop)}` }] : []);
  } finally {
    await closeServer(provider);
    rmSync(dirs.tempRoot, { recursive: true, force: true });
  }
}

async function runReloadCleanupCase() {
  const dirs = makeIsolatedDirs();
  let provider;
  let firstHost;
  let secondHost;
  const hosts = [];
  try {
    provider = await startOfflineProvider(dirs.agentDir, "PI-SDK-SMOKE-HAPPY");
    firstHost = startRpcHost(dirs);
    hosts.push(firstHost);
    await waitForReady(firstHost);
    const firstStatus = statusEvent(firstHost);
    const firstStop = await stopRpcHost(firstHost);
    firstHost = undefined;

    secondHost = startRpcHost(dirs);
    hosts.push(secondHost);
    await waitForReady(secondHost);
    const prompt = await runPrompt(secondHost, "PI-SDK-SMOKE-HAPPY");
    const secondStatus = statusEvent(secondHost);
    const secondStop = await stopRpcHost(secondHost);
    secondHost = undefined;

    const observed = {
      reloadedStatus: secondStatus,
      feature: {
        advertised: provider.requests[0]?.toolNames.includes(TOOL_NAME) === true,
        providerErrors: provider.errors,
        promptAccepted: prompt.promptResponse.success === true && prompt.promptResponse.data?.disposition === "started",
        toolEvent: prompt.toolEvent,
        persistedIssueIdentifier: persistedIssueIdentifier(dirs.cwd),
      },
      firstExitCode: firstStop.code,
      secondExitCode: secondStop.code,
      hasShutdownError: hosts.some((host) => UNHANDLED_ERROR_PATTERN.test(allOutput(host)))
        || firstStop.forced || secondStop.forced,
    };
    const assertions = behaviorAssertions("reload_cleanup", observed);
    const fullOutput = hosts.map(allOutput).join("\n");
    const evidence = outputEvidence(hosts, {
      provider_requests: providerRequestEvidence(provider),
      provider_errors: provider.errors,
      first_status: firstStatus && {
        method: firstStatus.method,
        statusKey: firstStatus.statusKey,
        statusText: firstStatus.statusText,
      },
      first_exit: firstStop,
      second_exit: secondStop,
    });
    const result = caseResult("reload_cleanup", secondStop.code, assertions, evidence, fullOutput);
    result.passed &&= !firstStop.forced && !secondStop.forced && provider.errors.length === 0;
    return result;
  } catch (error) {
    const stops = [await stopRpcHost(firstHost), await stopRpcHost(secondHost)];
    const hostEvidence = hosts.map((host, index) => ({ ...host, stderr: `${host.stderr}\nshutdown=${JSON.stringify(stops[index])}` }));
    return failedCase("reload_cleanup", error, hostEvidence);
  } finally {
    await closeServer(provider);
    rmSync(dirs.tempRoot, { recursive: true, force: true });
  }
}

function runHostShellCase() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-multica-spine-host-shell-"));
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
  let shell;
  let result;
  try {
    if (process.platform === "win32") {
      shell = "PowerShell";
      const powershell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
      const quote = (value) => `'${value.replaceAll("'", "''")}'`;
      const command = `& ${quote(process.execPath)} ${quote(piCli)} --version; exit $LASTEXITCODE`;
      result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
        cwd: root, env, encoding: "utf8", timeout: PROBE_TIMEOUT_MS, windowsHide: true,
      });
    } else {
      shell = "/bin/sh";
      result = spawnSync(shell, ["-c", 'exec "$1" "$2" --version', "pi-sdk-smoke", process.execPath, piCli], {
        cwd: root, env, encoding: "utf8", timeout: PROBE_TIMEOUT_MS,
      });
    }
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const exitCode = result.status ?? 1;
    const observed = { shell, exitCode, output, expectedVersion: SDK_VERSIONS["@earendil-works/pi-coding-agent"] };
    const assertions = behaviorAssertions("host_shell", observed);
    const fullOutput = `${output}\n${result.error?.message ?? ""}`;
    return caseResult("host_shell", exitCode, assertions, JSON.stringify({
      command: "npm run smoke:pi",
      shell,
      output,
      exit_code: exitCode,
      error: result.error?.message ?? null,
    }, null, 2), fullOutput);
  } catch (error) {
    return failedCase("host_shell", error);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
}

async function main() {
  const cases = [];
  cases.push(await runExtensionLoadCase());
  cases.push(await runFeatureCase("happy_path", "PI-SDK-SMOKE-HAPPY"));
  cases.push(await runFeatureCase("error_path", ""));
  cases.push(await runReloadCleanupCase());
  cases.push(runHostShellCase());

  const unhandledErrors = cases.reduce((sum, item) => sum + item.unhandledErrors, 0);
  const extensionLoadErrors = cases.reduce((sum, item) => sum + item.loadErrors, 0)
    + cases.flatMap((item) => item.assertions).filter((assertion) =>
      ["extension_registered", "reloaded_extension_registered"].includes(assertion.id) && !assertion.passed).length;
  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: sdkVersions,
    platform: process.platform,
    model_inference: "none; deterministic provider is local-only on 127.0.0.1 and returns a fixed Spine tool call",
    unhandled_errors: unhandledErrors,
    extension_load_errors: extensionLoadErrors,
    cases: cases.map(({ unhandledErrors: _unhandledErrors, loadErrors: _loadErrors, ...item }) => item),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    verification_contract: VERIFICATION_CONTRACT,
    platform: process.platform,
    unhandled_errors: report.unhandled_errors,
    extension_load_errors: report.extension_load_errors,
    cases: cases.map(({ name, passed, exit_code }) => ({ name, passed, exit_code })),
  }));
  if (cases.some((item) => !item.passed) || report.unhandled_errors !== 0 || report.extension_load_errors !== 0) {
    process.exitCode = 1;
  }
}

await main();
