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
                schedule: "明天下午三点",
                duration: "30 分钟",
                importance: 4
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
    expect(draft.importance).toBe(4);
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
      model: "anthropic:claude-3-5-sonnet-latest",
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
});
