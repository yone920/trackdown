import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import {
  buildRecommendation,
  type GoalPace,
  type Recommendation,
} from './recommendations';
import {
  type ActivityLevel,
  type Sex,
} from './tdee';

// Data hooks for the screens. Same exported names and shapes as the Supabase version;
// only the transport changed — PostgREST calls became calls to backend/ (see lib/api.ts).
// Day/range boundaries are still computed here in the phone's local timezone and sent
// as ISO instants, exactly as the PostgREST filters were.

export type Entry = {
  id: string;
  time: string;
  name: string;
  kcal: number;
};

export type MealMacros = {
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
};

export type EntryDetail = Entry & Partial<MealMacros> & {
  weight_lb?: number | null;
};

/** Row shape returned by GET /api/entries/:kind (meals carry the macro columns). */
type EntryRow = {
  id: string;
  description: string;
  kcal: number;
  logged_at: string;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
};

type WeightRow = { id: string; weight_lb: number; logged_at: string };

function formatTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

function dayBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayBoundsFromKey(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

type Kind = 'meals' | 'movement';

type RangeQuery = { from?: string; to?: string; order?: 'asc' | 'desc'; limit?: number };

function listEntries(kind: Kind, query: RangeQuery) {
  return api<EntryRow[]>(`/api/entries/${kind}`, { query });
}

function listWeights(query: RangeQuery) {
  return api<WeightRow[]>('/api/weight', { query });
}

const toEntry = (r: EntryRow): Entry => ({
  id: r.id,
  time: formatTime(r.logged_at),
  name: r.description,
  kcal: r.kcal ?? 0,
});

async function fetchToday(kind: Kind): Promise<Entry[]> {
  const { start, end } = dayBounds();
  const rows = await listEntries(kind, { from: start, to: end, order: 'desc' });
  return rows.map(toEntry);
}

async function fetchRecentUnique(
  kind: Kind,
  limit: number,
): Promise<{ name: string; kcal: number }[]> {
  const rows = await listEntries(kind, { order: 'desc', limit: 50 });
  const seen = new Map<string, { name: string; kcal: number }>();
  for (const r of rows) {
    if (!seen.has(r.description)) seen.set(r.description, { name: r.description, kcal: r.kcal ?? 0 });
    if (seen.size >= limit) break;
  }
  return Array.from(seen.values());
}

export function useMealsToday() {
  return useQuery({ queryKey: ['meals', 'today'], queryFn: () => fetchToday('meals') });
}

export type TodayMacros = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

async function fetchTodayMacros(): Promise<TodayMacros> {
  const { start, end } = dayBounds();
  const rows = await listEntries('meals', { from: start, to: end });
  const totals: TodayMacros = { protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const r of rows) {
    totals.protein_g += Number(r.protein_g ?? 0);
    totals.carbs_g += Number(r.carbs_g ?? 0);
    totals.fat_g += Number(r.fat_g ?? 0);
    totals.fiber_g += Number(r.fiber_g ?? 0);
  }
  return totals;
}

export function useTodayMacros() {
  return useQuery({ queryKey: ['meals', 'today-macros'], queryFn: fetchTodayMacros });
}

export function useMovementToday() {
  return useQuery({
    queryKey: ['movement', 'today'],
    queryFn: () => fetchToday('movement'),
  });
}

export function useRecentMeals(limit = 8) {
  return useQuery({
    queryKey: ['meals', 'recent', limit],
    queryFn: () => fetchRecentUnique('meals', limit),
  });
}

export function useRecentMovement(limit = 8) {
  return useQuery({
    queryKey: ['movement', 'recent', limit],
    queryFn: () => fetchRecentUnique('movement', limit),
  });
}

export type EntryKind = 'meals' | 'movement' | 'weight';

export function useEntry(kind: EntryKind, id: string) {
  return useQuery({
    queryKey: [kind, 'detail', id],
    enabled: !!id,
    queryFn: async (): Promise<EntryDetail | null> => {
      if (kind === 'weight') {
        const row = await api<WeightRow>(`/api/weight/${id}`).catch(notFoundAsNull);
        if (!row) return null;
        return {
          id: row.id,
          time: formatTime(row.logged_at),
          name: 'Weight reading',
          kcal: 0,
          weight_lb: Number(row.weight_lb),
        };
      }
      const row = await api<EntryRow>(`/api/entries/${kind}/${id}`).catch(notFoundAsNull);
      if (!row) return null;
      const base: EntryDetail = toEntry(row);
      if (kind === 'meals') {
        const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
        base.protein_g = num(row.protein_g);
        base.carbs_g = num(row.carbs_g);
        base.fat_g = num(row.fat_g);
        base.fiber_g = num(row.fiber_g);
      }
      return base;
    },
  });
}

function notFoundAsNull(error: unknown): null {
  if (error && typeof error === 'object' && (error as { status?: number }).status === 404) return null;
  throw error;
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id }: { kind: EntryKind; id: string }) => {
      const path = kind === 'weight' ? `/api/weight/${id}` : `/api/entries/${kind}/${id}`;
      await api<void>(path, { method: 'DELETE' });
    },
    onSuccess: (_, { kind }) => {
      const key = kind === 'weight' ? 'weight' : kind;
      qc.invalidateQueries({ queryKey: [key] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['day'] });
    },
  });
}

