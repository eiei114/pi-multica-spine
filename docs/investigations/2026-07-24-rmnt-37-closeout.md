# R-MNT-37 closeout (v0.7.9)

**Date:** 2026-07-24  
**Seed:** Idea-to-build slash entry skill

## Delivered

| Item | Path |
|---|---|
| Pi skill | `skills/idea-to-build/SKILL.md` (`disable-model-invocation: true`) |
| Bootstrap CLI | `scripts/workflow-idea-entry.mjs` |
| Canary rough idea | `--rough-idea` on `workflow-sandbox-canary.mjs` |

## Usage

```
/skill:idea-to-build
<paste rough idea>
```

Agent runs:

```bash
node scripts/workflow-idea-entry.mjs --rough-idea "..." --execute
```

## Verification

```bash
npm run ci
```
