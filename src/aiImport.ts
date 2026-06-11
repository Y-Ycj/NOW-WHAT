import { parseTaskInput } from "./taskParser";
import type { ActionItem, SourceType } from "./types";

export type AiImportDraft = {
  content: string;
  duration?: string;
  goalTitle?: string;
  importance: number;
  kind: SourceType;
  schedule?: string;
  steps?: Array<{
    content: string;
    duration?: string;
    importance: number;
    schedule?: string;
  }>;
};

export type AiImportRequest = {
  apiKey: string;
  context?: string[];
  imageDataUrl?: string;
  imageMimeType?: string;
  imageName?: string;
  model: string;
  prompt: string;
  provider: string;
  vision: boolean;
};

export class AiProviderError extends Error {
  provider: string;
  status?: number;

  constructor(message: string, provider: string, status?: number) {
    super(message);
    this.name = "AiProviderError";
    this.provider = provider;
    this.status = status;
  }
}

const SYSTEM_PROMPT = `你是任务导入助手。目标是减少用户决策成本，把输入整理成任务草稿。
只返回 JSON，不要 Markdown。
字段：
kind: "oneOff" | "routine" | "longTerm"
content: 一次性任务或日常任务的具体内容
goalTitle: 长期目标标题
steps: 长期目标下的马上可行动小任务数组
schedule: 期望时间，可为空
duration: 持续时长，可为空
importance: 1 到 5
如果语义模糊，也先给出最保守草稿。`;

export async function importTasksWithAi(request: AiImportRequest): Promise<AiImportDraft> {
  if (!request.apiKey.trim()) throw new Error("缺少 API Key");
  if (!request.prompt.trim() && !request.imageDataUrl && !request.imageName) throw new Error("缺少导入内容");
  const contextualRequest = { ...request, prompt: buildContextPrompt(request) };

  if (isOpenAiCompatibleProvider(request.provider)) {
    return importWithOpenAiCompatible(contextualRequest);
  }

  if (request.provider === "anthropic") {
    return importWithAnthropic(contextualRequest);
  }

  if (request.provider === "gemini") {
    return importWithGemini(contextualRequest);
  }

  throw new AiProviderError("暂不支持这个 API 服务商。请换一个列表中的模型，或等待后续接入。", request.provider);
}

function buildContextPrompt(request: AiImportRequest) {
  const context = request.context?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (!context.length) return request.prompt;
  const previous = context.map((item, index) => `${index + 1}. ${item}`).join("\n");
  return `此前用户输入（按时间顺序）：\n${previous}\n\n本轮用户输入：\n${request.prompt || "请结合此前内容和图片继续整理。"}\n\n请结合此前内容理解本轮修改，并返回完整的最新任务草稿。`;
}

export async function testAiConnection(request: Omit<AiImportRequest, "imageDataUrl" | "imageMimeType" | "imageName" | "prompt">) {
  await importTasksWithAi({
    ...request,
    prompt: "测试连接。请只返回一个 JSON 任务草稿：{\"kind\":\"oneOff\",\"content\":\"连接测试\",\"importance\":3}",
    vision: false
  });
}

async function importWithOpenAiCompatible(request: AiImportRequest): Promise<AiImportDraft> {
  const endpoint = endpointForOpenAiCompatibleProvider(request.provider);
  const model = request.model.replace(`${request.provider}:`, "");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: buildOpenAiCompatibleContent(request)
        }
      ]
    })
  });

  if (!response.ok) throw await buildProviderError(response, request.provider);

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new AiProviderError("模型没有返回内容。请确认模型可用，或换一个模型重试。", request.provider);
  try {
    return normalizeDraft(JSON.parse(content));
  } catch {
    throw new AiProviderError("模型返回的不是可解析 JSON。请换一个模型或稍后重试。", request.provider);
  }
}

async function importWithAnthropic(request: AiImportRequest): Promise<AiImportDraft> {
  const model = request.model.replace("anthropic:", "");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": request.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildAnthropicContent(request)
        }
      ]
    })
  });

  if (!response.ok) throw await buildProviderError(response, request.provider);

  const data = (await response.json()) as { content?: Array<{ text?: string; type?: string }> };
  const content = data.content?.find((block) => block.type === "text" || block.text)?.text;
  if (!content) throw new AiProviderError("模型没有返回内容。请确认模型可用，或换一个模型重试。", request.provider);
  try {
    return normalizeDraft(JSON.parse(content));
  } catch {
    throw new AiProviderError("模型返回的不是可解析 JSON。请换一个模型或稍后重试。", request.provider);
  }
}

async function importWithGemini(request: AiImportRequest): Promise<AiImportDraft> {
  const model = request.model.replace("gemini:", "");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        },
        contents: [
          {
            role: "user",
            parts: [
              ...buildGeminiParts(request)
            ]
          }
        ]
      })
    }
  );

  if (!response.ok) throw await buildProviderError(response, request.provider);

  const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const content = data.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!content) throw new AiProviderError("模型没有返回内容。请确认模型可用，或换一个模型重试。", request.provider);
  try {
    return normalizeDraft(JSON.parse(content));
  } catch {
    throw new AiProviderError("模型返回的不是可解析 JSON。请换一个模型或稍后重试。", request.provider);
  }
}

async function buildProviderError(response: Response, provider: string) {
  const detail = await readErrorDetail(response);
  return new AiProviderError(explainProviderError(response.status, detail), provider, response.status);
}

