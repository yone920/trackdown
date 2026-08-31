import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, tzOffsetMin, upload } from './api';
import type {
  AnalyzeResponse,
  CoachNext,
  ConfirmResponse,
  DayLogView,
  DayView,
  DaysView,
  ExerciseSheet,
  FusionResult,
  GoalMetric,
  GoalProgress,
  GoalRecord,
  GoalsView,
  IsoDate,
  Profile,
  TrainingBoard,
  WeekView,
} from './types';

// Every screen's data, and the only place a URL appears twice (lib/api.ts is the
// transport). The v1 hooks that fetched `/api/entries/*` and did the arithmetic on the
// phone are gone: the server computes the day, the targets and the verdict now
// (docs/build-plan.md §WP3/§WP4), so a hook here fetches one endpoint and returns it.
//
// `tz` goes on every day-shaped request — the backend's day boundaries are the user's
// local midnight and only this device knows where that is.

export function localDateKey(d: Date = new Date()): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Everything a confirmed log can have changed. One list, so no screen goes stale. */
export function invalidateAfterLog(qc: ReturnType<typeof useQueryClient>): void {
  for (const key of ['day', 'week', 'days', 'goals', 'profile', 'coach', 'training'])
    qc.invalidateQueries({ queryKey: [key] });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** GET /api/day/:date — the live day when `date` is today, the record when it is past. */
export function useDay(date: IsoDate) {
  return useQuery({
    queryKey: ['day', date],
    enabled: !!date,
    queryFn: () => api<DayView>(`/api/day/${date}`, { query: { tz: tzOffsetMin() } }),
  });
}

/** GET /api/week — seven statuses and the week's deficit. */
export function useWeek(end?: IsoDate) {
  return useQuery({
    queryKey: ['week', end ?? 'today'],
    queryFn: () => api<WeekView>('/api/week', { query: { tz: tzOffsetMin(), end } }),
  });
}

/** GET /api/days — the Days list, newest first. */
export function useDays(before?: IsoDate, limit = 14) {
  return useQuery({
    queryKey: ['days', before ?? 'top', limit],
    queryFn: () => api<DaysView>('/api/days', { query: { tz: tzOffsetMin(), before, limit } }),
  });
}

/**
 * GET /api/days, one page at a time. The Days tab is a list of every day the user has
 * logged; `next_before` is the server's cursor and null means there is nothing older.
 */
export function useDaysPages(limit = 21) {
  return useInfiniteQuery({
    queryKey: ['days', 'pages', limit],
    initialPageParam: undefined as IsoDate | undefined,
    queryFn: ({ pageParam }) =>
      api<DaysView>('/api/days', { query: { tz: tzOffsetMin(), before: pageParam, limit } }),
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
}

/** GET /api/day/:date/log — the day as it was recorded (raw text, evidence, corrections). */
export function useDayLog(date: IsoDate) {
  return useQuery({
    queryKey: ['day', date, 'log'],
    enabled: !!date,
    queryFn: () => api<DayLogView>(`/api/day/${date}/log`, { query: { tz: tzOffsetMin() } }),
  });
}

/**
 * GET /api/exercises/:id — the catalogue row behind a tapped exercise name. Skipped when
 * the id is not one (lib/exercise.ts §NO_EXERCISE_ID): the sheet is name-only then, and a
 * request that can only 404 is not worth making. The catalogue does not change while an
 * app is open, so this is cached for the session.
 */
export function useExercise(id: string | null) {
  const known = !!id && UUID.test(id);
  return useQuery({
    queryKey: ['exercise', id],
    enabled: known,
    staleTime: Infinity,
    queryFn: () => api<ExerciseSheet>(`/api/exercises/${id}`),
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/goals — active goals in priority order, with progress, plus history. */
export function useGoals() {
  return useQuery({
    queryKey: ['goals'],
    queryFn: () => api<GoalsView>('/api/goals', { query: { tz: tzOffsetMin() } }),
  });
}

/** GET /api/goals/:id/progress — per-metric current/target/% and the trend series. */
export function useGoalProgress(id: string | null) {
  return useQuery({
    queryKey: ['goals', 'progress', id],
    enabled: !!id,
    queryFn: () =>
      api<GoalProgress & { today: IsoDate }>(`/api/goals/${id}/progress`, {
        query: { tz: tzOffsetMin() },
      }),
  });
}

/**
 * GET /api/training/board — one row per regularly-logged exercise, with the coach's own
 * next step on it, plus frequency, cardio and the weigh-ins (user decision 2026-08-31 —
 * the Progress tab, training first class).
 *
 * A read of what was logged plus one call into the progression rules: no model, nothing
 * cached on the server, so a tab may fetch it on open.
 */
export function useTrainingBoard() {
  return useQuery({
    queryKey: ['training', 'board'],
    queryFn: () => api<TrainingBoard>('/api/training/board', { query: { tz: tzOffsetMin() } }),
  });
}

/** GET /api/profile — the plan row and the targets the server derives from it. */
export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api<Profile>('/api/profile', { query: { tz: tzOffsetMin() } }),
  });
}

/** The one cache entry the Coach screen reads. Everything an ask returns is written here. */
const COACH_NEXT: readonly unknown[] = ['coach', 'next'];

/**
 * GET /api/coach/next — today's brief, cached for the day on the server. Never fetched
 * on its own: the coach is a button (concept-v2 §Principles 5), so this hook is only
 * mounted by the Coach screen.
 *
 * It takes no context. Anything the user types goes through {@link useAskCoach}, whose
 * answer is written straight into this entry — one request per tap on Ask, and the brief
 * already on screen stays on screen while it runs. (It used to take the typed line as part
 * of the query key, which made every Ask fire a GET *and* a POST — two model calls — and
 * blanked the screen in between, because a new key has no data in it yet.)
 */
export function useCoachNext() {
  return useQuery({
    queryKey: COACH_NEXT,
    queryFn: () => api<CoachNext>('/api/coach/next', { query: { tz: tzOffsetMin() } }),
    // A brief costs a model call; asking again on every focus is not what the button means.
    staleTime: 1000 * 60 * 30,
    retry: 0,
  });
}

/**
 * POST /api/coach/next/regenerate — the Ask button.
 *
 * `context` is a fact about today the next brief should account for ("knee hurts"); a
 * `revision` is an instruction about the answer itself ("make it 8 exercises"), and the
 * server hands the model the brief the user is looking at. The answer replaces the cache
 * entry directly rather than invalidating it: a refetch would throw the brief away for a
 * frame, and this response *is* the fresh one.
 */
export function useAskCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ context = null, revision = null }: { context?: string | null; revision?: string | null }) =>
      api<CoachNext>('/api/coach/next/regenerate', {
        method: 'POST',
        body: { tz_offset_min: tzOffsetMin(), context, revision },
      }),
    onSuccess: (data) => qc.setQueryData(COACH_NEXT, data),
  });
}

