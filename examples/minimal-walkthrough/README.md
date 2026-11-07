# Minimal spine walkthrough

Offline walkthrough for the work-agent spine using checked-in fixture state under `fixture/.multica-spine/`. The fixture models a completed bind → PR → evidence → handoff path for issue `TASK-45`; the script loads that task and runs `evaluateSpine` without calling the Pi tools or `multica` CLI.

## Run

From the repo root:

```bash
npm run walkthrough
```

Or run only this example:

```bash
node examples/minimal-walkthrough/run-walkthrough.mjs
```

No `multica` CLI or network access is required.

## Expected output

Success prints JSON with `status: "VERIFIED"`, `verified: true`, and an empty `missing` array:

```json
{
  "issue": "TASK-45",
  "status": "VERIFIED",
  "verified": true,
  "missing": []
}
```

The fixture carries the issue, PR metadata (`prNumber`, `prHeadSha`, `prBranch`, `writebackRecorded: true`), verification evidence, and a handoff that references the issue and PR URL. The script only calls `evaluateSpine(task)` on that stored state, so it answers one question: does the recorded state satisfy the spine contract?

`multica_spine_verify` adds two checks that read live repository state, so this example skips them:

- **git completion** — working tree clean, no leftover conflict markers, branch pushed to its upstream, and `prHeadSha` equal to the current `HEAD`.
- **local import closure** — the linked local issue markdown (if any) no longer has `ready_for_multica: true`.

A `VERIFIED` result here therefore does not mean `multica_spine_verify` will pass in a live session. The fixture's `prHeadSha` is the placeholder `abc123`, so running `SpineStateStore.verify()` on this fixture from inside a git checkout reports `git: PR head SHA metadata is stale`.

See also [`../workflow-campaign-walkthrough/`](../workflow-campaign-walkthrough/) for an offline Hermes Campaign demo.
