# pi-multica-spine

[![CI](https://github.com/eiei114/pi-multica-spine/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-multica-spine/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-multica-spine/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-multica-spine/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pi-multica-spine.svg)](https://www.npmjs.com/package/pi-multica-spine)
[![npm downloads](https://img.shields.io/npm/dm/pi-multica-spine.svg)](https://www.npmjs.com/package/pi-multica-spine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)
<a href="https://buymeacoffee.com/ekawano114m"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60"></a>

> A Pi extension that keeps Multica work agents bound to the issue → PR → evidence → handoff contract.

## What this is

`pi-multica-spine` is for Pi agents doing implementation or PR-producing work inside Multica. It injects a short work-agent contract and exposes typed tools that make forgotten PR binding, verification evidence, and handoff gaps visible before an agent reports done.

It does not replace Multica controllers, Todo Runner, Review Sentinel, or PR creation flow. It is a narrow spine for work agents.

## Features

- Seven typed spine tools: bind, context, next, link PR, add evidence, handoff, and verify.
- Repo-local `.multica-spine/` state store with opaque issue identifiers and ASCII-safe task filenames.
- Work-agent contract injected into Pi sessions so agents see the bind → PR → evidence → handoff flow up front.
- PR binding checker with a recommended `Multica Issue: <issue-identifier>` PR body line.
- Done gate via `multica_spine_verify` — fails until issue binding, PR writeback, evidence, handoff, and git completion (clean worktree, no conflict markers, pushed commits, current PR head SHA) are complete.

### Tools

| Tool | Purpose |
|---|---|
| `multica_spine_bind` | Bind the active opaque issue identifier. |
| `multica_spine_context` | Inspect current issue, PR, evidence, handoff, and verification state. |
| `multica_spine_next` | Return current state plus the next required action. |
| `multica_spine_link_pr` | Record PR URL and metadata (`prNumber`, `prHeadSha`, `prBranch`, etc.). |
| `multica_spine_add_evidence` | Record verification command/manual/test/lint/typecheck evidence. |
| `multica_spine_handoff` | Record structured done/changed/verification/blockers/next handoff. |
| `multica_spine_verify` | Completion check. Fails until issue, PR binding, writeback, evidence, handoff, and git completion blockers are resolved. |

## Install

Install the published npm package with Pi:

```bash
pi install npm:pi-multica-spine
```

Pin a specific version when you want reproducible installs:

```bash
pi install npm:pi-multica-spine@0.1.2
```

Install into the current project instead of your user Pi settings:

```bash
pi install npm:pi-multica-spine -l
```

Or install from GitHub:

```bash
pi install git:github.com/eiei114/pi-multica-spine
```

Try it without permanently installing:

```bash
pi -e npm:pi-multica-spine
```

## Quick start

Clone the repo and try the extension locally:

```bash
git clone https://github.com/eiei114/pi-multica-spine.git
cd pi-multica-spine
npm install
pi -e .
```

Then bind an issue and walk the spine:

1. Call `multica_spine_bind` with your opaque issue identifier.
2. Call `multica_spine_next` to see the required next action.
3. Open a PR whose branch, title, or body references the bound issue.
4. Call `multica_spine_link_pr` with PR URL, number, head SHA, branch, and `writebackRecorded: true` after the source issue is updated.
5. Call `multica_spine_add_evidence` with verification results.
6. Call `multica_spine_handoff` with a reviewer-ready summary.
7. Call `multica_spine_verify` before reporting done.

Recommended PR body line:

```md
Multica Issue: <issue-identifier>
```

### Contract injected into work-agent sessions

```md
You are acting as a Multica Work Agent.

For Multica implementation or PR-producing work:
1. Bind the active issue identifier with multica_spine_bind.
2. Use multica_spine_next to see the required next action.
3. Ensure PRs reference the bound issue identifier.
4. Do not report done until multica_spine_verify passes.
```

### State files

State is repo-local:

```txt
.multica-spine/current.json
.multica-spine/tasks/<safe-issue-identifier>.json
```

Issue identifiers are stored canonically as opaque strings. Filenames are ASCII-safe slugs with a short hash suffix.

## Package contents

| Path | Purpose |
|---|---|
| `extensions/` | Pi TypeScript extension entrypoint (`index.ts`) |
| `lib/` | Spine state store, state machine, PR binding checker, git completion checker, and schemas |
| `docs/` | Release and maintainer docs (`release.md`) |
| `README.md` | Public entrypoint (this file) |
| `LICENSE` | MIT license |
| `CHANGELOG.md` | Version history |

## Development

```bash
npm install
npm run ci
```

Individual checks:

```bash
npm run typecheck
npm test
npm run pack:check
```

## Release

This package uses npm Trusted Publishing with GitHub Actions OIDC — no `NPM_TOKEN` is required.

```bash
npm version patch
git push
```

On `main`, `.github/workflows/auto-release.yml` creates the `v<version>` tag and GitHub Release, then dispatches `.github/workflows/publish.yml` to publish to npm.

See [`docs/release.md`](docs/release.md) for setup details.

## Security

Pi packages run with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/pi-multica-spine
- GitHub: https://github.com/eiei114/pi-multica-spine
- Issues: https://github.com/eiei114/pi-multica-spine/issues

## License

MIT
