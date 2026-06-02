import type { ActionItem, GoalRefinementInput, GoalRefinementProvider } from "./types";
import { createId } from "./storage";

export const guidedGoalRefinementProvider: GoalRefinementProvider = {
  refine(input: GoalRefinementInput): ActionItem {
    const now = new Date().toISOString();
    return {
      id: createId("item"),
      title: input.firstStep.trim(),
      sourceType: "longTerm",
      importance: input.importance,
      urgency: 2,
      preferredWindow: input.preferredWindow,
      estimatedMinutes: input.estimatedMinutes,
      energyLevel: input.energyLevel,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
  }
};
