# Production Gate Decision Note

**Status:** draft decision framework — **gate remains CLOSED**  
**Date:** 2026-07-24  
**Scope:** Maintenance project binding `productionAllowed`

This note defines *when* a human may open the production gate. It does **not** authorize agents to flip the flag.

## Current state

| Control | Value |
|---|---|
| `productionAllowed` | `false` |
| `destructiveAllowed` | `false` |
| `releaseAllowed` | `true` (npm/GitHub release still human-owned via Trusted Publishing flow) |
| Live Maintenance run | DOT-1137 completed with gate closed |

## What “production” means here

For `pi-multica-spine`, **production** means allowing Campaign/binding actions that can affect real delivery surfaces beyond Maintenance rehearsal — not merely running `workflow-production-run.mjs` against the Maintenance project with `productionAllowed=false`.

Maintenance rehearsal **is allowed** with the gate closed (already proven).

## Open-gate checklist (all required)

A human may set `productionAllowed=true` only when **all** of the following are true:

0. [ ] Automated gate checklist green: `npm run check:production-gate` (gate remains CLOSED; human items still required).
1. [ ] Ops checklist followed successfully on a fresh Maintenance rehearsal (`docs/workflow-ops-checklist.md`).
2. [ ] Sandbox canary evidence still green within the last successful campaign window.
3. [ ] Pack smoke (`npm run pack:smoke`) green on the candidate commit.
4. [ ] Explicit written intent: what Campaign / rough idea will use the open gate.
5. [ ] Rollback owner named (who sets `productionAllowed=false` if anything drifts).
6. [ ] Secrets, billing, and account-permission changes are **out of scope** for that Campaign.

## Always forbidden (even if gate opens)

- Rotating or committing secrets
- Billing / plan changes
- Destructive cleanup of production Multica resources without a separate human runbook
- Silent history rewrites of workflow ledgers

## Close-gate procedure

1. Set binding `deliveryPolicy.productionAllowed=false` via production-binding apply (or Multica metadata equivalent).
2. Record reason + timestamp in an investigation note under `docs/investigations/`.
3. Stop in-flight Campaigns that required the open gate; sandbox lane may continue.

## Agent policy

- Agents may **propose** opening the gate by pointing at this checklist.
- Agents must **not** set `productionAllowed=true` without an explicit human “yes” in the current conversation or Multica parent issue.
- Aggressive automation elsewhere does not override this Human Gate.
