import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};

function renderApp() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  return { container, root };
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function change(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settleMotion() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 380));
  });
}

async function goToAddTask(container: HTMLElement) {
  const wantButtons = Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === "我想做什么"
  );
  expect(wantButtons.length).toBeGreaterThan(0);
  click(wantButtons[0]);
  await settleMotion();
}

async function addTask(container: HTMLElement, title: string) {
  await goToAddTask(container);
  const taskInput = container.querySelector<HTMLInputElement>('input[aria-label="任务具体内容"]');
  expect(taskInput).toBeTruthy();
  change(taskInput!, title);
  const addButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "添加一次性任务"
  );
  expect(addButton).toBeTruthy();
  click(addButton!);
  await settleMotion();
}

describe("App", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
  });

  it("keeps adding tasks separate from the now page", async () => {
    const { container } = renderApp();

    expect(container.textContent).toContain("我该做什么");
    expect(container.textContent).not.toContain("把想法变成下一步");

    await goToAddTask(container);

    expect(container.textContent).toContain("把想法变成下一步");
    expect(container.textContent).toContain("任务输入");
    expect(container.textContent).toContain("智能导入");
    expect(container.textContent).toContain("一次性任务");
    expect(container.textContent).toContain("日常任务");
    expect(container.textContent).toContain("长期目标");
    const taskInput = container.querySelector<HTMLInputElement>('input[aria-label="任务具体内容"]');
    expect(taskInput).toBeTruthy();
    change(taskInput!, "写一条测试任务");

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "添加一次性任务"
    );
    expect(addButton).toBeTruthy();
    click(addButton!);
    await settleMotion();

    expect(container.textContent).toContain("我该做什么");
    expect(container.textContent).toContain("写一条测试任务");
    expect(container.textContent).not.toContain("把想法变成下一步");
  });

  it("allows adding tasks without optional schedule or duration", async () => {
    const { container } = renderApp();

    await goToAddTask(container);
    const taskInput = container.querySelector<HTMLInputElement>('input[aria-label="任务具体内容"]');
    expect(taskInput).toBeTruthy();
    change(taskInput!, "只写任务本体");

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "添加一次性任务"
    );
    expect(addButton).toBeTruthy();
    click(addButton!);
    await settleMotion();

    const state = JSON.parse(localStorage.getItem("now-what-app-state") ?? "{}");
    expect(state.items[0].title).toBe("只写任务本体");
    expect(state.items[0].scheduleText).toBeUndefined();
    expect(state.items[0].durationText).toBeUndefined();
    expect(state.items[0].estimatedMinutes).toBe(25);
    expect(container.textContent).not.toContain("25 分钟");
  });

  it("keeps AI import locked until the user provides an API key", async () => {
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
                importance: 3
              })
            }
          }
        ]
      })
    } as Response);
    const { container } = renderApp();

    await goToAddTask(container);

    const aiButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "智能导入"
    );
    expect(aiButton).toBeTruthy();
    click(aiButton!);
    await settleMotion();

    expect(container.textContent).toContain("智能导入尚未解锁");
    expect(container.textContent).toContain("充值会员");
    expect(container.textContent).toContain("导入 API");
    expect(container.querySelector('input[aria-label="上传截图"]')).toBeFalsy();

    const membershipButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "充值会员"
    );
    expect(membershipButton).toBeTruthy();
    click(membershipButton!);
    expect(container.textContent).toContain("会员解锁暂未开放");
    const closeNotice = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "知道了"
    );
    click(closeNotice!);

    const keyInput = container.querySelector<HTMLInputElement>('input[aria-label="API Key"]');
    expect(keyInput).toBeTruthy();
    const modelSelect = container.querySelector<HTMLSelectElement>('select[aria-label="智能导入模型"]');
    expect(modelSelect).toBeTruthy();
    expect(modelSelect?.textContent).toContain("（推荐）");
    expect(container.textContent).toContain("保存到本机，下次自动解锁");
    change(keyInput!, "sk-test");

    const unlockButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "使用 API 解锁"
    );
    expect(unlockButton).toBeTruthy();
    click(unlockButton!);

    expect(container.textContent).toContain("智能导入对话");
    expect(container.textContent).toContain("支持识图");
    expect(container.querySelector('input[aria-label="上传截图"]')).toBeTruthy();

    const promptInput = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="智能导入对话输入"]');
    expect(promptInput).toBeTruthy();
    changeTextarea(promptInput!, "明天下午三点提交报表 30 分钟");
    const organizeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "整理"
    );
    expect(organizeButton).toBeTruthy();
    click(organizeButton!);
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(container.textContent).toContain("待确认任务草稿");
    expect(container.textContent).toContain("提交报表");
    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "确认后导入"
    );
    expect(confirmButton).toBeTruthy();
    click(confirmButton!);
    await settleMotion();

    expect(container.textContent).toContain("任务具体内容");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="任务具体内容"]')?.value).toBe("提交报表");
  });

  it("can save, restore, and clear the AI API key on this device", async () => {
    const first = renderApp();

    await goToAddTask(first.container);
    const aiButton = Array.from(first.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "智能导入"
    );
    expect(aiButton).toBeTruthy();
    click(aiButton!);
    await settleMotion();

    change(first.container.querySelector<HTMLInputElement>('input[aria-label="API Key"]')!, "sk-local-device-1234");
    const saveCheckbox = first.container.querySelector<HTMLInputElement>('input[aria-label="保存 API Key 到本机"]');
    expect(saveCheckbox).toBeTruthy();
    act(() => {
      saveCheckbox!.click();
    });
    const unlockButton = Array.from(first.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "使用 API 解锁"
    );
    expect(unlockButton).toBeTruthy();
    click(unlockButton!);

    expect(first.container.textContent).toContain("本机已保存 sk-l...1234");
    expect(localStorage.getItem("now-what-ai-credentials")).toContain("sk-local-device-1234");

    act(() => first.root.unmount());
    const second = renderApp();
    await goToAddTask(second.container);
    const restoredAiButton = Array.from(second.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "智能导入"
    );
    click(restoredAiButton!);
    await settleMotion();

    expect(second.container.textContent).toContain("智能导入对话");
    expect(second.container.textContent).toContain("本机已保存 sk-l...1234");

    const clearButton = Array.from(second.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "清除密钥"
    );
    expect(clearButton).toBeTruthy();
    click(clearButton!);

    expect(localStorage.getItem("now-what-ai-credentials")).toBeNull();
    expect(second.container.textContent).toContain("智能导入尚未解锁");
  });

  it("shows actionable feedback when testing an unavailable AI model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 })
    );
    const { container } = renderApp();

    await goToAddTask(container);
    const aiButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "智能导入"
    );
    click(aiButton!);
    await settleMotion();

    change(container.querySelector<HTMLInputElement>('input[aria-label="API Key"]')!, "sk-wrong-model");
    const testButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "测试连接"
    );
    expect(testButton).toBeTruthy();
    click(testButton!);
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("模型不可用或模型名称不匹配");
  });

  it("combines switch recommendation with optional reason feedback", async () => {
    const { container } = renderApp();

    await addTask(container, "写一条测试任务");

    expect(container.textContent).toContain("开始");
    expect(container.textContent).toContain("已完成");
    expect(container.textContent).toContain("换一个");

    expect(container.textContent).not.toContain("不适合现在");
    expect(container.textContent).not.toContain("时间不够");

    const reasonButton = container.querySelector<HTMLButtonElement>('button[aria-label="选择换一个理由"]');
    expect(reasonButton).toBeTruthy();
    click(reasonButton!);
    await settleMotion();

    expect(container.textContent).toContain("时间不够");
    expect(container.textContent).toContain("不在合适地点");
    expect(container.textContent).toContain("设备不在手边");
    expect(container.textContent).toContain("太费精力");
    expect(container.textContent).not.toContain("不想做这个");
    expect(container.textContent).not.toContain("已经完成");
  });

  it("records start and completion duration when completing after start", async () => {
    const { container } = renderApp();

    await addTask(container, "记录开始和完成");

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "开始"
    );
    const completeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "已完成"
    );
    expect(startButton).toBeTruthy();
    expect(completeButton).toBeTruthy();

    click(startButton!);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    click(completeButton!);

    const state = JSON.parse(localStorage.getItem("now-what-app-state") ?? "{}");
    expect(state.events.some((event: { type: string }) => event.type === "started")).toBe(true);
    expect(
      state.events.some((event: { type: string; durationMs?: number }) => event.type === "completed" && event.durationMs)
    ).toBe(true);
  });

  it("shows active tasks in task radar by default and keeps quadrants available", async () => {
    const { container } = renderApp();

    await addTask(container, "今天下午三点提交报表");

    const tasksButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "任务"
    );
    click(tasksButton!);
    await settleMotion();

    expect(container.textContent).toContain("任务雷达");
    expect(container.textContent).toContain("提交报表");
    expect(container.textContent).not.toContain("空");

    const quadrantButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "四象限"
    );
    expect(quadrantButton).toBeTruthy();
    click(quadrantButton!);
    await settleMotion();

    expect(container.textContent).toContain("重要且紧急");
    expect(container.textContent).toContain("重要不紧急");
    expect(container.textContent).toContain("紧急不重要");
    expect(container.textContent).toContain("不重要不紧急");
  });

  it("shows completed records by day from the task page", async () => {
    const { container } = renderApp();

    await addTask(container, "完成记录测试");

    const tasksButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "任务"
    );
    click(tasksButton!);
    await settleMotion();

    const completeButton = container.querySelector<HTMLButtonElement>('button[title="完成"]');
    expect(completeButton).toBeTruthy();
    click(completeButton!);

    const historyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "已完成"
    );
    expect(historyButton).toBeTruthy();
    click(historyButton!);
    await settleMotion();

    expect(container.textContent).toContain("已完成记录");
    expect(container.textContent).toContain("默认今日已完成");
    expect(container.textContent).toContain("完成记录测试");
  });

  it("keeps routine tasks active after completion", async () => {
    const { container } = renderApp();

    await goToAddTask(container);
    const routineKind = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("日常任务")
    );
    expect(routineKind).toBeTruthy();
    click(routineKind!);

    const taskInput = container.querySelector<HTMLInputElement>('input[aria-label="任务具体内容"]');
    expect(taskInput).toBeTruthy();
    change(taskInput!, "晨间拉伸");
    const scheduleInput = container.querySelector<HTMLInputElement>('input[aria-label="期望时间"]');
    change(scheduleInput!, "每天早上 8 点");
    const durationInput = container.querySelector<HTMLInputElement>('input[aria-label="持续时长"]');
    change(durationInput!, "15 分钟");

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "添加日常任务"
    );
    expect(addButton).toBeTruthy();
    click(addButton!);
    await settleMotion();

    const completeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "已完成"
    );
    expect(completeButton).toBeTruthy();
    click(completeButton!);

    const state = JSON.parse(localStorage.getItem("now-what-app-state") ?? "{}");
    const routine = state.items.find((item: { title: string }) => item.title === "晨间拉伸");
    expect(routine?.sourceType).toBe("routine");
    expect(routine?.status).toBe("active");
    expect(routine?.estimatedMinutes).toBe(15);
    expect(state.events.some((event: { itemId: string; type: string }) => event.itemId === routine.id && event.type === "completed")).toBe(true);
  });

  it("adds long term goals through multiple concrete next actions", async () => {
    const { container } = renderApp();

    await goToAddTask(container);
    const longTermKind = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("长期目标")
    );
    expect(longTermKind).toBeTruthy();
    click(longTermKind!);

    change(container.querySelector<HTMLInputElement>('input[aria-label="长期目标"]')!, "三个月内完成作品集");
    change(container.querySelector<HTMLInputElement>('input[aria-label="长期目标小任务 1"]')!, "列出三个项目候选");
    const addStepButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "增加小任务"
    );
    expect(addStepButton).toBeTruthy();
    click(addStepButton!);
    change(container.querySelector<HTMLInputElement>('input[aria-label="长期目标小任务 2"]')!, "整理作品集目录");
    change(container.querySelector<HTMLInputElement>('input[aria-label="小任务 2 持续时长"]')!, "45 分钟");
    const stepTwoOnce = Array.from(container.querySelectorAll<HTMLButtonElement>('div[aria-label="小任务 2 重复方式"] button')).find(
      (button) => button.textContent?.trim() === "一次性"
    );
    expect(stepTwoOnce).toBeTruthy();
    click(stepTwoOnce!);
    const stepTwoLevel = Array.from(container.querySelectorAll<HTMLButtonElement>('div[aria-label="小任务 2 重要性"] button')).find(
      (button) => button.textContent?.trim() === "5"
    );
    expect(stepTwoLevel).toBeTruthy();
    click(stepTwoLevel!);
    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "添加长期目标"
    );
    expect(addButton).toBeTruthy();
    click(addButton!);
    await settleMotion();

    expect(container.textContent).toContain("整理作品集目录");
    const state = JSON.parse(localStorage.getItem("now-what-app-state") ?? "{}");
    expect(state.longTermGoals[0].title).toBe("三个月内完成作品集");
    expect(state.longTermGoals[0].nextActionIds.length).toBe(2);
    expect(state.items.map((item: { title: string }) => item.title)).toEqual(["列出三个项目候选", "整理作品集目录"]);
    expect(state.items[0].recurrence.frequency).toBe("daily");
    expect(state.items[1].recurrence.frequency).toBe("once");
    expect(state.items[1].estimatedMinutes).toBe(45);
    expect(state.items[1].importance).toBe(5);
  });

  it("explains why a long term goal cannot be added when the goal title is missing", async () => {
    const { container } = renderApp();

    await goToAddTask(container);
    const longTermKind = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("长期目标")
    );
    expect(longTermKind).toBeTruthy();
    click(longTermKind!);
    change(container.querySelector<HTMLInputElement>('input[aria-label="长期目标小任务 1"]')!, "英语学习");

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "添加长期目标"
    );
    expect(addButton).toBeTruthy();
    click(addButton!);

    expect(container.textContent).toContain("请先填写长期目标");
    expect(localStorage.getItem("now-what-app-state")).toBeNull();
  });

  it("stores the selected importance level from the unified task form", async () => {
    const { container } = renderApp();

    await goToAddTask(container);
    change(container.querySelector<HTMLInputElement>('input[aria-label="任务具体内容"]')!, "重要性测试");
    const levelFive = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')).find(
      (button) => button.textContent?.trim() === "5"
    );
    expect(levelFive).toBeTruthy();
    click(levelFive!);

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "添加一次性任务"
    );
    click(addButton!);
    await settleMotion();

    const state = JSON.parse(localStorage.getItem("now-what-app-state") ?? "{}");
    expect(state.items[0].importance).toBe(5);
  });
});
