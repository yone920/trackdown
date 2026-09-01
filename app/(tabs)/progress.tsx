import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { BodyMap, coverageSummary } from '@/components/body-map';
import { Columns, Sparkline, TrendLine } from '@/components/charts';
import { ExerciseName } from '@/components/exercise-name';
import { IconAvatar, IconChevronDown, IconChevronRight, IconChevronUp } from '@/components/icons';
import { Card, Chip, Chips, dismissDeletes, Row, Section } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { dateLabel } from '@/lib/format';
import {
  cardioColumns,
  cardioProvenance,
  frequencyColumns,
  frequencySummary,
  goalCard,
  goalSections,
  snapshotStrip,
  topLifts,
  type ProgressSection,
} from '@/lib/progress-sections';
import {
  localDateKey,
  useGoalProgress,
  useGoals,
  usePrefetchExercises,
  useProfile,
  useReorderGoals,
  useTrainingBoard,
  useUpdateGoal,
  useWeek,
} from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import type { BoardCardioRow, BoardLift, GoalRecord, GoalWithProgress, TrainingBoard } from '@/lib/types';

// Progress — "what am I chasing, and where do I stand" (user decision 2026-08-31).
//
// This screen is the old Goals tab and the old Progress tab merged into one, because they
// were two halves of the same question and the answer was split across a tab switch. The
// order is the order the question is asked in:
//
//   1. **The goals**, each with where it started, where it is, where it finishes, and
//      whether the rate gets there by the day the user named.
//   2. **The snapshot strip** — sessions this week, cardio equivalent minutes, weight
//      trend. One line, so the tab answers "where do I stand" before anything is scrolled.
//   3. **The lifts board** — the SIX that are live, with the next step from the SAME
//      progression engine the coach uses (`GET /api/training/board` →
//      services/coach/rules.ts). The rest are in `app/lifts.tsx`, grouped by muscle.
//   4. **Cardio** — its own rows, in equivalent minutes and miles, and the week against
//      the plan's intent. Split out of the lifts board on 2026-08-31: a treadmill walk was
//      drawn between two barbell rows, and the two progress by different arithmetic.
//   5. **Coverage** — sessions a week, and the coverage ledger drawn on a body. The
//      sets-per-muscle bars and the "Overdue a turn" list are gone: see §Coverage below.
//   6. **The body**, when no weight goal already owns that line.
//
// The plan the coach reads — how you train, how you eat, constraints, the account — is not
// here any more: it is `app/you.tsx`, behind the avatar. Goal *management* stayed with the
// goals.
//
// No-data states are one quiet line each. Nothing on this screen is coloured green or
// orange for a user who has not asked to be judged (concept-v2 §Goals).

