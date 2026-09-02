import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { Sparkline } from '@/components/charts';
import { ExerciseName } from '@/components/exercise-name';
import { IconChevronRight } from '@/components/icons';
import { Body, Sub } from '@/components/type';
import { Card, Section } from '@/components/kit';
import { DetailScreen } from '@/components/progress/detail-screen';
import { topLifts } from '@/lib/progress-sections';
import { usePrefetchExercises, useTrainingBoard } from '@/lib/queries';
import { C, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import type { BoardLift } from '@/lib/types';

// STRENGTH — the live board (user decision 2026-09-02: the six cards came off the page and
// moved behind the row that summarises them).
//
// Nothing about a card changed. `topLifts` still ranks them the way the question is asked —
// trained this week, then the ones held mid-progression waiting for two clean sessions,
// then the ones owed a baseline — the sparkline is still the last four weeks of load, and
// the next step is still `prescribeLoads` and never a second opinion. "All lifts" is still
// the way to the grouped inventory (app/lifts.tsx).

export default function StrengthDetail() {
  const router = useRouter();
  const board = useTrainingBoard();

  const all = useMemo(() => board.data?.lifts ?? [], [board.data]);
  const lifts = useMemo(() => topLifts(all), [all]);
  const rest = all.length - lifts.length;

  // The sheets behind the names on this screen, warmed while it is being read.
  usePrefetchExercises(lifts.map((lift) => ({ id: lift.exercise_id, mediaCount: lift.media_count })));

  return (
    <DetailScreen
      testID="strength-detail"
      eyebrow={all.length === 0 ? 'Nothing in four weeks' : `${all.length} in four weeks`}
      title="Strength">
      <Section title="Live" summary={lifts.length > 0 ? `${lifts.length}` : null}>
        {all.length === 0 ? (
          <Card testID="lifts-empty">
            <Sub>{board.isLoading ? 'Reading your log…' : 'Nothing lifted in the last four weeks.'}</Sub>
          </Card>
        ) : (
          <>
            <Card style={{ paddingVertical: 4 }} testID="lifts-board">
              {lifts.map((lift, index) => (
                <LiftRow key={lift.exercise} lift={lift} last={index === lifts.length - 1} />
              ))}
            </Card>
            {/* Drawn whenever there is a board at all, not only when it overflows: "All
                lifts (6)" is still the way to the grouped view, and a link that appears at
                seven rows is a link nobody knows exists. */}
            <Pressable
              testID="all-lifts"
              accessibilityRole="button"
              accessibilityLabel={`All lifts, ${all.length}`}
              onPress={() => router.push('/lifts')}
              style={{
                marginTop: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 12,
                paddingHorizontal: SPACE.card,
                borderRadius: RADIUS.card,
                borderWidth: 1,
                borderColor: C.track,
              }}>
              <Body style={{ color: C.mute }}>
                {rest > 0 ? `All lifts (${all.length}) · ${rest} more` : `All lifts (${all.length})`}
              </Body>
              <IconChevronRight size={16} color={C.mute} />
            </Pressable>
          </>
        )}
      </Section>
    </DetailScreen>
  );
}

function LiftRow({ lift, last }: { lift: BoardLift; last: boolean }) {
  const values = lift.series.map((point) => point.load_lb).filter((load): load is number => load != null);
  const color = lift.sentiment === 'good' ? C.good : lift.sentiment === 'watch' ? C.accent : C.mute;

  return (
    <View
      testID={`lift-${lift.exercise}`}
      style={{
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: C.line,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <ExerciseName
            testID={`lift-name-${lift.exercise}`}
            name={lift.exercise}
            id={lift.exercise_id}
            mediaCount={lift.media_count}
          />
          <Sub style={[{ marginTop: 3 }, TABULAR]}>
            {[
              lift.load_text,
              lift.sets != null && lift.reps != null ? `${lift.sets} × ${lift.reps}` : null,
              lift.days_since === 0 ? 'today' : `${lift.days_since}d ago`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Sub>
          {lift.delta_text ? (
            <Sub testID={`lift-delta-${lift.exercise}`} style={{ marginTop: 3, color }}>
              {lift.delta_text}
            </Sub>
          ) : null}
        </View>
        {values.length > 0 ? (
          <View style={{ width: 76, paddingTop: 4 }}>
            <Sparkline points={values} height={34} color={C.dim} />
          </View>
        ) : null}
      </View>
      <Sub testID={`lift-next-${lift.exercise}`} style={{ marginTop: 6, color: C.ink }}>
        {lift.next.text}
        {lift.next.eta ? <Sub style={{ color: C.mute }}> · {lift.next.eta}</Sub> : null}
      </Sub>
    </View>
  );
}
