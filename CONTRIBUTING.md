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

Baseline (Node 24, report-only): ~93% lines, ~77% branches, ~93% functions. CI runs the same coverage step in report-only mode; thresholds are not enforced yet.

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