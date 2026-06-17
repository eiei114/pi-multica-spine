# PACKAGE_DISPLAY_NAME

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
[![Publish](https://github.com/OWNER/REPO/actions/workflows/publish.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/PACKAGE_NAME.svg)](https://www.npmjs.com/package/PACKAGE_NAME)
[![npm downloads](https://img.shields.io/npm/dm/PACKAGE_NAME.svg)](https://www.npmjs.com/package/PACKAGE_NAME)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)

> One-line pitch for this TypeScript-first Pi package.

## What this is

Briefly explain what this TypeScript-first package adds to Pi and who should use it.

## Features

- Feature 1
- Feature 2
- Feature 3

## Install

Install the published npm package with Pi:

```bash
pi install npm:PACKAGE_NAME
```

Replace `PACKAGE_NAME` with the exact `name` from `package.json`.
For a scoped npm package, keep the `npm:` prefix:

```bash
pi install npm:@your-scope/your-pi-package
```

Pin a specific version when you want reproducible installs:

```bash
pi install npm:PACKAGE_NAME@0.1.0
```

Install into the current project instead of your user Pi settings:

```bash
pi install npm:PACKAGE_NAME -l
```

Or install from GitHub:

```bash
pi install git:github.com/OWNER/REPO
```

Try it without permanently installing:

```bash
pi -e npm:PACKAGE_NAME
```

## Quick start

Try this package locally:

```bash
pi -e .
```

Then run:

```txt
/your-command
```

## Package contents

| Path | Purpose |
|---|---|
| `extensions/` | Pi TypeScript extension entrypoints (`*.ts` and `index.ts`) |
| `lib/` | Shared TypeScript helpers |
| `skills/` | Agent Skills |
| `prompts/` | Prompt templates |
| `themes/` | Pi themes |
| `docs/` | Optional supporting docs (usage, examples, release, ADRs) |

## Development

```bash
npm install
npm run ci
```

## Development flow

Use this default flow when building a new Pi extension OSS project from this template:

1. Create the Vault project notes under `4_Project/<ProjectName>/`.
2. Add `CONTEXT.md`, `README.md`, `ROADMAP.md`, `Docs/`, `Issues/`, and `Progress/`.
3. Write the PRD in `4_Project/<ProjectName>/Docs/`.
4. Split approved tracer-bullet issues into `4_Project/<ProjectName>/Issues/`.
5. Implement in the OSS repo.
6. Run `npm run ci`, `npm test`, and `npm pack --dry-run`.
7. Release with Trusted Publishing.
8. Save release notes and follow-up decisions back to the Vault project.

Short version:

```txt
Vault notes -> PRD -> Issues -> implement -> ci/check -> release -> save learnings
```

## Release

This package is set up for npm Trusted Publishing, so no `NPM_TOKEN` is required.

```bash
npm version patch
git push
```

See [`docs/release.md`](docs/release.md) for setup details.

## Docs

`docs/` is optional supporting documentation, not a fixed six-file set. README stays the GitHub/npm entrypoint; add `docs/*.md` only when they help users or maintainers.

After creating a repository from this template:

1. Follow [`docs/template-checklist.md`](docs/template-checklist.md) for setup.
2. Run the **post-generation docs cleanup** in that checklist: delete or merge template bootstrap docs that no longer add project value.

Useful docs to keep when they add value:

- [`docs/examples.md`](docs/examples.md) — examples for extensions, skills, prompts, and themes
- [`docs/release.md`](docs/release.md) — Trusted Publishing details (README Release summarizes the flow)
- `docs/usage.md` — create when usage does not fit in README

Optional maintainer guidance (not a public-user navigation target in mature repos):

- [`docs/template-checklist.md`](docs/template-checklist.md)

Template bootstrap docs to delete or merge after setup unless they still teach something project-specific:

- `docs/github-template.md`
- `docs/repository-settings.md`
- `docs/typescript.md`

## Security

Pi packages can execute code with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/PACKAGE_NAME
- GitHub: https://github.com/OWNER/REPO
- Issues: https://github.com/OWNER/REPO/issues

## License

MIT\n