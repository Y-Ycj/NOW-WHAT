import { describe, expect, it } from "vitest";
import { parseTaskInput } from "./taskParser";

describe("taskParser", () => {
  it("separates colloquial time words from the action title", () => {
    const parsed = parseTaskInput("今晚七点外出吃饭", new Date("2026-06-01T07:00:00.000Z"));

    expect(parsed.title).toBe("外出吃饭");
    expect(parsed.preferredWindow).toBe("evening");
    expect(parsed.time).toBe("2026-06-01T11:00:00.000Z");
  });

  it("compacts filler words and extracts duration", () => {
    const parsed = parseTaskInput("提醒我明天上午 30 分钟整理一下项目备注", new Date("2026-06-01T07:00:00.000Z"));

    expect(parsed.title).toBe("整理一下项目备注");
    expect(parsed.preferredWindow).toBe("morning");
    expect(parsed.estimatedMinutes).toBe(30);
  });

  it("does not keep recurrence words in the action title", () => {
    const parsed = parseTaskInput("晨间拉伸 每天早上 8 点 15 分钟", new Date("2026-06-01T07:00:00.000Z"));

    expect(parsed.title).toBe("晨间拉伸");
    expect(parsed.preferredWindow).toBe("morning");
    expect(parsed.estimatedMinutes).toBe(15);
  });
});
