import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { IconAvatar, IconChevronRight } from '@/components/icons';
import { Chip, dismissDeletes } from '@/components/kit';
import { PlanSection } from '@/components/plan-section';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { dateEyebrow, kcal } from '@/lib/format';
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
import { C, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import { sessionSpan, splitBySource } from '@/lib/training-groups';
import { OFFLINE_MESSAGE } from '@/lib/errors';
import { CalendarButton, CalendarSheet } from '@/components/calendar-sheet';

// TRAIN — the session, and nothing else (user decision 2026-09-01: each tab owns one verb).
//
// It was "Today", and it was the whole day: the day number and its verdict, the goal, the
// calories, the Right-now reading, the plan, the training log and the eating log. Then Eat
// became a tab of its own, and a page that keeps a calories card while another tab owns
// calories is two answers to one question. So the whole-day framing moved to HOME — which
// is the morning glance and the only page that thinks in days — and what is left here is
// the workout:
//
//   * the plan, ticked off, each done line carrying what was actually logged against it
//   * off-plan work, under "Also", in the same card
//   * Adjust / Replace, and Start today's workout when there is no plan
//   * the coach's one nudge
//
// Nothing on this page links food-ward. The + still logs anything from anywhere.
//
// Opening it generates NOTHING: the day and the plan are both reads, and
// `GET /api/coach/next?generate=false` cannot write. "Start today's workout" is the only
// generator in the app.

export default function Train() {
  const router = useRouter();
  const insets = useScreenInsets();
  // The month sheet, opened from the header. Closed by default and fetching nothing until
  // it is asked for (components/calendar-sheet.tsx).
  const [calendar, setCalendar] = useState(false);
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
        <Sub style={{ marginTop: 8 }}>{day.error ? OFFLINE_MESSAGE : 'No day to show.'}</Sub>
        <View style={{ marginTop: 18, alignSelf: 'flex-start' }}>
          <Chip label="Try again" variant="primary" onPress={onRefresh} />
        </View>
      </View>
    );
  }

  const view = day.data;
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
      {/* Header. TRAIN owns the session and nothing else (user decision 2026-09-01: each
          tab owns one verb). The day number, the verdict, the goal, the calories and the
          Right-now reading all moved to Home, which is the only page that thinks in whole
          days; eating moved to its own tab. What is left here is the workout. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{dateEyebrow()}</Eyebrow>
          <Disp size={30} style={{ marginTop: 6 }}>
            Train
          </Disp>
        </View>
        {/* Any day that has already happened, from the header (user request 2026-09-02).
            One sheet, shared with the other tab — components/calendar-sheet.tsx. */}
        <CalendarButton testID="train-calendar" onPress={() => setCalendar(true)} />
        <Pressable
          testID="train-you"
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

      {/* Do — the day's plan, where the day is (user decision 2026-09-01). It was a page
          of its own behind an accent button at the bottom of this screen, which put the
          plan and the record of what actually happened on two different screens when they
          are two halves of one day. Opening this tab still generates nothing: the read is
          an exists-check, and "Start today's workout" is the only generator in the app
          (components/plan-section.tsx). */}
      <PlanSection />

      {/* The training log, behind a door on a day with no plan to hang it off. */}
      {/* With a plan, the training section IS the log: every line carries what was done
          under what was asked for, and off-plan work joins the same card (user decision
          2026-09-01). A second Done row would be the two-section layout coming back. With
          no plan there is no skeleton to hang the log off, so the door stays. */}
      {hasPlan ? null : (
        <SummaryRow
          testID="today-done"
          title="Done"
          line={doneLine}
          onPress={() => router.push('/train/log')}
        />
      )}

      <CalendarSheet visible={calendar} onClose={() => setCalendar(false)} scope="train" />
    </ScrollView>
  );
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
