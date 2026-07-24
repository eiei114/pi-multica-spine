# pi-multica-spine

Pi extension and workflow-adapter control plane for Multica work agents.

## Language

**Work Agent Spine**:
The narrow bind → PR → evidence → handoff → verify contract for implementation agents.
_Avoid_: generic agent framework, full orchestrator

**Campaign**:
One live Hermes Idea-to-Build execution from capture through final_package on Multica.
_Avoid_: sprint, batch job

**Maintenance Bundle**:
A single PR + semver that groups repo maintenance seeds (R-MNT) without a new Campaign.
_Avoid_: mega refactor, monolith PR for feature work

**Human Gate**:
Operations that stay human-owned even when automation is aggressive (production deploy, secrets, billing, destructive cleanup).
_Avoid_: manual step (too generic)

**Deferred Project Binding**:
Idea-to-Build stays local from `capture` through `build_handoff`; only the build handoff creates or reuses an implementation Project and starts Work Agent Spine governance.
_Avoid_: sandbox Project at idea entry, early PR completion gate

## Relationships

- A **Campaign** produces workflow artifacts and evidence; it is not a npm release by itself.
- A **Maintenance Bundle** may ship npm changes built from completed Campaign learnings.
- **Human Gate** boundaries apply inside both Campaign and Maintenance work.

## Example dialogue

> **Dev:** "Can we merge production binding and R-MNT fixes in one PR?"
> **Domain expert:** "That's a **Maintenance Bundle** — fine if we skip a new **Campaign** and keep **Human Gate** on productionAllowed."

## Flagged ambiguities

- "Release" sometimes means npm publish and sometimes means GitHub tag — resolved: **npm release** vs **GitHub release** when precision matters.
