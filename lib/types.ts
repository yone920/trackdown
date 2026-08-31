// The shapes the backend actually returns, written out once so every screen reads the
// same names. Mirrors backend/src/services/{day,goals,readings,fusion}/** — when one of
// those changes, this file is the other half of the change (docs/agent-brief.md).

export type IsoDate = string;

export type DayStatus = 'on_track' | 'over' | 'under' | 'none';
export type Verdict = 'served' | 'missed' | 'unlogged' | 'none';
export type ActivitySource = 'manual' | 'fused' | 'health';
export type ActivityCategory = 'cardio' | 'strength' | 'mobility' | 'other';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type Confidence = 'low' | 'medium' | 'high';

export type GoalKind =
  | 'lose_fat'
  | 'gain_muscle'
  | 'build_strength'
  | 'improve_endurance'
  | 'maintain'
  | 'custom';

export type GoalMetric = {
  measure: string;
  scope?: string | null;
  target?: number | null;
  unit?: string | null;
  direction?: 'decrease' | 'increase' | 'maintain' | 'at_least' | 'at_most' | null;
  rate?: string | null;
  by?: IsoDate | null;
};

export type GoalRow = {
  id: string;
  kind: GoalKind;
  title: string;
  metrics: GoalMetric[];
  priority: number;
  status: string;
  active_from: IsoDate;
  active_to: IsoDate | null;
};

export type MetricProgress = {
  measure: string;
  label: string;
  scope: string | null;
  unit: string | null;
  direction: string | null;
  target: number | null;
  current: number | null;
  baseline: number | null;
  percent: number | null;
  series: { date: IsoDate; value: number }[];
};

export type GoalProgress = {
  goal_id: string;
  percent: number | null;
  metrics: MetricProgress[];
  detection?: unknown;
};

export type GoalRecord = GoalRow & {
  stated_at: string;
  reached_candidate_at: string | null;
  stalled_since: IsoDate | null;
  created_at: string;
};

export type GoalWithProgress = GoalRecord & { progress: GoalProgress };

export type GoalsView = {
  active: GoalWithProgress[];
  history: (GoalRecord & { outcome: string })[];
  no_goal: boolean;
};

export type DeltaVsLast = {
  text: string;
  direction: 'up' | 'down' | 'same' | 'new';
  field: 'load_lb' | 'sets' | 'reps' | 'duration_min' | 'distance_mi' | null;
  load_lb: number | null;
  sets: number | null;
  reps: number | null;
  previous: {
    logged_at: string;
    load_lb: number | null;
    sets: number | null;
    reps: number | null;
  } | null;
};

export type EvidencePhoto = {
  id: string;
  kind: string;
  mime: string | null;
  width: number | null;
  height: number | null;
};

export type DayActivity = {
  id: string | null;
  logged_at: string;
  description: string;
  exercise: string | null;
  category: ActivityCategory | null;
  muscle_groups: string[];
  sets: number | null;
  reps: number | null;
  load_lb: number | null;
  duration_min: number | null;
  distance_mi: number | null;
  kcal: number;
  source: ActivitySource;
  confidence: Confidence | null;
  block_id: string | null;
  delta_vs_last: DeltaVsLast | null;
  /** Photos logged with this row; the bytes come from GET /api/evidence/:id. */
  evidence: EvidencePhoto[];
};

export type DayMeal = {
  id: string;
  logged_at: string;
  description: string;
  slot: MealSlot;
  stated_slot: MealSlot | null;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  evidence: EvidencePhoto[];
};

export type DayWeightRow = {
  id: string | null;
  logged_at: string;
  weight_lb: number;
  source: 'manual' | 'health';
};

export type Block = {
  id: string;
  title: string;
  start: string;
  end: string;
  minutes: number;
  kcal: number;
  kcal_from_health: boolean;
  exercise_count: number;
  activity_ids: string[];
  muscle_groups: string[];
  category: ActivityCategory;
  health: unknown | null;
};

export type ArcEvent = {
  kind: 'meal' | 'activity' | 'weight' | 'block' | 'now' | 'expected';
  label: string;
  at: number;
  until?: number;
  instant: string;
  kcal?: number;
};

export type ExpectedItem = {
  kind: 'meal' | 'weigh_in';
  slot?: MealSlot;
  label: string;
  at_minutes: number;
};

export type MacroLine = {
  eaten: number | null;
  target: number | null;
  note: 'under' | 'over' | 'on target' | null;
};

export type ActionKind = 'log_meal' | 'weigh_in' | 'coach' | 'workout';

export type ReadingAction = { label: string; kind: ActionKind };

export type Reading = {
  kind: 'right_now' | 'in_short';
  text: string;
  next_action: (ReadingAction & { hint?: string | null }) | null;
  actions: ReadingAction[];
  inputs_hash: string;
  model: string | null;
  created_at: string;
};

export type MuscleSummary = { muscle: string; sets: number; exercises: string[] };

