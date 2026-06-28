import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Fail before Multica's generic 30m/120m idle watchdog when git transport goes silent. */
export const GIT_NETWORK_IDLE_TIMEOUT_MS = 180_000;

/** Safety wall-clock cap for a single guarded git network command. */
export const GIT_NETWORK_WALL_CLOCK_TIMEOUT_MS = 600_000;

export const GIT_TRANSPORT_HANG_MARKER = "[multica-spine] git transport hang detected";

export const GIT_TRANSPORT_FAILURE_MARKER = "[multica-spine] git transport failure";

export type GitTransportFailureKind =
  | "idle_hang"
  | "auth"
  | "remote"
  | "network"
  | "credential_prompt"
  | "shell"
  | "unknown";

export interface GitTransportFailure {
  kind: GitTransportFailureKind;
  summary: string;
  hints: string[];
  command: string;
  idleTimeoutMs: number;
  lastOutputAtMs?: number;
  partialOutput?: string;
}

const GIT_NETWORK_SUBCOMMANDS = ["push", "fetch", "pull", "ls-remote"] as const;

const NETWORK_COMMAND_PATTERN = new RegExp(
  `(^|[;&|]\\s*)git\\s+(?:[-\\w@.=]+\\s+)*(${GIT_NETWORK_SUBCOMMANDS.join("|")})\\b`,
  "i",
);

export function isGitNetworkShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return NETWORK_COMMAND_PATTERN.test(trimmed);
}

export function classifyGitTransportFailure(
  command: string,
  output: string,
  options: { idleTimeoutMs: number; idleHang?: boolean },
): GitTransportFailure {
  const text = output.trim();
  const lower = text.toLowerCase();

  if (options.idleHang) {
    return {
      kind: "idle_hang",
      summary: "Git network command produced no output for the idle watchdog interval.",
      hints: [
        "This is a git transport hang, not generic agent silence. The subprocess was stopped early.",
        "Check remote URL (`git remote -v`), VPN/firewall, and whether SSH or HTTPS auth is configured for non-interactive runs.",
        "For HTTPS, ensure a credential helper or token is available; for SSH, ensure ssh-agent has the right key loaded.",
        "Retry with `GIT_TRACE=1 GIT_CURL_VERBOSE=1` on a short command like `git ls-remote origin HEAD` to see where transport stalls.",
      ],
      command,
      idleTimeoutMs: options.idleTimeoutMs,
      partialOutput: text || undefined,
    };
  }

  if (/terminal prompts disabled|askpass|could not read password|credential/i.test(text)) {
    return {
      kind: "credential_prompt",
      summary: "Git appears to be waiting for interactive credentials.",
      hints: [
        "Work agents cannot answer interactive credential prompts.",
        "Configure a non-interactive credential helper or token before rerunning push/fetch/pull.",
        "Prefer `gh auth setup-git` or a stored HTTPS token over password prompts.",
      ],
      command,
      idleTimeoutMs: options.idleTimeoutMs,
      partialOutput: text || undefined,
    };
  }

  if (
    /device not configured|could not read username|invalid credentials|authentication failed|403|401 forbidden|permission denied \(publickey\)/i.test(
      text,
    )
  ) {
    return {
      kind: "auth",
      summary: "Git transport failed with an authentication error.",
      hints: [
        "Verify the remote URL and that credentials are available in this non-interactive agent runtime.",
        "For GitHub HTTPS, use a PAT via credential helper or `gh auth setup-git`.",
        "For SSH remotes, confirm `ssh -T git@github.com` works in the same environment.",
      ],
      command,
      idleTimeoutMs: options.idleTimeoutMs,

      partialOutput: text || undefined,
    };
  }

  if (/repository not found|remote: .*not found|could not read from remote repository|does not appear to be a git repository|fatal: .*remote error/i.test(text)) {
    return {
      kind: "remote",
      summary: "Git remote rejected the request or the remote repository reference looks wrong.",
      hints: [
        "Run `git remote -v` and confirm the URL matches the intended repo.",
        "Check branch name, fork permissions, and whether the remote branch still exists.",
        "If using `--force-with-lease`, verify the remote tracking ref is current.",
      ],
      command,
      idleTimeoutMs: options.idleTimeoutMs,
      partialOutput: text || undefined,
    };
  }

  if (
    /could not resolve host|connection timed out|connection refused|network is unreachable|failed to connect|ssl|tls|operation timed out|unable to access/i.test(
      text,
    ) ||
    lower.includes("connection reset")
  ) {
    return {
      kind: "network",
      summary: "Git transport failed due to a network or connectivity issue.",
      hints: [
        "Check VPN, proxy, DNS, and general outbound connectivity from this runtime.",
        "Retry `git ls-remote origin HEAD` to confirm transport before a long push/pull.",
        "If the remote is reachable but slow, investigate proxy or firewall rules for git/https/ssh.",
      ],
      command,
      idleTimeoutMs: options.idleTimeoutMs,
      partialOutput: text || undefined,
    };
  }

  if (/is not recognized as an internal or external command|command not found: git|syntax error|unexpected token/i.test(text)) {
    return {
      kind: "shell",
      summary: "The shell rejected the git command before transport started.",
      hints: [
        "Confirm git is installed and on PATH in this runtime.",
        "Use shell syntax that matches the active runtime (PowerShell vs bash).",
        "Avoid mixing bash-only operators in PowerShell runs.",
      ],
      command,
      idleTimeoutMs: options.idleTimeoutMs,
      partialOutput: text || undefined,
    };
  }

  return {
    kind: "unknown",
    summary: "Git network command failed.",
    hints: [
      "Inspect stderr/stdout above for the underlying git error.",
      "Retry a smaller transport probe such as `git ls-remote origin HEAD` before push/pull.",
    ],
    command,
    idleTimeoutMs: options.idleTimeoutMs,
    partialOutput: text || undefined,
  };
}

