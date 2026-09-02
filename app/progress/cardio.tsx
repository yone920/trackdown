import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Columns, Sparkline } from '@/components/charts';
import { ExerciseName } from '@/components/exercise-name';
import { Card, Section } from '@/components/kit';
import { DetailScreen } from '@/components/progress/detail-screen';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { cardioColumns, cardioProvenance } from '@/lib/progress-sections';
import { useGoals, usePrefetchExercises, useTrainingBoard } from '@/lib/queries';
import { C, FONT, TABULAR } from '@/lib/theme';
import type { BoardCardioRow } from '@/lib/types';

// CARDIO — the week, what it is made of, and each activity's own row.
//
// Everything the Progress tab drew under "Cardio" is here unchanged: equivalent minutes
// against the target, where the target came from, the breakdown behind the number on a tap,
// the weekly columns, the last and best pace, and one row per activity in minutes and miles
// — never a pound (field report 2026-08-31).

export default function CardioDetail() {
  const board = useTrainingBoard();
  const goals = useGoals();
  // The breakdown behind the equivalent number, opened by tapping it. Closed by default:
  // "50 of 150" is the answer and "20 brisk + 15 run×2" is the working.
  const [open, setOpen] = useState(false);

  const active = goals.data?.active ?? [];
  const judge = active.length > 0 && active.some((goal) => goal.kind !== 'maintain' && goal.kind !== 'custom');

  const cardio = board.data?.cardio ?? null;
  const rows = cardio?.activities ?? [];
  const columns = cardio ? cardioColumns(cardio.weeks, cardio.weekly_target_min, judge) : null;
  const noMinutes = !cardio || cardio.weeks.every((week) => week.minutes === 0);
  const nothing = noMinutes && rows.length === 0;

  usePrefetchExercises(rows.map((row) => ({ id: row.exercise_id, mediaCount: row.media_count })));

  const equivalent = cardio ? (cardio.equiv_minutes_this_week ?? cardio.minutes_this_week) : 0;
  const provenance = cardioProvenance(cardio?.target_source);

  return (
    <DetailScreen
      testID="cardio-detail"
      eyebrow={cardio && !nothing ? `${equivalent} of ${cardio.weekly_target_min} min` : null}
      title="Cardio">
      {!cardio || nothing ? (
        <Card testID="cardio-empty" style={{ marginTop: 14 }}>
          <Sub>
            {board.isLoading
              ? 'Reading your week…'
              : cardio
                ? `Nothing logged yet — ${cardio.weekly_target_min} min a week is what the goal asks for.`
                : 'Nothing logged yet.'}
          </Sub>
        </Card>
      ) : (
        <>
          <Section title="This week">
            <Card testID="cardio">
              {/* Equivalent minutes, not minutes: a hard twenty is worth more than an easy
                  forty and the target was never about how long the shoes were on
                  (backend services/coach/cardioIntensity.ts). */}
              <Eyebrow>Equivalent minutes a week</Eyebrow>
              <Pressable
                testID="cardio-equivalent"
                accessibilityRole="button"
                accessibilityLabel={`${equivalent} of ${cardio.weekly_target_min} equivalent minutes — what this is made of`}
                disabled={(cardio.breakdown ?? []).length === 0}
                onPress={() => setOpen((current) => !current)}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                  <Disp size={30} style={TABULAR}>
                    {equivalent}
                  </Disp>
                  <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 12 }}>
                    of {cardio.weekly_target_min} min this week
                  </Sub>
                </View>
                {cardio.equiv_text ? (
                  <Sub testID="cardio-equiv-text" style={[{ marginTop: 4, color: C.mute }, TABULAR]}>
                    {cardio.equiv_text}
                  </Sub>
                ) : null}
              </Pressable>

              {/* Where 150 came from. The calorie target learnt this the hard way
                  (fix-safearea-target-label): a number nobody chose must not be reported as
                  one they did. */}
              {provenance ? (
                <Sub testID="cardio-provenance" style={{ marginTop: 4, color: C.dim }}>
                  {provenance}
                </Sub>
              ) : null}

              {open && (cardio.breakdown ?? []).length > 0 ? (
                <View testID="cardio-breakdown" style={{ marginTop: 12 }}>
                  {cardio.breakdown!.map((row) => (
                    <View
                      key={row.exercise}
                      style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Sub style={{ flex: 1, paddingRight: 10 }}>{`${row.exercise} · ${row.intensity}`}</Sub>
                      <Sub style={TABULAR}>{`${row.minutes} min → ${row.equiv_minutes}`}</Sub>
                    </View>
                  ))}
                  {cardio.alternatives_text ? (
                    <Sub testID="cardio-alternatives" style={{ marginTop: 10, color: C.mute, lineHeight: 17 }}>
                      {`Still short: ${cardio.alternatives_text}.`}
                    </Sub>
                  ) : null}
                </View>
              ) : null}

              {columns ? (
                <View style={{ marginTop: 12 }}>
                  <Columns columns={columns.columns} color={judge ? C.accent : C.mute} height={70} />
                </View>
              ) : null}
              {cardio.last ? (
                <Sub testID="cardio-pace" style={[{ marginTop: 12 }, TABULAR]}>
                  Last: {cardio.last.pace_min_mi.toFixed(1)} min/mi over {cardio.last.distance_mi} mi
                  {cardio.best && cardio.best.date !== cardio.last.date
                    ? ` · best ${cardio.best.pace_min_mi.toFixed(1)}`
                    : ''}
                </Sub>
              ) : null}
            </Card>
          </Section>

          {rows.length > 0 ? (
            <Section title="Activities" summary={`${rows.length}`}>
              <Card style={{ paddingVertical: 4 }} testID="cardio-board">
                {rows.map((row, index) => (
                  <CardioRow key={row.exercise} row={row} last={index === rows.length - 1} />
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </DetailScreen>
  );
}

/** A lift's row, in cardio's units. Minutes, distance and pace — there is no load here. */
function CardioRow({ row, last }: { row: BoardCardioRow; last: boolean }) {
  const router = useRouter();
  const values = row.series
    .map((point) => point.duration_min)
    .filter((minutes): minutes is number => minutes != null);
  const color = row.sentiment === 'good' ? C.good : row.sentiment === 'watch' ? C.accent : C.mute;

  // The same door as a lift's row, in this section's own currency: minutes and pace per
  // session rather than loads (field report 2026-09-02).
  return (
    <Pressable
      testID={`cardio-${row.exercise}`}
      accessibilityRole="button"
      accessibilityLabel={`${row.exercise} — its history`}
      onPress={() => router.push({ pathname: '/history/[exercise]', params: { exercise: row.exercise } })}
      style={{ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <ExerciseName
            testID={`cardio-name-${row.exercise}`}
            name={row.exercise}
            id={row.exercise_id}
            mediaCount={row.media_count}
          />
          <Sub testID={`cardio-sub-${row.exercise}`} style={[{ marginTop: 3 }, TABULAR]}>
            {[row.summary_text, row.days_since === 0 ? 'today' : `${row.days_since}d ago`]
              .filter(Boolean)
              .join(' · ')}
          </Sub>
          {row.delta_text ? (
            <Sub testID={`cardio-delta-${row.exercise}`} style={{ marginTop: 3, color }}>
              {row.delta_text}
            </Sub>
          ) : null}
        </View>
        {values.length > 0 ? (
          <View style={{ width: 76, paddingTop: 4 }}>
            <Sparkline points={values} height={34} color={C.dim} />
          </View>
        ) : null}
      </View>
      <Sub testID={`cardio-next-${row.exercise}`} style={{ marginTop: 6, color: C.ink }}>
        {row.next.text}
      </Sub>
    </Pressable>
  );
}
