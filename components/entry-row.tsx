import { Pressable, Text, View } from 'react-native';

import { localDateKey, type LoggedEntry } from '@/lib/queries';

export function EntryRow({
  entry,
  isLast,
  accent,
  onPress,
}: {
  entry: LoggedEntry;
  isLast: boolean;
  accent: 'ink' | 'sage';
  onPress: () => void;
}) {
  const valueColor = accent === 'sage' ? 'text-sage' : 'text-ink';
  const valuePrefix = accent === 'sage' && entry.kcal > 0 ? '−' : '';
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center py-4 ${isLast ? '' : 'border-b border-hairline'}`}>
      <View className="w-24">
        <Text className="text-[12px] text-ash">{formatEntryDate(entry.logged_at)}</Text>
      </View>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        className="flex-1 text-[14px] text-ink pr-3">
        {entry.description}
      </Text>
      <Text className={`font-serif text-[15px] ${valueColor}`}>
        {entry.kcal > 0 ? `${valuePrefix}${entry.kcal}` : '—'}
      </Text>
    </Pressable>
  );
}

export function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const todayKey = localDateKey(today);
  const yesterdayKey = localDateKey(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1),
  );
  const key = localDateKey(d);
  if (key === todayKey) return 'Today';
  if (key === yesterdayKey) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
