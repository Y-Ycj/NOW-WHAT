import type { ActionItem } from "./types";

type ParsedTaskInput = {
  title: string;
  time?: string;
  preferredWindow?: ActionItem["preferredWindow"];
  estimatedMinutes?: number;
};

const chineseNumbers: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12
};

const windowWords: Record<string, NonNullable<ActionItem["preferredWindow"]>> = {
  早上: "morning",
  上午: "morning",
  中午: "afternoon",
  下午: "afternoon",
  傍晚: "evening",
  晚上: "evening",
  今晚: "evening",
  夜里: "night",
  深夜: "night"
};

const fillerPatterns = [
  /^(我想|我要|我需要|帮我|帮忙|记得|提醒我|安排一下|安排|待会儿?|等会儿?|可以的话|麻烦)?/u,
  /(这件事|这个任务)$/u
];

export function parseTaskInput(input: string, now = new Date()): ParsedTaskInput {
  const normalized = input.replace(/[，。！？、]/g, " ").replace(/\s+/g, " ").trim();
  const estimatedMinutes = parseDuration(normalized);
  const timeInfo = parseTime(normalized, now);
  const title = compactTitle(removeTimeFragments(normalized, timeInfo?.matchedText, estimatedMinutes?.matchedText));

  return {
    title: title || normalized,
    time: timeInfo?.time,
    preferredWindow: timeInfo?.preferredWindow,
    estimatedMinutes: estimatedMinutes?.minutes
  };
}

function parseDuration(text: string) {
  const match = text.match(/(\d{1,3})\s*(分钟|分|小时|h|H)/u);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const minutes = /小时|h|H/u.test(match[2]) ? amount * 60 : amount;
  return { minutes: Math.min(180, Math.max(5, minutes)), matchedText: match[0] };
}

function parseTime(text: string, now: Date) {
  const dateOffset = text.includes("后天") ? 2 : text.includes("明天") ? 1 : 0;
  const windowMatch = text.match(/(今晚|早上|上午|中午|下午|傍晚|晚上|夜里|深夜)/u);
  const dateMatch = text.match(/(今天|明天|后天)/u);
  const preferredWindow = windowMatch ? windowWords[windowMatch[1]] : undefined;
  const timeMatch = text.match(
    /(今天|明天|后天|今晚)?\s*(早上|上午|中午|下午|傍晚|晚上|夜里|深夜)?\s*([0-2]?\d|[一二两三四五六七八九十]{1,2})\s*[点:：时]\s*([0-5]?\d)?\s*分?/u
  );

  if (!timeMatch && preferredWindow) {
    return {
      preferredWindow,
      matchedText: `${dateMatch?.[0] ?? ""}${windowMatch?.[0] ?? ""}`
    };
  }

  if (!timeMatch) return undefined;

  const windowWord = timeMatch[2] || (timeMatch[1] === "今晚" ? "今晚" : windowMatch?.[1]);
  const windowFromTime = windowWord ? windowWords[windowWord] : preferredWindow;
  const hourValue = parseHour(timeMatch[3]);
  if (hourValue === undefined) {
    return {
      preferredWindow: windowFromTime,
      matchedText: timeMatch[0]
    };
  }

  const date = new Date(now);
  date.setSeconds(0, 0);
  date.setDate(date.getDate() + dateOffset);
  date.setHours(adjustHour(hourValue, windowWord), Number(timeMatch[4] || 0), 0, 0);

  return {
    time: date.toISOString(),
    preferredWindow: windowFromTime || inferWindow(date.getHours()),
    matchedText: timeMatch[0]
  };
}

function parseHour(value: string) {
  if (/^\d+$/u.test(value)) return Number(value);
  return chineseNumbers[value];
}

function adjustHour(hour: number, windowWord?: string) {
  if ((windowWord === "下午" || windowWord === "傍晚" || windowWord === "晚上" || windowWord === "今晚") && hour < 12) {
    return hour + 12;
  }
  if ((windowWord === "夜里" || windowWord === "深夜") && hour === 12) return 0;
  return hour;
}

function inferWindow(hour: number): NonNullable<ActionItem["preferredWindow"]> {
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

function removeTimeFragments(text: string, timeText?: string, durationText?: string) {
  let result = text;
  for (const fragment of [durationText, timeText]) {
    if (fragment) result = result.replace(fragment, " ");
  }
  return result;
}

function compactTitle(text: string) {
  return fillerPatterns
    .reduce((result, pattern) => result.replace(pattern, ""), text)
    .replace(/(今天|明天|后天|今晚|早上|上午|中午|下午|傍晚|晚上|夜里|深夜|每天|每日|每周)/gu, "")
    .replace(/([0-2]?\d|[一二两三四五六七八九十]{1,2})\s*[点:：时]\s*([0-5]?\d)?\s*分?/gu, "")
    .replace(/^(要|去|把|将|给)\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}
