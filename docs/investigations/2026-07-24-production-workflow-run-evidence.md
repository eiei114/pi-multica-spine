# Production Workflow Run Evidence

Live Maintenance-project Hermes run for `pi-multica-spine` v0.5.1 workflow operations documentation.

## Run summary

| Field | Value |
|---|---|
| Project | `pi-multica-spine Maintenance` (`415010b1-f28a-4ae4-9042-ddeb00800029`) |
| Parent issue | **DOT-1137** (`9b4af831-b188-4f8a-826c-29f01eeff2af`) |
| Workflow run | `prod-20260723-a7a20ee6` |
| Ledger hash | `b58b78ca11a2af0ce81855c6b7f7029d52cdfc7cd7d147e346f81f38c8ad0e7e` |
| Stages | 12 (`ui_design_brief` / `spec_fix` skipped) |
| Final state | `workflow_status=completed` @ `final_package` |
| Human review | approved (`stageIssuesClosed=12`) |
| Controller autopilot | `2e78dd85-f52a-4ede-8573-8c49776a5967` |

## Commands (repo root)

```bash
node scripts/workflow-production-run.mjs --start
rm -f .multica/daemon_task_context.json   # required if leftover daemon marker blocks CLI
node scripts/workflow-production-run.mjs --campaign
rm -f .multica/daemon_task_context.json
node scripts/workflow-production-run.mjs --human-review
```

## Rough idea

Update pi-multica-spine README and ops docs for v0.5.0: document jsonl-digest CLI, sandbox canary, production binding, and production-run workflow scripts; verify npm install path for `@0.5.0`.

## Deliverables

- README workflow operations section (`scripts/jsonl-digest.mjs`, sandbox canary, production binding, production run)
- `lib/workflow-production-run.ts` + `scripts/workflow-production-run.mjs`
- `docs/production-workflow-binding.md` production run section
- Color policy: JSON default; `--human` / `--color` opt-in

## Notes

- `Artifacts/workflows/` is gitignored; final package index lives under `Artifacts/workflows/<run-id>/final/` locally.
- Campaign may require removing `.multica/daemon_task_context.json` when not running inside an agent task (Multica mat_ token guard). **v0.5.2+** scripts clear this automatically.
- `prRequired=true` on production binding; release remains human-owned.

generated_at: 2026-07-23T21:45:27.262Z