async function readErrorDetail(response: Response) {
  try {
    const value = await response.clone().json() as unknown;
    return JSON.stringify(value).slice(0, 280);
  } catch {
    try {
      return (await response.text()).slice(0, 280);
    } catch {
      return "";
    }
  }
}

function explainProviderError(status: number, detail: string) {
  const suffix = detail ? `（${detail}）` : "";
  if (status === 400) return `请求格式不被模型接受。若上传了图片，可能是当前模型不支持图片；也可能是该服务商不支持 JSON 输出参数。${suffix}`;
  if (status === 401) return `API Key 无效，或这个 Key 不属于当前选择的服务商。请检查密钥和模型来源。${suffix}`;
  if (status === 403) return `当前账号没有权限使用这个模型，或服务商限制了项目、地区、组织权限。${suffix}`;
  if (status === 404) return `模型不可用或模型名称不匹配。请换一个模型，或确认服务商控制台里的模型 ID。${suffix}`;
  if (status === 429) return `额度不足或请求过快。请检查服务商余额、限额，或稍后重试。${suffix}`;
  if ([500, 502, 503, 529].includes(status)) return `服务商暂时不可用。请稍后重试，或临时换一个模型。${suffix}`;
  return `API 请求失败：${status}。${suffix}`;
}

export function explainAiImportError(error: unknown) {
  if (error instanceof AiProviderError) return error.message;
  if (error instanceof TypeError || (error instanceof Error && /fetch|network|CORS|Failed to fetch/i.test(error.message))) {
    return "浏览器无法直接连接这个服务商。可能是网络问题，或该 API 不允许前端直连；正式版建议通过后端代理。";
  }
  if (error instanceof Error) return error.message;
  return "API 请求失败，原因未知。";
}

function isOpenAiCompatibleProvider(provider: string) {
  return ["openai", "openrouter", "deepseek", "moonshot", "alibaba", "mistral", "xai"].includes(provider);
}

function endpointForOpenAiCompatibleProvider(provider: string) {
  const endpoints: Record<string, string> = {
    alibaba: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    deepseek: "https://api.deepseek.com/chat/completions",
    mistral: "https://api.mistral.ai/v1/chat/completions",
    moonshot: "https://api.moonshot.ai/v1/chat/completions",
    openai: "https://api.openai.com/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    xai: "https://api.x.ai/v1/chat/completions"
  };
  return endpoints[provider] ?? endpoints.openai;
}

export function fallbackImportDraft(text: string): AiImportDraft {
  const parsed = parseTaskInput(text);
  return {
    content: parsed.title || text.trim() || "待整理任务",
    duration: parsed.estimatedMinutes ? `${parsed.estimatedMinutes} 分钟` : undefined,
    importance: 3,
    kind: "oneOff",
    schedule: parsed.preferredWindow ? preferredWindowText(parsed.preferredWindow) : undefined
  };
}

function normalizeDraft(value: unknown): AiImportDraft {
  const draft = value as Partial<AiImportDraft>;
  const kind = draft.kind === "routine" || draft.kind === "longTerm" ? draft.kind : "oneOff";
  return {
    content: String(draft.content || draft.steps?.[0]?.content || "待整理任务"),
    duration: draft.duration ? String(draft.duration) : undefined,
    goalTitle: draft.goalTitle ? String(draft.goalTitle) : undefined,
    importance: clampImportance(draft.importance),
    kind,
    schedule: draft.schedule ? String(draft.schedule) : undefined,
    steps: draft.steps?.map((step) => ({
      content: String(step.content || "待整理任务"),
      duration: step.duration ? String(step.duration) : undefined,
      importance: clampImportance(step.importance),
      schedule: step.schedule ? String(step.schedule) : undefined
    }))
  };
}

function clampImportance(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function preferredWindowText(window: NonNullable<ActionItem["preferredWindow"]>) {
  const labels = {
    morning: "上午",
    afternoon: "下午",
    evening: "晚上",
    night: "深夜",
    any: ""
  };
  return labels[window] || undefined;
}

function buildOpenAiCompatibleContent(request: AiImportRequest) {
  const text = [
    request.prompt,
    request.imageName && !request.imageDataUrl ? `用户已上传图片，文件名：${request.imageName}。` : ""
  ]
    .filter(Boolean)
    .join("\n");

  if (!request.imageDataUrl) return text;

  return [
    { type: "text", text: text || "请识别图片中的任务，并整理成任务草稿。" },
    {
      type: "image_url",
      image_url: {
        url: request.imageDataUrl
      }
    }
  ];
}

function buildAnthropicContent(request: AiImportRequest) {
  const blocks: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  > = [];
  if (request.prompt.trim() || request.imageName) {
    blocks.push({ type: "text", text: request.prompt || `请识别图片中的任务：${request.imageName ?? ""}` });
  }
  const image = imageParts(request);
  if (image) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.base64
      }
    });
  }
  return blocks.length ? blocks : [{ type: "text", text: "请整理任务。" }];
}

function buildGeminiParts(request: AiImportRequest) {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: [SYSTEM_PROMPT, request.prompt || "请识别图片中的任务，并整理成任务草稿。"].filter(Boolean).join("\n\n")
    }
  ];
  const image = imageParts(request);
  if (image) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64
      }
    });
  }
  return parts;
}

function imageParts(request: AiImportRequest) {
  if (!request.imageDataUrl) return undefined;
  const match = request.imageDataUrl.match(/^data:([^;]+);base64,(.*)$/u);
  if (!match) return undefined;
  return {
    mimeType: request.imageMimeType || match[1],
    base64: match[2]
  };
}
