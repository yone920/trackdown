import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, tzOffsetMin, upload } from './api';
import type {
  AnalyzeResponse,
  CoachNext,
  ConfirmResponse,
  DayLogView,
  DayView,
  DaysView,
  FusionResult,
  GoalMetric,
  GoalProgress,
  GoalRecord,
  GoalsView,
  IsoDate,
  Profile,
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
  for (const key of ['day', 'week', 'days', 'goals', 'profile', 'coach'])
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

/** GET /api/profile — the plan row and the targets the server derives from it. */
export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api<Profile>('/api/profile', { query: { tz: tzOffsetMin() } }),
  });
}

/**
 * GET /api/coach/next — today's brief, cached for the day on the server. Never fetched
 * on its own: the coach is a button (concept-v2 §Principles 5), so this hook is only
 * mounted by the Coach screen.
 */
export function useCoachNext(context?: string | null) {
  return useQuery({
    queryKey: ['coach', 'next', context ?? ''],
    queryFn: () =>
      api<CoachNext>('/api/coach/next', {
        query: { tz: tzOffsetMin(), context: context ?? undefined },
      }),
    // A brief costs a model call; asking again on every focus is not what the button means.
    staleTime: 1000 * 60 * 30,
    retry: 0,
  });
}

export function useRegenerateCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (context: string | null) =>
      api<CoachNext>('/api/coach/next/regenerate', {
        method: 'POST',
        body: { tz_offset_min: tzOffsetMin(), context },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach'] }),
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
};

/** POST /api/log/analyze — a preview. Nothing is saved until the user confirms. */
export function useAnalyze() {
  return useMutation({
    mutationFn: ({ text, photos = [], kindHint }: AnalyzeInput) => {
      const parts = [
        ...(text ? [{ name: 'text', value: text }] : []),
        ...(kindHint ? [{ name: 'kind_hint', value: kindHint }] : []),
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
