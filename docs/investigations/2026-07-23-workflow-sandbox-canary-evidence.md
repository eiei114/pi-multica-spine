# Workflow Sandbox Canary Evidence (2026-07-23)

## Merge gate completion

| PR | Issue | Merge commit | Notes |
|---|---|---|---|
| [#30](https://github.com/eiei114/pi-multica-spine/pull/30) | DOT-1120 | `0c7cd34` | Hermes adapter |
| [#31](https://github.com/eiei114/pi-multica-spine/pull/31) | DOT-1117 | `6be7ac6` | Routing / telemetry / factory |
| [#32](https://github.com/eiei114/pi-multica-spine/pull/32) | DOT-1119 harness | `1ad5b71` | Dry-run harness |
| [#34](https://github.com/eiei114/pi-multica-spine/pull/34) | DOT-1119 bootstrap | `83c886a` | `--apply` |
| [#35](https://github.com/eiei114/pi-multica-spine/pull/35) | DOT-1119 campaign | `887fb13` | `--campaign` + fixtures |

- `origin/main` HEAD: `887fb13` (pre human-review PR)
- npm release: [v0.4.0](https://github.com/eiei114/pi-multica-spine/releases/tag/v0.4.0)
- Local verification: `npm run ci` pass (140 tests)

## Multica issue sync

| Issue | Status | Notes |
|---|---|---|
| DOT-1116 | done | Parent lane — all 5 children complete |
| DOT-1121 | done | Live CLI |
| DOT-1118 | done | Controller Autopilot |
| DOT-1120 | done | Hermes adapter |
| DOT-1117 | done | Routing / telemetry / factory / migration |
| DOT-1119 | done | Sandbox canary + operations handoff |
| **DOT-1123** | **done** | Canary parent — human final review approved |

## Live canary status

| Item | Value |
|---|---|
| Sandbox path | `C:/Users/Keisu/Projects/Sandbox/pi-multica-spine-idea-to-build-canary` |
| Multica project | `c8db7286-1fc1-4034-b9ac-76388560244e` |
| Parent issue | **DOT-1123** — `status=done`, `workflow_status=completed` |
| Workflow run | `canary-20260723` |
| Ledger hash | `08db48c536b3491ac6c383d2748a30e0ed37c15bb6fa70ab3d4ab95243b82d60` |
| `live_canary_status` | **`human_review_complete`** |

### End-to-end commands

```bash
node scripts/workflow-sandbox-canary.mjs --apply
node scripts/workflow-sandbox-canary.mjs --campaign
node scripts/workflow-sandbox-canary.mjs --human-review
```

### Human final review (2026-07-23T15:10:21Z)

- Verdict: **approved**
- Reviewer: Keisu (human operator)
- `needs_human_review=false` on parent metadata
- Review artifact: `10-human-final-review.md`
- Unresolved color preference: **accepted as documented open question**

### Deliverable

```bash
node src/digest.mjs tasks.sample.jsonl
# {"counts":{"open":2,"done":1},"lineCount":3,"digest":"56a668db..."}
```

## Lane completion

The Workflow Adapter Completion master plan is **fully executed** for sandbox:

- rough idea → parent issue → 12 Hermes stages → `workflow_status=completed` → human final review → DOT-1123 done
- Production binding / npm publish / release remain human-owned (not executed)