/** GET /api/day/:date */
export type DayView = {
  date: IsoDate;
  tz_offset_min: number;
  is_today: boolean;
  closed_at: string | null;
  day_number: number;
  items: { meals: DayMeal[]; activities: DayActivity[]; weights: DayWeightRow[] };
  blocks: Block[];
  eaten: number;
  earned: number;
  target: number | null;
  allowance: number | null;
  remaining: number | null;
  eatback: 'none' | 'half' | 'all';
  tdee: number | null;
  balance: number | null;
  status: DayStatus;
  over_by: number | null;
  macros: { protein_g: MacroLine; carbs_g: MacroLine; fat_g: MacroLine; fiber_g: MacroLine };
  weight: { day: number | null; avg_7d: number | null; trend_per_week: number | null };
  muscle_groups: string[];
  muscle_summary: MuscleSummary[];
  health: { active_energy: number | null; steps: number | null };
  eating_pattern: string | null;
  arc: ArcEvent[];
  expected: ExpectedItem[];
  verdict: Verdict;
  verdict_words: string;
  verdict_why: string;
  goal: GoalRow | null;
  goal_involves_calories: boolean;
  summary_line: string;
  /** The live day's reading, or the closed day's. Null when no model could be reached. */
  reading: Reading | null;
  coach: CoachBrief | null;
  /** True once anything counting as today's workout has been logged. */
  workout_done?: boolean;
};

/** GET /api/week and GET /api/days rows. */
export type DayRow = {
  date: IsoDate;
  day_number: number;
  is_today: boolean;
  closed: boolean;
  status: DayStatus;
  verdict: Verdict;
  verdict_words: string;
  summary: string;
  in_short: string | null;
  eaten: number | null;
  earned: number | null;
  allowance: number | null;
  balance: number | null;
  weight_lb: number | null;
  muscle_groups: string[];
};

export type WeekView = {
  end: IsoDate;
  start: IsoDate;
  days: DayRow[];
  weekly_deficit: number | null;
  served: number;
  judged: number;
};

export type DaysView = { days: DayRow[]; next_before: IsoDate | null };

// ---------------------------------------------------------------------------
// The log, as recorded (GET /api/day/:date/log — backend/src/services/dayLog.ts)
// ---------------------------------------------------------------------------

export type DayLogKind = 'activity' | 'meal' | 'weight' | 'goal' | 'statement';
export type DayLogIcon = 'camera' | 'mic' | 'keyboard' | 'heart';

export type DayLogEvidence = {
  id: string;
  kind: 'photo' | 'transcript' | 'text';
  text: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
};

export type DayLogRecord =
  | {
      kind: 'activity';
      description: string;
      exercise: string | null;
      category: ActivityCategory | null;
      muscle_groups: string[];
      sets: number | null;
      reps: number | null;
      load_lb: number | null;
      duration_min: number | null;
      distance_mi: number | null;
      kcal: number;
    }
  | {
      kind: 'meal';
      description: string;
      meal_type: MealSlot | null;
      kcal: number;
      protein_g: number | null;
      carbs_g: number | null;
      fat_g: number | null;
      fiber_g: number | null;
    }
  | { kind: 'weight'; weight_lb: number }
  | { kind: 'goal'; title: string; goal_kind: GoalKind; metrics: GoalMetric[] }
  | { kind: 'statement'; text: string };

export type DayLogEntry = {
  /** The saved row's id — what a correction PATCHes. A statement carries its evidence id. */
  id: string;
  kind: DayLogKind;
  logged_at: string;
  raw_text: string | null;
  icon: DayLogIcon;
  evidence: DayLogEvidence[];
  source: ActivitySource | null;
  confidence: Confidence | null;
  understood: string;
  editable: boolean;
  record: DayLogRecord;
};

export type DayLogView = {
  date: IsoDate;
  tz_offset_min: number;
  entries: DayLogEntry[];
};

export type CoachBrief = {
  id?: string;
  date?: IsoDate;
  /** When the user asked — the Coach screen's "asked at" line. */
  asked_at?: string;
  /** What they said when asking, plus the day's saved coach-context statements. */
  context?: string | null;
  model?: string | null;
  /** True when this answer came back from the day's cache rather than the model. */
  cached?: boolean;
  headline?: string;
  why?: string;
  workout?: {
    type?: string;
    targets?: string[];
    exercises?: {
      name: string;
      load_lb: number | null;
      sets: number | null;
      reps: number | null;
      minutes?: number | null;
      note?: string | null;
    }[];
  } | null;
  nutrition?: {
    kcal: number | null;
    protein_g: number | null;
    carbs_max_g: number | null;
    ideas?: string[];
    why?: string | null;
  } | null;
  nudge?: string | null;
  nudge_action?: { kind: string; goal_id?: string | null; label?: string } | null;
};

export type CoachNext = {
  brief: CoachBrief;
  stale: boolean;
  gap: unknown;
  nudge_action: CoachBrief['nudge_action'];
  goals: { id: string; title: string; priority: number }[];
};

/** GET /api/profile — the row, plus what it works out to (backend services/profile.ts). */
export type ProfileTargets = {
  tdee: number | null;
  eat_target: number | null;
  deficit: number | null;
  safe_floor: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  source: 'computed' | 'stated' | 'none';
  tracking_only: boolean;
  eatback: string;
  weight_lb: number | null;
  date: IsoDate;
};

