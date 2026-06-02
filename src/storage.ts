import type { ActionEvent, AppState } from "./types";

const STORAGE_KEY = "now-what-app-state";
const AI_CREDENTIALS_KEY = "now-what-ai-credentials";

export type StoredAiCredentials = {
  apiKey: string;
  model: string;
  savedAt: string;
};

export const emptyState: AppState = {
  schemaVersion: 1,
  items: [],
  oneOffTasks: [],
  routineTasks: [],
  longTermGoals: [],
  events: []
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.schemaVersion !== 1) return emptyState;
    return {
      ...emptyState,
      ...parsed,
      items: parsed.items ?? [],
      events: parsed.events ?? []
    };
  } catch {
    return emptyState;
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadAiCredentials(): StoredAiCredentials | undefined {
  try {
    const raw = localStorage.getItem(AI_CREDENTIALS_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredAiCredentials>;
    if (!parsed.apiKey || !parsed.model) return undefined;
    return {
      apiKey: parsed.apiKey,
      model: parsed.model,
      savedAt: parsed.savedAt || new Date().toISOString()
    };
  } catch {
    return undefined;
  }
}

export function saveAiCredentials(credentials: Omit<StoredAiCredentials, "savedAt">) {
  localStorage.setItem(
    AI_CREDENTIALS_KEY,
    JSON.stringify({
      ...credentials,
      savedAt: new Date().toISOString()
    })
  );
}

export function clearAiCredentials() {
  localStorage.removeItem(AI_CREDENTIALS_KEY);
}

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function createEvent(
  itemId: string,
  type: ActionEvent["type"],
  details: Pick<ActionEvent, "durationMs" | "reason"> = {}
): ActionEvent {
  return {
    id: createId("event"),
    itemId,
    type,
    createdAt: new Date().toISOString(),
    ...details
  };
}
