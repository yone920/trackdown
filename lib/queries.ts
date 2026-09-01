import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect } from 'react';

import { api, authHeaders, exerciseMediaUrl, SHEET_PHOTO_WIDTH, tzOffsetMin, upload } from './api';
import { rememberExercise } from './exercise-cache';
import type {
  AnalyzeResponse,
  CoachNext,
  CoachStatus,
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
  PartCorrection,
  Profile,
  TrainingBoard,
  WeekView,
  YouView,
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
  // `you` is on the list because the dossier is written out of the profile, the goals and
  // four weeks of logs: a stated constraint changes what it should say. The server still
  // decides whether that is a new paragraph — it hashes its own inputs — so an invalidation
  // here costs a read and only sometimes a generation.
  for (const key of ['day', 'week', 'days', 'goals', 'profile', 'coach', 'training', 'you'])
    qc.invalidateQueries({ queryKey: [key] });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** GET /api/day/:date — the live day when `date` is today, the record when it is past. */
export function useDay(date: IsoDate, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['day', date],
    // `enabled` is a caller's veto, never a way to turn a blank date on: app/day/[date].tsx
    // stops asking for a day it is about to redirect away from (user decision 2026-09-01).
    enabled: !!date && options.enabled !== false,
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
 * request that can only 404 is not worth making.
 *
 * `staleTime: Infinity` and `gcTime: Infinity`, because a catalogue row cannot go stale:
 * what a bench press works and what it needs is the same answer for every account and does
 * not change between releases. Each answer is also written to disk
 * (lib/exercise-cache.ts), so the *first* tap after a cold launch is instant too — which
 * is the one anybody notices.
 */
export function useExercise(id: string | null) {
  const known = !!id && UUID.test(id);
  return useQuery({
    queryKey: ['exercise', id],
    enabled: known,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: () => fetchExercise(id as string),
  });
}

async function fetchExercise(id: string): Promise<ExerciseSheet> {
  const sheet = await api<ExerciseSheet>(`/api/exercises/${id}`);
  rememberExercise(sheet);
  return sheet;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a screen hands the prefetcher: an id it may not have, and a count it may not know. */
export type PrefetchableExercise = {
  id?: string | null;
  mediaCount?: number | null;
};

/**
 * Warms the sheets for the exercises already on screen — the coach's plan (its Do list AND
 * its finisher) and the six lifts and cardio rows on Progress (user decision 2026-08-31:
 * "prefetch details and the first photo for exercises visible on the coach plan and lifts
 * board"; both surfaces re-verified 2026-09-01 after a report that the plan felt slow).
 *
 * The row and the first photograph, which together are everything the sheet draws above
 * the fold. Deliberately cheap and deliberately quiet:
 *
 *   * `prefetchQuery` with the same `staleTime` is a no-op for anything already cached, so
 *     the list can be handed over on every render and only ever fetches what is new.
 *   * It runs in an effect rather than during render, so a slow catalogue never delays a
 *     screen that has everything it needs to draw.
 *   * The photograph is fetched at exactly the width the sheet asks for
 *     ({@link SHEET_PHOTO_WIDTH}). The width is in the URL, so a prefetch at any other size
 *     would warm a cache entry the sheet never reads — a download for nobody.
 *   * A caller that already knows the count says so, and an exercise with no photographs
 *     costs no image request at all: it is skipped before the sheet is even consulted.
 *   * Failures are swallowed. A prefetch that fails costs the user nothing: the sheet
 *     fetches on the tap, exactly as it did before this existed.
 */
export function usePrefetchExercises(
  exercises: readonly (PrefetchableExercise | string | null | undefined)[],
): void {
  const qc = useQueryClient();
  // The list as one string, so the effect re-runs when the *set* changes rather than on
  // every render that rebuilt the array. The count rides in it because a row whose photos
  // arrived after the first render should warm them on that render and not before.
  const key = exercises
    .map((entry) => (typeof entry === 'string' || entry == null ? { id: entry } : entry))
    .filter((entry): entry is PrefetchableExercise => !!entry.id && UUID.test(entry.id))
    .map((entry) => `${entry.id}:${entry.mediaCount ?? ''}`)
    .join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const run = async () => {
      for (const entry of key.split(',')) {
        if (cancelled) return;
        const [id, count] = entry.split(':') as [string, string];
        try {
          await qc.prefetchQuery({
            queryKey: ['exercise', id],
            staleTime: Infinity,
            gcTime: Infinity,
            queryFn: () => fetchExercise(id),
          });
          // A name the row already said has no pictures is a row with nothing to warm.
          if (count === '0') continue;
          const sheet = qc.getQueryData<ExerciseSheet>(['exercise', id]);
          // The first frame only: the second is below the fold and the tap will fetch it
          // in the time it takes to scroll.
          if (sheet && sheet.media.length > 0) {
            await Image.prefetch(exerciseMediaUrl(id, 0, SHEET_PHOTO_WIDTH), {
              headers: authHeaders(),
            }).catch(() => false);
          }
        } catch {
          // See above: a prefetch is an optimisation and never a requirement.
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [key, qc]);
}

/**
 * GET /api/you — the dossier (backend services/readings/dossier.ts). Its own endpoint
 * rather than a field on `GET /api/profile`, and that is the whole reason it exists
 * separately: the profile is invalidated after every single log
 * ({@link invalidateAfterLog}), so a generated paragraph living on it would be a model
 * call per meal.
 *
 * Half an hour of `staleTime`, because the server caches the paragraph on its own inputs
 * hash anyway — this only stops the screen asking twice in one sitting.
 */
export function useYou() {
  return useQuery({
    queryKey: ['you'],
    queryFn: () => api<YouView>('/api/you', { query: { tz: tzOffsetMin() } }),
    staleTime: 1000 * 60 * 30,
    retry: 0,
  });
}

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
 * GET /api/coach/next?generate=false — today's brief **if there is one**, and `brief: null`
 * if there is not. Never fetched on its own: the coach is a button (concept-v2 §Principles
 * 5), so this hook is only mounted by the Coach screen.
 *
 * `generate=false` is the whole point. Opening the page used to generate the day's brief
 * when there was not one yet, which made *looking* the thing that wrote the day's standing
 * answer — a schedule with extra steps (user decision 2026-08-31 §2). The screen now draws
 * its own "What should I do today?" button over a null brief, and the only things that ever
 * cost a model call are taps.
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
    queryFn: () =>
      api<CoachNext>('/api/coach/next', { query: { tz: tzOffsetMin(), generate: false } }),
    // Free now — but the answer holds still for the day, so refetching on every focus
    // would only replace a brief with itself.
    staleTime: 1000 * 60 * 30,
    retry: 0,
  });
}

/**
 * GET /api/coach/status — the four numbers Today's button needs: is there a plan, what is
 * it called, and how much of it is done (user decision 2026-08-31 §1).
 *
 * Safe to fetch on every open of the Today tab, and that is a property of the endpoint
 * rather than of this hook: it is an exists-check on the server and cannot generate
 * anything. Before it existed, the only way to ask "is there a plan?" was to ask for one.
 */
export function useCoachStatus() {
  return useQuery({
    queryKey: ['coach', 'status'],
    queryFn: () => api<CoachStatus>('/api/coach/status', { query: { tz: tzOffsetMin() } }),
    retry: 0,
  });
}

/**
 * POST /api/coach/next/regenerate — every tap that can change today's plan.
 *
 * `context` is a fact about today the next brief should account for ("knee hurts"); a
 * `revision` is an instruction about the answer itself ("add core", "switch to legs"), and
 * the server hands the model the brief the user is looking at.
 *
 * `mode` says which of the plan's two explicit buttons this was — `append` for *Add to
 * today's plan*, `rewrite` for *Replace today's plan* — and the server does not let the
 * model overrule it. The free-text box sends no mode at all: only the model has read the
 * sentence, and its default there is to add rather than replace.
 *
 * The answer replaces the cache entry directly rather than invalidating it: a refetch would
 * throw the brief away for a frame, and this response *is* the fresh one. The button on
 * Today reads a different endpoint, so that one is invalidated.
 */
export function useAskCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      context = null,
      revision = null,
      mode = null,
    }: {
      context?: string | null;
      revision?: string | null;
      mode?: 'append' | 'rewrite' | null;
    }) =>
      api<CoachNext>('/api/coach/next/regenerate', {
        method: 'POST',
        body: { tz_offset_min: tzOffsetMin(), context, revision, mode },
      }),
    onSuccess: (data) => {
      qc.setQueryData(COACH_NEXT, data);
      qc.invalidateQueries({ queryKey: ['coach', 'status'] });
    },
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
  /**
   * The told changes this preview went through before it was saved, exactly as
   * /api/log/analyze measured them. Relayed, never computed here: the server diffed the
   * parts it was handed against the parts it answered with, and it writes them against the
   * rows the parts turn into (migration 0015).
   */
  corrections?: PartCorrection[];
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
          corrections: input.corrections ?? [],
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
  /**
   * What the user SAID to make this change. Sent with the patch so the server can file the
   * correction — its own diff of the row before and after — beside the record it changed
   * (migration 0015). Absent when nothing was told: the Goals screen's own edits.
   */
  instruction?: string | null;
};

/**
 * PATCH one saved row — the DayLog's "tap → correct". Every screen that could be showing
 * the old value is invalidated, because a correction moves the day's totals and the
 * verdict with it.
 */
export function usePatchRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id, patch, instruction }: PatchInput) =>
      api<Record<string, unknown>>(PATCH_PATH[kind]!(id), {
        method: 'PATCH',
        body: instruction ? { ...patch, correction_instruction: instruction } : patch,
      }),
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
