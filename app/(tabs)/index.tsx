import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useMealsToday,
  useMovementToday,
  useRecommendation,
  useTodayMacros,
} from '@/lib/queries';
import { classifyDay, type DaySeverity } from '@/lib/recommendations';

const FALLBACK_MACRO_GOALS = { carbs: 220, fat: 70, protein: 140, fiber: 30 };

export default function Today() {
  const { data: mealsToday = [] } = useMealsToday();
  const { data: movementToday = [] } = useMovementToday();
  const { data: todayMacros } = useTodayMacros();
  const rec = useRecommendation();

  const macroGoals =
    rec.recommendation
      ? {
          carbs: rec.recommendation.macros.carbs_g,
          fat: rec.recommendation.macros.fat_g,
          protein: rec.recommendation.macros.protein_g,
          fiber: rec.recommendation.macros.fiber_g,
        }
      : FALLBACK_MACRO_GOALS;

  const macros = [
    { label: 'Carbs', value: Math.round(todayMacros?.carbs_g ?? 0), goal: macroGoals.carbs, unit: 'g' },
    { label: 'Fat', value: Math.round(todayMacros?.fat_g ?? 0), goal: macroGoals.fat, unit: 'g' },
    { label: 'Protein', value: Math.round(todayMacros?.protein_g ?? 0), goal: macroGoals.protein, unit: 'g' },
    { label: 'Fiber', value: Math.round(todayMacros?.fiber_g ?? 0), goal: macroGoals.fiber, unit: 'g' },
  ];

  const consumed = mealsToday.reduce((sum, m) => sum + m.kcal, 0);
  const exerciseBurn = movementToday.reduce((sum, m) => sum + m.kcal, 0);
  // True energy balance: subtract baseline TDEE plus logged exercise.
  const baselineBurn = rec.recommendation?.tdee.tdee ?? 0;
  const totalBurn = baselineBurn + exerciseBurn;
  const target =
    rec.recommendation?.mode === 'recommendations'
      ? rec.recommendation.dailyCalories
      : rec.recommendation?.mode === 'tracking_only'
        ? rec.recommendation.maintenanceCalories
        : 2100;
  const targetDeficit =
    rec.recommendation?.mode === 'recommendations'
      ? rec.recommendation.dailyDeficit
      : 500;
  const safeFloor =
    rec.recommendation?.mode === 'recommendations'
      ? rec.recommendation.safeFloor
      : rec.recommendation?.mode === 'tracking_only'
        ? rec.recommendation.safeFloor
        : 1500;
  const net = rec.ready ? consumed - totalBurn : consumed - exerciseBurn;
  const status = classifyDay({
    consumed,
    net,
    dailyTarget: target,
    targetDeficit,
    safeFloor,
  });
  const intakeRemaining = target - consumed;
  const overCap = intakeRemaining < 0;
  const now = new Date();
  const dayLabel = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const barPct = Math.max(0, Math.min(100, (consumed / target) * 100));
  const netTint = severityTint(status.severity);
  const intakeNote = status.belowSafeFloor
    ? `Eaten only ${consumed.toLocaleString()} kcal — safe minimum is ${safeFloor.toLocaleString()} kcal.`
    : overCap
      ? `${Math.abs(intakeRemaining).toLocaleString()} kcal past your ${target.toLocaleString()} intake cap`
      : `${intakeRemaining.toLocaleString()} kcal left of your ${target.toLocaleString()} daily intake`;
  const heroNumberDisplay =
    net < 0
      ? `−${Math.abs(net).toLocaleString()}`
      : net > 0
        ? `+${net.toLocaleString()}`
        : '0';

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
            {dayLabel} · {dateLabel}
          </Text>
        </View>

        <View className="px-8 pt-14 pb-10">
          <Text className="text-[15px] text-graphite">{status.headline}</Text>
          <View className="flex-row items-baseline mt-1">
            <Text
              className={`font-serif-light ${netTint}`}
              style={{ fontSize: 96, lineHeight: 104, letterSpacing: -2 }}>
              {heroNumberDisplay}
            </Text>
          </View>
          <Text
            className={`text-[15px] -mt-1 ${
              status.severity === 'danger' ? 'text-terracotta' : 'text-graphite'
            }`}>
            {status.subline}
          </Text>

          <View className="flex-row mt-10">
            <BalanceStat label="Eaten" value={consumed} tint="text-terracotta" />
            <View className="w-[1px] bg-hairline mx-1 self-stretch" />
            <BalanceStat
              label="Burned"
              value={rec.ready ? totalBurn : exerciseBurn}
              tint="text-sage"
              sublabel={
                rec.ready
                  ? `${baselineBurn.toLocaleString()} base + ${exerciseBurn.toLocaleString()} move`
                  : undefined
              }
            />
            <View className="w-[1px] bg-hairline mx-1 self-stretch" />
            <BalanceStat label="Net" value={net} tint={netTint} />
          </View>

          <View className="mt-8">
            <View className="h-[2px] bg-hairline rounded-full overflow-hidden">
              <View
                className="h-full bg-terracotta"
                style={{ width: `${barPct}%`, opacity: overCap ? 1 : 0.7 }}
              />
            </View>
            <Text className="text-[12px] text-ash mt-3">{intakeNote}</Text>
          </View>

          {!rec.ready && (
            <Pressable
              onPress={() => router.push('/(tabs)/profile')}
              className="mt-6 flex-row items-center active:opacity-70">
              <Text className="text-[12px] text-terracotta flex-1">
                Set up your profile so we can compute your real TDEE.
              </Text>
              <Feather name="chevron-right" size={14} color="#B8623E" />
            </Pressable>
          )}
        </View>

        <View className="px-8">
          <Text
            className="text-[10px] text-ash pb-4"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Macros
          </Text>
          <View className="gap-5">
            {macros.map((m) => {
              const pct = Math.min(100, (m.value / m.goal) * 100);
              return (
                <View key={m.label}>
                  <View className="flex-row justify-between items-baseline">
                    <Text className="text-[14px] text-ink">{m.label}</Text>
                    <Text className="font-serif text-[15px] text-ink">
                      {m.value}
                      <Text className="text-ash">
                        {' '}
                        / {m.goal}
                        {m.unit}
                      </Text>
                    </Text>
                  </View>
                  <View className="mt-2 h-[1px] bg-hairline overflow-hidden">
                    <View className="h-full bg-ink" style={{ width: `${pct}%` }} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View className="px-8 pt-14">
          <View className="flex-row justify-between items-baseline pb-4">
            <Pressable
              onPress={() => router.push('/eating')}
              hitSlop={8}
              className="flex-row items-center">
              <Text
                className="text-[10px] text-ash"
                style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
                Today's meals
              </Text>
              <Feather
                name="chevron-right"
                size={12}
                color="#9A938A"
                style={{ marginLeft: 6 }}
              />
            </Pressable>
            <Pressable onPress={() => router.push('/(tabs)/log')} hitSlop={8}>
              <Text className="text-[11px] text-terracotta">+ add</Text>
            </Pressable>
          </View>
          <View>
            {mealsToday.length === 0 ? (
              <Text className="text-[13px] text-ash italic py-2">Nothing logged yet today.</Text>
            ) : (
              mealsToday.map((meal, i) => (
                <Pressable
                  key={meal.id}
                  onPress={() =>
                    router.push({ pathname: '/detail', params: { type: 'meals', id: meal.id } })
                  }
                  className={`flex-row items-center py-5 ${
                    i !== mealsToday.length - 1 ? 'border-b border-hairline' : ''
                  }`}>
                  <Text className="w-16 text-[12px] text-ash">{meal.time}</Text>
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    className="flex-1 text-[15px] text-ink pr-3">
                    {meal.name}
                  </Text>
                  <Text className="font-serif text-[15px] text-ink">
                    {meal.kcal > 0 ? meal.kcal : '—'}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </View>

        <View className="px-8 pt-12">
          <View className="flex-row justify-between items-baseline pb-4">
            <Pressable
              onPress={() => router.push('/movement')}
              hitSlop={8}
              className="flex-row items-center">
              <Text
                className="text-[10px] text-ash"
                style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
                Movement
              </Text>
              <Feather
                name="chevron-right"
                size={12}
                color="#9A938A"
                style={{ marginLeft: 6 }}
              />
            </Pressable>
            <Pressable onPress={() => router.push('/(tabs)/log')} hitSlop={8}>
              <Text className="text-[11px] text-terracotta">+ add</Text>
            </Pressable>
          </View>
          <View>
            {movementToday.length === 0 ? (
              <Text className="text-[13px] text-ash italic py-2">No movement logged yet.</Text>
            ) : (
              movementToday.map((m, i) => (
                <Pressable
                  key={m.id}
                  onPress={() =>
                    router.push({ pathname: '/detail', params: { type: 'movement', id: m.id } })
                  }
                  className={`flex-row items-center py-5 ${
                    i !== movementToday.length - 1 ? 'border-b border-hairline' : ''
                  }`}>
                  <Text className="w-16 text-[12px] text-ash">{m.time}</Text>
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    className="flex-1 text-[15px] text-ink pr-3">
                    {m.name}
                  </Text>
                  <Text className="font-serif text-[15px] text-sage">
                    {m.kcal > 0 ? `−${m.kcal}` : '—'}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </View>

        <View className="px-8 pt-10">
          <Text className="text-[13px] italic text-graphite text-center font-serif">
            "Small steps, taken daily."
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function severityTint(severity: DaySeverity): string {
  switch (severity) {
    case 'good':
      return 'text-sage';
    case 'caution':
    case 'danger':
      return 'text-terracotta';
    case 'neutral':
    default:
      return 'text-ink';
  }
}

function BalanceStat({
  label,
  value,
  tint,
  sublabel,
}: {
  label: string;
  value: number;
  tint: string;
  sublabel?: string;
}) {
  return (
    <View className="flex-1 items-center">
      <Text
        className="text-[10px] text-ash"
        style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text className={`font-serif text-[24px] mt-2 ${tint}`}>
        {value.toLocaleString()}
      </Text>
      <Text className="text-[10px] text-ash mt-1">kcal</Text>
      {sublabel && (
        <Text className="text-[9px] text-mist mt-0.5 text-center" numberOfLines={2}>
          {sublabel}
        </Text>
      )}
    </View>
  );
}
