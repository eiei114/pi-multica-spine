# Template re-sync (DOT-823) — 2026-07-24

Compared `pi-multica-spine@0.6.1` against local `pi-extension-template@0.1.6` (pi coding-agent 0.80.x peer baseline).

## Adopted (v0.7.0)

| Delta | Action |
| --- | --- |
| GitHub Actions `checkout@v7`, `setup-node@v6` | Bumped `.github/workflows/ci.yml` to match template |
| CLI `importSpineLib` pattern | All workflow/jsonl scripts use `scripts/spine-lib-import.mjs` (dist preferred, `lib/*.ts` dev fallback) |
| Coverage floors toward 0.7.0 | Raised gate to lines 75% / branches 68% / functions 75% |

## Deferred (intentional)

| Delta | Reason |
| --- | --- |
| Template `publish.yml` curl pre-check before `setup-node` | pi-multica-spine already skips via `npm view` + E403 classifier; changing OIDC order risks regressions |
| Template `push`/`tags` publish triggers | Removed in 0.6.0 (DOT-881 single-trigger design) |
| `skills/`, `prompts/`, `themes/` scaffold layout | Not applicable to Multica spine package |
| `create-pi-extension` workspace / `sync:template` | Different publish model (this repo publishes `pi-multica-spine` directly) |
| Example extensions (`hello.ts`, TUI dashboard) | Out of scope for workflow adapter package |

## Next periodic check

Re-diff when `pi-extension-template` bumps peer deps or release workflow guardrails change.
