import { View } from 'react-native';

import { TrendLine } from '@/components/charts';
import { Card, Section } from '@/components/kit';
import { DetailScreen } from '@/components/progress/detail-screen';
import { Disp, Sub } from '@/components/type';
import { WeighIns } from '@/components/weigh-ins';
import { useTrainingBoard } from '@/lib/queries';
import { C, FONT, TABULAR } from '@/lib/theme';

// BODY — the weight line at full height, and every weigh-in behind it.
//
// The rows are the point of this screen. They lost their only surface once already (field
// report 2026-09-02: a mistyped 110 fed every average and could be corrected nowhere), so
// when the Progress page became a scoreboard they got a door of their own rather than a
// smaller corner of a busier page. Tap a row to correct it in words, ✕ to take it back —
// the same three targets a logged row has anywhere else.

export default function BodyDetail() {
  const board = useTrainingBoard();
  const body = board.data?.body ?? null;
  const values = body?.series.map((point) => point.value) ?? [];

  return (
    <DetailScreen
      testID="body-detail"
      eyebrow={body?.avg_7d == null ? null : `${body.avg_7d.toFixed(1)} lb · 7-day avg`}
      title="Body">
      <Section title="The line" summary={values.length > 0 ? `${values.length} readings` : null}>
        {values.length === 0 ? (
          <Card testID="body-empty">
            <Sub>{board.isLoading ? 'Reading your weigh-ins…' : 'No weigh-ins logged.'}</Sub>
          </Card>
        ) : (
          <Card testID="body">
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Disp size={30} style={TABULAR}>
                {body!.latest?.toFixed(1) ?? '—'}
              </Disp>
              <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 12 }}>lb</Sub>
              {body!.trend_per_week == null ? null : (
                <Sub style={[{ marginLeft: 10 }, TABULAR]}>
                  {body!.trend_per_week > 0 ? '+' : '−'}
                  {Math.abs(body!.trend_per_week).toFixed(1)} lb/wk
                </Sub>
              )}
            </View>
            <View style={{ marginTop: 12 }}>
              <TrendLine height={120} series={[{ values, color: C.ink, width: 2 }]} />
            </View>
          </Card>
        )}
      </Section>

      <WeighIns />
    </DetailScreen>
  );
}
