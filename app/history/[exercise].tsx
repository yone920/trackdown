import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { SessionTrend } from '@/components/charts';
import { IconPhoto } from '@/components/icons';
import { Card, Row, Section, Skeleton } from '@/components/kit';
import { DetailScreen } from '@/components/progress/detail-screen';
import { Body, Disp, Sub } from '@/components/type';
import { readerLine } from '@/lib/errors';
import {
  entriesNote,
  historyPoints,
  historySummary,
  MIN_POINTS_FOR_LINE,
  muscleEyebrow,
  sessionLine,
  sessionPerSide,
  sessionWhen,
  sparseNote,
  stateLine,
} from '@/lib/exercise-history';
import { openExercise } from '@/lib/exercise';
import { dateLabel } from '@/lib/format';
import { localDateKey, useDeleteRecord, useExerciseHistory } from '@/lib/queries';
import { C, FONT, TABULAR } from '@/lib/theme';

// One exercise, all of it (user field report 2026-09-02, on All lifts: "60 lb · today …
// doesn't have enough detail … the historic loads, the progress of the load … which
// direction I'm going").
//
// The board's row answers "where does this stand". This answers "how did it get there":
// the coach's own next step at the top — read off the board by the server, so this screen
// and the row that opened it cannot say different things — then the load over its own
// sessions, then every session ever logged, newest first, each one a door to the record it
// came from.
//
// **The name is not this door.** A name anywhere in this app opens the how-to sheet, and
// that contract does not bend for a new screen (components/exercise-name.tsx): the ROW is
// what opens the history, and the sheet is still one tap away from here, on the glyph.

export default function ExerciseHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ exercise?: string; id?: string; media?: string }>();
  const name = typeof params.exercise === 'string' ? params.exercise : '';
  const today = localDateKey();

  const history = useExerciseHistory(name);
  const remove = useDeleteRecord();
  const view = history.data ?? null;

  const chart = useMemo(() => (view ? historyPoints(view) : { points: [], unit: null }), [view]);
  const state = view ? stateLine(view) : null;
  const note = view ? sparseNote(chart.points.length) : null;

  /** A session opens the row it came from, in the review-and-tell sheet every log uses. */
  const correct = (session: { id: string | null; date: string }) => {
    if (!session.id) return;
    router.push({
      pathname: '/log',
      params: { editDate: session.date, editId: session.id, editKind: 'activity' },
    });
  };

  return (
    <DetailScreen
      testID="exercise-history"
      eyebrow={view ? muscleEyebrow(view) : null}
      title={view?.exercise ?? name}>
      {/* The how-to sheet, still one tap away — the door the name is everywhere else. */}
      {view && view.media_count > 0 ? (
        <Pressable
          testID="history-how-to"
          accessibilityRole="button"
          accessibilityLabel={`${view.exercise} — how it is done`}
          onPress={() => openExercise(router, { name: view.exercise, id: view.exercise_id, mediaCount: view.media_count })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, alignSelf: 'flex-start', paddingVertical: 6 }}>
          <IconPhoto size={14} color={C.mute} />
          <Sub style={{ color: C.mute, textDecorationLine: 'underline', textDecorationColor: C.track }}>
            How it is done
          </Sub>
        </Pressable>
      ) : null}

      {history.isLoading && !view ? (
        <View testID="history-skeleton" style={{ marginTop: 18 }}>
          <Skeleton width="60%" height={18} />
          <Card style={{ marginTop: 14 }}>
            <Skeleton width="100%" height={110} />
          </Card>
        </View>
      ) : null}

      {history.error && !view ? (
        <Card testID="history-error" style={{ marginTop: 18 }}>
          <Sub style={{ color: C.accent }}>
            {readerLine(history.error, 'Nothing logged for this one yet.')}
          </Sub>
        </Card>
      ) : null}

      {view ? (
        <>
          {/* Where it stands — the coach's own sentence, and the reason under it. */}
          {state ? (
            <View style={{ marginTop: 14 }}>
              <Body testID="history-state" style={[{ color: C.ink, lineHeight: 21 }, TABULAR]}>
                {state.text}
              </Body>
              {state.why ? (
                <Sub testID="history-why" style={{ marginTop: 4, lineHeight: 17 }}>
                  {state.why}
                </Sub>
              ) : null}
            </View>
          ) : null}

          {/* How it got there. */}
          <Section title={chart.unit === 'min' ? 'Minutes' : 'Load'} summary={historySummary(view)}>
            <Card testID="history-chart">
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Disp size={30} testID="history-latest" style={TABULAR}>
                  {chart.points.length > 0 ? String(chart.points[chart.points.length - 1]!.value) : '—'}
                </Disp>
                {chart.unit ? (
                  <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 12 }}>{chart.unit}</Sub>
                ) : null}
                {view.best_load_lb != null && chart.unit === 'lb' ? (
                  <Sub testID="history-best" style={[{ marginLeft: 10 }, TABULAR]}>
                    best {view.best_load_lb} lb
                  </Sub>
                ) : null}
              </View>

              <View style={{ marginTop: 12 }}>
                <SessionTrend
                  values={chart.points.map((point) => point.value)}
                  height={110}
                  color={C.accent}
                  // Under three sessions it is dots and no line: two points joined up look
                  // exactly like a trend and are not one.
                  line={chart.points.length >= MIN_POINTS_FOR_LINE}
                />
              </View>

              {chart.points.length > 1 ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Sub testID="history-from" style={[{ fontSize: 10 }, TABULAR]}>
                    {dateLabel(chart.points[0]!.date)}
                  </Sub>
                  <Sub testID="history-to" style={[{ fontSize: 10 }, TABULAR]}>
                    {dateLabel(chart.points[chart.points.length - 1]!.date)}
                  </Sub>
                </View>
              ) : null}

              {note ? (
                <Sub testID="history-sparse" style={{ marginTop: 10, color: C.dim, lineHeight: 17 }}>
                  {note}
                </Sub>
              ) : null}
            </Card>
          </Section>

          {/* Every session, newest first. */}
          <Section title="Sessions" summary={`${view.sessions_count}`}>
            <Card style={{ paddingVertical: 4 }} testID="history-sessions">
              {view.sessions.map((session, index) => (
                <Row
                  key={session.id ?? `${session.date}-${index}`}
                  testID={`history-session-${session.date}`}
                  title={sessionWhen(session.date, today)}
                  sub={[
                    sessionLine(session, { loadDirection: view.load_direction }),
                    sessionPerSide(session, view.equipment),
                    entriesNote(session),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onPress={session.id ? () => correct(session) : undefined}
                  pressLabel={`${sessionWhen(session.date, today)} — open to correct`}
                  onDelete={session.id ? () => remove.mutate({ kind: 'activity', id: session.id as string }) : undefined}
                  deleteLabel={`${view.exercise} on ${dateLabel(session.date)}`}
                  divider={index < view.sessions.length - 1}
                />
              ))}
            </Card>
          </Section>
        </>
      ) : null}

      {!history.isLoading && !view && !history.error ? (
        <Card testID="history-empty" style={{ marginTop: 18 }}>
          <Sub>Nothing logged for this one yet.</Sub>
        </Card>
      ) : null}

      {history.isFetching && view ? (
        <View style={{ alignItems: 'center', paddingTop: 16 }}>
          <ActivityIndicator color={C.dim} size="small" />
        </View>
      ) : null}
    </DetailScreen>
  );
}
