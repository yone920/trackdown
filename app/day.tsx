import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDay } from '@/lib/queries';

export default function Day() {
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date ?? '';
  const { data, isLoading } = useDay(date);

  const meals = data?.meals ?? [];
  const movement = data?.movement ?? [];
  const consumed = meals.reduce((s, m) => s + m.kcal, 0);
  const burned = movement.reduce((s, m) => s + m.kcal, 0);
  const net = consumed - burned;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={['top', 'bottom']}>
      <View className="px-6 pt-2 pb-2 flex-row items-center">
        <Pressable onPress={() => router.back()} hitSlop={16} className="flex-row items-center">
          <Feather name="chevron-left" size={22} color="#5C544B" />
          <Text className="text-[14px] text-graphite ml-1">Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="px-8 pt-8">
          <Text
            className="text-[11px] text-ash"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            {formatHeader(date)}
          </Text>
          <View className="flex-row items-baseline mt-6">
            <Text
              className="font-serif-light text-ink"
              style={{ fontSize: 80, lineHeight: 88, letterSpacing: -1.5 }}>
              {isLoading ? '—' : net.toLocaleString()}
            </Text>
            <Text className="text-[16px] text-ash ml-3">net kcal</Text>
          </View>
          <Text className="text-[13px] text-graphite mt-2">
            {consumed.toLocaleString()} in <Text className="text-sage">· {burned.toLocaleString()} out</Text>
          </Text>
        </View>

        <View className="px-8 pt-12">
          <Text
            className="text-[10px] text-ash pb-4"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Meals
          </Text>
          {meals.length === 0 ? (
            <Text className="text-[13px] text-ash italic py-2">No meals logged.</Text>
          ) : (
            meals.map((meal, i) => (
              <Pressable
                key={meal.id}
                onPress={() =>
                  router.push({ pathname: '/detail', params: { type: 'meals', id: meal.id } })
                }
                className={`flex-row items-center py-5 ${
                  i !== meals.length - 1 ? 'border-b border-hairline' : ''
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

        <View className="px-8 pt-12">
          <Text
            className="text-[10px] text-ash pb-4"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
            Movement
          </Text>
          {movement.length === 0 ? (
            <Text className="text-[13px] text-ash italic py-2">No movement logged.</Text>
          ) : (
            movement.map((m, i) => (
              <Pressable
                key={m.id}
                onPress={() =>
                  router.push({ pathname: '/detail', params: { type: 'movement', id: m.id } })
                }
                className={`flex-row items-center py-5 ${
                  i !== movement.length - 1 ? 'border-b border-hairline' : ''
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
      </ScrollView>
    </SafeAreaView>
  );
}

function formatHeader(dateKey: string): string {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
