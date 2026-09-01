import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { GoalBanner } from '@/components/goal-banner';
import { IconAvatar, IconChevronRight } from '@/components/icons';
import { Card, Chip, Chips, dismissDeletes } from '@/components/kit';
import { MetricCard } from '@/components/metric-card';
import { PlanSection } from '@/components/plan-section';
import { ReadingCard } from '@/components/reading-card';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { dateEyebrow, dateLabel, kcal } from '@/lib/format';
import {
  localDateKey,
  useCoachNext,
  useDay,
  useGoals,
  useProfile,
  useWeek,
} from '@/lib/queries';
import { keyboardPadding, useKeyboardHeight } from '@/lib/keyboard';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import { todayCards } from '@/lib/today-cards';
import { sessionSpan, splitBySource } from '@/lib/training-groups';
import type { DayView } from '@/lib/types';

// Today — the working page for the open day. Top to bottom: where you are, the goal, the
// cards that goal decides, the model's two sentences about right now, the PLAN, and then
// one line each for what you have done and what you have eaten.
//
// It is short on purpose (user decision 2026-09-01, from screenshots of the merged page).
// Three things came off it and the reason was the same each time — **it was pushing the
// day off its own screen**:
//
//   * the full grouped training log and the full meal list, now behind two doors
//     (app/today/training.tsx, app/today/eating.tsx). What stays is the state and the tap.
//   * "The day so far" — the arc. "It is useless": the Done line already says when.
//   * the Body numbers and the 7-day weight card, which live on Home. Neither moves over
//     the course of a day, so neither is news here.
//
// And one thing came off for a different reason: the plan's own text box, its Photo/Type
// tiles and its submit button were a SECOND input surface, which concept-v2 §Principles 7
// forbids outright. Adjusting the plan is told through the + like everything else.
//
// Nothing on this screen is computed here. `/api/day/:date` answers with the totals, the
// verdict, the blocks and the deltas; `/api/goals` with the goal and its progress. The one
// judgement the app makes is *which cards to show*, and that is lib/today-cards.ts.

const STATUS_WORDS: Record<DayView['status'], { text: string; color: string }> = {
  on_track: { text: 'on track', color: C.good },
  over: { text: 'over', color: C.accent },
  under: { text: 'under', color: C.accent },
  none: { text: '—', color: C.mute },
};