export function redactGitCommand(command: string): string {
  return command
    .replace(/(https?:\/\/)([^/@\s]+@)/gi, "$1***@")
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "ghp_***")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "github_pat_***");
}

export function formatGitTransportFailure(failure: GitTransportFailure): string {
  const marker = failure.kind === "idle_hang" ? GIT_TRANSPORT_HANG_MARKER : GIT_TRANSPORT_FAILURE_MARKER;
  const lines = [
    marker,
    `kind: ${failure.kind}`,
    `summary: ${failure.summary}`,
    `command: ${redactGitCommand(failure.command)}`,
    `idle_timeout_ms: ${failure.idleTimeoutMs}`,
    "next_steps:",
    ...failure.hints.map((hint) => `- ${hint}`),
  ];
  if (failure.partialOutput) {
    lines.push("partial_output:", failure.partialOutput);
  }
  return lines.join("\n");
}

export interface GuardedGitNetworkResult {
  exitCode: number;
  output: string;
  failure?: GitTransportFailure;
  idleHang: boolean;
}

export interface GuardedGitNetworkOptions {
  cwd?: string;
  idleTimeoutMs?: number;
  wallClockTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  shellPath?: string;
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      });
    } catch {
      // ignore
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}

function getShell(): { shell: string; args: string[] } | { useShellTrue: true } {
  if (process.platform === "win32") {
    return { useShellTrue: true };
  }
  return { shell: process.env.SHELL || "/bin/bash", args: ["-lc"] };
}

export async function runGuardedGitNetworkShellCommand(
  command: string,
  options: GuardedGitNetworkOptions = {},
): Promise<GuardedGitNetworkResult> {
  const idleTimeoutMs = options.idleTimeoutMs ?? GIT_NETWORK_IDLE_TIMEOUT_MS;
  const wallClockTimeoutMs = options.wallClockTimeoutMs ?? GIT_NETWORK_WALL_CLOCK_TIMEOUT_MS;
  const shellConfig = getShell();
  const cwd = options.cwd ?? process.cwd();

  return new Promise((resolve) => {
    const child =
      "useShellTrue" in shellConfig
        ? spawn(command, {
            cwd,
            env: options.env ?? process.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            shell: true,
          })
        : spawn(shellConfig.shell, [...shellConfig.args, command], {
            cwd,
            env: options.env ?? process.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            detached: true,
          });

    const chunks: string[] = [];
    let lastOutputAt = Date.now();
    let settled = false;
    let idleHang = false;

    const append = (data: Buffer) => {
      if (data.length === 0) return;
      lastOutputAt = Date.now();
      chunks.push(data.toString("utf8"));
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const idleTimer = setInterval(() => {
      if (Date.now() - lastOutputAt >= idleTimeoutMs) {
        idleHang = true;
        if (child.pid) killProcessTree(child.pid);
      }
    }, 250);

    const wallClockTimer = setTimeout(() => {
      idleHang = idleHang || chunks.join("").trim().length === 0;
      if (child.pid) killProcessTree(child.pid);
    }, wallClockTimeoutMs);

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearInterval(idleTimer);
      clearTimeout(wallClockTimer);

      const output = chunks.join("");
      let failure: GitTransportFailure | undefined;
      if (idleHang || exitCode !== 0) {
        failure = classifyGitTransportFailure(command, output, { idleTimeoutMs, idleHang });
      }

      resolve({ exitCode, output, failure, idleHang });
    };

    child.on("error", (error) => {
      chunks.push(error instanceof Error ? error.message : String(error));
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

export function buildGuardedGitNetworkBashCommand(originalCommand: string): string {
  const cliPath = fileURLToPath(new URL("./git-network-guard-cli.mjs", import.meta.url));
  const payload = Buffer.from(originalCommand, "utf8").toString("base64url");
  return `node "${cliPath}" --payload ${payload}`;
}

export function gitNetworkWallClockTimeoutSeconds(): number {
  return Math.ceil(GIT_NETWORK_WALL_CLOCK_TIMEOUT_MS / 1000);
}