export type EntryPatch = {
  kcal?: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
};

export function useUpdateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      id,
      patch,
    }: {
      kind: 'meals' | 'movement';
      id: string;
      patch: EntryPatch;
    }) => {
      await api<EntryRow>(`/api/entries/${kind}/${id}`, { method: 'PATCH', body: patch });
    },
    onSuccess: (_, { kind, id }) => {
      qc.invalidateQueries({ queryKey: [kind] });
      qc.invalidateQueries({ queryKey: [kind, 'detail', id] });
      qc.invalidateQueries({ queryKey: ['meals', 'today-macros'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['day'] });
    },
  });
}

function useAdd(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { description: string; kcal: number }) => {
      await api<EntryRow[]>(`/api/entries/${kind}`, { method: 'POST', body: input });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [kind] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['day'] });
    },
  });
}

export function useAddMeal() {
  return useAdd('meals');
}

export function useAddMovement() {
  return useAdd('movement');
}

export type ParsedItem = {
  type: 'meal' | 'movement' | 'weight';
  description: string;
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  weight_lb?: number;
  confidence: 'low' | 'medium' | 'high';
};

export type LoggedItem = ParsedItem & { id?: string };

// The backend parses the text with Claude (what the `parse-log` edge function did) and
// saves every item in one transaction, returning them with their new ids.
export function useLogText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string): Promise<LoggedItem[]> => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('Say something first.');
      const { items } = await api<{ items: LoggedItem[] }>('/api/log', {
        method: 'POST',
        body: { text: trimmed },
      });
      if (items.length === 0) throw new Error('Could not understand that.');
      return items;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['movement'] });
      qc.invalidateQueries({ queryKey: ['weight'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['day'] });
    },
  });
}

export type DaySummary = {
  date: string;
  consumed: number;
  burned: number;
  mealCount: number;
  movementCount: number;
};

async function fetchDaysSummary(days: number): Promise<DaySummary[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const range = { from: start.toISOString(), to: end.toISOString() };

  const [meals, movement] = await Promise.all([
    listEntries('meals', range),
    listEntries('movement', range),
  ]);

  const buckets = new Map<string, DaySummary>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = localDateKey(d);
    buckets.set(key, { date: key, consumed: 0, burned: 0, mealCount: 0, movementCount: 0 });
  }

  for (const r of meals) {
    const b = buckets.get(localDateKey(new Date(r.logged_at)));
    if (b) {
      b.consumed += r.kcal ?? 0;
      b.mealCount += 1;
    }
  }
  for (const r of movement) {
    const b = buckets.get(localDateKey(new Date(r.logged_at)));
    if (b) {
      b.burned += r.kcal ?? 0;
      b.movementCount += 1;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function useDaysSummary(days = 14) {
  return useQuery({
    queryKey: ['summary', days],
    queryFn: () => fetchDaysSummary(days),
  });
}

export type LoggedEntry = {
  id: string;
  description: string;
  kcal: number;
  logged_at: string;
};

async function fetchRecentEntries(kind: Kind, days: number): Promise<LoggedEntry[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const rows = await listEntries(kind, { from: start.toISOString(), order: 'desc' });
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    kcal: r.kcal ?? 0,
    logged_at: r.logged_at,
  }));
}

export function useRecentMealEntries(days = 30) {
  return useQuery({
    queryKey: ['meals', 'entries', days],
    queryFn: () => fetchRecentEntries('meals', days),
  });
}

export function useRecentMovementEntries(days = 30) {
  return useQuery({
    queryKey: ['movement', 'entries', days],
    queryFn: () => fetchRecentEntries('movement', days),
  });
}

export type WeightLog = {
  id: string;
  weight_lb: number;
  logged_at: string;
};

const toWeightLog = (r: WeightRow): WeightLog => ({
  id: r.id,
  weight_lb: Number(r.weight_lb),
  logged_at: r.logged_at,
});

async function fetchWeightLogs(days: number): Promise<WeightLog[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const rows = await listWeights({ from: start.toISOString(), order: 'asc' });
  return rows.map(toWeightLog);
}

