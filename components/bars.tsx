import { View } from 'react-native';

export function Bars({
  values,
  max,
  tint,
  height = 64,
}: {
  values: number[];
  max: number;
  tint: 'terracotta' | 'sage' | 'ink';
  height?: number;
}) {
  const barColor =
    tint === 'terracotta' ? 'bg-terracotta' : tint === 'sage' ? 'bg-sage' : 'bg-ink';
  return (
    <View className="flex-row items-end gap-[4px]" style={{ height }}>
      {values.map((v, i) => {
        const absV = Math.abs(v);
        const pct = max > 0 ? (absV / max) * 100 : 0;
        const hasValue = absV > 0;
        return (
          <View key={i} className="flex-1 h-full justify-end">
            {hasValue ? (
              <View
                className={`w-full ${barColor} rounded-sm`}
                style={{ height: `${Math.max(pct, 4)}%`, opacity: 0.35 + (pct / 100) * 0.55 }}
              />
            ) : (
              <View className="w-full h-[1px] bg-hairline" />
            )}
          </View>
        );
      })}
    </View>
  );
}
