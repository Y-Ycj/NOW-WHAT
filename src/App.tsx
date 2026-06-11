import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  Bot,
  Check,
  ChevronDown,
  CreditCard,
  Home,
  ImageUp,
  KeyRound,
  ListChecks,
  Lock,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  X
} from "lucide-react";
import { explainAiImportError, fallbackImportDraft, importTasksWithAi, testAiConnection, type AiImportDraft } from "./aiImport";
import { getCurrentRecommendation } from "./recommendation";
import { clearAiCredentials, createEvent, createId, loadAiCredentials, loadState, saveAiCredentials, saveState } from "./storage";
import { parseTaskInput } from "./taskParser";
import type { ActionEvent, ActionItem, AppState, EnergyLevel, SourceType } from "./types";
import "./styles.css";

type View = "now" | "want" | "tasks";
type QuadrantKey = "importantUrgent" | "importantNotUrgent" | "notImportantUrgent" | "notImportantNotUrgent";
type TaskKind = SourceType;
type GoalStepDraft = {
  cadence: "daily" | "weekly" | "once";
  content: string;
  duration: string;
  id: string;
  importance: number;
  schedule: string;
  weekdays: number[];
};
type TaskEntryDraft = {
  content: string;
  duration: string;
  goalTitle: string;
  importance: number;
  kind: TaskKind;
  routineCadence: "daily" | "weekly";
  schedule: string;
  steps: GoalStepDraft[];
  weekdays: number[];
};
type ImportMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};
type ImportModelOption = {
  label: string;
  recommended?: boolean;
  value: string;
  vision: boolean;
};

function isKeyboardInputTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const input = target.closest("input, textarea");
  if (input instanceof HTMLTextAreaElement) return true;
  if (!(input instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "color", "file", "radio", "range", "reset", "submit"].includes(input.type);
}

const getPageMotion = (reduceMotion: boolean) =>
  reduceMotion
    ? ({
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.01 }
      } as const)
    : ({
        initial: { opacity: 0, y: 18 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -10 },
        transition: { duration: 0.34, ease: "easeOut" }
      } as const);

const sourceLabels: Record<SourceType, string> = {
  oneOff: "一次性",
  routine: "日常",
  longTerm: "目标"
};

const energyLabels: Record<EnergyLevel, string> = {
  low: "低",
  medium: "中",
  high: "高"
};

const windowLabels: Record<NonNullable<ActionItem["preferredWindow"]>, string> = {
  morning: "上午",
  afternoon: "下午",
  evening: "晚上",
  night: "深夜",
  any: "任意"
};

const kindLabels: Record<TaskKind, { title: string; note: string }> = {
  oneOff: { title: "一次性任务", note: "只执行一次，完成后归档到记录" },
  routine: { title: "日常任务", note: "每日或每周重复，完成后继续保留" },
  longTerm: { title: "长期目标", note: "拆成多个可反复推进的小任务" }
};

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const importModelGroups: Array<{ label: string; models: ImportModelOption[] }> = [
  {
    label: "带识图（推荐）",
    models: [
      { value: "openai:gpt-4.1-mini", label: "OpenAI GPT-4.1 mini", vision: true, recommended: true },
      { value: "openai:gpt-4.1", label: "OpenAI GPT-4.1", vision: true, recommended: true },
      { value: "openai:gpt-4o-mini", label: "OpenAI GPT-4o mini", vision: true },
      { value: "anthropic:claude-3-5-sonnet-latest", label: "Claude Sonnet", vision: true, recommended: true },
      { value: "gemini:gemini-2.5-flash", label: "Gemini 2.5 Flash", vision: true, recommended: true },
      { value: "gemini:gemini-2.5-pro", label: "Gemini 2.5 Pro", vision: true },
      { value: "alibaba:qwen-vl-plus", label: "Qwen-VL Plus", vision: true },
      { value: "alibaba:qwen-vl-max", label: "Qwen-VL Max", vision: true },
      { value: "mistral:pixtral-large-latest", label: "Mistral Pixtral Large", vision: true },
      { value: "xai:grok-vision", label: "xAI Grok Vision", vision: true },
      { value: "openrouter:auto-vision", label: "OpenRouter Auto Vision", vision: true }
    ]
  },
  {
    label: "不带识图（仅文字）",
    models: [
      { value: "openai:gpt-4.1-nano", label: "OpenAI GPT-4.1 nano", vision: false },
      { value: "anthropic:claude-3-5-haiku-latest", label: "Claude Haiku Text", vision: false },
      { value: "deepseek:deepseek-chat", label: "DeepSeek Chat", vision: false },
      { value: "moonshot:kimi-k2.5-text", label: "Kimi K2.5 Text", vision: false },
      { value: "openrouter:auto-text", label: "OpenRouter Auto Text", vision: false }
    ]
  }
];

const quadrantLabels: Record<QuadrantKey, { title: string; note: string }> = {
  importantUrgent: { title: "重要且紧急", note: "先清掉，减少压力" },
  importantNotUrgent: { title: "重要不紧急", note: "持续推进，避免变急" },
  notImportantUrgent: { title: "紧急不重要", note: "快速处理或压缩" },
  notImportantNotUrgent: { title: "不重要不紧急", note: "删除、归档或延后" }
};

const nowIso = () => new Date().toISOString();

const maskSecret = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "已保存";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const createGoalStepDraft = (): GoalStepDraft => ({
  cadence: "daily",
  content: "",
  duration: "",
  id: createId("step"),
  importance: 3,
  schedule: "",
  weekdays: [new Date().getDay()]
});

const initialTaskDraft = (): TaskEntryDraft => ({
  content: "",
  duration: "",
  goalTitle: "",
  importance: 3,
  kind: "oneOff",
  routineCadence: "daily",
  schedule: "",
  steps: [createGoalStepDraft()],
  weekdays: [new Date().getDay()]
});