async function fetchAllWeightLogs(): Promise<WeightLog[]> {
  const rows = await listWeights({ order: 'asc' });
  return rows.map(toWeightLog);
}

export function useWeightLogs(days = 30) {
  return useQuery({
    queryKey: ['weight', 'range', days],
    queryFn: () => fetchWeightLogs(days),
  });
}

export function useAllWeightLogs() {
  return useQuery({
    queryKey: ['weight', 'all'],
    queryFn: fetchAllWeightLogs,
  });
}

export type Profile = {
  id: string;
  display_name: string | null;
  goal_weight_lb: number | null;
  units: 'imperial' | 'metric';
  sex: Sex | null;
  birth_year: number | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  goal_pace: GoalPace;
  pregnant_or_lactating: boolean;
  health_concern: boolean;
  disclaimer_acknowledged_at: string | null;
};

async function fetchProfile(): Promise<Profile | null> {
  const row = await api<Record<string, unknown>>('/api/profile');
  if (!row) return null;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: row.id as string,
    display_name: (row.display_name as string | null) ?? null,
    goal_weight_lb: num(row.goal_weight_lb),
    units: ((row.units as string) ?? 'imperial') as 'imperial' | 'metric',
    sex: (row.sex as Sex | null) ?? null,
    birth_year: num(row.birth_year),
    height_cm: num(row.height_cm),
    activity_level: (row.activity_level as ActivityLevel | null) ?? null,
    goal_pace: ((row.goal_pace as GoalPace | null) ?? 'standard') as GoalPace,
    pregnant_or_lactating: Boolean(row.pregnant_or_lactating),
    health_concern: Boolean(row.health_concern),
    disclaimer_acknowledged_at:
      (row.disclaimer_acknowledged_at as string | null) ?? null,
  };
}

export function useProfile() {
  return useQuery({ queryKey: ['profile'], queryFn: fetchProfile });
}

export type ProfileUpdate = Partial<{
  display_name: string | null;
  goal_weight_lb: number | null;
  sex: Sex | null;
  birth_year: number | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  goal_pace: GoalPace;
  pregnant_or_lactating: boolean;
  health_concern: boolean;
  disclaimer_acknowledged_at: string | null;
}>;

export function useAddWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (weightLb: number) => {
      await api<WeightRow[]>('/api/weight', { method: 'POST', body: { weight_lb: weightLb } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weight'] });
      qc.invalidateQueries({ queryKey: ['tdee'] });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfileUpdate) => {
      await api<Record<string, unknown>>('/api/profile', { method: 'PATCH', body: patch });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['recommendation'] });
    },
  });
}

export function useAcknowledgeDisclaimer() {
  const update = useUpdateProfile();
  return () => update.mutateAsync({ disclaimer_acknowledged_at: new Date().toISOString() });
}

export type RecSummary = {
  ready: boolean;
  missing: ('sex' | 'birth_year' | 'height_cm' | 'activity_level' | 'weight')[];
  weightLb: number | null;
  recommendation: Recommendation | null;
};

export function useRecommendation(): RecSummary {
  const { data: profile } = useProfile();
  const { data: weightLogs = [] } = useAllWeightLogs();
  const latestWeight =
    weightLogs.length > 0 ? weightLogs[weightLogs.length - 1].weight_lb : null;

  const missing: RecSummary['missing'] = [];
  if (!profile?.sex) missing.push('sex');
  if (!profile?.birth_year) missing.push('birth_year');
  if (!profile?.height_cm) missing.push('height_cm');
  if (!profile?.activity_level) missing.push('activity_level');
  if (latestWeight === null) missing.push('weight');

  if (missing.length > 0 || !profile) {
    return { ready: false, missing, weightLb: latestWeight, recommendation: null };
  }

  const recommendation = buildRecommendation({
    sex: profile.sex!,
    birthYear: profile.birth_year!,
    heightCm: profile.height_cm!,
    weightLb: latestWeight!,
    activityLevel: profile.activity_level!,
    goalPace: profile.goal_pace,
    goalWeightLb: profile.goal_weight_lb,
    pregnantOrLactating: profile.pregnant_or_lactating,
    healthConcern: profile.health_concern,
  });

  return { ready: true, missing: [], weightLb: latestWeight, recommendation };
}

export function useDay(dateKey: string) {
  return useQuery({
    queryKey: ['day', dateKey],
    enabled: !!dateKey,
    queryFn: async (): Promise<{ meals: Entry[]; movement: Entry[] }> => {
      const { start, end } = dayBoundsFromKey(dateKey);
      const range = { from: start, to: end, order: 'asc' as const };
      const [meals, movement] = await Promise.all([
        listEntries('meals', range),
        listEntries('movement', range),
      ]);
      return { meals: meals.map(toEntry), movement: movement.map(toEntry) };
    },
  });
}
