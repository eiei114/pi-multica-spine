# Contributing

Thanks for helping improve this Pi package.

## Development

```bash
npm install
npm run ci
```

### Coverage

```bash
npm run test:coverage
```

Prints line, branch, and function coverage for `lib/` and `extensions/` using Node's built-in `--experimental-test-coverage` reporter (no extra dependencies).

Baseline (Node 24): CI enforces average coverage across `lib/**/*.ts` and `extensions/index.ts` via `scripts/coverage-gate.mjs` (lines ≥ 75%, branches ≥ 68%, functions ≥ 75%), plus per-file **hotspot** floors on critical modules. See `COVERAGE_HOTSPOTS` / `COVERAGE_DENYLIST` in that script.

## Local Pi testing

```bash
pi -e .
```

## Pull requests

Before opening a PR:

- Run `npm run ci`
- Update docs when behavior changes
- Update `CHANGELOG.md` for user-facing changes
- Keep package contents small and intentional

## Release

Releases use npm Trusted Publishing. Do not add `NPM_TOKEN` to GitHub Secrets.

```bash
npm version patch
git push
```

On `main`, `.github/workflows/auto-release.yml` creates the `v<version>` tag and GitHub Release, then dispatches `.github/workflows/publish.yml` to publish to npm. See [`docs/release.md`](docs/release.md).