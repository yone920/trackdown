import { Pressable, View } from 'react-native';

import { Tile, TileHead } from '@/components/progress/tile';
import { Body, Sub } from '@/components/type';
import type { DayLineView } from '@/lib/scoreboard';
import { C, TABULAR } from '@/lib/theme';

// DAYS — the last three, and a door to every one before them.
//
// The whole days archive used to be the top section of this page: every closed day, grouped
// by week, each week with its own tally. It is a record, and a record belongs where it can
// be read at length (app/days.tsx) rather than at the top of a scoreboard.
//
// The dot is the day's verdict, and an OPEN day is a ring: today is not over, so it is not
// filled in. That rule is the Days list's own (components/days-list.tsx) and it does not
// change because the row got shorter.

export function DaysTile({
  days,
  headline,
  loading,
  onOpenDay,
  onAll,
}: {
  days: DayLineView[];
  /** "3 of 3 served" — the week, when there is a judged week to report. */
  headline: string | null;
  loading: boolean;
  onOpenDay: (date: string) => void;
  onAll: () => void;
}) {
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

      {days.length === 0 ? (
        <Sub testID="days-empty" style={{ marginTop: 6 }}>
          {loading ? 'Reading your days…' : 'Nothing logged yet.'}
        </Sub>
      ) : (
        <View style={{ marginTop: 6 }}>
          {days.map((day, index) => (
            <Pressable
              key={day.date}
              testID={`day-row-${day.date}`}
              accessibilityRole="button"
              accessibilityLabel={day.line}
              onPress={() => onOpenDay(day.date)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 8,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: C.line,
              }}>
              <View
                testID={`day-dot-${day.date}`}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 4.5,
                  marginRight: 10,
                  backgroundColor: day.open ? 'transparent' : DOT[day.verdict],
                  borderWidth: day.open ? 1.5 : 0,
                  borderColor: C.good,
                }}
              />
              <Body style={{ flex: 1, paddingRight: 10 }} numberOfLines={1}>
                {day.line}
              </Body>
              <Sub testID={`day-right-${day.date}`} style={TABULAR}>
                {day.right}
              </Sub>
            </Pressable>
          ))}
        </View>
      )}
    </Tile>
  );
}

const DOT: Record<string, string> = {
  served: C.good,
  missed: C.accent,
  unlogged: C.track,
  none: C.track,
};