export default function Today() {
  const router = useRouter();
  const insets = useScreenInsets();
  const keyboard = useKeyboardHeight();
  // Recomputed on every render, so an app left open overnight asks for the new day.
  const date = localDateKey();

  const day = useDay(date);
  const week = useWeek();
  const goals = useGoals();
  const profile = useProfile();
  // Pull-to-refresh refreshes the plan's ticks too — the same query PlanSection reads, so
  // this costs no extra request, and `generate=false` means it can never make a plan.
  const coachNext = useCoachNext();

  const refreshing = day.isRefetching || week.isRefetching || goals.isRefetching;
  const onRefresh = useCallback(() => {
    day.refetch();
    week.refetch();
    goals.refetch();
    profile.refetch();
    coachNext.refetch();
  }, [day, week, goals, profile, coachNext]);

  const goal = goals.data?.active?.[0] ?? null;
  const cards = useMemo(
    () =>
      day.data
        ? // The 7-day weight lives on Home (user decision 2026-09-01): it does not move
          // over the course of a day, so it is not news on the working page.
          todayCards({ day: day.data, week: week.data ?? null, goal }).filter(
            (card) => card.key !== 'weight-trend',
          )
        : [],
    [day.data, week.data, goal],
  );

  const openLog = (hint?: string) =>
    router.push(hint ? { pathname: '/log', params: { hint } } : '/log');


  if (day.isLoading && !day.data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.mute} />
      </View>
    );
  }

  if (day.error || !day.data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: SPACE.screen, justifyContent: 'center' }}>
        <Disp size={26}>Could not reach the server</Disp>
        <Sub style={{ marginTop: 8 }}>{(day.error as Error | null)?.message ?? 'No day to show.'}</Sub>
        <View style={{ marginTop: 18, alignSelf: 'flex-start' }}>
          <Chip label="Try again" variant="primary" onPress={onRefresh} />
        </View>
      </View>
    );
  }

  const view = day.data;
  const status = STATUS_WORDS[view.status];
  const reading = view.reading;
  // Training is filed the way the closed Day files it — one rule, lib/training-groups.ts.
  // Today used to group by auto-block, so the same workout looked like two different
  // workouts depending on which page you opened it from (user decision 2026-09-01).
  const { logged, health } = splitBySource(view.items.activities);
  const span = sessionSpan(logged);
  // The plan absorbs the log when there is one — the totals move onto its own header.
  const hasPlan = !!coachNext.data?.brief;
  const moves = logged.length + health.length;
  // How the day is going, in one line each. Facts only: no verdict, nothing owed.
  const doneLine =
    moves === 0
      ? 'Nothing logged yet'
      : [`${kcal(view.earned)} kcal earned`, span, `${moves} ${moves === 1 ? 'move' : 'moves'}`]
          .filter(Boolean)
          .join(' · ');
  const left = view.allowance == null ? null : Math.round(view.allowance - view.eaten);
  const eatLine =
    view.items.meals.length === 0
      ? left == null
        ? 'Nothing eaten yet'
        : `Nothing eaten yet · ${kcal(left)} left`
      : left == null
        ? `${kcal(view.eaten)} eaten`
        : `${kcal(view.eaten)} eaten · ${kcal(Math.abs(left))} ${left < 0 ? 'over' : 'left'}`;

  return (
    <ScrollView
      testID="today-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      onScrollBeginDrag={dismissDeletes}
      // The plan's "adjust it" box lives on this page now, so the page owns the keyboard:
      // UIKit's own inset is what lets the box scroll clear, and on Android the padding
      // does it (lib/keyboard.ts explains why never both).
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140 + keyboardPadding(keyboard),
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{dateEyebrow()}</Eyebrow>
          <Disp size={30} style={{ marginTop: 6 }}>
            {/* An empty day carries no verdict: 0 eaten is trivially "under allowance", and a
                green "on track" at 6 am judges a day that has not happened (user report). */}
            {view.items.meals.length + view.items.activities.length + view.items.weights.length === 0 ? (
              <>Day {view.day_number}</>
            ) : (
              <>
                Day {view.day_number} ·{' '}
                <Text style={{ color: status.color, fontFamily: FONT.disp }}>{status.text}</Text>
              </>
            )}
          </Disp>
        </View>
        <Pressable
          testID="today-you"
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

      {/* The goal, or the absence of one */}
      <View style={{ marginTop: 18 }}>
        <GoalBanner
          testID="goal-banner"
          title={goal?.title ?? null}
          sub={goalSubtitle(goal?.metrics ?? [], goal?.progress?.percent ?? null)}
          percent={goal?.progress?.percent ?? null}
          onPress={() => router.push('/progress')}
        />
      </View>

      {/* The cards the goal decides */}
      <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {cards.map((card) => (
          <View key={card.key} style={card.full ? { width: '100%' } : { flexGrow: 1, flexBasis: '46%' }}>
            <MetricCard
              testID={`metric-${card.key}`}
              eyebrow={card.eyebrow}
              value={card.value}
              unit={card.unit}
              sub={card.sub}
              chart={card.chart}
              valueColor={card.valueColor}
            />
          </View>
        ))}
      </View>

      {/* No target yet: the profile cannot produce one, so say what is missing. */}
      {view.allowance == null && profile.data?.targets?.source === 'none' ? (
        <Card style={{ marginTop: 12 }}>
          <Eyebrow>No calorie target yet</Eyebrow>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>
            Tell me your height, your age and what you weigh and I can work out what to eat.
          </Body>
          <View style={{ marginTop: 14 }}>
            <Chips>
              <Chip label="Tell me" variant="primary" onPress={() => openLog()} />
            </Chips>
          </View>
        </Card>
      ) : null}

      {/* Right now */}
      {reading ? (
        <View style={{ marginTop: 12 }}>
          {/* A pure reading, refreshed after every log. No action chips: the + is the one
              door for logging (user decision 2026-09-01) — extra buttons implied there were
              different kinds of logging. */}
          <ReadingCard eyebrow="Right now" text={reading.text} live={view.is_today} />
        </View>
      ) : null}

      {/* Do — the day's plan, where the day is (user decision 2026-09-01). It was a page
          of its own behind an accent button at the bottom of this screen, which put the
          plan and the record of what actually happened on two different screens when they
          are two halves of one day. Opening this tab still generates nothing: the read is
          an exists-check, and "Start today's workout" is the only generator in the app
          (components/plan-section.tsx). */}
      <PlanSection />

      {/* The two logs, behind doors (user decision 2026-09-01). The full grouped list of
          what was done used to be the whole middle of this page, which pushed the plan,
          the meals and everything else off the bottom of a real gym day. What is left here
          is a line that says how the day is going, and a tap that opens the log.

          The Eat line carries ONE calorie figure, and it is the day's own arithmetic. The
          card that used to sit here printed the same number three times in three sizes and
          then quoted a different one underneath, out of an older generation of the coach's
          brief; that guidance now lives behind the door, a screen away from the number
          that counts. Two disagreeing calorie figures on one card is worse than none. */}
      {/* With a plan, the training section IS the log: every line carries what was done
          under what was asked for, and off-plan work joins the same card (user decision
          2026-09-01). A second Done row would be the two-section layout coming back. With
          no plan there is no skeleton to hang the log off, so the door stays. */}
      {hasPlan ? null : (
        <SummaryRow
          testID="today-done"
          title="Done"
          line={doneLine}
          onPress={() => router.push('/today/training')}
        />
      )}
      <SummaryRow
        testID="today-eat"
        title="Eat"
        line={eatLine}
        onPress={() => router.push('/eat')}
      />

    </ScrollView>
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


/**
 * One line about a whole section, and a tap that opens it. The logs were pushing the rest
 * of the day off the screen (user decision 2026-09-01: "we can hide them behind a
 * button"), so what stays on Today is the state and the door to the detail.
 */
function SummaryRow({
  testID,
  title,
  line,
  onPress,
}: {
  testID: string;
  title: string;
  line: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title} — ${line}`}
      onPress={onPress}
      style={({
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: RADIUS.card,
        backgroundColor: C.card,
        paddingVertical: 16,
        paddingHorizontal: SPACE.card,
        opacity: 1,
      })}>
      <View style={{ flex: 1 }}>
        <Disp size={19} weight="semi">
          {title}
        </Disp>
        <Sub testID={`${testID}-line`} style={[{ marginTop: 4 }, TABULAR]}>
          {line}
        </Sub>
      </View>
      <IconChevronRight size={18} color={C.mute} />
    </Pressable>
  );
}
