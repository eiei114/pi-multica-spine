# Maintenance Bundle delivery for v0.6.0

After Workflow Adapter Completion (sandbox + production Campaign evidence), remaining work was mostly maintenance seeds (R-MNT-1..6) plus making published CLI scripts runnable without TypeScript source stripping in `node_modules`.

We ship one **Maintenance Bundle** as `v0.6.0` (single PR, auto-merge) instead of multiple patch releases. Campaign-style live Multica runs and `productionAllowed=true` stay outside this bundle per **Human Gate**.

**Considered options:** continue 0.5.x patch train; include a second production Campaign — rejected to keep review surface bounded.

**Consequences:** `dist/` is built on `prepack`/CI; scripts import compiled `dist/lib/*.js`. ROADMAP seeds R-MNT-1..6 are absorbed into 0.6.0.
