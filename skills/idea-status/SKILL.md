---
name: idea-status
description: Read-only Operations Cockpit for Idea Sessions. Use ONLY when the user explicitly invokes /skill:idea-status.
disable-model-invocation: true
---

# Idea Status

Run:

```bash
npm run build
node scripts/workflow-idea-status.mjs --json
```

Retention dry-run (zero deletion):

```bash
node scripts/workflow-idea-status.mjs --retention-dry-run --json
```
