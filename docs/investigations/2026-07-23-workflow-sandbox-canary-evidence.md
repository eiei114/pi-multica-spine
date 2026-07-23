# Workflow Sandbox Canary Evidence (2026-07-23)

## Merge gate completion

| PR | Issue | Merge commit | Published |
|---|---|---|---|
| [#30](https://github.com/eiei114/pi-multica-spine/pull/30) | DOT-1120 | `0c7cd34f328b3469ddb2bc40892d7b78a52b785d` | — |
| [#31](https://github.com/eiei114/pi-multica-spine/pull/31) | DOT-1117 | `6be7ac69c031fc15843b94e0b8b7377aa02d5b33` | — |
| [#32](https://github.com/eiei114/pi-multica-spine/pull/32) | DOT-1119 | `1ad5b71c52cd9610c4a4411e03e6149776799794` | — |
| [#33](https://github.com/eiei114/pi-multica-spine/pull/33) | evidence | `1bff904` | — |

- `origin/main` HEAD: `1bff904` (pre live-apply branch)
- npm release: [v0.4.0](https://github.com/eiei114/pi-multica-spine/releases/tag/v0.4.0)
- Local verification: `npm run ci` pass on live-apply branch

## Multica issue sync

| Issue | Status | Notes |
|---|---|---|
| DOT-1116 | done | Parent lane |
| DOT-1121 | done | Live CLI |
| DOT-1118 | done | Controller Autopilot |
| DOT-1120 | done | Hermes adapter |
| DOT-1117 | done | Routing / telemetry / factory / migration |
| DOT-1119 | done | Harness + live bootstrap executed 2026-07-23 |

## Live canary status

| Item | Value |
|---|---|
| Sandbox path | `C:/Users/Keisu/Projects/Sandbox/pi-multica-spine-idea-to-build-canary` |
| Initial commit | `e9f6e0dc1000b318238df180bfb9419d42f97ccd` |
| Multica project | `pi-multica-spine Idea-to-Build Canary` (`c8db7286-1fc1-4034-b9ac-76388560244e`) |
| Parent issue | [DOT-1123](https://multica.dev) (`fb0ecde7-0171-4954-9ab2-f6151e562cd3`) |
| Workflow run | `canary-20260723` |
| Controller autopilot | `51782d94-7cdf-4188-9326-e64f7d5040e1` (Pi OSS Orchestrator, `run_only`) |
| Daemon / resource | `019e4c75-0504-7591-8646-260b510ce726` → local_directory bind |
| Ledger hash | `c099bab8dd622562c573bbc2b66c3ddf8b743f09325eb1a43d7f892b63230b9e` |
| `live_canary_status` | `bootstrap_complete` |

### Controller bounded tick evidence

Command:

```bash
node scripts/workflow-sandbox-canary.mjs --apply
```

Result (2026-07-23T14:55:29Z):

- ticks: **3**
- stop reason: **`no_pending_controller_work`**
- actions: `acquire_lease` → `persist_summary` → `release_lease`
- workflow status: **`waiting`** at stage **`capture`**
- parent metadata written (`workflow_managed=true`, `completion_authority=workflow_controller`)

### Final package

Generated at:

`C:/Users/Keisu/Projects/Sandbox/pi-multica-spine-idea-to-build-canary/.multica-spine/canary-artifacts/canary-20260723/final/`

Files: `00-executive-summary.md` … `09-operations-handoff.md` (10 files)

## Safety checks (verified)

- Production project `415010b1-f28a-4ae4-9042-ddeb00800029` **not used**
- `deliveryPolicy.productionAllowed=false`, `releaseAllowed=false`
- Explicit `--project-id` rejected on `--apply`
- Windows CLI entrypoint fixed (`pathToFileURL` main guard)

## Remaining human actions

1. Run stage workers (Cursor Composer Builder) through capture → final_package Hermes chain.
2. Resolve unresolved preference: colorized human-readable summary for canary CLI output (`07-assumptions-and-open-questions.md`).
3. Human final review on `final_package` stage when ledger reaches it.
4. Merge live-apply PR when approved.
