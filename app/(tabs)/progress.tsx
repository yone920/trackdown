import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Bars } from '@/components/bars';
import { Sparkline, buildSparkPoints } from '@/components/weight-sparkline';
import {
  localDateKey,
  useAllWeightLogs,
  useDaysSummary,
  type DaySummary,
  type WeightLog,
} from '@/lib/queries';

const RANGE = 30;

export default function Progress() {
  const { data: days = [], isLoading } = useDaysSummary(RANGE);
  const { data: weightLogs = [] } = useAllWeightLogs();

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}>
        <View className="px-8 pt-10">
          <Text
            className="text-[11px] text-ash"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Progress
          </Text>
        </View>

        <EatingCard days={days} />
        <MovementCard days={days} />
        <WeightCard logs={weightLogs} />

        <View className="px-8 pt-14">
          <Text
            className="text-[10px] text-ash pb-4"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Recent days
          </Text>
          {isLoading ? (
            <Text className="text-[13px] text-ash italic py-2">Loading…</Text>
          ) : (
            [...days]
              .reverse()
              .slice(0, 14)
              .map((d, i, arr) => (
                <DayRow
                  key={d.date}
                  day={d}
                  isLast={i === arr.length - 1}
                  onPress={() => router.push({ pathname: '/day', params: { date: d.date } })}
                />
              ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function EatingCard({ days }: { days: DaySummary[] }) {
  const todayKey = localDateKey(new Date());
  const today = days.find((d) => d.date === todayKey)?.consumed ?? 0;
  const values = days.map((d) => d.consumed);
  const max = Math.max(1, ...values);

  return (
    <MetricCard
      label="Eating"
      onPress={() => router.push('/eating')}
      value={today.toLocaleString()}
      unit="kcal today"
      chart={<Bars values={values} max={max} tint="terracotta" height={40} />}
    />
  );
}

function MovementCard({ days }: { days: DaySummary[] }) {
  const todayKey = localDateKey(new Date());
  const today = days.find((d) => d.date === todayKey)?.burned ?? 0;
  const values = days.map((d) => d.burned);
  const max = Math.max(1, ...values);

  return (
    <MetricCard
      label="Movement"
      onPress={() => router.push('/movement')}
      value={today.toLocaleString()}
      unit="kcal today"
      valueTint="text-sage"
      chart={<Bars values={values} max={max} tint="sage" height={40} />}
    />
  );
}

function WeightCard({ logs }: { logs: WeightLog[] }) {
  const current = logs.length > 0 ? logs[logs.length - 1].weight_lb : null;
  const startDelta =
    logs.length > 1 && current !== null ? current - logs[0].weight_lb : null;
  const points = buildSparkPoints(logs, 30);

  const deltaText =
    startDelta === null
      ? null
      : Math.abs(startDelta) < 0.05
        ? null
        : `${startDelta < 0 ? '−' : '+'}${Math.abs(startDelta).toFixed(1)} lb total`;

  return (
    <MetricCard
      label="Weight"
      onPress={() => router.push('/weight')}
      value={current === null ? '—' : current.toFixed(1)}
      unit={current === null ? 'no entries' : deltaText ?? 'lb'}
      chart={
        current === null ? (
          <View className="h-[40px] justify-center">
            <View className="h-[1px] bg-hairline" />
          </View>
        ) : (
          <Sparkline points={points} height={40} />
        )
      }
    />
  );
}

function MetricCard({
  label,
  value,
  unit,
  chart,
  onPress,
  valueTint = 'text-ink',
}: {
  label: string;
  value: string;
  unit: string;
  chart: React.ReactNode;
  onPress: () => void;
  valueTint?: string;
}) {
  return (
    <Pressable onPress={onPress} className="px-8 pt-12 active:opacity-70">
      <View className="flex-row items-baseline justify-between pb-4">
        <Text
          className="text-[10px] text-ash"
          style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
          {label}
        </Text>
        <View className="flex-row items-center">
          <Text className="text-[11px] text-terracotta mr-1">View</Text>
          <Feather name="chevron-right" size={14} color="#B8623E" />
        </View>
      </View>
      <View className="flex-row items-baseline">
        <Text
          className={`font-serif-light ${valueTint}`}
          style={{ fontSize: 48, lineHeight: 52, letterSpacing: -1 }}>
          {value}
        </Text>
        <Text className="text-[13px] text-ash ml-2">{unit}</Text>
      </View>
      <View className="mt-4">{chart}</View>
    </Pressable>
  );
}

function DayRow({
  day,
  isLast,
  onPress,
}: {
  day: DaySummary;
  isLast: boolean;
  onPress: () => void;
}) {
  const net = day.consumed - day.burned;
  const hasData = day.mealCount > 0 || day.movementCount > 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={!hasData}
      className={`flex-row items-center py-4 ${isLast ? '' : 'border-b border-hairline'}`}>
      <View className="w-24">
        <Text className="text-[13px] text-ink">{formatDayLabel(day.date)}</Text>
      </View>
      <View className="flex-1">
        {hasData ? (
          <Text className="text-[12px] text-ash">
            {day.consumed.toLocaleString()} in
            {day.burned > 0 && (
              <Text className="text-sage"> · {day.burned.toLocaleString()} out</Text>
            )}
          </Text>
        ) : (
          <Text className="text-[12px] text-mist italic">nothing logged</Text>
        )}
      </View>
      {hasData && (
        <Text className="font-serif text-[15px] text-ink mr-2">{net.toLocaleString()}</Text>
      )}
      {hasData && <Feather name="chevron-right" size={16} color="#C9C2B8" />}
    </Pressable>
  );
}

function formatDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const todayKey = localDateKey(today);
  const yesterdayKey = localDateKey(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1),
  );
  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
