# Hermes pinned bundle audit

Date: 2026-07-23  
Scope: DOT-1120 composite Adapter inputs

## Approved sources

| Bundle | Commit | Canonical content SHA-256 | Files | License |
|---|---|---|---:|---|
| `hermes-agent-idea-workflow` | `acf82c9a169050c06ed33b9514ac1e17b6ccb68c` | `3256bd8ed9da5daf59d75b6ed99fb9519b14b15f55b75bc44cbab8e421d4cec3` | 14 | MIT |
| `hermes-agent-supwerpowers-chatgpt` | `5db0d93e7acfd81a7e9f4a64a257d65501102684` | `8609d6b0da22beaed153a7d2fb86144bdf81815de50a60f8f6af270df75a4269` | 22 | MIT |

The content digest is computed over files sorted by POSIX-relative path. Each hash input is `path + NUL + bytes + NUL`; `.git/` is excluded. This makes the audited snapshot independent of GitHub archive packaging.

## Audit result

- Both commits were fetched directly by full SHA.
- Both repositories contain Markdown, templates, JSON metadata, licenses, and repository guidance only.
- No install script, executable hook, submodule, LFS pointer, symlink escape, publish/deploy command, secret, or production action was found in the pinned trees.
- Runtime code receives an `AuditedBundleLoader` and calls `loadByDigest(contentHash)` only. Source URLs remain attribution metadata and are never runtime fetch targets.
- Snapshot paths are normalized and rejected when absolute or traversal-bearing.

## Adapter boundary

The two bundles remain distinct inputs:

- Idea Workflow: capture, Question relay, design, optional UI brief, implementation spec, and build handoff.
- Supwerpowers: planning, implementation, independent reviews, debugging, and verification discipline.

`pi-multica-spine` supplies Multica issue routing, Controller progression, artifact lineage, review caps, and final human gates. It does not create a generic workflow interpreter.
