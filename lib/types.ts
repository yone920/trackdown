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
  /** Which way the number went. */
  direction: 'up' | 'down' | 'same' | 'new';
  /**
   * Whether that was progress. Not the same question as `direction`: on an assisted machine
   * the load is the help the machine gives, so "-5 lb" is five pounds less help and reads
   * green. Colour by this, never by `direction`. Optional so a row cached from an older
   * build still renders.
   */
  sentiment?: 'good' | 'watch' | 'neutral';
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
  /** The catalogue row the name resolved to; null makes the sheet name-only. */
  exercise_id: string | null;
  /** The machine it was done on, when they named one — drawn as the sub-line. */
  equipment: string | null;
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
  /** Part of `kcal` is a MET estimate: the lifts in the block reported none. Marked "est.". */
  kcal_estimated: boolean;
  exercise_count: number;
  activity_ids: string[];
  muscle_groups: string[];
  category: ActivityCategory;
  health: unknown | null;
};

export type ArcEvent = {
  kind: 'meal' | 'activity' | 'weight' | 'block' | 'now';
  label: string;
  at: number;
  until?: number;
  instant: string;
  kcal?: number;
};

/**
 * A slot today has nothing in yet. Nothing renders it — the app shows what was logged and
 * not what is owed (user decision 2026-08-31). It stays on the response because the
 * server's Right-now reading is written from it: what the day has not had is how the
 * reading knows a dinner is what would close the remaining targets.
 */
export type ExpectedItem = {
  kind: 'meal' | 'weigh_in';
  slot?: MealSlot;
  label: string;
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
      exercise_id: string | null;
      equipment: string | null;
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

/**
 * One told change, kept beside the record it changed (migration 0015). `changes` is the
 * field-level diff the server computed between what it had understood and what it
 * understood after being told — never something the app worked out for itself.
 */
export type FieldChange = { field: string; from: unknown; to: unknown };

export type DayLogCorrection = {
  id: string;
  instruction: string;
  changes: FieldChange[];
  created_at: string;
};

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
  /**
   * Oldest first. Empty for a record nobody has corrected, which is most of them, and
   * absent altogether from a server written before migration 0015.
   */
  corrections?: DayLogCorrection[];
  record: DayLogRecord;
};

export type DayLogView = {
  date: IsoDate;
  tz_offset_min: number;
  entries: DayLogEntry[];
};

/**
 * How much of a prescribed line has been done today. Computed server-side against the day's
 * log on every read, so the tick follows a correction or a delete without asking.
 */
export type ExerciseCompletion = {
  done: boolean;
  sets_done: number;
  sets_prescribed: number | null;
  partial: boolean;
};

export type BriefExercise = {
  name: string;
  /** Resolved server-side when the brief is returned, so the app never name-matches. */
  exercise_id?: string | null;
  load_lb: number | null;
  sets: number | null;
  reps: number | null;
  minutes?: number | null;
  note?: string | null;
  /** The one movement in this plan the user has never logged, when there is one. */
  is_new?: boolean;
  /** The local clock an appended item arrived at ("2:05p"); null for the plan's own lines. */
  added_at?: string | null;
  completion?: ExerciseCompletion;
};

export type NutritionNow = {
  remaining_kcal: number | null;
  eaten_kcal: number;
  allowance_kcal: number | null;
  remaining_protein_g: number | null;
  eaten_protein_g: number | null;
  protein_target_g: number | null;
  /** True once the day is past its allowance. One flat line, never a scolding. */
  past_target: boolean;
  line: string;
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
    exercises?: BriefExercise[];
    /** The short stretch / mobility close on a training day. Empty on a rest day. */
    finisher?: { name: string; minutes?: number | null; note?: string | null }[];
    /** True when every line of a non-empty plan is done — the "Plan complete" state. */
    complete?: boolean;
  } | null;
  nutrition?: {
    kcal: number | null;
    protein_g: number | null;
    carbs_max_g: number | null;
    ideas?: string[];
    why?: string | null;
  } | null;
  /**
   * What is LEFT of the day, computed by the server on every read (never stored). The Eat
   * card draws these; `nutrition` above is the day's target and does not move.
   */
  nutrition_now?: NutritionNow | null;
  nudge?: string | null;
  nudge_action?: { kind: string; goal_id?: string | null; label?: string } | null;
};

