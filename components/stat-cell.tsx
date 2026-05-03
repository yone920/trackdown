import { Text, View } from 'react-native';

export function StatCell({
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
