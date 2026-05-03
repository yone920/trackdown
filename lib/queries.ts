import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from './supabase';
import {
  buildRecommendation,
  type GoalPace,
  type Recommendation,
} from './recommendations';
import {
  type ActivityLevel,
  type Sex,
} from './tdee';

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

const TABLE = { meals: 'meals', movement: 'calorie_expenditure' } as const;
type Kind = keyof typeof TABLE;

async function fetchToday(kind: Kind): Promise<Entry[]> {
  const { start, end } = dayBounds();
  const { data, error } = await supabase
    .from(TABLE[kind])
    .select('id, description, kcal, logged_at')
    .gte('logged_at', start)
    .lt('logged_at', end)
    .order('logged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    time: formatTime(r.logged_at as string),
    name: r.description as string,
    kcal: (r.kcal as number) ?? 0,
  }));
}

async function fetchRecentUnique(
  kind: Kind,
  limit: number,
): Promise<{ name: string; kcal: number }[]> {
  const { data, error } = await supabase
    .from(TABLE[kind])
    .select('description, kcal, logged_at')
    .order('logged_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  const seen = new Map<string, { name: string; kcal: number }>();
  for (const r of data ?? []) {
    const name = r.description as string;
    if (!seen.has(name)) seen.set(name, { name, kcal: (r.kcal as number) ?? 0 });
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
  const { data, error } = await supabase
    .from('meals')
    .select('protein_g, carbs_g, fat_g, fiber_g')
    .gte('logged_at', start)
    .lt('logged_at', end);
  if (error) throw error;
  const totals: TodayMacros = { protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const r of data ?? []) {
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
        const { data, error } = await supabase
          .from('weight_logs')
          .select('id, weight_lb, logged_at')
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return {
          id: data.id as string,
          time: formatTime(data.logged_at as string),
          name: 'Weight reading',
          kcal: 0,
          weight_lb: Number(data.weight_lb),
        };
      }
      const { data, error } = await supabase
        .from(TABLE[kind])
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as Record<string, unknown>;
      const base: EntryDetail = {
        id: row.id as string,
        time: formatTime(row.logged_at as string),
        name: row.description as string,
        kcal: (row.kcal as number) ?? 0,
      };
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

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id }: { kind: EntryKind; id: string }) => {
      const table = kind === 'weight' ? 'weight_logs' : TABLE[kind];
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
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
      const { error } = await supabase.from(TABLE[kind]).update(patch).eq('id', id);
      if (error) throw error;
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
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const user = userData.user;
      if (!user) throw new Error('Not authenticated.');
      const { error } = await supabase.from(TABLE[kind]).insert({
        user_id: user.id,
        description: input.description,
        kcal: input.kcal,
      });
      if (error) throw error;
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

export function useLogText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string): Promise<LoggedItem[]> => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('Say something first.');

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const user = userData.user;
      if (!user) throw new Error('Not authenticated.');

      const { data: parsed, error: fnErr } = await supabase.functions.invoke<{
        items: ParsedItem[];
      }>('parse-log', { body: { text: trimmed } });
      if (fnErr) throw fnErr;
      const items = parsed?.items ?? [];
      if (items.length === 0) throw new Error('Could not understand that.');

      const meals = items.filter((i) => i.type === 'meal');
      const movement = items.filter((i) => i.type === 'movement');
      const weights = items.filter((i) => i.type === 'weight' && i.weight_lb);

      const ids: { meal: string[]; movement: string[]; weight: string[] } = {
        meal: [],
        movement: [],
        weight: [],
      };

      if (meals.length > 0) {
        const { data, error } = await supabase.from('meals').insert(
          meals.map((i) => ({
            user_id: user.id,
            description: i.description,
            kcal: i.kcal ?? 0,
            protein_g: i.protein_g ?? null,
            carbs_g: i.carbs_g ?? null,
            fat_g: i.fat_g ?? null,
            fiber_g: i.fiber_g ?? null,
          })),
        ).select('id');
        if (error) throw error;
        ids.meal = (data ?? []).map((r) => r.id as string);
      }
      if (movement.length > 0) {
        const { data, error } = await supabase.from('calorie_expenditure').insert(
          movement.map((i) => ({
            user_id: user.id,
            description: i.description,
            kcal: i.kcal ?? 0,
          })),
        ).select('id');
        if (error) throw error;
        ids.movement = (data ?? []).map((r) => r.id as string);
      }
      if (weights.length > 0) {
        const { data, error } = await supabase.from('weight_logs').insert(
          weights.map((i) => ({
            user_id: user.id,
            weight_lb: i.weight_lb,
          })),
        ).select('id');
        if (error) throw error;
        ids.weight = (data ?? []).map((r) => r.id as string);
      }

      const counters = { meal: 0, movement: 0, weight: 0 };
      const enriched = items.map((item) => {
        if (item.type === 'weight' && !item.weight_lb) return { ...item };
        const idx = counters[item.type]++;
        return { ...item, id: ids[item.type][idx] };
      });
      console.log('[useLogText:v3] enriched items', enriched);
      return enriched;
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
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const [mealsRes, moveRes] = await Promise.all([
    supabase
      .from('meals')
      .select('kcal, logged_at')
      .gte('logged_at', startISO)
      .lt('logged_at', endISO),
    supabase
      .from('calorie_expenditure')
      .select('kcal, logged_at')
      .gte('logged_at', startISO)
      .lt('logged_at', endISO),
  ]);
  if (mealsRes.error) throw mealsRes.error;
  if (moveRes.error) throw moveRes.error;

  const buckets = new Map<string, DaySummary>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = localDateKey(d);
    buckets.set(key, { date: key, consumed: 0, burned: 0, mealCount: 0, movementCount: 0 });
  }

  for (const r of mealsRes.data ?? []) {
    const key = localDateKey(new Date(r.logged_at as string));
    const b = buckets.get(key);
    if (b) {
      b.consumed += (r.kcal as number) ?? 0;
      b.mealCount += 1;
    }
  }
  for (const r of moveRes.data ?? []) {
    const key = localDateKey(new Date(r.logged_at as string));
    const b = buckets.get(key);
    if (b) {
      b.burned += (r.kcal as number) ?? 0;
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
  const { data, error } = await supabase
    .from(TABLE[kind])
    .select('id, description, kcal, logged_at')
    .gte('logged_at', start.toISOString())
    .order('logged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    description: r.description as string,
    kcal: (r.kcal as number) ?? 0,
    logged_at: r.logged_at as string,
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

async function fetchWeightLogs(days: number): Promise<WeightLog[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const { data, error } = await supabase
    .from('weight_logs')
    .select('id, weight_lb, logged_at')
    .gte('logged_at', start.toISOString())
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    weight_lb: Number(r.weight_lb),
    logged_at: r.logged_at as string,
  }));
}