export default function Progress() {
  const router = useRouter();
  const insets = useScreenInsets();
  const today = localDateKey();

  const goals = useGoals();
  const week = useWeek();
  const board = useTrainingBoard();
  const profile = useProfile();
  const update = useUpdateGoal();
  const reorder = useReorderGoals();

  // "Not yet" on a reached prompt: the candidate stays on the row (only the measure can
  // clear it), so the dismissal is this session's, and the prompt is back tomorrow if the
  // goal really is done.
  const [dismissed, setDismissed] = useState<string[]>([]);

  const active = goals.data?.active ?? [];
  const history = goals.data?.history ?? [];
  const judge = active.length > 0 && active.some((goal) => goal.kind !== 'maintain' && goal.kind !== 'custom');

  const refreshing = goals.isRefetching || board.isRefetching || week.isRefetching;
  const onRefresh = useCallback(() => {
    goals.refetch();
    board.refetch();
    week.refetch();
    profile.refetch();
  }, [goals, board, week, profile]);

  const openGoalSheet = () => router.push({ pathname: '/log', params: { hint: 'goal' } });

  const move = (index: number, by: -1 | 1) => {
    const next = [...active];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    reorder.mutate(next.map((goal) => goal.id));
  };

  // A weight goal already draws the weight line at the top of the screen; drawing it twice
  // would be the same fact judged in one place and not in the other.
  const weightGoalOwnsBody = active.some((goal) =>
    goal.metrics.some((metric) => metric.measure === 'body_weight'),
  );

  const snapshot = useMemo(() => snapshotStrip(board.data ?? null), [board.data]);

  // The sheets behind the names on this screen, warmed while it is being read: the six
  // lifts drawn below and the cardio rows beside them, each with its row and its first
  // photograph at the width the sheet asks for (lib/queries.ts §usePrefetchExercises).
  usePrefetchExercises([
    ...topLifts(board.data?.lifts ?? []).map((lift) => ({
      id: lift.exercise_id,
      mediaCount: lift.media_count,
    })),
    ...(board.data?.cardio.activities ?? []).map((row) => ({
      id: row.exercise_id,
      mediaCount: row.media_count,
    })),
  ]);

  return (
    <ScrollView
      testID="progress-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      // A scroll is an answer of "no" to an armed Delete? (components/kit.tsx).
      onScrollBeginDrag={dismissDeletes}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{active.length === 0 ? 'No goal set' : `${active.length} active`}</Eyebrow>
          <Disp size={30} style={{ marginTop: 6 }}>
            Progress
          </Disp>
        </View>
        <Pressable
          testID="progress-you"
          accessibilityLabel="You"
          onPress={() => router.push('/you')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: C.track,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <IconAvatar size={20} color={C.mute} />
        </Pressable>
      </View>

      {goals.isLoading && active.length === 0 ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={C.mute} />
        </View>
      ) : null}

      {!goals.isLoading && active.length === 0 ? <NoGoal onTell={openGoalSheet} /> : null}

      {active.map((goal, index) => (
        <View key={goal.id} style={{ marginTop: 14 }}>
          <GoalBlock
            goal={goal}
            index={index}
            count={active.length}
            today={today}
            week={week.data ?? null}
            dismissed={dismissed.includes(goal.id)}
            busy={update.isPending || reorder.isPending}
            onDismiss={() => setDismissed((current) => [...current, goal.id])}
            onMove={(by) => move(index, by)}
            onReached={() => update.mutate({ id: goal.id, patch: { status: 'reached' } })}
            onDrop={() => update.mutate({ id: goal.id, patch: { status: 'dropped' } })}
            onAdjust={openGoalSheet}
          />
        </View>
      ))}

      {active.length > 0 ? (
        <View style={{ marginTop: 16, alignSelf: 'flex-start' }}>
          <Chip label="Add another goal" onPress={openGoalSheet} testID="add-goal" />
        </View>
      ) : null}

      {/* Three numbers, one line: how often, how much cardio, which way the weight is
          going. It is what the sections below spell out, said once before anything has to
          be scrolled to. */}
      {snapshot ? (
        <Sub testID="snapshot-strip" style={[{ marginTop: 18, color: C.mute, lineHeight: 18 }, TABULAR]}>
          {snapshot}
        </Sub>
      ) : null}

      <LiftsBoard board={board.data ?? null} loading={board.isLoading} />
      <Cardio board={board.data ?? null} judge={judge} />
      <Coverage board={board.data ?? null} judge={judge} />
      {weightGoalOwnsBody ? null : <BodySection board={board.data ?? null} />}

      {history.length > 0 ? (
        <Section title="Before this" summary={`${history.length}`}>
          <Card style={{ paddingVertical: 4 }}>
            {history.map((goal, index) => (
              <Row
                key={goal.id}
                title={goal.title}
                sub={`${outcomeWords(goal)} · ${goal.active_to ? dateLabel(goal.active_to) : dateLabel(goal.active_from)}`}
                divider={index < history.length - 1}
              />
            ))}
          </Card>
        </Section>
      ) : null}
    </ScrollView>
  );
}

/** The goal card's chart, and what it collapses to with one reading and no trend. */
const FULL_CHART = 110;
const SPARSE_CHART = 44;

