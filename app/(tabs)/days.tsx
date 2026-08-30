import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconChevronRight } from '@/components/icons';
import { Card, Chip } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { groupByWeek, weekdayLabel, type WeekGroup } from '@/lib/days-weeks';
import { useDaysPages, useGoals, useWeek } from '@/lib/queries';
import { C, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import type { DayRow, Verdict } from '@/lib/types';

// Days (docs/design-system.md §Days). Every day the user has logged, newest first,
// grouped by the week it belongs to, each week carrying its own tally. Tap a day and you
// get the reading of it.
//
// The grouping and the tally arithmetic are lib/days-weeks.ts — pure and tested there.
// This file is the list: week headings and day rows, paging with the server's
// `next_before` cursor when the user reaches the bottom.

const DOT: Record<Verdict, string> = {
  served: C.good,
  missed: C.accent,
  unlogged: C.track,
  none: C.track,
};

type Item = { type: 'week'; group: WeekGroup } | { type: 'day'; row: DayRow };

function flatten(groups: WeekGroup[]): Item[] {
  return groups.flatMap((group) => [
    { type: 'week' as const, group },
    ...group.days.map((row) => ({ type: 'day' as const, row })),
  ]);
}

export default function Days() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const days = useDaysPages();
  const week = useWeek();
  const goals = useGoals();
  const goal = goals.data?.active?.[0] ?? null;

  const rows = useMemo(() => (days.data?.pages ?? []).flatMap((page) => page.days), [days.data]);
  const items = useMemo(() => flatten(groupByWeek(rows, week.data ?? null)), [rows, week.data]);

  const empty = !days.isLoading && rows.length === 0;

  return (
    <FlatList
      testID="days-list"
      style={{ flex: 1, backgroundColor: C.bg }}
      data={items}
      keyExtractor={(item) => (item.type === 'week' ? `w-${item.group.key}` : `d-${item.row.date}`)}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140,
      }}
      refreshing={days.isRefetching}
      onRefresh={() => {
        days.refetch();
        week.refetch();
      }}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (days.hasNextPage && !days.isFetchingNextPage) days.fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ paddingBottom: 8 }}>
          <Eyebrow>{goal ? goal.title : 'No goal set'}</Eyebrow>
          <Disp size={30} style={{ marginTop: 6 }}>
            Days
          </Disp>
        </View>
      }
      ListEmptyComponent={
        empty ? (
          <Card style={{ marginTop: 18 }}>
            <Disp size={22}>Nothing logged yet</Disp>
            <Sub style={{ marginTop: 8, lineHeight: 19 }}>
              Every day you log closes itself into a record. The first one shows up here.
            </Sub>
            <View style={{ marginTop: 14, alignSelf: 'flex-start' }}>
              <Chip label="Log something" variant="primary" onPress={() => router.push('/log')} />
            </View>
          </Card>
        ) : (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={C.mute} />
          </View>
        )
      }
      ListFooterComponent={
        days.isFetchingNextPage ? (
          <View style={{ paddingTop: 20, alignItems: 'center' }}>
            <ActivityIndicator color={C.mute} />
          </View>
        ) : null
      }
      renderItem={({ item }) =>
        item.type === 'week' ? (
          <WeekHeading group={item.group} />
        ) : (
          <DayListRow row={item.row} onPress={() => router.push(`/day/${item.row.date}`)} />
        )
      }
    />
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
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
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
              borderRadius: RADIUS.pill,
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
