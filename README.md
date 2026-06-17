# pi-multica-spine

[![CI](https://github.com/eiei114/pi-multica-spine/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-multica-spine/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-multica-spine.svg)](https://www.npmjs.com/package/pi-multica-spine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> A Pi extension that keeps Multica work agents bound to the issue → PR → evidence → handoff contract.

## What this is

`pi-multica-spine` is for Pi agents doing implementation or PR-producing work inside Multica. It injects a short work-agent contract and exposes typed tools that make forgotten PR binding, verification evidence, and handoff gaps visible before an agent reports done.

It does not replace Multica controllers, Todo Runner, Review Sentinel, or PR creation flow. It is a narrow spine for work agents.

## Tools

| Tool | Purpose |
|---|---|
| `multica_spine_bind` | Bind the active opaque issue identifier. |
| `multica_spine_context` | Inspect current issue, PR, evidence, handoff, and verification state. |
| `multica_spine_next` | Return current state plus the next required action. |
| `multica_spine_link_pr` | Record PR URL and metadata (`prNumber`, `prHeadSha`, `prBranch`, etc.). |
| `multica_spine_add_evidence` | Record verification command/manual/test/lint/typecheck evidence. |
| `multica_spine_handoff` | Record structured done/changed/verification/blockers/next handoff. |
| `multica_spine_verify` | Completion check. Fails until issue, PR binding, writeback, evidence, and handoff are complete. |

## Contract injected into work-agent sessions

```md
You are acting as a Multica Work Agent.

For Multica implementation or PR-producing work:
1. Bind the active issue identifier with multica_spine_bind.
2. Use multica_spine_next to see the required next action.
3. Ensure PRs reference the bound issue identifier.
4. Do not report done until multica_spine_verify passes.
```

## State files

State is repo-local:

```txt
.multica-spine/current.json
.multica-spine/tasks/<safe-issue-identifier>.json
```

Issue identifiers are stored canonically as opaque strings. Filenames are ASCII-safe slugs with a short hash suffix.

## Install / try

From GitHub:

```bash
pi -e git:github.com/eiei114/pi-multica-spine
```

Local development:

```bash
npm install
npm run ci
pi -e .
```

## Example flow

1. Call `multica_spine_bind` with `TASK-45`.
2. Open a PR whose branch/title/body/metadata references `TASK-45`.
3. Call `multica_spine_link_pr` with PR URL, number, head SHA, branch, and `writebackRecorded: true` after the source issue is updated or manually recorded.
4. Call `multica_spine_add_evidence` with verification command results.
5. Call `multica_spine_handoff` with reviewer-ready summary.
6. Call `multica_spine_verify` before reporting done.

Recommended PR body line:

```md
Multica Issue: TASK-45
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run pack:check
```

## Security

Pi packages run with your local permissions. Review extensions before installing third-party packages.

## License

MIT
