export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_VERSIONS = {
  "@earendil-works/pi-agent-core": "1.2.0",
  "@earendil-works/pi-ai": "1.2.0",
  "@earendil-works/pi-coding-agent": "1.2.0",
  "@earendil-works/pi-tui": "1.2.0",
};

export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension/i;

export function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed ?? null), passed: passed === true };
}

function textFromToolEvent(event) {
  const result = event?.result;
  if (!result || typeof result !== "object") return "";
  return (result.content ?? []).filter((item) => item?.type === "text").map((item) => item.text).join("\n");
}

export function behaviorAssertions(name, observed) {
  if (name === "extension_load") {
    const status = observed.status && {
      method: observed.status.method,
      statusKey: observed.status.statusKey,
      statusText: observed.status.statusText,
    };
    return [assertion(
      "extension_registered",
      "The actual Pi host loads pi-multica-spine and emits its RPC session status.",
      status ?? null,
      status?.method === "setStatus" && status.statusKey === "multica-spine"
        && status.statusText === "Multica spine ready",
    )];
  }

  if (name === "happy_path") {
    const output = textFromToolEvent(observed.toolEvent);
    return [assertion(
      "feature_response",
      "Pi advertises and executes multica_spine_bind; it returns BOUND for the requested issue and persists that binding.",
      {
        advertised: observed.advertised,
        providerErrors: observed.providerErrors ?? [],
        promptAccepted: observed.promptAccepted === true,
        toolName: observed.toolEvent?.toolName ?? null,
        isError: observed.toolEvent?.isError ?? null,
        output,
        persistedIssueIdentifier: observed.persistedIssueIdentifier ?? null,
      },
      observed.advertised === true && (observed.providerErrors ?? []).length === 0
        && observed.promptAccepted === true
        && observed.toolEvent?.toolName === "multica_spine_bind"
        && observed.toolEvent.isError === false && output.includes("status: BOUND")
        && output.includes("issue: PI-SDK-SMOKE-HAPPY")
        && observed.persistedIssueIdentifier === "PI-SDK-SMOKE-HAPPY",
    )];
  }

  if (name === "error_path") {
    const output = textFromToolEvent(observed.toolEvent);
    return [assertion(
      "handled_error",
      "Pi executes multica_spine_bind with an empty identifier, reports a failed tool result containing the validation error, and settles the run.",
      {
        toolName: observed.toolEvent?.toolName ?? null,
        isError: observed.toolEvent?.isError ?? null,
        output,
        providerErrors: observed.providerErrors ?? [],
        promptAccepted: observed.promptAccepted === true,
        settled: observed.settled === true,
      },
      observed.toolEvent?.toolName === "multica_spine_bind" && observed.toolEvent.isError === true
        && output.includes("issueIdentifier is required") && (observed.providerErrors ?? []).length === 0
        && observed.promptAccepted === true
        && observed.settled === true,
    )];
  }

  if (name === "reload_cleanup") {
    const feature = behaviorAssertions("happy_path", observed.feature)[0];
    const status = observed.reloadedStatus && {
      method: observed.reloadedStatus.method,
      statusKey: observed.reloadedStatus.statusKey,
      statusText: observed.reloadedStatus.statusText,
    };
    return [
      assertion(
        "reloaded_extension_registered",
        "After the first Pi process exits, a second actual Pi process loads the extension and emits its session status.",
        status ?? null,
        status?.method === "setStatus" && status.statusKey === "multica-spine"
          && status.statusText === "Multica spine ready",
      ),
      assertion(
        "reloaded_feature_response",
        "The second process executes the real bind tool and persists the resulting issue binding.",
        feature.observed,
        feature.passed,
      ),
      assertion(
        "clean_shutdown",
        "Both actual Pi processes exit with status 0 after bounded stdin shutdown, without unhandled or shutdown errors.",
        {
          firstExitCode: observed.firstExitCode ?? null,
          secondExitCode: observed.secondExitCode ?? null,
          hasShutdownError: observed.hasShutdownError === true,
        },
        observed.firstExitCode === 0 && observed.secondExitCode === 0 && observed.hasShutdownError === false,
      ),
    ];
  }

  if (name === "host_shell") {
    return [assertion(
      "native_shell_boundary",
      `The native host shell launches this checkout's local Pi CLI and prints exactly the pinned ${SDK_VERSIONS["@earendil-works/pi-coding-agent"]} version.`,
      {
        shell: observed.shell,
        exitCode: observed.exitCode,
        output: observed.output,
        expectedVersion: observed.expectedVersion,
      },
      observed.exitCode === 0 && observed.output === observed.expectedVersion,
    )];
  }

  throw new Error(`Unknown smoke case: ${name}`);
}
