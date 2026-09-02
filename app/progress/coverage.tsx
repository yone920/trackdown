import { View } from 'react-native';

import { BodyMap, coverageSummary } from '@/components/body-map';
import { Columns } from '@/components/charts';
import { Card, Section } from '@/components/kit';
import { DetailScreen } from '@/components/progress/detail-screen';
import { Eyebrow, Sub } from '@/components/type';
import { frequencyColumns, frequencySummary } from '@/lib/progress-sections';
import { useGoals, useTrainingBoard } from '@/lib/queries';
import { C, TABULAR } from '@/lib/theme';

// COVERAGE — the whole body, and how often it gets worked.
//
// The page above carries twelve chips and a popup per muscle; this is where the figure is
// still drawn at full width, front and back, with its legend and the list of what the
// rotation owes a turn. The sessions-a-week columns came here with it: they are a fact
// about the calendar rather than about any one muscle, and they were always the other half
// of this section.

export default function CoverageDetail() {
  const board = useTrainingBoard();
  const goals = useGoals();

  const active = goals.data?.active ?? [];
  const judge = active.length > 0 && active.some((goal) => goal.kind !== 'maintain' && goal.kind !== 'custom');

  const frequency = board.data?.frequency ?? null;
  const columns = frequency ? frequencyColumns(frequency.weeks, judge) : null;
  const trained = frequency && frequency.weeks.some((week) => week.sessions > 0);

  return (
    <DetailScreen
      testID="coverage-detail"
      eyebrow={coverageSummary(frequency?.coverage)}
      title="Coverage">
      {!frequency || !trained ? (
        <Card testID="frequency-empty" style={{ marginTop: 14 }}>
          <Sub>{board.isLoading ? 'Reading your sessions…' : 'No sessions in the last eight weeks.'}</Sub>
        </Card>
      ) : (
        <>
          <Section title="Sessions a week">
            <Card testID="frequency">
              <Eyebrow>Sessions a week</Eyebrow>
              <Sub style={[{ marginTop: 4 }, TABULAR]}>
                {frequencySummary(frequency.weeks, frequency.average_per_week)}
              </Sub>
              {columns ? (
                <View style={{ marginTop: 12 }}>
                  <Columns columns={columns.columns} color={judge ? C.accent : C.mute} height={70} />
                  <View style={{ flexDirection: 'row', marginTop: 6 }}>
                    {columns.columns.map((column, index) => (
                      <Sub key={index} style={[{ flex: 1, textAlign: 'center', fontSize: 10 }, TABULAR]}>
                        {column.label}
                      </Sub>
                    ))}
                  </View>
                </View>
              ) : null}
            </Card>
          </Section>

          <Section title="On the body">
            <BodyMap coverage={frequency.coverage} />
          </Section>
        </>
      )}
    </DetailScreen>
  );
}
