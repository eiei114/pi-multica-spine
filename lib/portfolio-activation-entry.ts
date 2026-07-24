import type { AutomaticPromotionDeps, AutomaticPromotionInput, AutomaticPromotionResult } from "./idea-auto-promotion.ts";
import type { IdeaLocalArtifactRegistry } from "./idea-local-artifact.ts";
import type { IdeaLocalLaneState } from "./idea-local-lane.ts";
import { PortfolioFleetConfigStore } from "./portfolio-fleet-enablement.ts";

export type PortfolioActivationResult =
  | { mode: "local_only"; reason: string }
  | { mode: "fleet_disabled" }
  | { mode: "promotion"; promotion: AutomaticPromotionResult };

export async function activatePortfolioIfReady(input: {
  cwd: string;
  lane: IdeaLocalLaneState;
  artifacts: IdeaLocalArtifactRegistry;
  buildPromotionInput(lane: IdeaLocalLaneState, artifacts: IdeaLocalArtifactRegistry): AutomaticPromotionInput;
  deps: AutomaticPromotionDeps;
  fleetStore?: PortfolioFleetConfigStore;
  promote?: (input: AutomaticPromotionInput, deps: AutomaticPromotionDeps) => Promise<AutomaticPromotionResult>;
}): Promise<PortfolioActivationResult> {
  if (input.lane.status !== "promotion_ready" || input.lane.currentStageId !== "build_handoff") {
    return { mode: "local_only", reason: "local_lane_not_promotion_ready" };
  }
  const fleetStore = input.fleetStore ?? new PortfolioFleetConfigStore(input.cwd);
  if (!(await fleetStore.load()).enabled) return { mode: "fleet_disabled" };
  if (!input.promote) throw new Error("Portfolio fleet is enabled but no explicit promotion factory is registered");
  return {
    mode: "promotion",
    promotion: await input.promote(input.buildPromotionInput(input.lane, input.artifacts), input.deps),
  };
}