/** GET /api/exercises/:id — everything the exercise sheet draws. */
export type ExerciseSheet = {
  id: string;
  name: string;
  aliases: string[];
  category: ActivityCategory;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string[];
  /** The numbered steps. Empty when the catalogue row has no illustration source. */
  instructions: string[];
  level: string | null;
  /** Paths under the API base; the bytes need the session's bearer token. */
  media: { index: number; url: string }[];
  source: { dataset: string; slug: string } | null;
};

/**
 * GET /api/coach/status — does today have a plan, and how far through is it. An
 * exists-check and nothing else: it never generates a brief, which is what lets Today's
 * button reflect the day's state without asking the coach a question on every open (user
 * decision 2026-08-31 §1).
 */
export type CoachStatus = {
  date: IsoDate;
  has_plan: boolean;
  headline: string | null;
  done_count: number;
  total_count: number;
  /** True when every line of a non-empty plan is done. */
  complete: boolean;
};

export type CoachNext = {
  /**
   * Null when nobody has asked today and the request said not to generate one — the page
   * load. Opening the Coach screen must never be what writes the day's advice.
   */
  brief: CoachBrief | null;
  stale: boolean;
  /**
   * One line saying why this is not the answer that was just asked for — set when the
   * server had to fall back to the day's previous brief. Null on a normal answer.
   */
  note?: string | null;
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
  /**
   * Where `eat_target` came from: derived from the TDEE inputs, stated by the user, the
   * `daily_calorie_target` column's own DEFAULT that nobody chose, or nothing at all
   * (backend services/tdee.ts §TargetSource).
   */
  source: 'derived' | 'stated' | 'default' | 'none';
  tracking_only: boolean;
  eatback: string;
  weight_lb: number | null;
  date: IsoDate;
};

/** Where they train now, and how much has been seen there (migration 0012). */
export type PlaceSummary = {
  id: string;
  name: string;
  kind: 'gym' | 'home' | 'travel' | 'other';
  equipment_count: number;
};

export type Profile = Record<string, unknown> & {
  id: string;
  display_name: string | null;
  units: 'imperial' | 'metric';
  training_days?: number | null;
  diet_style?: string | null;
  constraints?: string[] | null;
  preferences?: string[] | null;
  /** Null until they say where they train, which is most of the time. */
  place?: PlaceSummary | null;
  targets: ProfileTargets;
};

/**
 * GET /api/you — the dossier: two short paragraphs about this account, generated from the
 * plan, the goals and four weeks of what was actually logged
 * (backend services/readings/dossier.ts).
 *
 * It replaced the "How you train / How you eat" row groups on the You screen: a grid of
 * fields is a form with the inputs taken out, and the interesting half of a plan is the
 * part nobody has said yet. `missing` is that half, written as invitations.
 *
 * Null when there is nothing to say yet, or when the provider was unavailable — the page
 * renders without it, like every other generated line in this app.
 */
export type Dossier = {
  known: string;
  missing: string;
  model: string | null;
  created_at: string;
};

export type YouView = {
  date: IsoDate;
  dossier: Dossier | null;
};

// ---------------------------------------------------------------------------
// The log pipeline (backend/src/services/fusion/schema.ts)
// ---------------------------------------------------------------------------

export type FieldSource = 'photo' | 'text' | null;

/**
 * "Was it a Chest-Supported Row?" — the one-tap upgrade offered when the reader could only
 * paraphrase the movement. It is an offer and never a question: the record saves without it.
 */
export type Refinement = { question: string; exercise: string };

export type ActivityItem = {
  exercise: string | null;
  /** What it was done ON, when they named one: "cable stack", "chest-supported row machine". */
  equipment: string | null;
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
  refine?: Refinement | null;
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
  /** The gym they named, if they named one — migration 0012. */
  place_name?: string | null;
  place_kind?: 'gym' | 'home' | 'travel' | 'other' | null;
} | null;

