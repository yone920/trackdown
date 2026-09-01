import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { IconChevronRight } from '@/components/icons';
import { Card, Chip, Section } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { groupByWeek, weekdayLabel, type WeekGroup } from '@/lib/days-weeks';
import { localDateKey, useDaysPages, useWeek } from '@/lib/queries';
import { C, TABULAR } from '@/lib/theme';
import type { DayRow, Verdict } from '@/lib/types';

// The days, as a SECTION (user decision 2026-09-01: Days folds into Progress, and the tab
// bar goes to five — Home · Today · Eat · Progress · You). Every day the user has logged,
// newest first, grouped by the week it belongs to, each week carrying its own tally.
//
// Nothing about a row changed in the move: the verdict dot, the tally, the day number and
// where a tap goes are all exactly what the Days tab drew. What changed is the container —
// a FlatList became plain views, because a list inside a scrolling page is two scrollers
// fighting. Paging is a button instead of an edge, for the same reason: "load more when you
// reach the bottom" has no bottom to reach inside a longer page.

const DOT: Record<Verdict, string> = {
  served: C.good,
  missed: C.accent,
  unlogged: C.track,
  none: C.track,
};

export function DaysList() {
  const router = useRouter();
  const days = useDaysPages();
  const week = useWeek();

  // Defensive on purpose: this is a SECTION of a page now, so it renders inside whatever
  // else that page is loading, and a half-arrived page is not a reason to take Progress
  // down with it.
  const rows = useMemo(() => (days.data?.pages ?? []).flatMap((page) => page?.days ?? []), [days.data]);
  const groups = useMemo(() => groupByWeek(rows, week.data ?? null), [rows, week.data]);
  const empty = !days.isLoading && rows.length === 0;

  /**
   * Today's row goes to the Today TAB, not to `/day/<today>` (user decision 2026-09-01).
   * The open day has one page and it is the tab; the day page is the archival reading of a
   * day that has closed.
   */
  const openDay = (date: string) =>
    date === localDateKey() ? router.push('/today') : router.push(`/day/${date}`);

  return (
    <Section title="Days" summary={rows.length > 0 ? `${rows.length} logged` : null}>
      <View testID="days-list">
        {empty ? (
          <Card>
            <Disp size={22}>Nothing logged yet</Disp>
            <Sub style={{ marginTop: 8, lineHeight: 19 }}>
              Every day you log closes itself into a record. The first one shows up here.
            </Sub>
            <View style={{ marginTop: 14, alignSelf: 'flex-start' }}>
              <Chip label="Log something" variant="primary" onPress={() => router.push('/log')} />
            </View>
          </Card>
        ) : null}

        {!empty && rows.length === 0 ? (
          <View style={{ paddingTop: 24, alignItems: 'center' }}>
            <ActivityIndicator color={C.mute} />
          </View>
        ) : null}

        {groups.map((group) => (
          <View key={group.key}>
            <WeekHeading group={group} />
            {group.days.map((row) => (
              <DayListRow key={row.date} row={row} onPress={() => openDay(row.date)} />
            ))}
          </View>
        ))}

        {days.hasNextPage ? (
          <View style={{ marginTop: 18, alignSelf: 'flex-start' }}>
            <Chip
              testID="days-more"
              label={days.isFetchingNextPage ? 'Loading…' : 'Earlier days'}
              disabled={days.isFetchingNextPage}
              onPress={() => days.fetchNextPage()}
            />
          </View>
        ) : null}
      </View>
    </Section>
  );
}

function WeekHeading({ group }: { group: WeekGroup }) {
  return (
    <View style={{ paddingTop: 24, paddingBottom: 6 }}>
      <Eyebrow>{group.label}</Eyebrow>
      {group.tally ? <Sub style={[{ marginTop: 4 }, TABULAR]}>{group.tally}</Sub> : null}
    </View>
  );
}

/**
 * The row: weekday over a dot, the verdict and the day's one line, the day number.
 * Today is drawn as an outline — the day is not over, so its dot is not filled in.
 */
export function DayListRow({ row, onPress }: { row: DayRow; onPress?: () => void }) {
  const open = row.is_today;
  const color = DOT[row.verdict] ?? C.track;
  const numberColor = row.verdict === 'served' ? C.good : row.verdict === 'missed' ? C.accent : C.mute;

  return (
    <Pressable
      testID={`day-${row.date}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ opacity: 1 })}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 13,
          borderBottomWidth: 1,
          borderBottomColor: C.line,
        }}>
        <View style={{ width: 46, alignItems: 'center' }}>
          <Disp size={16} style={{ color: open ? C.ink : C.mute }}>
            {weekdayLabel(row.date)}
          </Disp>
          <View
            style={{
              marginTop: 5,
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: open ? 'transparent' : color,
              borderWidth: open ? 1.5 : 0,
              borderColor: C.good,
            }}
          />
        </View>
        <View style={{ flex: 1, paddingLeft: 6, paddingRight: 10 }}>
          <Disp size={17} weight="semi">
            {open ? 'Today' : row.verdict_words}
          </Disp>
          <Sub style={{ marginTop: 3 }} numberOfLines={1}>
            {row.summary}
          </Sub>
        </View>
        <Disp size={18} style={[{ color: numberColor, marginRight: 6 }, TABULAR]}>
          {row.day_number}
        </Disp>
        <IconChevronRight size={18} color={C.dim} />
      </View>
    </Pressable>
  );
}
