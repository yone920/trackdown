import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Bars } from '@/components/bars';
import { EntryRow } from '@/components/entry-row';
import { StatCell } from '@/components/stat-cell';
import {
  localDateKey,
  useDaysSummary,
  useRecentMealEntries,
} from '@/lib/queries';

const TREND_DAYS = 30;

export default function Eating() {
  const { data: days = [] } = useDaysSummary(TREND_DAYS);
  const { data: entries = [], isLoading } = useRecentMealEntries(TREND_DAYS);

  const stats = useMemo(() => computeStats(days), [days]);
  const dailyValues = days.map((d) => d.consumed);
  const max = Math.max(1, ...dailyValues);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={['top', 'bottom']}>
      <View className="px-6 pt-2 pb-2 flex-row items-center">
        <Pressable onPress={() => router.back()} hitSlop={16} className="flex-row items-center">
          <Feather name="chevron-left" size={22} color="#5C544B" />
          <Text className="text-[14px] text-graphite ml-1">Back</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}>
        <View className="px-8 pt-6">
          <Text
            className="text-[10px] text-ash"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Eating
          </Text>
        </View>

        <View className="px-8 pt-8">
          <Text className="text-[15px] text-graphite">You ate today</Text>
          <View className="flex-row items-baseline mt-1">
            <Text
              className="font-serif-light text-ink"
              style={{ fontSize: 96, lineHeight: 104, letterSpacing: -2 }}>
              {stats.today.toLocaleString()}
            </Text>
            <Text className="text-[18px] text-ash ml-3">kcal</Text>
          </View>
          {stats.avg7 !== null && stats.today > 0 && (
            <Text className={`text-[13px] mt-2 ${vsAvgTint(stats.today - stats.avg7, true)}`}>
              {fmtVsAvg(stats.today - stats.avg7)} vs your 7-day average
            </Text>
          )}
        </View>

        <View className="px-8 pt-12">
          <Text
            className="text-[10px] text-ash pb-4"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Last {TREND_DAYS} days
          </Text>
          <Bars values={dailyValues} max={max} tint="terracotta" height={80} />
          <View className="flex-row justify-between mt-3">
            <Text className="text-[11px] text-ash">{TREND_DAYS}d ago</Text>
            <Text className="text-[11px] text-ash">today</Text>
          </View>
        </View>

        <View className="px-8 pt-12">
          <Text
            className="text-[10px] text-ash pb-4"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Averages
          </Text>
          <View className="flex-row justify-between">
            <StatCell label="today" value={fmtKcal(stats.today)} />
            <StatCell label="7-day" value={fmtKcal(stats.avg7)} />
            <StatCell label="30-day" value={fmtKcal(stats.avg30)} />
          </View>
        </View>

        <View className="px-8 pt-12">
          <Text
            className="text-[10px] text-ash pb-4"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Recent meals
          </Text>
          {isLoading ? (
            <Text className="text-[13px] text-ash italic py-2">Loading…</Text>
          ) : entries.length === 0 ? (
            <Text className="text-[13px] text-ash italic py-2">
              Nothing logged in the last {TREND_DAYS} days.
            </Text>
          ) : (
            entries.map((e, i) => (
              <EntryRow
                key={e.id}
                entry={e}
                isLast={i === entries.length - 1}
                accent="ink"
                onPress={() =>
                  router.push({ pathname: '/detail', params: { type: 'meals', id: e.id } })
                }
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type Stats = {
  today: number;
  avg7: number | null;
  avg30: number | null;
};

function computeStats(days: { date: string; consumed: number }[]): Stats {
  if (days.length === 0) return { today: 0, avg7: null, avg30: null };
  const todayKey = localDateKey(new Date());
  const todayBucket = days.find((d) => d.date === todayKey);
  const today = todayBucket?.consumed ?? 0;

  const last7 = days.slice(-7).filter((d) => d.consumed > 0);
  const last30 = days.filter((d) => d.consumed > 0);

  const avg = (arr: { consumed: number }[]) =>
    arr.length === 0 ? null : Math.round(arr.reduce((s, d) => s + d.consumed, 0) / arr.length);

  return { today, avg7: avg(last7), avg30: avg(last30) };
}

function fmtKcal(v: number | null): string {
  return v === null ? '—' : v.toLocaleString();
}

function fmtVsAvg(delta: number): string {
  if (Math.abs(delta) < 5) return 'right at';
  const sign = delta < 0 ? '−' : '+';
  return `${sign}${Math.abs(delta).toLocaleString()}`;
}

function vsAvgTint(delta: number, lowerIsBetter: boolean): string {
  if (Math.abs(delta) < 5) return 'text-graphite';
  const isGood = lowerIsBetter ? delta < 0 : delta > 0;
  return isGood ? 'text-sage' : 'text-terracotta';
}
