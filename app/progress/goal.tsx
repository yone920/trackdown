import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Columns, TrendLine } from '@/components/charts';
import { IconChevronDown, IconChevronUp } from '@/components/icons';
import { Card, Chip, Chips, Row, Section } from '@/components/kit';
import { DetailScreen } from '@/components/progress/detail-screen';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { dateLabel } from '@/lib/format';
import { goalCard, goalSections, type ProgressSection } from '@/lib/progress-sections';
import {
  localDateKey,
  useGoalProgress,
  useGoals,
  useReorderGoals,
  useTrainingBoard,
  useUpdateGoal,
  useWeek,
} from '@/lib/queries';
import { C, FONT, TABULAR } from '@/lib/theme';
import type { GoalRecord, GoalWithProgress } from '@/lib/types';

// The goal, at length — everything the Progress page used to draw at the top of itself
// (user decision 2026-09-02: the page is a scoreboard, and a scoreboard has doors).
//
// Nothing here changed in the move except the container: the standing line, the labelled
// and dated weigh-in trio, the chart with its dotted projection, the pace verdict, the
// reached and stalled prompts, the reorder arrows, "Add another goal" and the history of
// what has ended are all exactly what the tab drew. The page above keeps the ring, the
// number and the last move, and this is where the working is shown.

/** The goal card's chart, and what it collapses to with one reading and no trend. */
const FULL_CHART = 110;
const SPARSE_CHART = 44;

export default function GoalDetail() {
  const router = useRouter();
  const today = localDateKey();

  const goals = useGoals();
  const week = useWeek();
  const board = useTrainingBoard();
  const update = useUpdateGoal();
  const reorder = useReorderGoals();

  // "Not yet" on a reached prompt: the candidate stays on the row (only the measure can
  // clear it), so the dismissal is this session's, and the prompt is back tomorrow if the
  // goal really is done.
  const [dismissed, setDismissed] = useState<string[]>([]);

  const active = goals.data?.active ?? [];
  const history = goals.data?.history ?? [];

  const openGoalSheet = () => router.push({ pathname: '/log', params: { hint: 'goal' } });

  const move = (index: number, by: -1 | 1) => {
    const next = [...active];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    reorder.mutate(next.map((goal) => goal.id));
  };

  return (
    <DetailScreen
      testID="goal-detail"
      eyebrow={active.length === 0 ? 'No goal set' : `${active.length} active`}
      title="Goal">
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
            weighIns={board.data?.body.series ?? []}
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
    </DetailScreen>
  );
}

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
  weighIns,
}: {
  goal: GoalWithProgress;
  index: number;
  count: number;
  today: string;
  /** The actual weigh-ins behind the average, oldest first (TrainingBoard.body.series). */
  weighIns: readonly { date: string; value: number }[];
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

  const card = useMemo(
    () => goalCard(withSeries, { week: week ?? null, today, weighIns }),
    [withSeries, week, today, weighIns],
  );
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

      {/* The weigh-ins themselves, labelled and dated (user request 2026-09-02: "show where
          I was at the previous weight vs the new one with dates"). The line above is the
          claim; these are the evidence, and an average says out loud that it is one. */}
      {card.readings ? (
        <View testID={`goal-readings-${goal.id}`} style={{ marginTop: 10, gap: 3 }}>
          {card.readings.latest ? (
            <Reading label="Latest" value={card.readings.latest.value} when={card.readings.latest.when} />
          ) : null}
          {card.readings.previous ? (
            <Reading label="Before that" value={card.readings.previous.value} when={card.readings.previous.when} />
          ) : null}
          {card.readings.average ? <Reading label="7-day average" value={card.readings.average} /> : null}
        </View>
      ) : null}

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

function outcomeWords(goal: GoalRecord & { outcome: string }): string {
  if (goal.outcome === 'reached') return 'Reached';
  if (goal.outcome === 'dropped') return 'Dropped';
  if (goal.outcome === 'expired') return 'Expired';
  return goal.outcome;
}

/**
 * One labelled fact on the goal card: what it is, what it says, and when it was taken.
 *
 * Labelled because the card used to print "212.0 → 161.0 lb now (7-day avg)" — an arrow
 * between two numbers, one of them an average, neither of them dated — and a reader trying
 * to judge whether 161 was believable had nothing to check it against.
 */
function Reading({ label, value, when }: { label: string; value: string; when?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
      <Eyebrow style={{ minWidth: 96 }}>{label}</Eyebrow>
      <Sub style={[{ fontFamily: FONT.medium, color: C.ink }, TABULAR]}>{value}</Sub>
      {when ? <Sub style={{ color: C.dim }}>{when}</Sub> : null}
    </View>
  );
}
