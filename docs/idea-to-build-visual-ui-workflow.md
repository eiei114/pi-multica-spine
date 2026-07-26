# Idea-to-Build Visual UI Workflow

This contract applies only when the user explicitly supplies `visualTarget` as `visual`, `game`, or `ios_game`. Keyword inference is forbidden.

## Stage map

```text
capture
  → question_resolution
  → design_doc
  → ui_design_brief       (target-conditional)
  → implementation_spec
  → build_handoff
  → implementation
  → spec_compliance_review
  → code_quality_review
  → verification
  → visual_review          (target-conditional, separate from functional verification)
  → final_package
```

`ui_design_brief` is the source of truth for visual implementation. `visual_review` is the evidence-backed verdict. A functional PASS never implies a Visual PASS.

## UI design brief contract

The brief records:

- **Design system:** semantic palette and surface roles, typography/type scale, spacing, interaction states, motion budget, and explicit anti-patterns.
- **Screen states:** initial state, primary interaction, success/risk feedback, result, settings/purchase-unavailable, and other product-specific states.
- **Accessibility:** contrast target, Dynamic Type behavior, VoiceOver labels/order, 44pt minimum controls, color-not-only meaning, Reduce Motion behavior, and scroll safety.
- **Implementation boundaries:** preserve mechanics and asset IDs; record unresolved assumptions and provenance; block when required capability or asset evidence is missing.
- **Evidence plan:** state IDs, capture path, device/OS, commit SHA, screenshot/video requirements, and SHA-256 manifest.

For iOS/SpriteKit/SwiftUI, use SF system typography and platform accessibility APIs unless the brief explicitly approves a custom typeface. Keep semantic colors in tokens; do not scatter raw colors through views.

## iOS execution loop

The implementation agent follows the Tiny Loop Factory reference skills:

1. **UI/UX Pro Max:** generate and persist a design-system proposal before editing screens. Adapt web-oriented output to iOS; retain semantic colors, contrast, hierarchy, and anti-pattern checks.
2. **iOS UI Debug Loop:** capture the symptom and screen/state, select the smallest UI lane, make the smallest useful change, then verify.
3. **iOS Local Build Loop:** run the exact macOS/Xcode build and test command; record working directory, branch, command, result, and next risk.
4. **iOS Debugger Agent:** attach to a booted Simulator when runtime confirmation is required; collect UI tree, screenshots, logs, and gameplay video.
5. **SwiftUI Expert:** inspect view structure, Dynamic Type, accessibility order, scroll safety, API availability, and unnecessary state updates.

Reference source: <https://github.com/eiei114/tiny-loop-factory-ios/tree/main/.pi/skills>.

## Evidence and gates

- Required visual evidence is real Simulator/device output, never generated placeholder evidence.
- Each screenshot record includes `stateId`, device, OS, commit, and SHA-256 hash. A manifest is immutable and duplicate successful uploads are idempotent.
- A visual review must cover all named states and record findings, accessibility checks, provenance, and `pass`/`fail` verdict.
- Missing `macos_xcode`, `ios_simulator_evidence`, or `visual_qa` capability blocks the visual lane.
- Human owns final visual approval, PR merge, signing, TestFlight/App Store, production, billing, secrets, and destructive actions.

## Explicit target invocation

```bash
node scripts/workflow-idea-entry.mjs \
  --rough-idea "Build a Daily Relic iOS game" \
  --visual-target ios_game \
  --execute --json
```

The local session reports `visualTarget: "ios_game"` and requires the UI brief before `build_handoff`. No Multica Project or Spine binding is created before that handoff boundary.