/**
 * What the server's arithmetic gate made of a meal's numbers (backend
 * services/fusion/arithmetic.ts). Present only when the FIRST reading did not add up —
 * 4 × protein + 4 × carbs + 9 × fat against the kcal beside them.
 *
 *   "adjusted" — one automatic re-ask reconciled it.
 *   "flagged"  — it still does not add up; the confidence was forced to low.
 */
export type MealConsistency = {
  outcome: 'adjusted' | 'flagged';
  stated_kcal: number | null;
  implied_kcal: number | null;
};

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
      /** Null unless the server's arithmetic gate had something to say. */
      consistency?: MealConsistency | null;
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
/**
 * What a told change moved, as the server measured it. Handed back with the revised parts
 * and handed in again on the confirm, which writes it against the rows the parts become —
 * the only way a change made before anything is saved can end up in the record's history.
 */
export type PartCorrection = {
  part: number;
  /** Which item of an activities part; null for a meal or a weigh-in. */
  item: number | null;
  instruction: string;
  changes: FieldChange[];
};

export type AnalyzeResponse = {
  results: FusionResult[];
  result?: FusionResult;
  /** Empty for a fresh log; one entry per record a revision moved. */
  corrections?: PartCorrection[];
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

// ---------------------------------------------------------------------------
// The training board (GET /api/training/board — backend/src/services/training/board.ts)
// ---------------------------------------------------------------------------

export type LoadDirection = 'resistance' | 'assistance';

export type BoardPoint = {
  date: IsoDate;
  load_lb: number | null;
  sets: number | null;
  reps: number | null;
};

/** The coach's own prescription for this exercise, in a row's worth of words. */
export type BoardNextStep = {
  rule: 'new' | 'hold' | 'step_up' | 'step_down' | 'ease_back' | 'restart' | 'cardio' | 'reference';
  load_lb: number | null;
  sets: number | null;
  reps: number | null;
  text: string;
  /** "~1–2 wks"; null means the next session. */
  eta: string | null;
  why: string;
};

export type BoardLift = {
  exercise: string;
  exercise_id: string | null;
  category: ActivityCategory | null;
  muscle_groups: string[];
  /** On "assistance" the load is the help the machine gives — less of it is progress. */
  load_direction: LoadDirection;
  load_lb: number | null;
  sets: number | null;
  reps: number | null;
  load_text: string;
  last_date: IsoDate;
  days_since: number;
  sessions: number;
  best_load_lb: number | null;
  trend: 'new' | 'up' | 'flat' | 'down';
  trend_lb: number | null;
  delta_text: string | null;
  /** Colour by this, never by which way the number went (concept-v2 §Progression rules). */
  sentiment: 'good' | 'watch' | 'neutral';
  series: BoardPoint[];
  next: BoardNextStep;
};

export type BoardCardioPoint = {
  date: IsoDate;
  duration_min: number | null;
  distance_mi: number | null;
  pace_min_mi: number | null;
};

/**
 * The coverage ledger, one entry per muscle the coach rotates through plus stretching
 * (backend services/coach/features.ts §coverageLedger). It is what the body map is
 * coloured from and what the coach's rotation is held to — one ledger, two readers.
 */
export type CoverageEntry = {
  key: string;
  label: string;
  days_since: number | null;
  last_date?: IsoDate | null;
  /** Optional for one release: an older server carried only the 14- and 28-day counts. */
  sets_7d?: number;
  sets_14d: number;
  sets_28d: number;
  unit: 'sets' | 'sessions';
  overdue: boolean;
};

/** Light ×0.5, moderate ×1, vigorous ×2 — how a minute of cardio is counted. */
export type CardioIntensity = 'light' | 'moderate' | 'vigorous';

/** A goal named it, the user said it out loud, or the WHO's 150 is standing in. */
export type CardioTargetSource = 'goal' | 'stated' | 'default';

export type CardioBreakdownRow = {
  exercise: string;
  intensity: CardioIntensity;
  multiplier: number;
  minutes: number;
  equiv_minutes: number;
};

/** Minutes, never a load: cardio steps by the week's total, not by the last session. */
export type BoardCardioNext = {
  rule: 'cardio';
  minutes: number | null;
  /** "22 min next", "Hold 20 min". */
  text: string;
  eta: string | null;
  why: string;
};

/**
 * One row per cardio activity (field report 2026-08-31: a treadmill walk was drawn in the
 * Lifts section). Deliberately not a `BoardLift` with the pounds left blank — there is no
 * load, set or rep on it, so nothing here can print "lb".
 */
export type BoardCardioRow = {
  exercise: string;
  exercise_id: string | null;
  category: ActivityCategory | null;
  last_date: IsoDate;
  days_since: number;
  sessions: number;
  duration_min: number | null;
  distance_mi: number | null;
  pace_min_mi: number | null;
  best_pace_min_mi: number | null;
  /** How this activity's minutes are counted, and why (services/coach/cardioIntensity.ts). */
  intensity?: CardioIntensity;
  intensity_multiplier?: number;
  intensity_why?: string;
  /** "20 min · 1.2 mi · 16.7 min/mi" — as much of it as the session measured. */
  summary_text: string;
  delta_text: string | null;
  sentiment: 'good' | 'watch' | 'neutral';
  series: BoardCardioPoint[];
  next: BoardCardioNext;
};

export type TrainingBoard = {
  date: IsoDate;
  /** Strength only since the split; an older server also put the cardio rows in here. */
  lifts: BoardLift[];
  frequency: {
    weeks: { start: IsoDate; sessions: number }[];
    sessions_this_week: number;
    average_per_week: number;
    training_days_target: number | null;
    muscles: { muscle: string; sets_7d: number; sets_28d: number }[];
    /**
     * The coverage ledger — every muscle the coach rotates through plus stretching, largest
     * debt first, each with whether the rotation owes it one. The same ledger the brief is
     * built from, so the tab and the coach never disagree about what is overdue.
     */
    coverage?: CoverageEntry[];
  };
  cardio: {
    weeks: { start: IsoDate; minutes: number }[];
    /** Raw minutes logged this week, before any intensity is applied. */
    minutes_this_week: number;
    /**
     * The same week weighted by intensity — light ×0.5, moderate ×1, vigorous ×2 — which is
     * what the target is actually measured in (backend services/coach/cardioIntensity.ts).
     * Optional for one release: an older server does not send it.
     */
    equiv_minutes_this_week?: number;
    weekly_target_min: number;
    /** Equivalent minutes still to go this week; 0 when the week is already there. */
    short_by_min: number;
    /** "20 brisk + 15 run×2" — where the equivalent minutes came from. */
    equiv_text?: string;
    /** "22 moderate min or 11 hard" — two ways to close the same gap. Null when there is none. */
    alternatives_text?: string | null;
    /** Where the weekly target came from: a goal, something they said, or the WHO's 150. */
    target_source?: CardioTargetSource;
    /** Every cardio activity this week, largest first — the breakdown behind the headline. */
    breakdown?: CardioBreakdownRow[];
    /** The same week folded into the three classes, for the legend under the number. */
    intensity_mix?: { intensity: CardioIntensity; minutes: number; equiv_minutes: number }[];
    last: { date: IsoDate; pace_min_mi: number; distance_mi: number } | null;
    best: { date: IsoDate; pace_min_mi: number; distance_mi: number } | null;
    /**
     * The rows, when the server sends them. Optional for one release: an older server does
     * not know about them, which is not the same as sending an empty list.
     */
    activities?: BoardCardioRow[];
    /** True when a goal or a statement named the minutes rather than the WHO's 150. */
    target_stated?: boolean;
  };
  body: {
    latest: number | null;
    latest_date: IsoDate | null;
    avg_7d: number | null;
    trend_per_week: number | null;
    series: { date: IsoDate; value: number }[];
  };
};
