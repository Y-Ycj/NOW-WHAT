import type { ActionEvent, ActionItem, EnergyLevel, Recommendation } from "./types";

const ENERGY_WEIGHT: Record<EnergyLevel, number> = {
  low: 8,
  medium: 4,
  high: 0
};

function hoursUntil(now: Date, iso?: string) {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (new Date(iso).getTime() - now.getTime()) / 36e5;
}

function recentEvents(events: ActionEvent[], itemId: string, now: Date, days: number) {
  const since = now.getTime() - days * 24 * 36e5;
  return events.filter((event) => event.itemId === itemId && new Date(event.createdAt).getTime() >= since);
}

function lastEventTime(events: ActionEvent[], itemId: string) {
  return events
    .filter((event) => event.itemId === itemId)
    .map((event) => new Date(event.createdAt).getTime())
    .sort((a, b) => b - a)[0];
}

function timeScore(now: Date, item: ActionItem) {
  const hours = hoursUntil(now, item.time);
  if (hours < -24) return -35;
  if (hours < 0) return 16;
  if (hours <= 2) return 38;
  if (hours <= 8) return 30;
  if (hours <= 24) return 22;
  if (hours <= 72) return 12;
  return 0;
}

function windowScore(now: Date, item: ActionItem) {
  if (!item.preferredWindow || item.preferredWindow === "any") return 0;
  const current = currentWindow(now);
  return current === item.preferredWindow ? 12 : -4;
}

function recurrenceScore(now: Date, item: ActionItem) {
  if (!item.recurrence || item.recurrence.frequency === "once") return 0;
  if (item.recurrence?.frequency === "weekly") {
    return item.recurrence.weekdays?.includes(now.getDay()) ? 10 : -38;
  }
  return 4;
}

function currentWindow(now: Date): NonNullable<ActionItem["preferredWindow"]> {
  const hour = now.getHours();
  return hour < 11 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
}

export function scoreActionItem(now: Date, item: ActionItem, events: ActionEvent[]) {
  if (item.status !== "active") return Number.NEGATIVE_INFINITY;

  const recent = recentEvents(events, item.id, now, 7);
  const skipped = recent.filter((event) => event.type === "skipped").length;
  const snoozed = recent.filter((event) => event.type === "snoozed").length;
  const completed = recent.filter((event) => event.type === "completed").length;
  const cadenceDone = cadenceCompletionPenalty(now, item, events);
  const lastTime = lastEventTime(events, item.id);
  const daysIdle = lastTime ? Math.max(0, (now.getTime() - lastTime) / (24 * 36e5)) : 7;
  const longTermLift = item.sourceType === "longTerm" ? Math.min(22, daysIdle * 2.8) : 0;

  return (
    item.importance * 24 +
    item.urgency * 16 +
    timeScore(now, item) +
    windowScore(now, item) +
    recurrenceScore(now, item) +
    ENERGY_WEIGHT[item.energyLevel] +
    Math.max(0, 18 - item.estimatedMinutes / 5) +
    longTermLift -
    skipped * 15 -
    snoozed * 8 -
    completed * 10 -
    cadenceDone
  );
}

function cadenceCompletionPenalty(now: Date, item: ActionItem, events: ActionEvent[]) {
  if (!item.recurrence || item.recurrence.frequency === "once") return 0;
  const completedEvents = events.filter((event) => event.itemId === item.id && event.type === "completed");
  if (!completedEvents.length) return 0;

  if (item.recurrence?.frequency === "weekly") {
    const weekStart = startOfWeek(now).getTime();
    const completedThisWeek = completedEvents.some((event) => new Date(event.createdAt).getTime() >= weekStart);
    return completedThisWeek ? 80 : 0;
  }

  const today = localDateKey(now);
  const completedToday = completedEvents.some((event) => localDateKey(new Date(event.createdAt)) === today);
  return completedToday ? 80 : 0;
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCurrentRecommendation(
  now: Date,
  items: ActionItem[],
  events: ActionEvent[]
): Recommendation {
  const ranked = items
    .map((item) => ({ item, score: scoreActionItem(now, item, events) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);

  const primary = ranked[0]?.item;
  const secondary =
    ranked[1] && ranked[0].score - ranked[1].score <= 12 && isGoodSecondary(now, ranked[1].item)
      ? ranked[1].item
      : undefined;

  return {
    primary,
    secondary,
    reason: primary ? buildReason(now, primary) : undefined
  };
}

function isGoodSecondary(now: Date, item: ActionItem) {
  if (item.preferredWindow && item.preferredWindow !== "any" && item.preferredWindow !== currentWindow(now)) {
    return false;
  }

  const hours = hoursUntil(now, item.time);
  if (Number.isFinite(hours) && hours > 2) return false;

  return true;
}

export function buildReason(now: Date, item: ActionItem) {
  const quadrant =
    item.importance >= 4 && item.urgency >= 4
      ? "重要且紧急"
      : item.importance >= 4
        ? "重要"
        : item.urgency >= 4
          ? "紧急"
          : "低摩擦";
  const hours = hoursUntil(now, item.time);
  const timeText =
    Number.isFinite(hours) && hours < 0
      ? "已经到点"
      : Number.isFinite(hours) && hours <= 24
        ? `${Math.max(1, Math.round(hours))} 小时内`
        : item.preferredWindow && item.preferredWindow !== "any"
          ? preferredWindowLabel(item.preferredWindow)
          : "现在可做";

  return [quadrant, timeText, item.durationText ? `预计 ${item.durationText}` : undefined].filter(Boolean).join("，");
}

function preferredWindowLabel(window: NonNullable<ActionItem["preferredWindow"]>) {
  const labels = {
    morning: "适合上午",
    afternoon: "适合下午",
    evening: "适合晚上",
    night: "适合深夜",
    any: "现在可做"
  };
  return labels[window];
}
