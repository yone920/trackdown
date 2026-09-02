import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { IconAvatar } from '@/components/icons';
import { dismissDeletes } from '@/components/kit';
import { BodyTile } from '@/components/progress/body-tile';
import { CardioTile } from '@/components/progress/cardio-tile';
import { CoverageTile } from '@/components/progress/coverage-tile';
import { DaysTile } from '@/components/progress/days-tile';
import { GoalTile } from '@/components/progress/goal-tile';
import { StrengthTile } from '@/components/progress/strength-tile';
import { TILE_GAP } from '@/components/progress/tile';
import { Disp, Eyebrow } from '@/components/type';
import { dateEyebrow } from '@/lib/format';
import {
  bodyRow,
  cardioRow,
  daysHeadline,
  daysRow,
  goalRow,
  strengthRow,
} from '@/lib/scoreboard';
import {
  localDateKey,
  useDays,
  useGoalProgress,
  useGoals,
  usePrefetchExercises,
  useTrainingBoard,
  useWeek,
} from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, SPACE } from '@/lib/theme';
import type { GoalWithProgress } from '@/lib/types';

// Progress — the scoreboard (user decision 2026-09-02, from a reviewed mockup).
//
// **One screenful of live facts, and no required scrolling.** Seven rows, top to bottom:
// the goal, the body, the strength board, coverage, cardio, and the last three days. Each
// row is a compact tile carrying the most important computed thing about its section, and
// each is a DOOR to the screen that holds the rest of it. If the user never taps anything,
// the page alone has said how they are doing.
//
// What this replaces: the same page with everything open on it — the whole goal card, the
// six lift cards with their sparklines, the weigh-in rows, two full-width body figures, the
// cardio breakdown, the sessions-a-week bars and the entire days archive, in that order,
// several screens deep. Every one of those still exists; none of it is on the page.
//
//   · the goal card, its admin and the history   → app/progress/goal.tsx
//   · the weigh-ins and the full weight line     → app/progress/body.tsx
//   · the six live lifts and "All lifts"         → app/progress/strength.tsx
//   · the figures, the legend, sessions a week   → app/progress/coverage.tsx
//   · equivalent minutes, breakdown, pace, rows  → app/progress/cardio.tsx
//   · every day ever logged                      → app/days.tsx
//
// The body figure has one more home: tapping a muscle chip on the coverage row opens it
// zoomed over the page, with the ledger's facts about that muscle beside it
// (components/progress/muscle-sheet.tsx).
//
// Nothing on this page decides what a number means — every fact on every row comes out of
// lib/scoreboard.ts, which is arithmetic and tested without a renderer.

export default function Progress() {
  const router = useRouter();
  const insets = useScreenInsets();
  const today = localDateKey();

  const goals = useGoals();
  const week = useWeek();
  const board = useTrainingBoard();
  const days = useDays(undefined, 7);

  const active = goals.data?.active ?? [];
  const primary = active[0] ?? null;
  // The goals list carries the percentages but not the points, and the delta on the row is
  // a claim about two dated readings — so the primary goal's own progress is read here, the
  // same query the goal screen behind this row uses (react-query hands them one result).
  const progress = useGoalProgress(primary?.id ?? null);
  const withSeries: GoalWithProgress | null = useMemo(
    () =>
      primary && progress.data?.metrics
        ? { ...primary, progress: { ...primary.progress, metrics: progress.data.metrics } }
        : primary,
    [primary, progress.data],
  );

  const goal = useMemo(
    // The weigh-ins are the evidence behind a smoothed measure: the goal's own series is a
    // 7-day average, and "−2.0 lb since Aug 31" is a claim about what the scale read.
    () => (withSeries ? goalRow(withSeries, { today, weighIns: board.data?.body.series ?? [] }) : null),
    [withSeries, today, board.data],
  );
  const body = useMemo(() => bodyRow(board.data?.body ?? null, today), [board.data, today]);
  const strength = useMemo(() => strengthRow(board.data?.lifts ?? []), [board.data]);
  const cardio = useMemo(() => cardioRow(board.data?.cardio ?? null), [board.data]);
  const dayRows = useMemo(() => daysRow(days.data?.days ?? []), [days.data]);

  const refreshing = goals.isRefetching || board.isRefetching || week.isRefetching || days.isRefetching;
  const onRefresh = useCallback(() => {
    goals.refetch();
    board.refetch();
    week.refetch();
    days.refetch();
  }, [goals, board, week, days]);

  // The sheets behind the two mover names, warmed while the page is being read.
  usePrefetchExercises(
    strength.movers.map((mover) => ({ id: mover.exercise_id, mediaCount: mover.media_count })),
  );

  /**
   * Today's row goes to the Train TAB, not to `/day/<today>` (user decision 2026-09-01).
   * The open day has one page and it is the tab; the day page is the archival reading of a
   * day that has closed.
   */
  const openDay = (date: string) => (date === today ? router.push('/train') : router.push(`/day/${date}`));

  return (
    <ScrollView
      testID="progress-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      // A scroll is an answer of "no" to an armed Delete? (components/kit.tsx).
      onScrollBeginDrag={dismissDeletes}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: SPACE.tabBar + 24,
        gap: TILE_GAP,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}>
      {/* 1 · The title, the day, and the way to the plan and the account. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
        <Disp size={30} style={{ flex: 1 }}>
          Progress
        </Disp>
        <Eyebrow testID="progress-date" style={{ marginRight: 12 }}>
          {dateEyebrow()}
        </Eyebrow>
        <Pressable
          testID="progress-you"
          accessibilityRole="button"
          accessibilityLabel="You"
          onPress={() => router.push('/you')}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: C.track,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <IconAvatar size={18} color={C.mute} />
        </Pressable>
      </View>

      {/* 2 · GOAL */}
      <GoalTile
        goal={goal}
        loading={goals.isLoading}
        onOpen={() => router.push('/progress/goal')}
        onTell={() => router.push({ pathname: '/log', params: { hint: 'goal' } })}
      />

      {/* 3 · BODY */}
      <BodyTile body={body} loading={board.isLoading} onOpen={() => router.push('/progress/body')} />

      {/* 4 · STRENGTH */}
      <StrengthTile
        strength={strength}
        loading={board.isLoading}
        onOpen={() => router.push('/progress/strength')}
      />

      {/* 5 · COVERAGE */}
      <CoverageTile
        coverage={board.data?.frequency.coverage}
        lifts={board.data?.lifts ?? []}
        onOpen={() => router.push('/progress/coverage')}
      />

      {/* 6 · CARDIO — hidden entirely when there is none and nobody asked for any: a section
          of zeroes on the screen of somebody who lifts and does not run is the app inventing
          a shortfall (lib/scoreboard.ts §cardioRow). */}
      {cardio ? <CardioTile cardio={cardio} onOpen={() => router.push('/progress/cardio')} /> : null}

      {/* 7 · DAYS */}
      <DaysTile
        days={dayRows}
        headline={daysHeadline(week.data ?? null)}
        loading={days.isLoading}
        onOpenDay={openDay}
        onAll={() => router.push('/days')}
      />
    </ScrollView>
  );
}
