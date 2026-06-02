import { describe, expect, it } from "vitest";
import { guidedGoalRefinementProvider } from "./goalRefinement";

describe("guidedGoalRefinementProvider", () => {
  it("turns a long term goal input into an active next action", () => {
    const action = guidedGoalRefinementProvider.refine({
      title: "完成作品集",
      why: "申请新机会",
      field: "工作",
      firstStep: "列出三个项目案例",
      preferredWindow: "afternoon",
      estimatedMinutes: 25,
      energyLevel: "medium",
      importance: 5
    });

    expect(action.title).toBe("列出三个项目案例");
    expect(action.sourceType).toBe("longTerm");
    expect(action.status).toBe("active");
    expect(action.preferredWindow).toBe("afternoon");
  });
});