// ---------------------------------------------------------------------------
// The log pipeline
// ---------------------------------------------------------------------------

export type AnalyzeInput = {
  text?: string | null;
  /** Local file URIs, already downscaled (lib/photos.ts). At most four. */
  photos?: { uri: string; filename: string; type: string }[];
  kindHint?: string | null;
  /**
   * The unanswered question this text is the answer to. "Yes" on its own is not a log —
   * sent back with the words it is about and the question it answers, it is. Both halves
   * or neither (backend/src/services/fusion/context.ts §ClarifyRound).
   */
  clarify?: { originalText: string; question: string } | null;
  /**
   * "Make a change" (concept-v2 §Principles 7 — NO FORMS). The parts the user is looking
   * at and what they said to change about them. Sent instead of a fresh log: the server
   * re-reads each part with the instruction in its prompt and hands them back revised.
   * `results` is a pending preview; `record` is one saved row read back the same way.
   */
  revise?: { results?: FusionResult[]; record?: FusionResult; instruction: string } | null;
};

/** POST /api/log/analyze — a preview. Nothing is saved until the user confirms. */
export function useAnalyze() {
  return useMutation({
    mutationFn: ({ text, photos = [], kindHint, clarify, revise }: AnalyzeInput) => {
      const parts = [
        ...(revise ? [{ name: 'revise', value: JSON.stringify(revise) }] : []),
        ...(text ? [{ name: 'text', value: text }] : []),
        ...(kindHint ? [{ name: 'kind_hint', value: kindHint }] : []),
        ...(clarify
          ? [
              { name: 'clarify_original', value: clarify.originalText },
              { name: 'clarify_question', value: clarify.question },
            ]
          : []),
        { name: 'client_time', value: new Date().toISOString() },
        { name: 'tz_offset_min', value: String(tzOffsetMin()) },
        ...photos.map((photo) => ({
          name: 'photos',
          uri: photo.uri,
          filename: photo.filename,
          type: photo.type,
        })),
      ];
      return upload<AnalyzeResponse>('/api/log/analyze', parts);
    },
  });
}