async function fetchAllWeightLogs(): Promise<WeightLog[]> {
  const { data, error } = await supabase
    .from('weight_logs')
    .select('id, weight_lb, logged_at')
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    weight_lb: Number(r.weight_lb),
    logged_at: r.logged_at as string,
  }));
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
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    display_name: (row.display_name as string | null) ?? null,
    goal_weight_lb:
      row.goal_weight_lb === null || row.goal_weight_lb === undefined
        ? null
        : Number(row.goal_weight_lb),
    units: ((row.units as string) ?? 'imperial') as 'imperial' | 'metric',
    sex: (row.sex as Sex | null) ?? null,
    birth_year:
      row.birth_year === null || row.birth_year === undefined
        ? null
        : Number(row.birth_year),
    height_cm:
      row.height_cm === null || row.height_cm === undefined
        ? null
        : Number(row.height_cm),
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
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const userId = userData.user?.id;
      if (!userId) throw new Error('Not authenticated.');
      const { error } = await supabase
        .from('weight_logs')
        .insert({ user_id: userId, weight_lb: weightLb });
      if (error) throw error;
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
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const userId = userData.user?.id;
      if (!userId) throw new Error('Not authenticated.');
      const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
      if (error) throw error;
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
      const [mealsRes, moveRes] = await Promise.all([
        supabase
          .from('meals')
          .select('id, description, kcal, logged_at')
          .gte('logged_at', start)
          .lt('logged_at', end)
          .order('logged_at', { ascending: true }),
        supabase
          .from('calorie_expenditure')
          .select('id, description, kcal, logged_at')
          .gte('logged_at', start)
          .lt('logged_at', end)
          .order('logged_at', { ascending: true }),
      ]);
      if (mealsRes.error) throw mealsRes.error;
      if (moveRes.error) throw moveRes.error;
      const map = (r: { id: unknown; description: unknown; kcal: unknown; logged_at: unknown }) => ({
        id: r.id as string,
        time: formatTime(r.logged_at as string),
        name: r.description as string,
        kcal: (r.kcal as number) ?? 0,
      });
      return {
        meals: (mealsRes.data ?? []).map(map),
        movement: (moveRes.data ?? []).map(map),
      };
    },
  });
}
