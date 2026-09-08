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

The fixture includes PR metadata (`prNumber`, `prHeadSha`, `prBranch`, `writebackRecorded: true`), verification evidence, and a handoff that references the issue and PR URL — the same fields `multica_spine_verify` checks in live sessions.

See also [`../workflow-campaign-walkthrough/`](../workflow-campaign-walkthrough/) for an offline Hermes Campaign demo.
