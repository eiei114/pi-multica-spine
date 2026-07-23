# Workflow Sandbox Canary Evidence (2026-07-23)

## Lane status: **COMPLETE**

Sandbox canary + human final review + production binding + v0.5.0 release.

## Releases

| Version | PR | Notes |
|---|---|---|
| v0.4.0 | #30–#32 | Workflow adapter foundation + sandbox harness |
| v0.5.0 | #37 | Campaign, human-review, JSONL digest, production binding |

## Multica issues

| Issue | Status |
|---|---|
| DOT-1116 | done |
| DOT-1117–DOT-1120 | done |
| DOT-1119 | done (`human_review_complete`) |
| DOT-1123 | done (canary parent, approved) |

## Production binding

| Field | Value |
|---|---|
| Project | `pi-multica-spine Maintenance` (`415010b1-f28a-4ae4-9042-ddeb00800029`) |
| Script | `node scripts/workflow-production-binding.mjs --apply` |
| `prRequired` | true |
| `releaseAllowed` | true (human-owned) |
| `productionAllowed` | false |
| Doc | `docs/production-workflow-binding.md` |

## Color policy (resolved)

- **Default**: JSON (`scripts/jsonl-digest.mjs`)
- **Human**: `--human`
- **Color**: `--color` opt-in; auto on TTY with `--human` unless `--no-color`
- Metadata: `color_output_policy=json_default_opt_in_color`

## Sandbox canary (reference)

| Field | Value |
|---|---|
| Project | `c8db7286-1fc1-4034-b9ac-76388560244e` |
| Parent | DOT-1123 |
| Run | `canary-20260723` |
| Ledger | `08db48c536b3491ac6c383d2748a30e0ed37c15bb6fa70ab3d4ab95243b82d60` |

```bash
node scripts/workflow-sandbox-canary.mjs --apply
node scripts/workflow-sandbox-canary.mjs --campaign
node scripts/workflow-sandbox-canary.mjs --human-review
```