export type Profile = Record<string, unknown> & {
  id: string;
  display_name: string | null;
  units: 'imperial' | 'metric';
  training_days?: number | null;
  diet_style?: string | null;
  constraints?: string[] | null;
  preferences?: string[] | null;
  targets: ProfileTargets;
};

// ---------------------------------------------------------------------------
// The log pipeline (backend/src/services/fusion/schema.ts)
// ---------------------------------------------------------------------------

export type FieldSource = 'photo' | 'text' | null;

export type ActivityItem = {
  exercise: string | null;
  description: string;
  category: ActivityCategory | null;
  muscle_groups: string[] | null;
  sets: number | null;
  reps: number | null;
  load_lb: number | null;
  duration_min: number | null;
  distance_mi: number | null;
  kcal: number | null;
  confidence: Confidence;
  sources: Record<string, FieldSource> | null;
};

export type MealItem = {
  name: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  serving_amount: string | null;
};

export type ProposedTimeline = {
  by: IsoDate | null;
  rate: string | null;
  note: string | null;
  realistic: boolean | null;
};

export type GoalSpec = {
  kind: GoalKind;
  title: string;
  metrics: GoalMetric[];
  active_from: IsoDate | null;
  active_to: IsoDate | null;
};

/**
 * Facts the user stated in the same breath as a goal ("I'm 212, I train 4 days a week at
 * the gym, I'm 45"). The server saves each where it belongs — the weight as a weigh-in, the
 * rest on the profile — so the card only has to show what it noted. Optional: a goal typed
 * into the Goals screen states nothing alongside itself.
 */
export type GoalFacts = {
  current_weight_lb: number | null;
  training_days: number | null;
  environment: 'gym' | 'home' | null;
  age_years: number | null;
};

export type ProfileFields = {
  diet_style: string | null;
  protein_g: number | null;
  carbs_max_g: number | null;
  training_days: number | null;
  environment: string | null;
  equipment: string[] | null;
  eatback: 'none' | 'half' | 'all' | null;
} | null;

export type FusionResult =
  | { kind: 'activities'; items: ActivityItem[] }
  | {
      kind: 'meal';
      description: string;
      meal_type: MealSlot | null;
      kcal: number | null;
      protein_g: number | null;
      carbs_g: number | null;
      fat_g: number | null;
      fiber_g: number | null;
      items: MealItem[];
      confidence: Confidence;
      sources: Record<string, FieldSource> | null;
    }
  | { kind: 'weight'; weight_lb: number; confidence: Confidence; sources: Record<string, FieldSource> | null }
  | { kind: 'goal'; spec: GoalSpec; proposed_timeline: ProposedTimeline | null; facts?: GoalFacts | null }
  | { kind: 'constraint'; text: string; fields: ProfileFields }
  | { kind: 'preference'; text: string; fields: ProfileFields }
  | { kind: 'coach_context'; text: string }
  | { kind: 'unclear'; question: string };

export type FusionKind = FusionResult['kind'];

export type EvidenceRef = {
  id: string;
  kind: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  url: string;
  /**
   * Which of `results` this photo was read for — the plate to the meal, the machine to the
   * exercise. Sent back on confirm as `evidence_parts` so the link is kept.
   */
  part?: number;
};

/**
 * POST /api/log/analyze
 *
 * `results` is the answer: one entry per thing the user said, in the order they said it,
 * because one sentence can be a meal and a run and a weigh-in at once. `result` is the same
 * thing for a single-part log and is absent when there are several — it is there for one
 * release, for a client written before mixed input existed.
 */
export type AnalyzeResponse = {
  results: FusionResult[];
  result?: FusionResult;
  proposal?: {
    projected_date: IsoDate | null;
    weeks: number | null;
    rate: string | null;
    note: string;
    by: IsoDate | null;
    unrealistic: boolean;
    standing: boolean;
  };
  evidence: EvidenceRef[];
  context: { local_date: IsoDate; tz_offset_min: number };
};

/** What one part of a confirm became — the ids, in the order the parts were sent. */
export type SavedPart = {
  kind: FusionKind;
  activity_ids: string[];
  meal_id: string | null;
  weight_id: string | null;
  goal_id: string | null;
  evidence_ids: string[];
};

/** POST /api/log/confirm */
export type ConfirmResponse = {
  /** The first part's kind; `kinds` is the whole answer. */
  kind: FusionKind;
  kinds: FusionKind[];
  parts: SavedPart[];
  activities: Record<string, unknown>[];
  /** The first meal saved; `meals` holds them all. Same for `weight` / `weights`. */
  meal: Record<string, unknown> | null;
  meals: Record<string, unknown>[];
  meal_items: Record<string, unknown>[];
  weight: Record<string, unknown> | null;
  weights: Record<string, unknown>[];
  goal: Record<string, unknown> | null;
  goal_proposal: unknown | null;
  profile: Record<string, unknown> | null;
  coach_context: { date: string; text: string } | null;
  evidence: Record<string, unknown>[];
  replayed: boolean;
};
