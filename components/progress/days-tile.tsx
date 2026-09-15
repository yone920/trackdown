import { Pressable, View } from 'react-native';

import { Tile, TileHead } from '@/components/progress/tile';
import { Body, Sub } from '@/components/type';
import type { DayLineView } from '@/lib/scoreboard';
import { C, TABULAR } from '@/lib/theme';

// DAYS — a fortnight as a shape, and a door to every day before it.
//
// It was the last three days as three sentences: "Served your goal · Hamstrings & Lo…",
// "340 …". Both halves truncated, the right-hand column sat under the floating +, and three
// rows of prose is the densest way there is to say what a row of marks says at a glance
// (user decision 2026-09-03, from a reviewed mockup).
//
// So: one bar per day, most recent on the right, coloured by the day's verdict. The bar's
// HEIGHT is the day's calories earned against the best day on the strip — a second fact for
// free, and the reason the strip has a shape rather than being a row of dots. Every bar is
// still the day it stands for: tap it and the day opens, as the row did.
//
// The open day is an outline rather than a fill, which is the Days list's own rule
// (components/days-list.tsx): today is not over, so it is not filled in.

/** Tall enough for the eye to read a difference, short enough to stay a summary. */
const STRIP_HEIGHT = 34;
/** A day that earned nothing still gets a stub, so the week's shape has no holes in it. */
const MIN_FRACTION = 0.18;

const FILL: Record<string, string> = {
  served: C.good,
  missed: C.accent,
  unlogged: C.track,
  none: C.track,
};

export function DaysTile({
  days,
  headline,
  loading,
  onOpenDay,
  onAll,
}: {
  /** Newest first, as `daysRow` returns them. */
  days: DayLineView[];
  /** "3 of 3 served" — the week, when there is a judged week to report. */
  headline: string | null;
  loading: boolean;
  onOpenDay: (date: string) => void;
  onAll: () => void;
}) {
  // Oldest on the left: a strip of time reads the way time does.
  const strip = [...days].reverse();
  const peak = Math.max(...strip.map((day) => day.earned ?? 0), 1);
  const served = strip.filter((day) => day.verdict === 'served').length;
  const missed = strip.filter((day) => day.verdict === 'missed').length;

  return (
    <Tile testID="tile-days">
      <TileHead
        eyebrow={headline ? `Days · ${headline}` : 'Days'}
        right={
          <Pressable
            testID="days-all"
            accessibilityRole="button"
            accessibilityLabel="All days"
            onPress={onAll}
            hitSlop={8}>
            <Sub style={{ color: C.mute, textDecorationLine: 'underline', textDecorationColor: C.track }}>
              All days
            </Sub>
          </Pressable>
        }
      />

      {strip.length === 0 ? (
        <Sub testID="days-empty" style={{ marginTop: 6 }}>
          {loading ? 'Reading your days…' : 'Nothing logged yet.'}
        </Sub>
      ) : (
        <>
          <Body testID="days-summary" style={[{ marginTop: 4 }, TABULAR]}>
            {`${strip.length} days`}
            <Body style={{ color: C.mute }}>
              {` · ${served} served${missed > 0 ? `, ${missed} missed` : ''}`}
            </Body>
          </Body>

          <View
            testID="days-strip"
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 3,
              height: STRIP_HEIGHT,
              marginTop: 11,
            }}>
            {strip.map((day) => {
              const fraction = Math.max(MIN_FRACTION, (day.earned ?? 0) / peak);
              return (
                <Pressable
                  key={day.date}
                  testID={`day-bar-${day.date}`}
                  accessibilityRole="button"
                  accessibilityLabel={day.line}
                  onPress={() => onOpenDay(day.date)}
                  style={{
                    flex: 1,
                    height: `${Math.round(fraction * 100)}%`,
                    borderRadius: 2,
                    backgroundColor: day.open ? 'transparent' : FILL[day.verdict] ?? C.track,
                    borderWidth: day.open ? 1.5 : 0,
                    borderColor: C.good,
                  }}
                />
              );
            })}
          </View>
        </>
      )}
    </Tile>
  );
}
