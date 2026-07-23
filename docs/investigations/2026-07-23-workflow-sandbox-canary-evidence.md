# Workflow Sandbox Canary Evidence (2026-07-23)

## Merge gate completion

| PR | Issue | Merge commit | Notes |
|---|---|---|---|
| [#30](https://github.com/eiei114/pi-multica-spine/pull/30) | DOT-1120 | `0c7cd34` | Hermes adapter |
| [#31](https://github.com/eiei114/pi-multica-spine/pull/31) | DOT-1117 | `6be7ac6` | Routing / telemetry / factory |
| [#32](https://github.com/eiei114/pi-multica-spine/pull/32) | DOT-1119 harness | `1ad5b71` | Dry-run harness |
| [#33](https://github.com/eiei114/pi-multica-spine/pull/33) | evidence | `1bff904` | Initial evidence |
| [#34](https://github.com/eiei114/pi-multica-spine/pull/34) | DOT-1119 bootstrap | `83c886a` | `--apply` live bootstrap |

- `origin/main` HEAD: `83c886a` (pre campaign PR)
- npm release: [v0.4.0](https://github.com/eiei114/pi-multica-spine/releases/tag/v0.4.0)
- Local verification: `npm run ci` pass (139 tests)

## Multica issue sync

| Issue | Status | Notes |
|---|---|---|
| DOT-1116 | done | Parent lane |
| DOT-1121 | done | Live CLI |
| DOT-1118 | done | Controller Autopilot |
| DOT-1120 | done | Hermes adapter |
| DOT-1117 | done | Routing / telemetry / factory / migration |
| DOT-1119 | **done** | Full live campaign completed 2026-07-23 |

## Live canary status

| Item | Value |
|---|---|
| Sandbox path | `C:/Users/Keisu/Projects/Sandbox/pi-multica-spine-idea-to-build-canary` |
| Initial commit | `e9f6e0dc1000b318238df180bfb9419d42f97ccd` |
| Multica project | `pi-multica-spine Idea-to-Build Canary` (`c8db7286-1fc1-4034-b9ac-76388560244e`) |
| Parent issue | **DOT-1123** (`fb0ecde7-0171-4954-9ab2-f6151e562cd3`) |
| Workflow run | `canary-20260723` |
| Controller autopilot | `51782d94-7cdf-4188-9326-e64f7d5040e1` |
| Final ledger hash | `08db48c536b3491ac6c383d2748a30e0ed37c15bb6fa70ab3d4ab95243b82d60` |
| `live_canary_status` | **`campaign_complete`** |
| `workflow_status` | **`completed`** at `final_package` |

### Campaign result (2026-07-23T15:04:57Z)

```bash
node scripts/workflow-sandbox-canary.mjs --campaign
```

- **12 Hermes stages** executed (ui_design_brief + spec_fix skipped by design)
- **12 stage issues** created and assigned to Cursor Composer Builder
- Controller actions per stage: `validate_produced_stage` → `seed_next_stage` → `persist_summary`
- Terminal: `workflow_status=completed` on `final_package`

### Deliverable CLI (sandbox repo)

```bash
cd C:/Users/Keisu/Projects/Sandbox/pi-multica-spine-idea-to-build-canary
node src/digest.mjs tasks.sample.jsonl
# {"counts":{"open":2,"done":1},"lineCount":3,"digest":"56a668db..."}
```

### Failure fixtures (F1–F8)

All fixtures pass via `node scripts/workflow-sandbox-canary.mjs --fixture <name>`.

### Final package

`C:/Users/Keisu/Projects/Sandbox/pi-multica-spine-idea-to-build-canary/.multica-spine/canary-artifacts/canary-20260723/final/` (10 files)

## Safety checks (verified)

- Production project `415010b1-f28a-4ae4-9042-ddeb00800029` **not used**
- `deliveryPolicy.productionAllowed=false`, `releaseAllowed=false`
- Explicit `--project-id` rejected on `--apply`

## Remaining human actions

1. **Human final review** on DOT-1123 / `final_package` stage issue (`7bc4e3db-f528-45a8-a0cb-ff5061739f27`)
2. Resolve color output preference (documented in `07-assumptions-and-open-questions.md`)
3. Optional: promote sandbox binding lessons to production (human-owned)
