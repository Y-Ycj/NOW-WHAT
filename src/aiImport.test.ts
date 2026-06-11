import { afterEach, describe, expect, it, vi } from "vitest";
import { explainAiImportError, importTasksWithAi } from "./aiImport";

describe("aiImport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls an OpenAI-compatible endpoint and normalizes JSON task drafts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: "oneOff",
              content: "提交报表",
              cadence: "weekly",
              schedule: "明天下午三点",
              duration: "30 分钟",
              importance: 4,
              weekdays: [5, 1, 3, 8, 3]
              })
            }
          }
        ]
      })
    } as Response);

    const draft = await importTasksWithAi({
      apiKey: "sk-test",
      model: "openai:gpt-4.1-mini",
      prompt: "明天下午三点提交报表 30 分钟",
      provider: "openai",
      vision: true
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/chat/completions", expect.any(Object));
    expect(draft.content).toBe("提交报表");
    expect(draft.cadence).toBe("weekly");
    expect(draft.importance).toBe(4);
    expect(draft.weekdays).toEqual([1, 3, 5]);
  });

  it("includes earlier user inputs when refining a task over multiple turns", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ kind: "routine", content: "学习英语", importance: 4 }) } }]
      })
    } as Response);

    await importTasksWithAi({
      apiKey: "sk-test",
      context: ["忽略的旧消息", "消息 2", "消息 3", "消息 4", "消息 5", "消息 6", "每天晚上学习英语 30 分钟"],
      currentDraft: {
        content: "学习英语",
        duration: "30 分钟",
        importance: 3,
        kind: "routine",
        schedule: "每天晚上"
      },
      model: "openai:gpt-4.1-mini",
      prompt: "重要性改成 4",
      provider: "openai",
      vision: true
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content).toContain("当前已整理草稿");
    expect(body.messages[1].content).toContain("每天晚上学习英语 30 分钟");
    expect(body.messages[1].content).toContain("重要性改成 4");
    expect(body.messages[1].content).toContain("返回完整的最新任务草稿");
    expect(body.messages[1].content).not.toContain("忽略的旧消息");
  });

  it("calls DeepSeek through its OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ kind: "oneOff", content: "整理 inbox", importance: 3 }) } }]
      })
    } as Response);

    await importTasksWithAi({
      apiKey: "sk-test",
      model: "deepseek:deepseek-chat",
      prompt: "整理 inbox",
      provider: "deepseek",
      vision: false
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/chat/completions", expect.any(Object));
  });

  it("uses current OpenRouter and Kimi model routes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ kind: "oneOff", content: "整理任务", importance: 3 }) } }]
      })
    } as Response);

    await importTasksWithAi({
      apiKey: "sk-openrouter",
      model: "openrouter:openrouter/auto",
      prompt: "整理任务",
      provider: "openrouter",
      vision: true
    });
    let body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("openrouter/auto");

    await importTasksWithAi({
      apiKey: "sk-kimi",
      model: "moonshot:kimi-k2.6",
      prompt: "整理任务",
      provider: "moonshot",
      vision: true
    });
    body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(body.model).toBe("kimi-k2.6");
  });

  it("calls Gemini through generateContent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ kind: "oneOff", content: "读论文", importance: 4 }) }] } }]
      })
    } as Response);

    await importTasksWithAi({
      apiKey: "gemini-key",
      model: "gemini:gemini-2.5-flash",
      prompt: "读论文",
      provider: "gemini",
      vision: true
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
  });

  it("sends image data to OpenAI-compatible vision models", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ kind: "oneOff", content: "整理截图任务", importance: 3 }) } }]
      })
    } as Response);

    await importTasksWithAi({
      apiKey: "sk-test",
      imageDataUrl: "data:image/png;base64,abc123",
      imageMimeType: "image/png",
      imageName: "tasks.png",
      model: "openai:gpt-4.1-mini",
      prompt: "识别截图任务",
      provider: "openai",
      vision: true
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,abc123");
  });

  it("sends base64 image blocks to Anthropic", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({ kind: "oneOff", content: "读图", importance: 3 }) }]
      })
    } as Response);

    await importTasksWithAi({
      apiKey: "sk-ant",
      imageDataUrl: "data:image/jpeg;base64,xyz789",
      imageMimeType: "image/jpeg",
      imageName: "tasks.jpg",
      model: "anthropic:claude-sonnet-4-6",
      prompt: "识别图片",
      provider: "anthropic",
      vision: true
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content[1].source.data).toBe("xyz789");
    expect(body.messages[0].content[1].source.media_type).toBe("image/jpeg");
  });

  it("translates provider errors into actionable feedback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 })
    );

    await expect(() =>
      importTasksWithAi({
        apiKey: "sk-test",
        model: "openai:not-a-model",
        prompt: "整理任务",
        provider: "openai",
        vision: false
      })
    ).rejects.toThrow("模型不可用");
  });

  it("explains browser connection failures", () => {
    expect(explainAiImportError(new TypeError("Failed to fetch"))).toContain("浏览器无法直接连接");
  });

  it("does not treat unsupported providers as a successful AI connection", async () => {
    await expect(() =>
      importTasksWithAi({
        apiKey: "random-key",
        model: "unknown:model",
        prompt: "测试",
        provider: "unknown",
        vision: false
      })
    ).rejects.toThrow("暂不支持这个 API 服务商");
  });
});
