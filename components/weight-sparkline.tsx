import { View } from 'react-native';

import type { WeightLog } from '@/lib/queries';

export type SparkPoint = { x: number; y: number; isLast: boolean };

export function Sparkline({
  points,
  height = 80,
}: {
  points: SparkPoint[];
  height?: number;
}) {
  if (points.length === 0) {
    return (
      <View className="justify-center" style={{ height }}>
        <View className="h-[1px] bg-hairline" />
      </View>
    );
  }
  return (
    <View className="relative w-full" style={{ height }}>
      <View
        className="absolute left-0 right-0 bg-hairline"
        style={{ top: height / 2, height: 1 }}
      />
      {points.map((p, i) => {
        const size = p.isLast ? 8 : 4;
        return (
          <View
            key={i}
            className={p.isLast ? 'bg-terracotta' : 'bg-ink'}
            style={{
              position: 'absolute',
              left: `${p.x * 100}%`,
              top: p.y * (height - size),
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: -size / 2,
              opacity: p.isLast ? 1 : 0.55,
            }}
          />
        );
      })}
    </View>
  );
}

export function buildSparkPoints(logs: WeightLog[], days: number): SparkPoint[] {
  if (logs.length === 0) return [];
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const recent = logs.filter((l) => new Date(l.logged_at) >= cutoff);
  if (recent.length === 0) return [];

  const weights = recent.map((l) => l.weight_lb);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = Math.max(0.5, max - min);

  const startMs = cutoff.getTime();
  const endMs = now.getTime();
  const range = Math.max(1, endMs - startMs);

  return recent.map((l, i) => {
    const t = new Date(l.logged_at).getTime();
    const x = (t - startMs) / range;
    const y = 1 - (l.weight_lb - min) / span;
    return { x: Math.max(0, Math.min(1, x)), y, isLast: i === recent.length - 1 };
  });
}