const baseItem = (title: string): Omit<ActionItem, "id" | "sourceType"> => {
  const timestamp = nowIso();
  return {
    title: title.trim(),
    importance: 3,
    urgency: 3,
    preferredWindow: "any",
    estimatedMinutes: 25,
    energyLevel: "medium",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

function useStoredState() {
  const [state, setState] = useState<AppState>(() => loadState());

  function commit(next: AppState) {
    setState(next);
    saveState(next);
  }

  return [state, commit] as const;
}

export default function App() {
  const [state, setState] = useStoredState();
  const [view, setView] = useState<View>("now");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const viewportBaseline = useRef(0);
  const reduceMotion = useReducedMotion();
  const pageMotion = getPageMotion(Boolean(reduceMotion));
  const [taskDraft, setTaskDraft] = useState<TaskEntryDraft>(() => initialTaskDraft());

  const activeItems = useMemo(() => state.items.filter((item) => item.status === "active"), [state.items]);
  const recommendation = useMemo(
    () => getCurrentRecommendation(new Date(), activeItems, state.events),
    [activeItems, state.events]
  );

  useEffect(() => {
    const viewport = window.visualViewport;

    function syncKeyboardState() {
      const viewportHeight = viewport?.height ?? window.innerHeight;
      viewportBaseline.current = Math.max(viewportBaseline.current, window.innerHeight, viewportHeight);
      const heightLoss = viewportBaseline.current - viewportHeight;
      const keyboardVisible = isKeyboardInputTarget(document.activeElement) && heightLoss > 120;
      setKeyboardOpen(keyboardVisible);
    }

    function syncAfterFocusChange() {
      window.setTimeout(syncKeyboardState, 0);
    }

    function resetViewportBaseline() {
      viewportBaseline.current = 0;
      syncAfterFocusChange();
    }

    syncKeyboardState();
    viewport?.addEventListener("resize", syncKeyboardState);
    window.addEventListener("resize", syncKeyboardState);
    window.addEventListener("orientationchange", resetViewportBaseline);
    document.addEventListener("focusin", syncAfterFocusChange);
    document.addEventListener("focusout", syncAfterFocusChange);
    return () => {
      viewport?.removeEventListener("resize", syncKeyboardState);
      window.removeEventListener("resize", syncKeyboardState);
      window.removeEventListener("orientationchange", resetViewportBaseline);
      document.removeEventListener("focusin", syncAfterFocusChange);
      document.removeEventListener("focusout", syncAfterFocusChange);
    };
  }, []);

  function addTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const goalSteps = taskDraft.steps.filter((step) => step.content.trim());
    const content = taskDraft.kind === "longTerm" ? goalSteps[0]?.content ?? "" : taskDraft.content;
    if (!content.trim()) return;
    if (taskDraft.kind === "longTerm" && (!taskDraft.goalTitle.trim() || !goalSteps.length)) return;

    const recurrence =
      taskDraft.kind === "routine"
        ? {
            frequency: taskDraft.routineCadence,
            weekdays:
              taskDraft.routineCadence === "weekly"
                ? (taskDraft.weekdays.length ? [...taskDraft.weekdays].sort() : [new Date().getDay()])
                : undefined
          }
        : { frequency: "once" as const };
    const goalId = createId("goal");
    const routineId = createId("routine");
    const oneOffId = createId("one");

    const itemsToAdd: ActionItem[] =
      taskDraft.kind === "longTerm"
        ? goalSteps.map((step) => {
            const parsed = parseTaskInput([step.content, step.schedule, step.duration].filter(Boolean).join(" "));
            const title = parsed.title || step.content.trim();
            const stepRecurrence =
              step.cadence === "once"
                ? ({ frequency: "once" } as const)
                : {
                    frequency: step.cadence,
                    weekdays:
                      step.cadence === "weekly"
                        ? (step.weekdays.length ? [...step.weekdays].sort() : [new Date().getDay()])
                        : undefined
                  };
            return {
              ...baseItem(title),
              id: createId("item"),
              sourceId: goalId,
              sourceType: "longTerm",
              importance: step.importance,
              urgency: parsed.time ? 4 : 2,
              time: parsed.time,
              scheduleText: step.schedule.trim() || undefined,
              recurrence: stepRecurrence,
              preferredWindow: parsed.preferredWindow ?? "any",
              estimatedMinutes: parsed.estimatedMinutes ?? 30,
              durationText: step.duration.trim() || undefined
            };
          })
        : (() => {
            const parsed = parseTaskInput([content, taskDraft.schedule, taskDraft.duration].filter(Boolean).join(" "));
            const title = parsed.title || content.trim();
            return [
              {
                ...baseItem(title),
                id: createId("item"),
                sourceType: taskDraft.kind,
                importance: taskDraft.importance,
                urgency: parsed.time ? 4 : taskDraft.kind === "oneOff" ? 3 : 2,
                time: parsed.time,
                scheduleText: taskDraft.schedule.trim() || undefined,
                recurrence,
                preferredWindow: parsed.preferredWindow ?? "any",
                estimatedMinutes: parsed.estimatedMinutes ?? 25,
                durationText: taskDraft.duration.trim() || undefined
              }
            ];
          })();

    const primaryItem = itemsToAdd[0];
    setState({
      ...state,
      items: [...itemsToAdd, ...state.items],
      oneOffTasks:
        taskDraft.kind === "oneOff"
          ? [{ id: oneOffId, actionItemId: primaryItem.id, title: primaryItem.title, dueAt: primaryItem.time }, ...state.oneOffTasks]
          : state.oneOffTasks,
      routineTasks:
        taskDraft.kind === "routine"
          ? [
              {
                id: routineId,
                actionItemId: primaryItem.id,
                title: primaryItem.title,
                cadence: taskDraft.routineCadence,
                weekdays:
                  taskDraft.routineCadence === "weekly"
                    ? (taskDraft.weekdays.length ? [...taskDraft.weekdays].sort() : [new Date().getDay()])
                    : undefined,
                preferredWindow: primaryItem.preferredWindow
              },
              ...state.routineTasks
            ]
          : state.routineTasks,
      longTermGoals:
        taskDraft.kind === "longTerm"
          ? [
              {
                id: goalId,
                title: taskDraft.goalTitle.trim(),
                why: "",
                field: "",
                nextActionId: primaryItem.id,
                nextActionIds: itemsToAdd.map((item) => item.id),
                createdAt: nowIso()
              },
              ...state.longTermGoals
            ]
          : state.longTermGoals
    });
    setTaskDraft(initialTaskDraft());
    setView("now");
  }

  function mark(
    itemId: string,
    type: "started" | "completed" | "snoozed" | "skipped",
    details: Parameters<typeof createEvent>[2] = {}
  ) {
    const nextItems =
      type === "completed"
        ? state.items.map((item) =>
            item.id === itemId && item.recurrence?.frequency !== "daily" && item.recurrence?.frequency !== "weekly"
              ? { ...item, status: "completed" as const, updatedAt: nowIso() }
              : item
          )
        : state.items;
    setState({
      ...state,
      items: nextItems,
      events: [createEvent(itemId, type, details), ...state.events]
    });
  }

  function archive(itemId: string) {
    setState({
      ...state,
      items: state.items.map((item) =>
        item.id === itemId ? { ...item, status: "archived", updatedAt: nowIso() } : item
      )
    });
  }

  return (
    <main className={keyboardOpen ? "app-shell keyboard-open" : "app-shell"}>
      <div className="space-bg" aria-hidden="true">
        <div className="orb orb-cyan" />
        <div className="orb orb-violet" />
        <div className="grid-layer" />
        <div className="noise-layer" />
      </div>
      <div className="app-frame">
        <header className="top-bar">
          <p>
            <span className="status-dot" />
            NOW WHAT OS
          </p>
        </header>

        <AnimatePresence mode="wait">
          {view === "now" ? (
            <NowView
              activeCount={activeItems.length}
              key="now"
              recommendation={recommendation}
              reduceMotion={Boolean(reduceMotion)}
              setView={setView}
              mark={mark}
              pageMotion={pageMotion}
            />
          ) : null}

          {view === "want" ? (
            <WantView
              addTask={addTask}
              key="want"
              pageMotion={pageMotion}
              reduceMotion={Boolean(reduceMotion)}
              setTaskDraft={setTaskDraft}
              taskDraft={taskDraft}
            />
          ) : null}

          {view === "tasks" ? (
            <TasksView
              activeItems={activeItems}
              archive={archive}
              events={state.events}
              items={state.items}
              key="tasks"
              mark={mark}
              pageMotion={pageMotion}
              reduceMotion={Boolean(reduceMotion)}
              setView={setView}
            />
          ) : null}
        </AnimatePresence>
      </div>

      <nav className="bottom-nav" aria-label="主导航">
        <NavButton
          active={view === "now"}
          icon={<Home size={19} />}
          label="我该做什么"
          onClick={() => setView("now")}
          reduceMotion={Boolean(reduceMotion)}
        />
        <NavButton
          active={view === "want"}
          icon={<Plus size={20} />}
          label="我想做什么"
          onClick={() => setView("want")}
          reduceMotion={Boolean(reduceMotion)}
        />
        <NavButton
          active={view === "tasks"}
          icon={<ListChecks size={19} />}
          label="任务"
          onClick={() => setView("tasks")}
          reduceMotion={Boolean(reduceMotion)}
        />
      </nav>
    </main>
  );
}

function NowView({
  activeCount,
  mark,
  pageMotion,
  reduceMotion,
  recommendation,
  setView
}: {
  activeCount: number;
  mark: (
    itemId: string,
    type: "started" | "completed" | "snoozed" | "skipped",
    details?: Parameters<typeof createEvent>[2]
  ) => void;
  pageMotion: ReturnType<typeof getPageMotion>;
  reduceMotion: boolean;
  recommendation: ReturnType<typeof getCurrentRecommendation>;
  setView: (view: View) => void;
}) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [startedSession, setStartedSession] = useState<{ itemId: string; startedAt: number }>();
  const switcherRef = useRef<HTMLDivElement>(null);
  const reasonButtonRef = useRef<HTMLButtonElement>(null);
  const reasonMenuId = useId();
  const primary = recommendation.primary;
  const hasStartedPrimary = Boolean(primary && startedSession?.itemId === primary.id);

  useEffect(() => {
    if (!reasonOpen) return;

    function closeIfOutside(event: PointerEvent) {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setReasonOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeIfOutside);
    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, [reasonOpen]);

  function closeReasonMenu() {
    setReasonOpen(false);
    reasonButtonRef.current?.focus();
  }

  function startPrimary() {
    if (!primary) return;
    const startedAt = Date.now();
    setStartedSession({ itemId: primary.id, startedAt });
    mark(primary.id, "started");
  }

  function completePrimary() {
    if (!primary) return;
    const durationMs =
      startedSession?.itemId === primary.id ? Math.max(0, Date.now() - startedSession.startedAt) : undefined;
    setStartedSession(undefined);
    mark(primary.id, "completed", durationMs ? { durationMs } : {});
  }

  function rejectPrimary(reason: "notEnoughTime" | "wrongLocation" | "missingDevice" | "tooMuchEnergy") {
    if (!primary) return;
    closeReasonMenu();
    mark(primary.id, "snoozed", { reason });
  }

  function onReasonKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      closeReasonMenu();
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + offset + items.length) % items.length;
      items[nextIndex]?.focus();
    }
  }

  return (
    <motion.section className="now-view" aria-live="polite" {...pageMotion}>
      <motion.div className="answer hero-panel" whileHover={reduceMotion ? undefined : { y: -4 }}>
        <div className="corner corner-tl" />
        <div className="corner corner-br" />
        <p className="kicker">我该做什么</p>
        {primary ? (
          <>
            <div className={reasonOpen ? "switcher open" : "switcher"} ref={switcherRef}>
              <motion.button
                className="switch-main"
                type="button"
                onClick={() => mark(primary.id, "skipped", { reason: "notNow" })}
                whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              >
                <RefreshCw size={15} aria-hidden="true" />
                换一个
              </motion.button>
              <button
                className="switch-reason"
                type="button"
                aria-label="选择换一个理由"
                aria-controls={reasonMenuId}
                aria-expanded={reasonOpen}
                aria-haspopup="menu"
                ref={reasonButtonRef}
                onClick={() => setReasonOpen((open) => !open)}
              >
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {reasonOpen ? (
                  <motion.div
                    className="switch-menu"
                    id={reasonMenuId}
                    role="menu"
                    aria-label="换一个理由"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                    onAnimationComplete={() => document.getElementById(reasonMenuId)?.querySelector("button")?.focus()}
                    onKeyDown={onReasonKeyDown}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                  >
                    <button type="button" role="menuitem" onClick={() => rejectPrimary("notEnoughTime")}>时间不够</button>
                    <button type="button" role="menuitem" onClick={() => rejectPrimary("wrongLocation")}>不在合适地点</button>
                    <button type="button" role="menuitem" onClick={() => rejectPrimary("missingDevice")}>设备不在手边</button>
                    <button type="button" role="menuitem" onClick={() => rejectPrimary("tooMuchEnergy")}>太费精力</button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
            <div className="decision-copy">
              <h1>{primary.title}</h1>
              <p className="reason">{recommendation.reason}</p>
            </div>
            <div className="decision-actions">
              <div className="action-bar">
                <motion.button
                  type="button"
                  onClick={startPrimary}
                  disabled={hasStartedPrimary}
                  whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                >
                  <Play size={18} aria-hidden="true" />
                  开始
                </motion.button>
                <motion.button
                  className="secondary-button"
                  type="button"
                  onClick={completePrimary}
                  whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                >
                  <Check size={18} aria-hidden="true" />
                  已完成
                </motion.button>
              </div>
              {hasStartedPrimary ? <p className="session-note">已开始</p> : null}
            </div>
            {recommendation.secondary ? <p className="alternative">也可以：{recommendation.secondary.title}</p> : null}
          </>
        ) : (
          <div className="empty-state">
            <Moon size={30} aria-hidden="true" />
            <h1>没有可推荐的动作</h1>
            <p>{activeCount ? "当前筛选下没有合适动作。" : "先把脑子里那件事放进来。"}</p>
            <motion.button type="button" onClick={() => setView("want")} whileTap={reduceMotion ? undefined : { scale: 0.98 }}>
              <Plus size={18} aria-hidden="true" />
              我想做什么
            </motion.button>
          </div>
        )}
      </motion.div>
    </motion.section>
  );
}

function WantView({
  addTask,
  pageMotion,
  reduceMotion,
  setTaskDraft,
  taskDraft
}: {
  addTask: (event: React.FormEvent<HTMLFormElement>) => void;
  pageMotion: ReturnType<typeof getPageMotion>;
  reduceMotion: boolean;
  setTaskDraft: (draft: TaskEntryDraft) => void;
  taskDraft: TaskEntryDraft;
}) {
  const [wantPage, setWantPage] = useState<"text" | "ai">("text");
  const [apiKey, setApiKey] = useState("");
  const [aiUnlocked, setAiUnlocked] = useState(false);
  const [saveApiKeyOnDevice, setSaveApiKeyOnDevice] = useState(false);
  const [savedApiKeyMask, setSavedApiKeyMask] = useState("");
  const [aiError, setAiError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("");
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiWorking, setAiWorking] = useState(false);
  const [importMessages, setImportMessages] = useState<ImportMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "把你想导入的内容发给我。可以是一段文字、一个大目标，或截图里的任务。"
    }
  ]);
  const [importReviewDraft, setImportReviewDraft] = useState<TaskEntryDraft>();
  const [membershipNoticeOpen, setMembershipNoticeOpen] = useState(false);
  const [selectedImportModel, setSelectedImportModel] = useState(importModelGroups[0].models[0].value);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState("");
  const [screenshotMimeType, setScreenshotMimeType] = useState("");
  const [screenshotName, setScreenshotName] = useState("");
  const [formError, setFormError] = useState("");
  const goalTitleRef = useRef<HTMLInputElement>(null);
  const selectedModel = importModelGroups.flatMap((group) => group.models).find((model) => model.value === selectedImportModel);
  const selectedModelHasVision = Boolean(selectedModel?.vision);

  useEffect(() => {
    const saved = loadAiCredentials();
    if (!saved) return;
    setApiKey(saved.apiKey);
    setSelectedImportModel(saved.model);
    setAiUnlocked(true);
    setSaveApiKeyOnDevice(true);
    setSavedApiKeyMask(maskSecret(saved.apiKey));
  }, []);

  function submitTask(event: React.FormEvent<HTMLFormElement>) {
    const hasLongTermStep = taskDraft.steps.some((step) => step.content.trim());
    if (taskDraft.kind === "longTerm" && !taskDraft.goalTitle.trim()) {
      event.preventDefault();
      setFormError("请先填写长期目标。下面的小任务会作为这个目标的推进动作保存。");
      goalTitleRef.current?.focus();
      goalTitleRef.current?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      return;
    }
    if (taskDraft.kind === "longTerm" && !hasLongTermStep) {
      event.preventDefault();
      setFormError("请至少填写一个马上可以行动的小任务。");
      return;
    }
    if (taskDraft.kind !== "longTerm" && !taskDraft.content.trim()) {
      event.preventDefault();
      setFormError("请先填写任务具体内容。");
      return;
    }
    setFormError("");
    addTask(event);
  }

  function unlockAi(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) return;
    setApiKey(trimmedKey);
    if (saveApiKeyOnDevice) {
      saveAiCredentials({ apiKey: trimmedKey, model: selectedImportModel });
      setSavedApiKeyMask(maskSecret(trimmedKey));
    } else {
      clearAiCredentials();
      setSavedApiKeyMask("");
    }
    setAiUnlocked(true);
  }

  async function testConnection() {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setConnectionStatus("请先填写 API Key。");
      return;
    }
    setConnectionTesting(true);
    setConnectionStatus("");
    try {
      await testAiConnection({
        apiKey: trimmedKey,
        model: selectedImportModel,
        provider: getImportProvider(selectedImportModel),
        vision: selectedModelHasVision
      });
      setConnectionStatus("连接成功，当前模型可用于智能导入。");
    } catch (error) {
      setConnectionStatus(explainAiImportError(error));
    } finally {
      setConnectionTesting(false);
    }
  }

  function clearSavedApiKey() {
    clearAiCredentials();
    setApiKey("");
    setAiUnlocked(false);
    setSaveApiKeyOnDevice(false);
    setSavedApiKeyMask("");
    setAiError("");
    setConnectionStatus("");
    setImportReviewDraft(undefined);
  }

  async function sendImportPrompt() {
    const text = aiPrompt.trim();
    if (!text && !screenshotName) return;
    const userText = [text, screenshotName ? `已上传图片：${screenshotName}` : ""].filter(Boolean).join("\n");
    setAiWorking(true);
    setAiError("");
    setImportMessages((messages) => [
      ...messages,
      { id: createId("msg"), role: "user", text: userText }
    ]);
    try {
      const provider = getImportProvider(selectedImportModel);
      const draft = await importTasksWithAi({
        apiKey,
        imageDataUrl: screenshotDataUrl,
        imageMimeType: screenshotMimeType,
        imageName: screenshotName,
        model: selectedImportModel,
        prompt: text,
        provider,
        vision: selectedModelHasVision
      });
      setImportMessages((messages) => [
        ...messages,
        {
          id: createId("msg"),
          role: "assistant",
          text: "我先整理成任务草稿。请确认类型、时间、时长和重要性，确认后再导入。"
        }
      ]);
      setImportReviewDraft(taskDraftFromAiDraft(draft));
      setAiPrompt("");
      setScreenshotDataUrl("");
      setScreenshotMimeType("");
      setScreenshotName("");
    } catch (error) {
      const fallback = fallbackImportDraft(text || screenshotName);
      setAiError(`${explainAiImportError(error)} 已使用本地解析生成草稿。`);
      setImportMessages((messages) => [
        ...messages,
        {
          id: createId("msg"),
          role: "assistant",
          text: "API 暂时没有成功返回。我先用本地解析生成一个草稿，你仍然可以确认后导入。"
        }
      ]);
      setImportReviewDraft(taskDraftFromAiDraft(fallback));
    } finally {
      setAiWorking(false);
    }
  }

  function onScreenshotSelected(file?: File) {
    if (!file) return;
    setScreenshotName(file.name);
    setScreenshotMimeType(file.type || "image/png");
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshotDataUrl(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => setAiError("图片读取失败，请重新选择。");
    reader.readAsDataURL(file);
  }

  function confirmImportDraft() {
    if (!importReviewDraft) return;
    setTaskDraft(importReviewDraft);
    setWantPage("text");
    setImportReviewDraft(undefined);
  }

  return (
    <motion.section className="stack-view" aria-label="我想做什么" {...pageMotion}>
      <div className="page-title task-title">
        <div>
          <p className="kicker">我想做什么</p>
          <h1>{wantPage === "text" ? "把想法变成下一步" : "智能导入"}</h1>
        </div>
        <div className="task-tabs want-tabs" role="radiogroup" aria-label="添加方式">
          <button
            type="button"
            role="radio"
            aria-checked={wantPage === "text"}
            className={wantPage === "text" ? "active" : ""}
            onClick={() => setWantPage("text")}
          >
            任务输入
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={wantPage === "ai"}
            className={wantPage === "ai" ? "active" : ""}
            onClick={() => setWantPage("ai")}
          >
            智能导入
          </button>
        </div>
      </div>

      {wantPage === "text" ? (
        <motion.form className="entry-flow glass-panel" onSubmit={submitTask} whileHover={reduceMotion ? undefined : { y: -4 }}>
          <div className="kind-picker" role="radiogroup" aria-label="任务类型">
            {(Object.keys(kindLabels) as TaskKind[]).map((kind) => (
              <button
                type="button"
                role="radio"
                aria-checked={taskDraft.kind === kind}
                className={taskDraft.kind === kind ? "active" : ""}
                key={kind}
                onClick={() => setTaskDraft({ ...taskDraft, kind })}
              >
                <strong>{kindLabels[kind].title}</strong>
                <span>{kindLabels[kind].note}</span>
              </button>
            ))}
          </div>

          <div className="entry-fields">
            {taskDraft.kind === "longTerm" ? (
              <>
                <label className="goal-title-field">
                  <span>长期目标</span>
                  <input
                    ref={goalTitleRef}
                    value={taskDraft.goalTitle}
                    onChange={(event) => {
                      setFormError("");
                      setTaskDraft({ ...taskDraft, goalTitle: event.target.value });
                    }}
                    placeholder="3 个月内完成作品集"
                    aria-label="长期目标"
                  />
                </label>
                <div className="goal-steps">
                  <div className="goal-steps-header">
                    <span className="field-label">马上可以行动的小任务</span>
                    <button
                      type="button"
                      className="ghost-add"
                      onClick={() => setTaskDraft({ ...taskDraft, steps: [...taskDraft.steps, createGoalStepDraft()] })}
                    >
                      <Plus size={16} aria-hidden="true" />
                      增加小任务
                    </button>
                  </div>
                  {taskDraft.steps.map((step, index) => (
                    <section className="goal-step-card" key={step.id}>
                      <div className="goal-step-main">
                        <span>{index + 1}</span>
                        <label>
                          小任务内容
                          <input
                            value={step.content}
                            onChange={(event) =>
                              setTaskDraft({
                                ...taskDraft,
                                steps: taskDraft.steps.map((item) =>
                                  item.id === step.id ? { ...item, content: event.target.value } : item
                                )
                              })
                            }
                            placeholder="列出作品集的 3 个项目候选"
                            aria-label={`长期目标小任务 ${index + 1}`}
                          />
                        </label>
                      </div>
                      <div className="goal-step-meta" aria-label={`小任务 ${index + 1} 附属属性`}>
                        <div className="step-recurrence">
                          <span className="field-label">重复方式</span>
                          <div className="mini-tabs" role="radiogroup" aria-label={`小任务 ${index + 1} 重复方式`}>
                            {[
                              { label: "每日", value: "daily" },
                              { label: "每周", value: "weekly" },
                              { label: "一次性", value: "once" }
                            ].map((option) => (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={step.cadence === option.value}
                                className={step.cadence === option.value ? "active" : ""}
                                key={option.value}
                                onClick={() =>
                                  setTaskDraft({
                                    ...taskDraft,
                                    steps: taskDraft.steps.map((item) =>
                                      item.id === step.id
                                        ? { ...item, cadence: option.value as GoalStepDraft["cadence"] }
                                        : item
                                    )
                                  })
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          {step.cadence === "weekly" ? (
                            <div className="weekday-picker compact" aria-label={`小任务 ${index + 1} 每周日期`}>
                              {weekdayLabels.map((label, day) => (
                                <button
                                  type="button"
                                  className={step.weekdays.includes(day) ? "active" : ""}
                                  key={label}
                                  onClick={() => {
                                    const nextWeekdays = step.weekdays.includes(day)
                                      ? step.weekdays.filter((item) => item !== day)
                                      : [...step.weekdays, day];
                                    setTaskDraft({
                                      ...taskDraft,
                                      steps: taskDraft.steps.map((item) =>
                                        item.id === step.id ? { ...item, weekdays: nextWeekdays } : item
                                      )
                                    });
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <label>
                          <span className="field-label">期望时间 <em>可选</em></span>
                          <input
                            value={step.schedule}
                            onChange={(event) =>
                              setTaskDraft({
                                ...taskDraft,
                                steps: taskDraft.steps.map((item) =>
                                  item.id === step.id ? { ...item, schedule: event.target.value } : item
                                )
                              })
                            }
                            placeholder=""
                            aria-label={`小任务 ${index + 1} 期望时间`}
                          />
                          <span className="field-hint">例如：今晚 / 明天下午三点 / 本周五</span>
                        </label>
                        <label>
                          <span className="field-label">持续时长 <em>可选</em></span>
                          <input
                            value={step.duration}
                            onChange={(event) =>
                              setTaskDraft({
                                ...taskDraft,
                                steps: taskDraft.steps.map((item) =>
                                  item.id === step.id ? { ...item, duration: event.target.value } : item
                                )
                              })
                            }
                            placeholder=""
                            aria-label={`小任务 ${index + 1} 持续时长`}
                          />
                          <span className="field-hint">例如：15 分钟 / 1 小时</span>
                        </label>
                        <label>
                          <span className="field-label">重要性</span>
                          <div className="importance-picker compact" role="radiogroup" aria-label={`小任务 ${index + 1} 重要性`}>
                            {[1, 2, 3, 4, 5].map((level) => (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={step.importance === level}
                                className={step.importance === level ? "active" : ""}
                                key={level}
                                onClick={() =>
                                  setTaskDraft({
                                    ...taskDraft,
                                    steps: taskDraft.steps.map((item) =>
                                      item.id === step.id ? { ...item, importance: level } : item
                                    )
                                  })
                                }
                              >
                                {level}
                              </button>
                            ))}
                          </div>
                        </label>
                        {taskDraft.steps.length > 1 ? (
                          <button
                            type="button"
                            className="step-remove"
                            onClick={() =>
                              setTaskDraft({ ...taskDraft, steps: taskDraft.steps.filter((item) => item.id !== step.id) })
                            }
                          >
                            移除
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <label>
                任务具体内容
                <input
                  value={taskDraft.content}
                  onChange={(event) => setTaskDraft({ ...taskDraft, content: event.target.value })}
                  placeholder={taskDraft.kind === "oneOff" ? "今晚七点外出吃饭" : "晨间拉伸"}
                  aria-label="任务具体内容"
                />
              </label>
            )}

            {taskDraft.kind === "routine" ? (
              <div className="routine-options">
                <div className="mini-tabs" role="radiogroup" aria-label="重复频率">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={taskDraft.routineCadence === "daily"}
                    className={taskDraft.routineCadence === "daily" ? "active" : ""}
                    onClick={() => setTaskDraft({ ...taskDraft, routineCadence: "daily" })}
                  >
                    每日
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={taskDraft.routineCadence === "weekly"}
                    className={taskDraft.routineCadence === "weekly" ? "active" : ""}
                    onClick={() => setTaskDraft({ ...taskDraft, routineCadence: "weekly" })}
                  >
                    每周
                  </button>
                </div>
                {taskDraft.routineCadence === "weekly" ? (
                  <div className="weekday-picker" aria-label="选择周几">
                    {weekdayLabels.map((label, index) => {
                      const checked = taskDraft.weekdays.includes(index);
                      return (
                        <button
                          type="button"
                          className={checked ? "active" : ""}
                          key={label}
                          onClick={() =>
                            setTaskDraft({
                              ...taskDraft,
                              weekdays: checked
                                ? taskDraft.weekdays.filter((day) => day !== index)
                                : [...taskDraft.weekdays, index]
                            })
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {taskDraft.kind !== "longTerm" ? (
              <>
                <div className="field-row">
                  <label>
                    <span className="field-label">期望时间 <em>可选</em></span>
                    <input
                      value={taskDraft.schedule}
                      onChange={(event) => setTaskDraft({ ...taskDraft, schedule: event.target.value })}
                      placeholder=""
                      aria-label="期望时间"
                    />
                    <span className="field-hint">例如：今晚 / 明天下午三点</span>
                  </label>
                  <label>
                    <span className="field-label">持续时长 <em>可选</em></span>
                    <input
                      value={taskDraft.duration}
                      onChange={(event) => setTaskDraft({ ...taskDraft, duration: event.target.value })}
                      placeholder=""
                      aria-label="持续时长"
                    />
                    <span className="field-hint">例如：15 分钟 / 1 小时</span>
                  </label>
                </div>

                <label>
                  <span className="field-label">任务重要性</span>
                  <div className="importance-picker" role="radiogroup" aria-label="任务重要性">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={taskDraft.importance === level}
                        className={taskDraft.importance === level ? "active" : ""}
                        key={level}
                        onClick={() => setTaskDraft({ ...taskDraft, importance: level })}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </label>
              </>
            ) : null}
          </div>

          {formError ? <p className="form-error" role="alert">{formError}</p> : null}

          <button type="submit" className="entry-submit">
            <Plus size={18} aria-hidden="true" />
            添加{kindLabels[taskDraft.kind].title}
          </button>
        </motion.form>
      ) : (
        <div className="ai-import-panel glass-panel">
          {!aiUnlocked ? (
            <div className="ai-lock">
              <div className="ai-lock-copy">
                <Lock size={24} aria-hidden="true" />
                <h2>智能导入尚未解锁</h2>
                <p>可以通过会员解锁，或导入自己的 API Key 使用截图分析和目标拆分。选择保存时，密钥只保存在这台设备。</p>
              </div>
              <div className="unlock-options">
                <section className="unlock-card">
                  <div className="panel-title">
                    <CreditCard size={18} aria-hidden="true" />
                    <h2>充值会员</h2>
                  </div>
                  <p>适合不想配置模型和 API 的使用方式。</p>
                  <button type="button" onClick={() => setMembershipNoticeOpen(true)}>
                    充值会员
                  </button>
                </section>
                <form className="unlock-card api-key-form" onSubmit={unlockAi}>
                  <div className="panel-title">
                    <KeyRound size={18} aria-hidden="true" />
                    <h2>导入 API</h2>
                  </div>
                  <label>
                    模型
                    <select
                      value={selectedImportModel}
                      onChange={(event) => {
                        setSelectedImportModel(event.target.value);
                        setConnectionStatus("");
                      }}
                      aria-label="智能导入模型"
                    >
                      {importModelGroups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.models.map((model) => (
                            <option key={model.value} value={model.value}>
                              {model.label}{model.recommended ? "（推荐）" : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label>
                    API Key
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => {
                        setApiKey(event.target.value);
                        setSavedApiKeyMask("");
                        setConnectionStatus("");
                      }}
                      placeholder="sk-..."
                      aria-label="API Key"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="save-key-row">
                    <input
                      type="checkbox"
                      checked={saveApiKeyOnDevice}
                      onChange={(event) => setSaveApiKeyOnDevice(event.target.checked)}
                      aria-label="保存 API Key 到本机"
                    />
                    <span>保存到本机，下次自动解锁</span>
                  </label>
                  <p className="key-privacy-note">密钥不会上传到我们的服务器；公共电脑不建议保存。</p>
                  {connectionStatus ? <p className="connection-status" role="status">{connectionStatus}</p> : null}
                  <button type="button" className="secondary-unlock" onClick={testConnection} disabled={connectionTesting}>
                    <KeyRound size={18} aria-hidden="true" />
                    {connectionTesting ? "测试中" : "测试连接"}
                  </button>
                  <button type="submit">
                    <KeyRound size={18} aria-hidden="true" />
                    使用 API 解锁
                  </button>
                </form>
              </div>
              <AnimatePresence>
                {membershipNoticeOpen ? (
                  <motion.div
                    className="notice-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    role="presentation"
                  >
                    <motion.dialog
                      aria-labelledby="membership-title"
                      className="notice-dialog"
                      open
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 12 }}
                    >
                      <button
                        type="button"
                        className="notice-close"
                        aria-label="关闭"
                        onClick={() => setMembershipNoticeOpen(false)}
                      >
                        <X size={18} aria-hidden="true" />
                      </button>
                      <h2 id="membership-title">会员解锁暂未开放</h2>
                      <p>当前 MVP 先支持自带 API Key。会员充值会在后续版本接入。</p>
                      <button type="button" onClick={() => setMembershipNoticeOpen(false)}>
                        知道了
                      </button>
                    </motion.dialog>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : (
            <div className="ai-chat-shell">
              <div className="ai-chat-header">
                <div className="ai-chat-title">
                  <span className="ai-avatar">
                    <Bot size={16} aria-hidden="true" />
                  </span>
                  <div>
                    <h2>智能导入</h2>
                    <p>{selectedModel?.label ?? "已选择模型"}{selectedModelHasVision ? " · 支持识图" : " · 仅文字"}</p>
                  </div>
                </div>
                <div className="ai-connection">
                  <span>{savedApiKeyMask ? `本机已保存 ${savedApiKeyMask}` : "本次会话已解锁"}</span>
                  <button type="button" className="ai-clear-key" onClick={clearSavedApiKey}>清除密钥</button>
                </div>
              </div>
              <div className={importMessages.length <= 1 ? "chat-thread is-empty" : "chat-thread"} aria-live="polite">
                {importMessages.map((message) => (
                  <article className={`chat-message ${message.role}`} key={message.id}>
                    <p>{message.text}</p>
                  </article>
                ))}
              </div>
              {importReviewDraft ? (
                <div className="import-review">
                  <div>
                    <p className="history-label">待确认任务草稿</p>
                    <h3>{kindLabels[importReviewDraft.kind].title}</h3>
                  </div>
                  <dl>
                    <div>
                      <dt>任务</dt>
                      <dd>{importReviewDraft.kind === "longTerm" ? importReviewDraft.steps[0]?.content : importReviewDraft.content}</dd>
                    </div>
                    <div>
                      <dt>期望时间</dt>
                      <dd>{importReviewDraft.schedule || importReviewDraft.steps[0]?.schedule || "未设置"}</dd>
                    </div>
                    <div>
                      <dt>持续时长</dt>
                      <dd>{importReviewDraft.duration || importReviewDraft.steps[0]?.duration || "未设置"}</dd>
                    </div>
                    <div>
                      <dt>重要性</dt>
                      <dd>{importReviewDraft.importance || importReviewDraft.steps[0]?.importance}</dd>
                    </div>
                  </dl>
                  <button type="button" onClick={confirmImportDraft}>
                    <Check size={18} aria-hidden="true" />
                    确认后导入
                  </button>
                </div>
              ) : null}
              {aiError ? <p className="ai-error" role="alert">{aiError}</p> : null}
              <div className={selectedModelHasVision ? "chat-composer has-upload" : "chat-composer"}>
                {selectedModelHasVision ? (
                  <label className="image-plus" title="上传图片">
                    <input
                      type="file"
                      accept="image/*"
                      aria-label="上传截图"
                      onChange={(event) => onScreenshotSelected(event.target.files?.[0])}
                    />
                    <Plus size={18} aria-hidden="true" />
                  </label>
                ) : null}
                <textarea
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  placeholder={selectedModelHasVision ? "输入任务，或上传截图后补充说明" : "输入任务，整理成字段"}
                  aria-label="智能导入对话输入"
                />
                <button className="send-import" type="button" onClick={sendImportPrompt} disabled={aiWorking || (!aiPrompt.trim() && !screenshotName)}>
                  <Sparkles size={18} aria-hidden="true" />
                  {aiWorking ? "整理中" : "整理"}
                </button>
              </div>
              {screenshotName ? <p className="upload-note">已选择图片：{screenshotName}</p> : null}
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}

function TasksView({
  activeItems,
  archive,
  events,
  items,
  mark,
  pageMotion,
  reduceMotion,
  setView
}: {
  activeItems: ActionItem[];
  archive: (itemId: string) => void;
  events: ActionEvent[];
  items: ActionItem[];
  mark: (itemId: string, type: "completed" | "snoozed" | "skipped") => void;
  pageMotion: ReturnType<typeof getPageMotion>;
  reduceMotion: boolean;
  setView: (view: View) => void;
}) {
  const [taskPage, setTaskPage] = useState<"radar" | "quadrants" | "history">("radar");
  const [selectedDay, setSelectedDay] = useState(() => localDateKey(new Date()));
  const radarGroups = useMemo(() => buildRadarGroups(activeItems, new Date()), [activeItems]);
  const quadrants = groupByQuadrant(activeItems);
  const completedRecords = useMemo(() => buildCompletedRecords(items, events), [items, events]);
  const dailyUsage = useMemo(() => buildDailyUsage(completedRecords, selectedDay), [completedRecords, selectedDay]);
  const selectedRecords = completedRecords.filter((record) => localDateKey(new Date(record.completedAt)) === selectedDay);
  const selectedLabel = formatDayLabel(selectedDay);

  return (
    <motion.section className="stack-view" aria-label="任务" {...pageMotion}>
      <div className="page-title task-title">
        <div>
          <p className="kicker">任务</p>
          <h1>
            {taskPage === "radar"
              ? activeItems.length
                ? "任务雷达"
                : "还没有动作"
              : taskPage === "quadrants"
                ? "四象限"
                : "已完成记录"}
          </h1>
        </div>
        <div className="task-tabs" role="radiogroup" aria-label="任务视图">
          <button
            type="button"
            role="radio"
            aria-checked={taskPage === "radar"}
            className={taskPage === "radar" ? "active" : ""}
            onClick={() => setTaskPage("radar")}
          >
            雷达
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={taskPage === "quadrants"}
            className={taskPage === "quadrants" ? "active" : ""}
            onClick={() => setTaskPage("quadrants")}
          >
            四象限
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={taskPage === "history"}
            className={taskPage === "history" ? "active" : ""}
            onClick={() => setTaskPage("history")}
          >
            已完成
          </button>
        </div>
      </div>

      {taskPage === "radar" ? (
        activeItems.length ? (
          <div className="radar-board" aria-label="任务雷达">
            {radarGroups.filter((group) => group.items.length).map((group) => (
              <section className="radar-section glass-panel" key={group.key}>
                <div className="radar-header">
                  <div>
                    <p>{group.note}</p>
                    <h2>{group.title}</h2>
                  </div>
                  <span>{group.items.length}</span>
                </div>
                <div className="radar-items">
                  {group.items.map((item) => (
                    <TaskRow
                      archive={archive}
                      compact
                      item={item}
                      key={item.id}
                      mark={mark}
                      reduceMotion={reduceMotion}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-panel glass-panel">
            <p>先添加一个足够小的下一步。</p>
            <button type="button" onClick={() => setView("want")}>
              <Plus size={18} aria-hidden="true" />
              我想做什么
            </button>
          </div>
        )
      ) : taskPage === "quadrants" ? (
        activeItems.length ? (
          <div className="quadrant-board" aria-label="紧急重要四象限">
            {(Object.keys(quadrantLabels) as QuadrantKey[]).map((key) => (
              <section className={`quadrant-panel ${key}`} key={key}>
                <div className="quadrant-header">
                  <div>
                    <p>{quadrantLabels[key].note}</p>
                    <h2>{quadrantLabels[key].title}</h2>
                  </div>
                  <span>{quadrants[key].length}</span>
                </div>
                {quadrants[key].length ? (
                  <div className="quadrant-items">
                    {quadrants[key].map((item) => (
                      <TaskRow archive={archive} item={item} key={item.id} mark={mark} reduceMotion={reduceMotion} />
                    ))}
                  </div>
                ) : (
                  <p className="quadrant-empty">空</p>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-panel glass-panel">
            <p>先添加一个足够小的下一步。</p>
            <button type="button" onClick={() => setView("want")}>
              <Plus size={18} aria-hidden="true" />
              我想做什么
            </button>
          </div>
        )
      ) : (
        <div className="history-panel glass-panel">
          <div className="history-summary">
            <div>
              <p className="history-label">默认今日已完成</p>
              <h2>{selectedLabel}</h2>
            </div>
            <p>{selectedRecords.length} 项</p>
          </div>
          <div className="usage-chart" aria-label="每日使用情况">
            {dailyUsage.map((day) => (
              <button
                type="button"
                className={day.key === selectedDay ? "usage-day active" : "usage-day"}
                key={day.key}
                onClick={() => setSelectedDay(day.key)}
              >
                <span className="usage-track">
                  <span style={{ height: `${day.height}%` }} />
                </span>
                <span className="usage-date">{day.shortLabel}</span>
                <span className="usage-minutes">{day.minutes ? `${day.minutes}m` : `${day.count}项`}</span>
              </button>
            ))}
          </div>
          {selectedRecords.length ? (
            <div className="completed-list">
              {selectedRecords.map((record) => (
                <article className="completed-row" key={record.eventId}>
                  <div>
                    <h3>{record.title}</h3>
                    <p>{formatClock(record.completedAt)}</p>
                  </div>
                  <span>{record.minutes ? `${record.minutes} 分钟` : "未记录时长"}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="history-empty">
              <p>这一天还没有完成记录。</p>
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}

function TaskRow({
  archive,
  compact = false,
  item,
  mark,
  reduceMotion
}: {
  archive: (itemId: string) => void;
  compact?: boolean;
  item: ActionItem;
  mark: (itemId: string, type: "completed" | "snoozed" | "skipped") => void;
  reduceMotion: boolean;
}) {
  return (
    <motion.article className={compact ? "task-row compact" : "task-row"} key={item.id} whileHover={reduceMotion ? undefined : { y: -3 }}>
      <div>
        <h3>{item.title}</h3>
        <ItemMeta compact={compact} item={item} />
      </div>
      <div className="compact-actions">
        <button type="button" aria-label={`完成：${item.title}`} onClick={() => mark(item.id, "completed")} title="完成">
          <Check size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label={`归档：${item.title}`} onClick={() => archive(item.id)} title="归档">
          <Archive size={16} aria-hidden="true" />
        </button>
      </div>
    </motion.article>
  );
}

function groupByQuadrant(items: ActionItem[]) {
  const groups: Record<QuadrantKey, ActionItem[]> = {
    importantUrgent: [],
    importantNotUrgent: [],
    notImportantUrgent: [],
    notImportantNotUrgent: []
  };

  for (const item of [...items].sort((a, b) => b.importance + b.urgency - (a.importance + a.urgency))) {
    groups[getQuadrantKey(item)].push(item);
  }

  return groups;
}

function getQuadrantKey(item: ActionItem): QuadrantKey {
  const important = item.importance >= 4;
  const urgent = item.urgency >= 4;
  if (important && urgent) return "importantUrgent";
  if (important) return "importantNotUrgent";
  if (urgent) return "notImportantUrgent";
  return "notImportantNotUrgent";
}

type RadarGroup = {
  items: ActionItem[];
  key: "now" | "today" | "later" | "quiet";
  note: string;
  title: string;
};

function buildRadarGroups(items: ActionItem[], now: Date): RadarGroup[] {
  const groups: RadarGroup[] = [
    { key: "now", title: "现在最该处理", note: "高优先级或已经到点", items: [] },
    { key: "today", title: "今天需要推进", note: "适合今日安排", items: [] },
    { key: "later", title: "有时间再清理", note: "低摩擦，可顺手做", items: [] },
    { key: "quiet", title: "暂不打扰", note: "不适合当前时段", items: [] }
  ];

  for (const item of [...items].sort((a, b) => radarRank(now, b) - radarRank(now, a))) {
    groups[getRadarGroupIndex(now, item)].items.push(item);
  }

  return groups;
}

function getRadarGroupIndex(now: Date, item: ActionItem) {
  const hours = item.time ? (new Date(item.time).getTime() - now.getTime()) / 36e5 : undefined;
  const preferredMismatch =
    item.preferredWindow && item.preferredWindow !== "any" && item.preferredWindow !== currentWindowLabel(now);

  if (preferredMismatch && (hours === undefined || hours > 2)) return 3;
  if (item.importance >= 4 || item.urgency >= 4 || (hours !== undefined && hours <= 2)) return 0;
  if ((hours !== undefined && hours <= 24) || item.sourceType === "longTerm") return 1;
  if (item.estimatedMinutes <= 25 || item.energyLevel === "low") return 2;
  return 3;
}

function radarRank(now: Date, item: ActionItem) {
  const hours = item.time ? (new Date(item.time).getTime() - now.getTime()) / 36e5 : 72;
  return item.importance * 22 + item.urgency * 14 + Math.max(0, 24 - hours) + Math.max(0, 30 - item.estimatedMinutes);
}

function currentWindowLabel(now: Date): NonNullable<ActionItem["preferredWindow"]> {
  const hour = now.getHours();
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

type CompletedRecord = {
  completedAt: string;
  eventId: string;
  itemId: string;
  minutes: number;
  title: string;
};

function buildCompletedRecords(items: ActionItem[], events: ActionEvent[]): CompletedRecord[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return events
    .filter((event) => event.type === "completed")
    .map((event) => {
      const item = itemById.get(event.itemId);
      return {
        completedAt: event.createdAt,
        eventId: event.id,
        itemId: event.itemId,
        minutes: event.durationMs ? Math.max(1, Math.round(event.durationMs / 60000)) : 0,
        title: item?.title ?? "已完成事项"
      };
    })
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
}

function buildDailyUsage(records: CompletedRecord[], selectedDay: string) {
  const today = new Date();
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (13 - index));
    return date;
  });
  const usage = days.map((date) => {
    const key = localDateKey(date);
    const dayRecords = records.filter((record) => localDateKey(new Date(record.completedAt)) === key);
    return {
      count: dayRecords.length,
      key,
      minutes: dayRecords.reduce((sum, record) => sum + record.minutes, 0),
      shortLabel: `${date.getMonth() + 1}/${date.getDate()}`
    };
  });
  const maxMinutes = Math.max(1, ...usage.map((day) => day.minutes || day.count * 5));
  return usage.map((day) => ({
    ...day,
    height: Math.max(day.key === selectedDay || day.count ? 12 : 4, ((day.minutes || day.count * 5) / maxMinutes) * 100)
  }));
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = localDateKey(new Date());
  return key === today
    ? "今日已完成"
    : new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(date);
}

function formatClock(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function taskDraftFromAiDraft(draft: AiImportDraft): TaskEntryDraft {
  if (draft.kind === "longTerm") {
    return {
      ...initialTaskDraft(),
      goalTitle: draft.goalTitle || draft.content,
      kind: "longTerm",
      steps: (draft.steps?.length ? draft.steps : [{ content: draft.content, duration: draft.duration, importance: draft.importance, schedule: draft.schedule }]).map(
        (step) => ({
          cadence: "daily",
          content: step.content,
          duration: step.duration || "",
          id: createId("step"),
          importance: step.importance,
          schedule: step.schedule || "",
          weekdays: [new Date().getDay()]
        })
      )
    };
  }

  return {
    ...initialTaskDraft(),
    content: draft.content,
    duration: draft.duration || "",
    importance: draft.importance,
    kind: draft.kind,
    schedule: draft.schedule || ""
  };
}

function getImportProvider(model: string) {
  const provider = model.split(":")[0];
  return provider || "unknown";
}

function NavButton({
  active,
  icon,
  label,
  onClick,
  reduceMotion
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  reduceMotion: boolean;
}) {
  return (
    <motion.button
      className={active ? "nav-button active" : "nav-button"}
      type="button"
      onClick={onClick}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

function ItemMeta({ compact = false, item }: { compact?: boolean; item: ActionItem }) {
  const timeMeta = item.time ? formatRelativeTaskTime(item.time) : item.preferredWindow && item.preferredWindow !== "any" ? windowLabels[item.preferredWindow] : undefined;
  const compactMeta = [timeMeta, item.durationText, sourceLabels[item.sourceType]].filter((meta): meta is string => Boolean(meta));
  const fullMeta = [
    sourceLabels[item.sourceType],
    item.durationText,
    `精力 ${energyLabels[item.energyLevel]}`,
    `重要 ${item.importance}`,
    `紧急 ${item.urgency}`
  ].filter((meta): meta is string => Boolean(meta));

  if (compact) {
    return (
      <div className="meta">
        {compactMeta.map((meta) => (
          <span key={meta}>{meta}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="meta">
      {fullMeta.map((meta) => (
        <span key={meta}>{meta}</span>
      ))}
    </div>
  );
}

function formatRelativeTaskTime(iso: string) {
  const date = new Date(iso);
  const today = localDateKey(new Date());
  const key = localDateKey(date);
  const clock = formatClock(iso);
  if (key === today) return `今天 ${clock}`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
