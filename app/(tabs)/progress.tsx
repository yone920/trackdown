import { useCallback, useMemo } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bar, Columns, TrendLine } from '@/components/charts';
import { Card } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import {
  consistencySection,
  coverageSection,
  goalSections,
  type ProgressSection,
} from '@/lib/progress-sections';
import { useDays, useGoalProgress, useGoals } from '@/lib/queries';
import { C, FONT, SPACE, TABULAR } from '@/lib/theme';
import type { DayRow, GoalWithProgress } from '@/lib/types';

// Progress (docs/design-system.md §Progress). One section per active goal, drawn from
// that goal's own metrics, then the two things that are true whether or not there is a
// goal: how often you train, and what you have been training.
//
// Which chart a metric gets is lib/progress-sections.ts — pure, and tested there. This
// file fetches (`GET /api/goals/:id/progress` carries the series; the goals list does
// not) and draws.
//
// With no goal there is no green and no orange: concept-v2 §Goals is explicit that the
// app judges nothing it was not asked to judge.

/** Two months of day rows: eight weeks of consistency, four weeks of coverage. */
const HISTORY_DAYS = 60;

export default function Progress() {
  const insets = useSafeAreaInsets();
  const goals = useGoals();
  const days = useDays(undefined, HISTORY_DAYS);

  const active = goals.data?.active ?? [];
  const judge = active.length > 0 && active.some((goal) => goal.kind !== 'maintain' && goal.kind !== 'custom');
  const rows: DayRow[] = useMemo(() => days.data?.days ?? [], [days.data]);

  const consistency = useMemo(() => consistencySection(rows, judge), [rows, judge]);
  const coverage = useMemo(() => coverageSection(rows, judge), [rows, judge]);

  const refreshing = goals.isRefetching || days.isRefetching;
  const onRefresh = useCallback(() => {
    goals.refetch();
    days.refetch();
  }, [goals, days]);

  return (
    <ScrollView
      testID="progress-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}>
      <Eyebrow>{active.length === 0 ? 'No goal set' : `${active.length} active`}</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        Progress
      </Disp>

      {goals.isLoading && active.length === 0 ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={C.mute} />
        </View>
      ) : null}

      {active.map((goal) => (
        <GoalProgressBlock key={goal.id} goal={goal} rows={rows} />
      ))}

      {active.length === 0 && !goals.isLoading ? (
        <Card style={{ marginTop: 18 }}>
          <Sub style={{ lineHeight: 19 }}>
            No goal, so nothing is being judged. What is below is what you have actually done.
          </Sub>
        </Card>
      ) : null}

      <View style={{ marginTop: 26 }}>
        <Disp size={20} weight="semi">
          Consistency
        </Disp>
        {consistency ? (
          <View style={{ marginTop: 12 }}>
            <SectionCard section={consistency} testID="section-consistency" />
          </View>
        ) : (
          <Card style={{ marginTop: 12 }}>
            <Sub>Nothing logged yet.</Sub>
          </Card>
        )}
      </View>

      {coverage ? (
        <View style={{ marginTop: 26 }}>
          <Disp size={20} weight="semi">
            Coverage
          </Disp>
          <View style={{ marginTop: 12 }}>
            <SectionCard section={coverage} testID="section-coverage" />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * One goal's sections. The series live on `/api/goals/:id/progress`, so each goal fetches
 * its own — a hook per goal, which is why this is a component and not a loop.
 */
function GoalProgressBlock({ goal, rows }: { goal: GoalWithProgress; rows: DayRow[] }) {
  const progress = useGoalProgress(goal.id);
  // The goals list has the percentages but not the series; this endpoint has both, so the
  // goal is re-made with the metrics that can actually be drawn.
  const metrics = progress.data?.metrics;
  const dailyWeights = useMemo(
    () =>
      rows
        .filter((row) => row.weight_lb != null)
        .map((row) => ({ date: row.date, value: row.weight_lb as number }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [rows],
  );

  const sections = useMemo(() => {
    const withSeries: GoalWithProgress = metrics
      ? { ...goal, progress: { ...goal.progress, metrics } }
      : goal;
    return goalSections(withSeries, dailyWeights);
  }, [goal, metrics, dailyWeights]);

  return (
    <View style={{ marginTop: 26 }}>
      <Disp size={20} weight="semi">
        {goal.title}
      </Disp>
      {sections.length === 0 ? (
        <Card style={{ marginTop: 12 }}>
          <Sub>Nothing measured yet for this goal.</Sub>
        </Card>
      ) : (
        sections.map((section) => (
          <View key={section.key} style={{ marginTop: 12 }}>
            <SectionCard section={section} testID={`section-${section.key}`} />
          </View>
        ))
      )}
    </View>
  );
}

function SectionCard({ section, testID }: { section: ProgressSection; testID?: string }) {
  const accent = section.judge ? C.accent : C.mute;
  return (
    <Card testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Eyebrow>{section.eyebrow}</Eyebrow>
        {section.sub ? <Sub style={TABULAR}>{section.sub}</Sub> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 8 }}>
        <Disp size={38} style={TABULAR}>
          {section.value}
        </Disp>
        {section.unit ? (
          <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 13 }}>{section.unit}</Sub>
        ) : null}
      </View>

      {section.chart?.kind === 'line' ? (
        <View style={{ marginTop: 14 }}>
          <TrendLine
            height={120}
            target={section.chart.target}
            series={[
              // The weigh-ins under the average, thin and dim: the evidence, not the claim.
              ...(section.chart.raw ? [{ values: section.chart.raw, color: C.dim, width: 1 }] : []),
              { values: section.chart.values, color: section.judge ? C.accent : C.ink, width: 2 },
            ]}
          />
        </View>
      ) : null}

      {section.chart?.kind === 'columns' ? (
        <View style={{ marginTop: 14 }}>
          <Columns columns={section.chart.columns} color={accent} />
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            {section.chart.columns.map((column, index) => (
              <Sub key={index} style={[{ flex: 1, textAlign: 'center', fontSize: 10 }, TABULAR]}>
                {column.label}
              </Sub>
            ))}
          </View>
        </View>
      ) : null}

      {section.chart?.kind === 'rows' ? (
        <View style={{ marginTop: 14 }}>
          {section.chart.rows.map((row) => (
            <View key={row.label} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Sub>{row.label}</Sub>
                <Sub style={TABULAR}>{row.value}</Sub>
              </View>
              <View style={{ marginTop: 4 }}>
                <Bar fraction={row.fraction} color={accent} height={6} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