/** No goal is a legitimate state, not an error (concept-v2 §Goals). */
function NoGoal({ onTell }: { onTell: () => void }) {
  return (
    <Card testID="goals-empty" style={{ marginTop: 18 }}>
      <Disp size={24}>No goal yet</Disp>
      <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>
        Training for consistency: the whole body, eating around maintenance, and nothing judged
        green or red. What is below is what you have actually done.
      </Body>
      <View style={{ marginTop: 14 }}>
        <Chips>
          <Chip label="Tell me what you're after" variant="primary" onPress={onTell} testID="tell-me" />
        </Chips>
      </View>
    </Card>
  );
}

/**
 * One goal. The series live on `GET /api/goals/:id/progress` (the goals list carries the
 * percentages but not the points), so each goal fetches its own — which is why this is a
 * component and not a loop body.
 */
function GoalBlock({
  goal,
  index,
  count,
  today,
  week,
  dismissed,
  busy,
  onMove,
  onReached,
  onDrop,
  onDismiss,
  onAdjust,
}: {
  goal: GoalWithProgress;
  index: number;
  count: number;
  today: string;
  week: ReturnType<typeof useWeek>['data'] | null;
  dismissed: boolean;
  busy: boolean;
  onMove: (by: -1 | 1) => void;
  onReached: () => void;
  onDrop: () => void;
  onDismiss: () => void;
  onAdjust: () => void;
}) {
  const progress = useGoalProgress(goal.id);
  // The goals list carries the percentages but not the points; this endpoint has both, so
  // the goal is re-made with the metrics that can actually be drawn.
  const metrics = progress.data?.metrics;
  const withSeries: GoalWithProgress = useMemo(
    () => (metrics ? { ...goal, progress: { ...goal.progress, metrics } } : goal),
    [goal, metrics],
  );

  const card = useMemo(() => goalCard(withSeries, { week: week ?? null, today }), [withSeries, week, today]);
  // Anything the goal measures beyond its headline number, drawn the way Progress always
  // drew a metric (lib/progress-sections.ts §goalSections).
  const extras = useMemo(() => goalSections(withSeries).slice(1), [withSeries]);

  const reached = !!goal.reached_candidate_at && !dismissed;
  const stalled = !!goal.stalled_since && !reached;

  return (
    <Card testID={`goal-${goal.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow style={{ color: index === 0 ? C.accent : C.mute }}>
            {index === 0 ? 'Goal · primary' : `Goal · ${index + 1}`}
          </Eyebrow>
          <Disp size={26} style={{ marginTop: 4 }}>
            {card.title}
          </Disp>
        </View>
        {count > 1 ? (
          <View style={{ marginLeft: 8 }}>
            <Pressable
              testID={`goal-up-${goal.id}`}
              accessibilityLabel="More important"
              disabled={index === 0 || busy}
              onPress={() => onMove(-1)}
              style={{ padding: 4, opacity: index === 0 ? 0.3 : 1 }}>
              <IconChevronUp size={18} color={C.mute} />
            </Pressable>
            <Pressable
              testID={`goal-down-${goal.id}`}
              accessibilityLabel="Less important"
              disabled={index === count - 1 || busy}
              onPress={() => onMove(1)}
              style={{ padding: 4, opacity: index === count - 1 ? 0.3 : 1 }}>
              <IconChevronDown size={18} color={C.mute} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Where it started, where it is, how far is left and how fast. */}
      <Sub testID={`goal-standing-${goal.id}`} style={[{ marginTop: 8, lineHeight: 18 }, TABULAR]}>
        {[card.standing, card.to_go, card.rate].filter(Boolean).join(' · ')}
      </Sub>

      {card.chart ? (
        <View
          testID={`goal-chart-${goal.id}`}
          style={{ marginTop: 14, height: card.chart.sparse ? SPARSE_CHART : FULL_CHART }}>
          <TrendLine
            height={card.chart.sparse ? SPARSE_CHART : FULL_CHART}
            target={card.chart.target}
            series={
              card.chart.sparse
                ? // One reading: the dot and the target it is measured against. There is no
                  // projection from a single point and no reason to reserve the room for one.
                  [{ values: card.chart.values, color: card.judge ? C.accent : C.ink, width: 2 }]
                : [
                    { values: card.chart.values, color: card.judge ? C.accent : C.ink, width: 2 },
                    // The dotted continuation: where this rate lands, not a promise.
                    { values: card.chart.projection, color: C.dim, width: 1.5, dashed: true },
                  ]
            }
          />
        </View>
      ) : null}

      {card.pace ? (
        <Sub
          testID={`goal-pace-${goal.id}`}
          style={{ marginTop: 10, color: card.pace.tone === 'mute' ? C.mute : C[card.pace.tone] }}>
          {card.pace.text}
        </Sub>
      ) : null}

      {card.week ? (
        <Sub testID={`goal-week-${goal.id}`} style={[{ marginTop: 4 }, TABULAR]}>
          {card.week}
        </Sub>
      ) : null}

      {extras.map((section) => (
        <View key={section.key} style={{ marginTop: 16 }}>
          <ExtraMetric section={section} />
        </View>
      ))}

      {/* The two prompts the day close can raise. Neither one closes anything by itself. */}
      {reached ? (
        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: C.track, paddingTop: 14 }}>
          <Body testID={`goal-reached-${goal.id}`}>Looks like you reached it — mark done?</Body>
        </View>
      ) : null}
      {stalled ? (
        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: C.track, paddingTop: 14 }}>
          <Body testID={`goal-stalled-${goal.id}`}>
            Stalled — adjust? Nothing has moved since {dateLabel(goal.stalled_since as string)}.
          </Body>
        </View>
      ) : null}

      <View style={{ marginTop: 14 }}>
        <Chips>
          <Chip
            label="Mark reached"
            variant={reached ? 'primary' : 'secondary'}
            onPress={onReached}
            disabled={busy}
            testID={`mark-reached-${goal.id}`}
          />
          {reached ? <Chip label="Not yet" onPress={onDismiss} disabled={busy} /> : null}
          {stalled ? <Chip label="Adjust it" variant="primary" onPress={onAdjust} disabled={busy} /> : null}
          <Chip label="Drop" onPress={onDrop} disabled={busy} testID={`drop-${goal.id}`} />
        </Chips>
      </View>
    </Card>
  );
}

/** A goal's second and third measures — the same widget the old Progress tab drew. */
function ExtraMetric({ section }: { section: ProgressSection }) {
  const accent = section.judge ? C.accent : C.mute;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Eyebrow>{section.eyebrow}</Eyebrow>
        {section.sub ? <Sub style={TABULAR}>{section.sub}</Sub> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
        <Disp size={26} style={TABULAR}>
          {section.value}
        </Disp>
        {section.unit ? (
          <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 12 }}>{section.unit}</Sub>
        ) : null}
      </View>
      {section.chart?.kind === 'columns' ? (
        <View style={{ marginTop: 10 }}>
          <Columns columns={section.chart.columns} color={accent} height={60} />
        </View>
      ) : null}
      {section.chart?.kind === 'line' ? (
        <View style={{ marginTop: 10 }}>
          <TrendLine
            height={80}
            target={section.chart.target}
            series={[{ values: section.chart.values, color: accent, width: 2 }]}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The six lifts that are live, and a door to the rest (user decision 2026-08-31).
 *
 * It used to be every exercise logged in four weeks, which on an account that trains
 * properly is twenty-odd rows sitting between the goals and everything else on the tab.
 * `topLifts` ranks them the way the question is asked — trained this week, then the ones
 * held mid-progression waiting for two clean sessions, then the ones owed a baseline — and
 * `app/lifts.tsx` holds the inventory.
 *
 * The next step on each row is still `prescribeLoads` and never a second opinion.
 */
function LiftsBoard({ board, loading }: { board: TrainingBoard | null; loading: boolean }) {
  const router = useRouter();
  const all = useMemo(() => board?.lifts ?? [], [board]);
  const lifts = useMemo(() => topLifts(all), [all]);
  const rest = all.length - lifts.length;

  return (
    <Section title="Lifts" summary={all.length > 0 ? `${all.length}` : null}>
      {all.length === 0 ? (
        <Card testID="lifts-empty">
          <Sub>{loading ? 'Reading your log…' : 'Nothing lifted in the last four weeks.'}</Sub>
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
  );
}

function LiftRow({ lift, last }: { lift: BoardLift; last: boolean }) {
  const values = lift.series.map((point) => point.load_lb).filter((load): load is number => load != null);
  const color =
    lift.sentiment === 'good' ? C.good : lift.sentiment === 'watch' ? C.accent : C.mute;

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

/**
 * How often, and where it landed (user decision 2026-08-31).
 *
 * The sets-per-muscle bars and the "Overdue a turn · Calves · never · Core · 21 days" line
 * that sat under them are **gone**, replaced by the body map. They were the same twelve
 * numbers twice — a bar chart sorted by volume and a text list sorted by debt — in a
 * vocabulary that only reads if you already know the answer. A figure says "the whole back
 * of you is grey" in one look, which is the sentence both of them were trying to write.
 *
 * The sessions-a-week columns stay: that is a fact about the calendar, not about the body,
 * and no picture of a torso says it.
 */
function Coverage({ board, judge }: { board: TrainingBoard | null; judge: boolean }) {
  const frequency = board?.frequency ?? null;
  const columns = frequency ? frequencyColumns(frequency.weeks, judge) : null;
  const trained = frequency && frequency.weeks.some((week) => week.sessions > 0);

  return (
    <Section title="Coverage" summary={coverageSummary(frequency?.coverage)}>
      {!frequency || !trained ? (
        <Card testID="frequency-empty">
          <Sub>No sessions in the last eight weeks.</Sub>
        </Card>
      ) : (
        <>
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
          <View style={{ marginTop: 10 }}>
            <BodyMap coverage={frequency.coverage} />
          </View>
        </>
      )}
    </Section>
  );
}

/**
 * Cardio, which used to be half of the Lifts section (field report 2026-08-31: an Incline
 * Treadmill Walk reading "20 min next" sat between two barbell rows). Its own section, its
 * own rows, its own units: minutes, miles and a pace, and never a pound.
 *
 * Hidden entirely when there is nothing in it *and* nobody asked for any. A section of
 * zeroes on the screen of somebody who lifts and does not run is the app inventing a
 * shortfall — but a user whose goal names weekly minutes has asked the question, and for
 * them an empty section is an answer.
 */
function Cardio({ board, judge }: { board: TrainingBoard | null; judge: boolean }) {
  const cardio = board?.cardio ?? null;
  const rows = cardio?.activities ?? [];
  const columns = cardio ? cardioColumns(cardio.weeks, cardio.weekly_target_min, judge) : null;
  const noMinutes = !cardio || cardio.weeks.every((week) => week.minutes === 0);
  const nothing = noMinutes && rows.length === 0;
  // The breakdown behind the equivalent number, opened by tapping it. Closed by default:
  // "50 of 150" is the answer and "20 brisk + 15 run×2" is the working.
  const [open, setOpen] = useState(false);

  if (nothing && !cardio?.target_stated) return null;

  const equivalent = cardio ? (cardio.equiv_minutes_this_week ?? cardio.minutes_this_week) : 0;
  const provenance = cardioProvenance(cardio?.target_source);

  return (
    <Section
      title="Cardio"
      summary={cardio && !nothing ? `${equivalent} of ${cardio.weekly_target_min} min` : null}>
      {nothing ? (
        <Card testID="cardio-empty">
          <Sub>
            Nothing logged yet — {cardio!.weekly_target_min} min a week is what the goal asks for.
          </Sub>
        </Card>
      ) : (
        <>
          <Card testID="cardio">
            {/* Equivalent minutes, not minutes: a hard twenty is worth more than an easy
                forty and the target was never about how long the shoes were on
                (backend services/coach/cardioIntensity.ts). */}
            <Eyebrow>Equivalent minutes a week</Eyebrow>
            <Pressable
              testID="cardio-equivalent"
              accessibilityRole="button"
              accessibilityLabel={`${equivalent} of ${cardio!.weekly_target_min} equivalent minutes — what this is made of`}
              disabled={(cardio!.breakdown ?? []).length === 0}
              onPress={() => setOpen((current) => !current)}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                <Disp size={30} style={TABULAR}>
                  {equivalent}
                </Disp>
                <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 12 }}>
                  of {cardio!.weekly_target_min} min this week
                </Sub>
              </View>
              {cardio!.equiv_text ? (
                <Sub testID="cardio-equiv-text" style={[{ marginTop: 4, color: C.mute }, TABULAR]}>
                  {cardio!.equiv_text}
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

            {open && (cardio!.breakdown ?? []).length > 0 ? (
              <View testID="cardio-breakdown" style={{ marginTop: 12 }}>
                {cardio!.breakdown!.map((row) => (
                  <View
                    key={row.exercise}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                    <Sub style={{ flex: 1, paddingRight: 10 }}>
                      {`${row.exercise} · ${row.intensity}`}
                    </Sub>
                    <Sub style={TABULAR}>
                      {`${row.minutes} min → ${row.equiv_minutes}`}
                    </Sub>
                  </View>
                ))}
                {cardio!.alternatives_text ? (
                  <Sub testID="cardio-alternatives" style={{ marginTop: 10, color: C.mute, lineHeight: 17 }}>
                    {`Still short: ${cardio!.alternatives_text}.`}
                  </Sub>
                ) : null}
              </View>
            ) : null}

            {columns ? (
              <View style={{ marginTop: 12 }}>
                <Columns columns={columns.columns} color={judge ? C.accent : C.mute} height={70} />
              </View>
            ) : null}
            {cardio!.last ? (
              <Sub testID="cardio-pace" style={[{ marginTop: 12 }, TABULAR]}>
                Last: {cardio!.last.pace_min_mi.toFixed(1)} min/mi over {cardio!.last.distance_mi} mi
                {cardio!.best && cardio!.best.date !== cardio!.last.date
                  ? ` · best ${cardio!.best.pace_min_mi.toFixed(1)}`
                  : ''}
              </Sub>
            ) : null}
          </Card>
          {rows.length > 0 ? (
            <Card style={{ marginTop: 10, paddingVertical: 4 }} testID="cardio-board">
              {rows.map((row, index) => (
                <CardioRow key={row.exercise} row={row} last={index === rows.length - 1} />
              ))}
            </Card>
          ) : null}
        </>
      )}
    </Section>
  );
}

/** A lift's row, in cardio's units. Minutes, distance and pace — there is no load here. */
function CardioRow({ row, last }: { row: BoardCardioRow; last: boolean }) {
  const values = row.series
    .map((point) => point.duration_min)
    .filter((minutes): minutes is number => minutes != null);
  const color = row.sentiment === 'good' ? C.good : row.sentiment === 'watch' ? C.accent : C.mute;

  return (
    <View
      testID={`cardio-${row.exercise}`}
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
    </View>
  );
}

/** The weight line, when no weight goal is already drawing it above. */
function BodySection({ board }: { board: TrainingBoard | null }) {
  const body = board?.body ?? null;
  const values = body?.series.map((point) => point.value) ?? [];

  return (
    <Section title="Body" summary={body?.avg_7d == null ? null : `${body.avg_7d.toFixed(1)} lb · 7-day avg`}>
      {values.length === 0 ? (
        <Card testID="body-empty">
          <Sub>No weigh-ins logged.</Sub>
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
            <TrendLine height={90} series={[{ values, color: C.ink, width: 2 }]} />
          </View>
        </Card>
      )}
    </Section>
  );
}

function outcomeWords(goal: GoalRecord & { outcome: string }): string {
  if (goal.outcome === 'reached') return 'Reached';
  if (goal.outcome === 'dropped') return 'Dropped';
  if (goal.outcome === 'expired') return 'Expired';
  return goal.outcome;
}
