import { describe, expect, it } from "vitest";
import { getCurrentRecommendation, scoreActionItem } from "./recommendation";
import type { ActionItem } from "./types";

const base: ActionItem = {
  id: "base",
  title: "base",
  sourceType: "oneOff",
  importance: 3,
  urgency: 3,
  estimatedMinutes: 30,
  energyLevel: "medium",
  preferredWindow: "any",
  status: "active",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z"
};

describe("recommendation", () => {
  it("prefers important urgent actions that fit now", () => {
    const now = new Date("2026-06-01T09:00:00.000Z");
    const lowPriority = { ...base, id: "low", title: "Low", importance: 1, urgency: 1 };
    const urgent = {
      ...base,
      id: "urgent",
      title: "Urgent",
      importance: 5,
      urgency: 5,
      time: "2026-06-01T10:00:00.000Z",
      energyLevel: "low" as const
    };

    const recommendation = getCurrentRecommendation(now, [lowPriority, urgent], []);

    expect(recommendation.primary?.id).toBe("urgent");
    expect(recommendation.reason).toContain("重要且紧急");
  });

  it("does not recommend completed or archived items", () => {
    const now = new Date("2026-06-01T09:00:00.000Z");
    const completed = { ...base, id: "done", status: "completed" as const, importance: 5, urgency: 5 };
    const active = { ...base, id: "active", importance: 2, urgency: 2 };

    const recommendation = getCurrentRecommendation(now, [completed, active], []);

    expect(recommendation.primary?.id).toBe("active");
  });

  it("prefers important but not urgent work over urgent but unimportant work", () => {
    const now = new Date("2026-06-01T09:00:00.000Z");
    const importantNotUrgent = {
      ...base,
      id: "important",
      title: "推进长期目标",
      importance: 5,
      urgency: 2
    };
    const urgentNotImportant = {
      ...base,
      id: "urgent-lite",
      title: "处理低价值急事",
      importance: 2,
      urgency: 5
    };

    const recommendation = getCurrentRecommendation(now, [urgentNotImportant, importantNotUrgent], []);

    expect(recommendation.primary?.id).toBe("important");
  });

  it("penalizes recently skipped items", () => {
    const now = new Date("2026-06-01T09:00:00.000Z");
    const item = { ...base, id: "skip-me", importance: 4, urgency: 4 };
    const scoreBefore = scoreActionItem(now, item, []);
    const scoreAfter = scoreActionItem(now, item, [
      {
        id: "event",
        itemId: item.id,
        type: "skipped",
        createdAt: "2026-06-01T08:00:00.000Z"
      }
    ]);

    expect(scoreAfter).toBeLessThan(scoreBefore);
  });

  it("does not force a secondary recommendation that is for a later window", () => {
    const now = new Date("2026-06-01T01:00:00.000Z");
    const primary = {
      ...base,
      id: "primary",
      title: "Now",
      importance: 4,
      urgency: 3,
      time: "2026-06-01T08:00:00.000Z"
    };
    const dinner = {
      ...base,
      id: "dinner",
      title: "外出吃饭",
      importance: 4,
      urgency: 3,
      preferredWindow: "evening" as const,
      time: "2026-06-01T11:00:00.000Z"
    };

    const recommendation = getCurrentRecommendation(now, [primary, dinner], []);

    expect(recommendation.primary?.id).toBe("primary");
    expect(recommendation.secondary).toBeUndefined();
  });

  it("lowers a daily routine after it has been completed today", () => {
    const now = new Date("2026-06-01T09:00:00.000Z");
    const routine = {
      ...base,
      id: "routine",
      sourceType: "routine" as const,
      importance: 4,
      recurrence: { frequency: "daily" as const }
    };
    const scoreBefore = scoreActionItem(now, routine, []);
    const scoreAfter = scoreActionItem(now, routine, [
      {
        id: "done",
        itemId: routine.id,
        type: "completed",
        createdAt: "2026-06-01T08:00:00.000Z"
      }
    ]);

    expect(scoreAfter).toBeLessThan(scoreBefore - 50);
  });
});
