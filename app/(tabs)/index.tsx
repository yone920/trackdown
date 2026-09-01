import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { GoalBanner } from '@/components/goal-banner';
import { IconAvatar, IconChevronRight } from '@/components/icons';
import { Card, Section } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { ReadingCard } from '@/components/reading-card';
import { dateEyebrow, dateLabel, kcal } from '@/lib/format';
import { localDateKey, useCoachStatus, useDay, useGoals, useTrainingBoard } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import type { CoachStatus, DayView, TrainingBoard } from '@/lib/types';

// HOME — the morning glance, and the ONLY page that thinks in whole days (user decision
// 2026-09-01: every other tab owns one verb — Train the session, Eat the food, Progress the
// long view).
//
// So the whole-day framing lives here and nowhere else: the day number and its verdict, the
// goal, the Right-now reading that reads food and training together, one line of calories,
// and the button into the session. Everything on it is either a fact about the day or a
// door to the tab that owns the detail — the calories line goes to Eat, the button goes to
// Train, the weight and the week go to Progress.
//
// Two rules it inherits unchanged:
//   * **An empty day carries no verdict.** 0 eaten is trivially "under allowance", and a
//     green "on track" at 6 am judges a day that has not happened.
//   * **Nothing here can generate a plan.** `/api/coach/status` is an exists-check that
//     cannot write, and `/api/day/:date` is a read. The button is a door.

const STATUS_WORDS: Record<DayView['status'], { text: string; color: string }> = {
  on_track: { text: 'on track', color: C.good },
  over: { text: 'over', color: C.accent },
  under: { text: 'under', color: C.accent },
  none: { text: '—', color: C.mute },
};

