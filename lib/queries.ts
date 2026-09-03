import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  api,
  ApiError,
  authHeaders,
  exerciseMediaUrl,
  GENERATE_TIMEOUT_MS,
  SHEET_PHOTO_WIDTH,
  tzOffsetMin,
  upload,
} from './api';
import { monthWindow } from './calendar';
import { LOST_ANSWER_NOTE, pollForPlan } from './coach-recovery';
import { readerLine } from './errors';
import { rememberExercise } from './exercise-cache';
import type {
  EatingView,
  ExerciseHistory,
  WeighIn,
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

/**
 * Every query-key ROOT a log, a correction or a deletion can have changed.
 *
 * **The rule is that a correction invalidates everything that draws the corrected number**,
 * and the way this list goes wrong is by omission: a new screen adds a query, nobody adds
 * its root here, and that one surface quietly serves a stale value for ever. It happened —
 * the Weigh-ins list read `['weight', …]`, which was not on this list, so a weigh-in
 * corrected from 110 to 210 saved correctly, showed its audit line on the record card, and
 * went on reading 110 on Progress (field report 2026-09-02).
 *
 * `you` is here because the dossier is written out of the profile, the goals and four weeks
 * of logs: a stated constraint changes what it should say. The server still decides whether
 * that is a new paragraph — it hashes its own inputs — so an invalidation costs a read and
 * only sometimes a generation.
 *
 * `exercise` is deliberately absent and is the ONLY deliberate absence: the catalogue is
 * the same for everybody and nothing a user logs changes it (queries.test.ts pins this, so
 * the next omission fails a test rather than a screen).
 */
export const INVALIDATED_AFTER_LOG = [
  'day',
  'week',
  'days',
  'goals',
  'profile',
  'coach',
  'training',
  'you',
  'eating',
  'weight',
] as const;

export function invalidateAfterLog(qc: ReturnType<typeof useQueryClient>): void {
  for (const key of INVALIDATED_AFTER_LOG) qc.invalidateQueries({ queryKey: [key] });
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

/**
 * GET /api/eating — the Eat page in one request: today's numbers, the computed week, and
 * the written direction. The direction is a cached READING, so opening the page when
 * nothing has moved generates nothing.
 */
export function useEating() {
  return useQuery({
    queryKey: ['eating'],
    queryFn: () => api<EatingView>('/api/eating', { query: { tz: tzOffsetMin() } }),
  });
}

/**
 * GET /api/weight — the weigh-ins themselves, newest first.
 *
 * They had no surface at all between the Today restructure and 2026-09-02: the numbers went
 * on feeding the averages and the goal card while the ROWS were unreachable, so a user who
 * mistyped one could not get at it to fix it. Body state belongs on Progress, and this is
 * what that section reads.
 */
export function useWeighIns(limit = 60) {
  return useQuery({
    queryKey: ['weight', 'list', limit],
    queryFn: () => api<WeighIn[]>('/api/weight', { query: { order: 'desc', limit } }),
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
 * One month of days, for the calendar sheet (components/calendar-sheet.tsx).
 *
 * No new endpoint: `before` on `GET /api/days` is exclusive and the list comes back newest
 * first, so the first of the NEXT month with a limit of 31 covers any month exactly
 * (lib/calendar.ts §monthWindow). A month with gaps spills a few rows out of the older end
 * of the window; the sheet keeps the ones whose date is in the month.
 */
export function useDaysInMonth(month: string, options: { enabled?: boolean } = {}) {
  const { before, limit } = monthWindow(month);
  return useQuery({
    queryKey: ['days', 'month', month],
    enabled: options.enabled ?? true,
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
    // Optional: this list is a section of Progress now, so it renders against whatever
    // else that page is loading — and a page that has not arrived is not a cursor.
    getNextPageParam: (last) => last?.next_before ?? undefined,
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

/**
 * GET /api/training/exercise — one movement, every session of it (field report 2026-09-02).
 *
 * Keyed by NAME, because that is what a logged row carries: a movement the catalogue has
 * never heard of still has a history, and it is the one a user is most likely to check.
 */
export function useExerciseHistory(name: string | null) {
  return useQuery({
    queryKey: ['training', 'exercise', (name ?? '').trim().toLowerCase()],
    enabled: !!name && name.trim() !== '',
    queryFn: () =>
      api<ExerciseHistory>('/api/training/exercise', { query: { tz: tzOffsetMin(), name: name as string } }),
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
        // A model call over a phone connection. The platform's own 60-second ceiling was
        // shorter than the work, which is how a brief that WAS written came back to the app
        // as a network error (field report 2026-09-02).
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    onSuccess: (data) => {
      qc.setQueryData(COACH_NEXT, data);
      qc.invalidateQueries({ queryKey: ['coach', 'status'] });
    },
  });
}

/**
 * Ask for today's plan, and do not lose it if the answer goes missing.
 *
 * The generation is the one call in the app that routinely outlives a phone's patience, and
 * a dropped response is not a failed generation — the server finishes writing either way,
 * and its per-day semantics mean asking again would return the same brief rather than a
 * second one. So a lost answer is RECOVERED: poll the status endpoint, which cannot itself
 * generate, until the plan shows up (lib/coach-recovery.ts).
 *
 * Three states come back, because the screen has three things to say: `asking` while the
 * call is out, `recovering` once the answer is late and the poll has taken over, and a
 * `note` when the window closed with nothing — which is the one thing the old flow never
 * did. It reverted to "Nothing planned yet" and said nothing at all.
 */
export function useStartWorkout() {
  const qc = useQueryClient();
  const ask = useAskCoach();
  const [recovering, setRecovering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // A screen that has gone away must not keep polling, and must not setState afterwards.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  /**
   * Ask for a session, and see it through.
   *
   * Returns the outcome as well as setting it: a caller that must decide something —
   * whether to close a sheet, say — cannot read `note` from the render it started in, and
   * a stale closure there is a screen that closes on a failure it never showed (caught by
   * the plan-new sheet, 2026-09-03).
   */
  const start = useCallback(
    async (input: AskCoachInput = {}): Promise<{ ok: boolean; note: string | null }> => {
      setNote(null);
      try {
        await ask.mutateAsync(input);
        return { ok: true, note: null };
      } catch (error) {
        // A refusal is a refusal: say it, and do not sit there polling for a plan that was
        // never going to be written. Only a lost or slow answer is worth waiting on.
        if (error instanceof ApiError) {
          // The refusal in the app's words, from the code the server sent — the server's
          // own sentence used to go straight into the note (lib/errors.ts).
          const line = readerLine(error, 'The coach could not start that just now.');
          if (!gone.current) setNote(line);
          return { ok: false, note: line };
        }
      }

      if (gone.current) return { ok: false, note: null };
      setRecovering(true);
      const found = await pollForPlan({
        checkStatus: () => api<CoachStatus>('/api/coach/status', { query: { tz: tzOffsetMin() } }),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        cancelled: () => gone.current,
      });
      if (gone.current) return { ok: false, note: null };
      setRecovering(false);
      if (found) {
        await qc.invalidateQueries({ queryKey: ['coach'] });
        return { ok: true, note: null };
      }
      setNote(LOST_ANSWER_NOTE);
      return { ok: false, note: LOST_ANSWER_NOTE };
    },
    [ask, qc],
  );

  return {
    start,
    /** The call is out, or the poll is waiting on it. Either way: one spinner, button off. */
    busy: ask.isPending || recovering,
    asking: ask.isPending,
    recovering,
    note,
    clearNote: useCallback(() => setNote(null), []),
  };
}

export type AskCoachInput = { context?: string | null; revision?: string | null; mode?: 'append' | 'rewrite' | null };

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

export type SplitInput = {
  id: string;
  /** At least two: replacing one record with one record is a PATCH. */
  parts: Record<string, unknown>[];
  instruction: string;
};

/**
 * Replace one saved exercise record with the parts a told change needs — the other half of
 * "make a change" (migration 0018). A PATCH can only ever move the fields of one row, and a
 * load that changed partway through the sets is two rows or it is nothing.
 *
 * The original row is corrected in place into the first part and keeps its id, so its
 * photos and its own correction history stay attached to it; the server writes the rest and
 * the trail linking them, in one transaction.
 */
export function useSplitRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parts, instruction }: SplitInput) =>
      api<{ records: Record<string, unknown>[] }>(`/api/entries/movement/${id}/split`, {
        method: 'POST',
        body: { parts, correction_instruction: instruction },
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
