export type SourceType = "oneOff" | "routine" | "longTerm";
export type EnergyLevel = "low" | "medium" | "high";
export type ActionStatus = "active" | "completed" | "archived";
export type ActionEventType = "started" | "completed" | "snoozed" | "skipped";
export type RecurrenceFrequency = "once" | "daily" | "weekly";

export interface ActionItem {
  id: string;
  title: string;
  sourceType: SourceType;
  importance: number;
  urgency: number;
  time?: string;
  scheduleText?: string;
  recurrence?: {
    frequency: RecurrenceFrequency;
    weekdays?: number[];
  };
  preferredWindow?: "morning" | "afternoon" | "evening" | "night" | "any";
  estimatedMinutes: number;
  durationText?: string;
  energyLevel: EnergyLevel;
  status: ActionStatus;
  createdAt: string;
  updatedAt: string;
  sourceId?: string;
}

export interface OneOffTask {
  id: string;
  actionItemId: string;
  title: string;
  dueAt?: string;
}

export interface RoutineTask {
  id: string;
  actionItemId: string;
  title: string;
  cadence: "daily" | "weekly";
  weekdays?: number[];
  preferredWindow: ActionItem["preferredWindow"];
}

export interface LongTermGoal {
  id: string;
  title: string;
  why: string;
  field: string;
  nextActionId?: string;
  nextActionIds?: string[];
  createdAt: string;
}

export interface ActionEvent {
  id: string;
  itemId: string;
  type: ActionEventType;
  createdAt: string;
  durationMs?: number;
  reason?: "notEnoughTime" | "wrongLocation" | "missingDevice" | "tooMuchEnergy" | "notNow";
}

export interface AppState {
  schemaVersion: 1;
  items: ActionItem[];
  oneOffTasks: OneOffTask[];
  routineTasks: RoutineTask[];
  longTermGoals: LongTermGoal[];
  events: ActionEvent[];
}

export interface Recommendation {
  primary?: ActionItem;
  secondary?: ActionItem;
  reason?: string;
}

export interface GoalRefinementInput {
  title: string;
  why: string;
  field: string;
  firstStep: string;
  preferredWindow: ActionItem["preferredWindow"];
  estimatedMinutes: number;
  energyLevel: EnergyLevel;
  importance: number;
}

export interface GoalRefinementProvider {
  refine(input: GoalRefinementInput): ActionItem;
}