export default function Home() {
  const router = useRouter();
  const insets = useScreenInsets();

  const goals = useGoals();
  const board = useTrainingBoard();
  // Home is the only page that thinks in whole days now (user decision 2026-09-01), so it
  // is the one that reads the day. `/api/day/:date` is a read; nothing here generates.
  const day = useDay(localDateKey());
  // An exists-check on the server, and that is a property of the endpoint rather than of
  // this page: `/api/coach/status` cannot generate anything (user decision 2026-08-31 §1).
  const coach = useCoachStatus();

  const refreshing = goals.isRefetching || board.isRefetching || coach.isRefetching || day.isRefetching;
  const onRefresh = useCallback(() => {
    goals.refetch();
    board.refetch();
    coach.refetch();
    day.refetch();
  }, [goals, board, coach, day]);

  const goal = goals.data?.active?.[0] ?? null;
  const body = board.data?.body ?? null;
  const status = coach.data ?? null;
  const view = day.data ?? null;
  const verdict = view ? STATUS_WORDS[view.status] : null;
  // An empty day carries NO verdict: 0 eaten is trivially "under allowance", and a green
  // "on track" at 6 am judges a day that has not happened (user report). The rule came with
  // the header when it moved here from Train, and it comes unchanged.
  const dayHappened =
    !!view && view.items.meals.length + view.items.activities.length + view.items.weights.length > 0;
  const left = view?.allowance == null ? null : Math.round(view.allowance - view.eaten);

  return (
    <ScrollView
      testID="home-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{dateEyebrow()}</Eyebrow>
          <Disp size={30} style={{ marginTop: 6 }}>
            {!view ? (
              <>Where you are</>
            ) : dayHappened && verdict ? (
              <>
                Day {view.day_number} ·{' '}
                <Text testID="home-verdict" style={{ color: verdict.color, fontFamily: FONT.disp }}>
                  {verdict.text}
                </Text>
              </>
            ) : (
              <>Day {view.day_number}</>
            )}
          </Disp>
        </View>
        <Pressable
          testID="home-you"
          accessibilityLabel="You"
          onPress={() => router.push('/you')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: C.track,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <IconAvatar size={20} color={C.mute} />
        </Pressable>
      </View>

      {/* The goal, or the absence of one — the same banner Today draws, because it is the
          same fact and it should not read as two different ones. */}
      <View style={{ marginTop: 18 }}>
        <GoalBanner
          testID="home-goal"
          title={goal?.title ?? null}
          sub={goalSubtitle(goal?.metrics ?? [], goal?.progress?.percent ?? null)}
          percent={goal?.progress?.percent ?? null}
          onPress={() => router.push('/progress')}
        />
      </View>

      {/* Right now — the two sentences that read the whole day, which is why they belong
          on the page that thinks in whole days and not on either half of it. A pure
          reading, refreshed after every log; the + is the one door to logging. */}
      {view?.reading ? (
        <View style={{ marginTop: 12 }}>
          <ReadingCard eyebrow="Right now" text={view.reading.text} live={view.is_today} />
        </View>
      ) : null}

      {/* A GLANCE at the food, not a second copy of the Eat page: one line, and a tap that
          opens the tab that owns it. */}
      <Pressable
        testID="home-eat"
        accessibilityRole="button"
        accessibilityLabel="Eating today"
        onPress={() => router.push('/eat')}
        style={({
          marginTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: RADIUS.card,
          backgroundColor: C.card,
          paddingVertical: 14,
          paddingHorizontal: SPACE.card,
          opacity: 1,
        })}>
        <Sub testID="home-eat-line" style={[{ flex: 1 }, TABULAR]}>
          {!view
            ? 'Eating'
            : left == null
              ? `${kcal(view.eaten)} eaten`
              : `${kcal(view.eaten)} eaten · ${kcal(Math.abs(left))} ${left < 0 ? 'over' : 'left'}`}
        </Sub>
        <IconChevronRight size={18} color={C.mute} />
      </Pressable>

      {/* The one button. It is a DOOR — it opens Today, where the plan lives and where the
          only generator in the app is. Pressing it here has never written anything. */}
      <Pressable
        testID="home-today"
        accessibilityLabel={planLabel(status)}
        onPress={() => router.push('/train')}
        style={({
          marginTop: 16,
          borderRadius: RADIUS.pill,
          backgroundColor: C.accent,
          paddingVertical: 16,
          alignItems: 'center',
          opacity: 1,
        })}>
        <Body style={{ fontFamily: FONT.semi, color: C.bg }}>{planLabel(status)}</Body>
        {planProgress(status) ? (
          <Sub testID="home-today-sub" style={{ marginTop: 3, color: C.bg, opacity: 0.75 }}>
            {planProgress(status)}
          </Sub>
        ) : null}
      </Pressable>

      {/* The body, over a week. Not today's number — today's number is noise, and this
          page is about the direction (concept-v2 §Calories: "the week is the unit"). */}
      <Section title="Weight" summary={body?.latest_date ? dateLabel(body.latest_date) : null}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="7-day avg" value={body?.avg_7d == null ? '—' : body.avg_7d.toFixed(1)} unit="lb" />
          <Stat
            label="Trend"
            value={
              body?.trend_per_week == null
                ? '—'
                : `${body.trend_per_week > 0 ? '+' : '−'}${Math.abs(body.trend_per_week).toFixed(1)}`
            }
            unit="lb / wk"
            color={trendColor(body?.trend_per_week ?? null, goal?.kind ?? null)}
          />
        </View>
        {body?.avg_7d == null ? (
          <Card style={{ marginTop: 10 }}>
            <Sub testID="home-weight-empty" style={{ lineHeight: 18 }}>
              No weigh-ins yet. Say what you weigh and the trend starts here.
            </Sub>
          </Card>
        ) : null}
      </Section>

      {/* The week, in two numbers: how often, and how much cardio. Both against what was
          actually aimed for, and neither of them a judgement. */}
      <Section title="This week">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat
            label="Trained"
            value={board.data ? String(board.data.frequency.sessions_this_week) : '—'}
            unit={sessionsUnit(board.data ?? null)}
          />
          <Stat
            label="Cardio"
            value={board.data ? String(Math.round(cardioEquivalent(board.data))) : '—'}
            unit={board.data ? `of ${board.data.cardio.weekly_target_min} equiv min` : 'equiv min'}
          />
        </View>
      </Section>

      {/* One quiet door onward. Progress is the long view; this page is the short one. */}
      <Pressable
        testID="home-progress"
        accessibilityLabel="See the whole picture"
        onPress={() => router.push('/progress')}
        style={({
          marginTop: 26,
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          opacity: 1,
        })}>
        <Sub style={{ flex: 1 }}>See the whole picture</Sub>
        <IconChevronRight size={18} color={C.mute} />
      </Pressable>
    </ScrollView>
  );
}

/**
 * What the button says, and the two states are whether a plan has been asked for today
 * (user decision 2026-08-31 §1). A status that has not arrived reads as the invitation: it
 * is the safe half of the pair — it promises nothing that is not there, and the tap opens
 * the same page either way.
 */
export function planLabel(status: CoachStatus | null): string {
  return status?.has_plan ? 'Today’s session' : "Start today's workout";
}

/** "2 of 6 done" once a plan is being worked through. A rest day counts nothing. */
export function planProgress(status: CoachStatus | null): string | null {
  if (!status?.has_plan || status.total_count === 0) return null;
  if (status.complete) return 'Plan complete ✓';
  return status.done_count === 0
    ? `${status.total_count} moves`
    : `${status.done_count} of ${status.total_count} done`;
}

/** "of 4 planned" when they said how often they train; plain "sessions" when they did not. */
export function sessionsUnit(board: TrainingBoard | null): string {
  const target = board?.frequency.training_days_target ?? null;
  return target ? `of ${target} planned` : 'sessions';
}

/**
 * The week's cardio in the unit the target is measured in — equivalent minutes, where light
 * counts half and vigorous counts double (backend services/coach/cardioIntensity.ts). An
 * older server sends only the raw minutes, and raw minutes are the honest fallback.
 */
export function cardioEquivalent(board: TrainingBoard): number {
  return board.cardio.equiv_minutes_this_week ?? board.cardio.minutes_this_week;
}

/** Green when the trend is going the way the goal wants it to, quiet when there is no goal. */
function trendColor(trend: number | null, kind: string | null): string {
  if (trend == null || !kind) return C.ink;
  if (kind === 'lose_fat') return trend < 0 ? C.good : C.ink;
  if (kind === 'gain_muscle') return trend > 0 ? C.good : C.ink;
  return C.ink;
}

function Stat({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <Card style={{ flex: 1, padding: 14 }}>
      <Eyebrow>{label}</Eyebrow>
      <Disp size={26} style={[{ marginTop: 6, color: color ?? C.ink }, TABULAR]}>
        {value}
      </Disp>
      {unit ? <Sub style={{ marginTop: 2 }}>{unit}</Sub> : null}
    </Card>
  );
}

/** The line under the goal's title: what it is measured on, and where it finishes. */
function goalSubtitle(
  metrics: { measure: string; target?: number | null; unit?: string | null; by?: string | null }[],
  percent: number | null,
): string | null {
  const first = metrics[0];
  if (!first) return percent == null ? null : `${Math.round(percent * 100)}% of the way`;
  const target = first.target == null ? null : `${first.target}${first.unit ? ` ${first.unit}` : ''}`;
  const by = first.by ? ` by ${dateLabel(first.by)}` : '';
  return target ? `${target}${by}` : by.trim() || null;
}
