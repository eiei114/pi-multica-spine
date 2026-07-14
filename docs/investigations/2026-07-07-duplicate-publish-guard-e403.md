# Investigation: duplicate npm publish guard failure (`pi-multica-spine@0.1.4`, E403)

> **Scope:** investigation only. This document does **not** modify `.github/workflows/publish.yml`,
> the package version, `CHANGELOG.md`, npm registry state, or any release. A follow-up
> **Implementation Slice** must own any workflow correction after this evidence is reviewed.
>
> **Related Multica issue:** DOT-881 — *Investigate duplicate npm publish guard failure*.

## TL;DR

The `Publish to npm` step in run [#28874584731](https://github.com/eiei114/pi-multica-spine/actions/runs/28874584731)
failed with `E403` ("You cannot publish over the previously published versions: 0.1.4") **even though the
`Skip already published version` step succeeded** — because of a **time-of-check-to-time-of-use (TOCTOU)
race between two concurrent publish runs that were not mutually excluded**.

A single version-bump push to `main` (PR #15, `0.1.3` → `0.1.4`, SHA `fd28e80`) fired **two** publish runs
with **different** `concurrency.group` values, so they ran in parallel:

| Run | Trigger | Concurrency group | Result |
| --- | --- | --- | --- |
| [#28874574414](https://github.com/eiei114/pi-multica-spine/actions/runs/28874574414) | `push` to `main` (`paths: package.json`) | `npm-publish-refs/heads/main` | **Published** `+ pi-multica-spine@0.1.4` |
| [#28874584731](https://github.com/eiei114/pi-multica-spine/actions/runs/28874584731) | `workflow_dispatch` `ref=v0.1.4` (from `auto-release.yml`) | `npm-publish-v0.1.4` | **Failed** `E403` |

The guard in the dispatch run queried `npm view pi-multica-spine@0.1.4` ~123 ms **before** the push run
finished publishing, saw `E404` (genuinely not-yet-published), set `skip=false`, and proceeded. By the time
its `npm publish` PUT reached the registry, `0.1.4` already existed → `E403`.

**The guard logic itself is correct in isolation** (reproduced locally without publishing — see
[Reproducible non-publish check](#reproducible-non-publish-check)). The bug is the **duplicate,
non-mutexed trigger**, not the conditional.

## 1. Failed run, head SHA/ref, and npm public state

### Failed run

| Field | Value |
| --- | --- |
| Run URL | https://github.com/eiei114/pi-multica-spine/actions/runs/28874584731 |
| Workflow | `Publish to npm` (`.github/workflows/publish.yml`) |
| Event | `workflow_dispatch` |
| Input `ref` | `v0.1.4` |
| `headBranch` | `v0.1.4` |
| **Head SHA** | `fd28e80a3014edbba068d00e33763992d1144a6d` |
| Created | 2026-07-07T14:36:21Z |
| Conclusion | `failure` |

Source: `gh run view 28874584731 --repo eiei114/pi-multica-spine --json ...`.

### Head SHA verification

- `git show fd28e80:package.json` → `name: pi-multica-spine`, **`version: 0.1.4`**.
- `git rev-list -n 1 v0.1.4` → `fd28e80a3014edbba068d00e33763992d1144a6d` (tag `v0.1.4` points at the same
  SHA the failed run checked out).
- `publish.yml` at `fd28e80` is byte-identical to the workflow on the current default branch
  (`git show fd28e80:.github/workflows/publish.yml`).

### npm public state of `pi-multica-spine@0.1.4` (today)

```
$ npm view pi-multica-spine@0.1.4 version dist.shasum dist.integrity _npmUser
version       = '0.1.4'
dist.shasum   = '8996787028b3ca823260bfefad7c95f36ea7b4a1'
dist.integrity= 'sha512-ylcSsO17D7KAwnVDxv7h5EqjZYYJRZ/UG38pYQawePR/CJNRFz3WoJgO/zO/LutXCXcMB1guq8AFsrIfsTqvpw=='
dist.tarball  = 'https://registry.npmjs.org/pi-multica-spine/-/pi-multica-spine-0.1.4.tgz'
_npmUser      = 'GitHub Actions <npm-oidc-no-reply@github.com>'
```

The published tarball `dist.shasum` (`899678...ea7b4a1`) **matches** the `npm notice shasum:` line emitted by
the **winning** push run [#28874574414](https://github.com/eiei114/pi-multica-spine/actions/runs/28874574414)
(provenance sigstore logIndex `2102478562`), confirming run #...74414 — not the failed dispatch run — is what
actually published `0.1.4`. `_npmUser` is the Trusted-Publishing OIDC identity ("GitHub Actions"), as
designed (no `NPM_TOKEN`).

## 2. Why `steps.published.outputs.skip != 'true'` did not prevent the publish step

### The guard and the conditional (verbatim, `publish.yml`)

```yaml
      - name: Skip already published version
        id: published
        shell: bash
        run: |
          name=$(node -p "require('./package.json').name")
          version=$(node -p "require('./package.json').version")
          set +e
          output=$(npm view "${name}@${version}" version 2>&1)
          status=$?
          set -e
          if [ "$status" -eq 0 ]; then
            echo "${name}@${version} is already published."
            echo "skip=true" >> "$GITHUB_OUTPUT"
          elif printf '%s' "$output" | grep -Eq 'E404|404 Not Found'; then
            echo "Publishing ${name}@${version}."
            echo "skip=false" >> "$GITHUB_OUTPUT"
          else
            printf '%s\n' "$output" >&2
            exit "$status"
          fi

      - name: Publish to npm
        if: steps.published.outputs.skip != 'true'
        run: npm publish --access public
```

The conditional `if: steps.published.outputs.skip != 'true'` is **correct**. The failure is **not** a logic
bug in this expression. It is that the guard's decision was **stale by the time the publish PUT landed**,
because a *second*, non-mutexed run was publishing the same version concurrently.

### Concurrency group does not cover both triggers

```yaml
concurrency:
  group: npm-publish-${{ github.event.inputs.ref || github.ref }}
  cancel-in-progress: false
```

- For the **push-to-`main`** run, `github.event.inputs` is absent on a `push` event, so the expression
  resolves to `github.ref` = `refs/heads/main` → group **`npm-publish-refs/heads/main`**.
- For the **`workflow_dispatch`** run, `github.event.inputs.ref` = `v0.1.4` → group **`npm-publish-v0.1.4`**.

These are **different** groups, so GitHub did **not** serialize or queue them. Both ran in parallel, both
reached the guard while the registry still answered `E404`, and both set `skip=false`.

### Why two runs exist for one version bump

A version-bump merge to `main` fans out into:

1. **`publish.yml`** via `on.push.branches: [main]` + `paths: [package.json, package-lock.json, ...]`
   → run [#28874574414](https://github.com/eiei114/pi-multica-spine/actions/runs/28874574414) (group
   `…refs/heads/main`).
2. **`auto-release.yml`** via `on.push.branches: [main]` + `paths: [package.json]` → detects
   `0.1.3 → 0.1.4`, creates tag `v0.1.4`, creates the GitHub Release, then runs
   `gh workflow run publish.yml --ref v0.1.4 -f ref=v0.1.4`
   → run [#28874584731](https://github.com/eiei114/pi-multica-spine/actions/runs/28874584731) (group
   `…v0.1.4`).

Confirmed from the Auto Release run [#28874573667](https://github.com/eiei114/pi-multica-spine/actions/runs/28874573667)
logs:

```
14:36:18.219Z  Version bump detected: 0.1.3 -> 0.1.4.
14:36:19.400Z  * [new tag]   v0.1.4 -> v0.1.4          (git push origin v0.1.4)
14:36:20.396Z  https://github.com/eiei114/pi-multica-spine/releases/tag/v0.1.4   (gh release create)
14:36:20.402Z  gh workflow run publish.yml --ref "$TAG" -f ref="$TAG"
14:36:21.978Z  https://github.com/eiei114/pi-multica-spine/actions/runs/28874584731   (dispatch created)
```

Note: tags/releases created by `GITHUB_TOKEN` do **not** reliably fan out via `push.tags` / `release.published`
(this is already documented in [`docs/release.md`](../release.md) → *Workflow guardrail*). That is precisely
why `auto-release.yml` dispatches `publish.yml` explicitly — but that explicit dispatch **plus** the direct
`push`-to-`main` trigger produces the duplicate, non-mutexed pair.

### Millisecond timeline (all timestamps 2026-07-07Z, from run logs)

```
14:36:12     PR #15 merge push to main @ fd28e80 (package.json 0.1.3 -> 0.1.4)
             -> fires CI, Auto Release (#...3667), Publish push (#...4414)
14:36:18.219 Auto Release: "Version bump detected: 0.1.3 -> 0.1.4."
14:36:19.400 Auto Release: push tag v0.1.4
14:36:20.396 Auto Release: gh release create v0.1.4
14:36:20.402 Auto Release: gh workflow run publish.yml --ref v0.1.4 -f ref=v0.1.4
14:36:21.978 -> Publish workflow_dispatch #28874584731 created (group npm-publish-v0.1.4)

14:36:43.945 #...4414 (push)  guard -> "Publishing pi-multica-spine@0.1.4." (skip=false)
14:36:45.550 #...4414 (push)  npm publish: "Publishing to https://registry.npmjs.org/ ..."
14:36:48.089 #...4731 (disp)  guard -> "Publishing pi-multica-spine@0.1.4." (skip=false)  [*]
14:36:48.094 #...4731 (disp)  npm publish starts
14:36:48.212 #...4414 (push)  + pi-multica-spine@0.1.4            >>> 0.1.4 PUBLISHED (winner)
14:36:49.349 #...4731 (disp)  npm publish: "Publishing to registry" (0.1.4 now exists)
14:36:51.462 #...4731 (disp)  npm error code E403
             403 Forbidden - ... You cannot publish over the previously published versions: 0.1.4
```

`[*]` At the dispatch run's check instant, `0.1.4` was **genuinely not yet on the registry** — the push run
did not finish publishing until **14:36:48.212Z**, ~**123 ms later**. The guard was *locally correct* but
*raced*. The dispatch run's publish PUT then reached the registry at 14:36:49.349Z, after `0.1.4` existed,
yielding the `E403`.

> Note: npm uploaded the dispatch run's **provenance** statement to the sigstore transparency log
> (logIndex `2102479299`) *before* the package PUT returned `E403`. That orphaned provenance entry is an npm
> behaviour quirk and is harmless (no second package was published). It is recorded here for completeness.

### Conclusion for criterion 2

`steps.published.outputs.skip != 'true'` did not block the publish step because, at check time, the guard
**correctly** observed `E404` (not yet published) and wrote `skip=false`. The inconsistency is fully
explained by the **TOCTOU race between the two non-mutexed concurrent runs**. **No remaining uncertainty.**
No additional evidence is required to resolve it; the run logs + registry shasum already prove which run
published and exactly when each check/PUT occurred.

## 3. Reproducible non-publish check

[`guard-repro.sh`](./guard-repro.sh) mirrors the `Skip already published version` step verbatim. It calls
only `npm view` (a **read**); it never invokes `npm publish`.

```bash
# CASE 1 — a version that IS published
$ bash docs/investigations/guard-repro.sh pi-multica-spine 0.1.4
--- guard('pi-multica-spine', '0.1.4') ---
branch=ALREADY_PUBLISHED (status=0) -> sets skip=true
npm view stdout: 0.1.4

# CASE 2 — a version that is NOT published
$ bash docs/investigations/guard-repro.sh pi-multica-spine 99.0.0-fake
--- guard('pi-multica-spine', '99.0.0-fake') ---
branch=NOT_FOUND (E404 match) -> sets skip=false (PROCEEDS TO PUBLISH)
npm view stderr: npm error code E404
npm error 404 No match found for version 99.0.0-fake
...
```

This demonstrates the conditional behaves exactly as designed: published → `skip=true`, missing → `skip=false`.
The guard is **not** the defect; the concurrent duplicate trigger is.

## 4. Smallest safe correction options (for the follow-up Implementation Slice)

These are **proposals only** — none are applied by this investigation issue. Ordered smallest → most robust.
Any correction must keep npm publication / OTP / release actions **human-owned or workflow-owned** and must
be verifiable **without** a real `npm publish`.

### Option A — single publish trigger (recommended; smallest, safest)

Drop the redundant direct `push`-to-`main` trigger from `publish.yml` so a version bump publishes through
**one** path only — the `auto-release.yml` → `workflow_dispatch` handoff — which is already the documented
"reliable" path in [`docs/release.md`](../release.md).

Concretely, in `publish.yml` `on:`, remove the `push.branches: [main]` block (keep `push.tags`, `release`,
`workflow_dispatch`), **or** remove `package.json` / `package-lock.json` from its `paths` so a plain version
bump no longer fires the publish directly. With only one trigger per version bump, the race cannot occur and
the existing per-version guard remains a correct backstop.

Why this is safe: it removes the *source* of the duplicate run instead of patching the symptom; it matches
the documented design intent ("keep one explicit handoff path"); it needs no new logic.

### Option B — normalize the concurrency key to the package version

If both triggers must remain, make `concurrency.group` resolve to the **same** string for every run that
publishes a given `(name, version)`. A `concurrency` expression cannot read `package.json` (it is evaluated
before checkout), so the key must come from the `github` context. The closest stable option is the version
derived from the tag/ref, but a `main`-branch push has no tag — so this option alone **cannot** fully unify
the two cases without also adopting Option A. Listed for completeness; not preferred.

### Option C — make `npm publish` idempotent for "already published" (defense in depth)

Treat an `E403` "cannot publish over the previously published versions" response as a **benign skip**
(exit `0`) instead of a failure, after first confirming the already-published version's tarball matches the
one being published (compare `dist.shasum`). This does **not** prevent the double attempt but converts the
racing duplicate from a red failure into a green no-op. Useful as a second layer on top of Option A; not a
substitute for removing the duplicate trigger.

### Recommendation

**Option A** as the primary fix, optionally combined with **Option C** as defense in depth. Both keep real
`npm publish` human/workflow-owned and are verifiable without publishing (see below).

### Verification plan (must not invoke a real `npm publish`)

1. **Guard reproduction (read-only):** `bash docs/investigations/guard-repro.sh pi-multica-spine 0.1.4`
   (expect `skip=true`) and `... 99.0.0-fake` (expect `skip=false`). Uses only `npm view`.
2. **Trigger-count check (static):** after Option A, inspect `publish.yml` `on:` and confirm a version-bump
   push to `main` produces exactly **one** publish run per version (the dispatch). Verify with
   `gh run list --workflow publish.yml --repo eiei114/pi-multica-spine --json event,headBranch,createdAt`
   on the next real version bump, asserting no two runs share the same `package.json` version within the
   release window.
3. **Concurrency-key assertion (static):** confirm `concurrency.group` is identical across the remaining
   trigger(s) for the same version, e.g. by rendering the expression for each event in a comment/table.
4. **Idempotency classification (Option C, no publish):** unit-test the error-classification grep/regex
   against captured npm stderr fixtures: `E403` "cannot publish over … previously published" → benign;
   `E403` auth/forbidden → fail; `E404` → not-found. Do **not** drive a real publish to obtain these.
5. **`npm publish --dry-run`** may be used to validate tarball contents (`pack:check` already does
   `npm pack --dry-run`) but cannot reproduce `E403`, so it is not used for the race itself.
6. **CI gate:** `npm run ci` must pass on the correction PR (typecheck + coverage + `pack:check`).

## 5. Acceptance criteria status

- [x] Failed run, head SHA/ref (`fd28e80` / `v0.1.4`), and npm public `pi-multica-spine@0.1.4` state
      recorded with evidence (§1, incl. shasum match to the winning run).
- [x] Established why `steps.published.outputs.skip != 'true'` did not prevent publish — TOCTOU race between
      two non-mutexed concurrent runs; no remaining uncertainty (§2).
- [x] Source-repository report contains a reproducible non-publish check for the guard output and conditional
      behavior (`docs/investigations/guard-repro.sh`, §3).
- [x] Report proposes the smallest safe workflow correction + a verification plan that cannot invoke a real
      `npm publish` (§4).
- [x] `npm run ci` passes for this documentation-only PR (run below; this issue changes docs/scripts only).
- [x] No `.github/workflows/publish.yml`, package version, `CHANGELOG.md`, npm registry state, or release is
      changed by this issue (additive docs + read-only script only).

## 6. Files added by this investigation

- `docs/investigations/2026-07-07-duplicate-publish-guard-e403.md` — this report.
- `docs/investigations/guard-repro.sh` — read-only guard reproduction (calls `npm view` only).
