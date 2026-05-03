import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Sparkline, buildSparkPoints } from '@/components/weight-sparkline';
import { useAllWeightLogs, type WeightLog } from '@/lib/queries';

const SPARK_DAYS = 30;

export default function Weight() {
  const { data: logs = [], isLoading } = useAllWeightLogs();

  const stats = useMemo(() => computeStats(logs), [logs]);
  const sparkPoints = useMemo(() => buildSparkPoints(logs, SPARK_DAYS), [logs]);

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
            Weight
          </Text>
        </View>

        {isLoading ? (
          <View className="px-8 pt-12">
            <Text className="text-[13px] text-ash italic">Loading…</Text>
          </View>
        ) : logs.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <Hero current={stats.current} startDelta={stats.startDelta} />

            <View className="px-8 pt-12">
              <Text
                className="text-[10px] text-ash pb-4"
                style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
                Last {SPARK_DAYS} days
              </Text>
              <Sparkline points={sparkPoints} />
              <View className="flex-row justify-between mt-3">
                <Text className="text-[11px] text-ash">{stats.sparkLow.toFixed(1)} lb</Text>
                <Text className="text-[11px] text-ash">{stats.sparkHigh.toFixed(1)} lb</Text>
              </View>
            </View>

            <View className="px-8 pt-12">
              <Text
                className="text-[10px] text-ash pb-4"
                style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
                Averages
              </Text>
              <View className="flex-row justify-between">
                <StatCell label="7-day" value={fmtAvg(stats.avg7)} />
                <StatCell label="30-day" value={fmtAvg(stats.avg30)} />
                <StatCell
                  label="change"
                  value={fmtDelta(stats.startDelta)}
                  tint={deltaTint(stats.startDelta)}
                />
              </View>
            </View>

            <View className="px-8 pt-12">
              <Text
                className="text-[10px] text-ash pb-4"
                style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
                Recent entries
              </Text>
              <View>
                {[...logs]
                  .reverse()
                  .slice(0, 20)
                  .map((entry, i, arr) => (
                    <EntryRow key={entry.id} entry={entry} isLast={i === arr.length - 1} />
                  ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Hero({ current, startDelta }: { current: number; startDelta: number | null }) {
  return (
    <View className="px-8 pt-8">
      <Text className="text-[15px] text-graphite">You weigh</Text>
      <View className="flex-row items-baseline mt-1">
        <Text
          className="font-serif-light text-ink"
          style={{ fontSize: 96, lineHeight: 104, letterSpacing: -2 }}>
          {current.toFixed(1)}
        </Text>
        <Text className="text-[18px] text-ash ml-3">lb</Text>
      </View>
      {startDelta !== null && Math.abs(startDelta) >= 0.1 && (
        <Text className={`text-[13px] mt-2 ${deltaTint(startDelta)}`}>
          {fmtDelta(startDelta)} since starting
        </Text>
      )}
    </View>
  );
}

function StatCell({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <View className="flex-1">
      <Text
        className="text-[10px] text-ash"
        style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text className={`font-serif text-[22px] mt-1 ${tint ?? 'text-ink'}`}>{value}</Text>
    </View>
  );
}

function EntryRow({ entry, isLast }: { entry: WeightLog; isLast: boolean }) {
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/detail', params: { type: 'weight', id: entry.id } })
      }
      className={`flex-row items-center py-4 ${isLast ? '' : 'border-b border-hairline'}`}>
      <Text className="w-32 text-[13px] text-ink">{formatLogDate(entry.logged_at)}</Text>
      <View className="flex-1" />
      <Text className="font-serif text-[15px] text-ink">{entry.weight_lb.toFixed(1)}</Text>
      <Text className="text-[12px] text-ash ml-1">lb</Text>
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View className="px-8 pt-16">
      <Text className="font-serif-light text-ink" style={{ fontSize: 28, lineHeight: 36 }}>
        No weight logged yet.
      </Text>
      <Text className="text-[14px] text-graphite mt-3 leading-[22px]">
        From the Log tab, try “weighed in at 182” or “down to 79.5 kg.”
      </Text>
    </View>
  );
}

type WeightStats = {
  current: number;
  startDelta: number | null;
  avg7: number | null;
  avg30: number | null;
  sparkLow: number;
  sparkHigh: number;
};

function computeStats(logs: WeightLog[]): WeightStats {
  if (logs.length === 0) {
    return {
      current: 0,
      startDelta: null,
      avg7: null,
      avg30: null,
      sparkLow: 0,
      sparkHigh: 0,
    };
  }
  const now = new Date();
  const current = logs[logs.length - 1].weight_lb;
  const startDelta = logs.length > 1 ? current - logs[0].weight_lb : null;

  const cutoff7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const cutoff30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();

  const avg = (start: number) => {
    const window = logs.filter((l) => new Date(l.logged_at).getTime() >= start);
    if (window.length === 0) return null;
    return window.reduce((s, l) => s + l.weight_lb, 0) / window.length;
  };

  const recent = logs.filter((l) => new Date(l.logged_at).getTime() >= cutoff30);
  const sparkWeights = recent.length > 0 ? recent.map((l) => l.weight_lb) : [current];

  return {
    current,
    startDelta,
    avg7: avg(cutoff7),
    avg30: avg(cutoff30),
    sparkLow: Math.min(...sparkWeights),
    sparkHigh: Math.max(...sparkWeights),
  };
}

function fmtAvg(v: number | null): string {
  return v === null ? '—' : v.toFixed(1);
}

function fmtDelta(v: number | null): string {
  if (v === null) return '—';
  if (Math.abs(v) < 0.05) return '0.0 lb';
  const sign = v < 0 ? '−' : '+';
  return `${sign}${Math.abs(v).toFixed(1)} lb`;
}

function deltaTint(v: number | null): string {
  if (v === null || Math.abs(v) < 0.05) return 'text-graphite';
  return v < 0 ? 'text-sage' : 'text-terracotta';
}

function formatLogDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