export type ConfirmInput = {
  /** Minted once per Save, however many parts it holds: a retry replays, it does not
   * log the meal and the run and the weigh-in a second time. */
  clientId: string;
  /** Every part of the log, in the order they were said. One transaction, one Save. */
  results: FusionResult[];
  evidenceIds?: string[];
  /** Which part each evidence id belongs to, aligned with `evidenceIds`. */
  evidenceParts?: number[];
  text?: string | null;
  textKind?: 'text' | 'transcript';
  source?: 'fused' | 'manual';
  /** A goal part: keep the user's own date, or save with no finish line. */
  confirmDate?: boolean;
  noDate?: boolean;
};

/** POST /api/log/confirm — writes every part of the (edited) preview in one transaction. */
export function useConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfirmInput) =>
      api<ConfirmResponse>('/api/log/confirm', {
        method: 'POST',
        body: {
          client_id: input.clientId,
          results: input.results,
          evidence_ids: input.evidenceIds ?? [],
          evidence_parts: input.evidenceParts ?? [],
          text: input.text ?? null,
          text_kind: input.textKind ?? 'text',
          ...(input.source ? { source: input.source } : {}),
          tz_offset_min: tzOffsetMin(),
          ...(input.confirmDate === undefined ? {} : { confirm_date: input.confirmDate }),
          ...(input.noDate === undefined ? {} : { no_date: input.noDate }),
        },
      }),
    onSuccess: () => invalidateAfterLog(qc),
  });
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/** Which endpoint corrects which kind of row (backend/src/routes/{entries,weight}.ts). */
const PATCH_PATH: Record<string, (id: string) => string> = {
  activity: (id) => `/api/entries/movement/${id}`,
  meal: (id) => `/api/entries/meals/${id}`,
  weight: (id) => `/api/weight/${id}`,
  goal: (id) => `/api/goals/${id}`,
};

export type PatchInput = {
  kind: 'activity' | 'meal' | 'weight' | 'goal';
  id: string;
  patch: Record<string, unknown>;
};

/**
 * PATCH one saved row — the DayLog's "tap → correct". Every screen that could be showing
 * the old value is invalidated, because a correction moves the day's totals and the
 * verdict with it.
 */
export function usePatchRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id, patch }: PatchInput) =>
      api<Record<string, unknown>>(PATCH_PATH[kind]!(id), { method: 'PATCH', body: patch }),
    onSuccess: () => invalidateAfterLog(qc),
  });
}

/** The three kinds of row a tap can take back. A goal is dropped, not deleted; a
 * statement lives on the plan and has no row of its own. */
export type DeleteKind = 'activity' | 'meal' | 'weight';

const DELETE_PATH: Record<DeleteKind, (id: string) => string> = {
  activity: (id) => `/api/entries/movement/${id}`,
  meal: (id) => `/api/entries/meals/${id}`,
  weight: (id) => `/api/weight/${id}`,
};

/**
 * DELETE one logged row. Something logged by mistake is undone where it is shown — one
 * tap to ask, one to do it — and the row's evidence goes with it, cascaded by the
 * database (migrations 0004_v2.sql `evidence.activity_id/meal_id`, 0009_day_log.sql
 * `evidence.weight_id`, all ON DELETE CASCADE).
 *
 * Everything a delete moves is invalidated on the same list a log uses: earned and eaten,
 * the sets per muscle group, the day's status, the week, the goal progress and the
 * Right-now reading, which the server regenerates because the day's inputs hash changed.
 */
export function useDeleteRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id }: { kind: DeleteKind; id: string }) =>
      api<void>(DELETE_PATH[kind](id), { method: 'DELETE' }),
    onSuccess: () => invalidateAfterLog(qc),
  });
}

// ---------------------------------------------------------------------------
// Goals — the Goals tab's own writes
// ---------------------------------------------------------------------------

export type GoalPatch = {
  title?: string;
  metrics?: GoalMetric[];
  priority?: number;
  status?: 'active' | 'reached' | 'expired' | 'dropped';
  active_to?: IsoDate | null;
};

/** PATCH /api/goals/:id — mark reached, drop, retitle. Never called by anything but a tap. */
export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: GoalPatch }) =>
      api<GoalRecord>(`/api/goals/${id}`, {
        method: 'PATCH',
        body: { ...patch, tz_offset_min: tzOffsetMin() },
      }),
    onSuccess: () => invalidateAfterLog(qc),
  });
}

/** POST /api/goals/reorder — the user's order, most important first. */
export function useReorderGoals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api<{ active: GoalRecord[] }>('/api/goals/reorder', {
      method: 'POST',
      body: { ids },
    }),
    onSuccess: () => invalidateAfterLog(qc),
  });
}
