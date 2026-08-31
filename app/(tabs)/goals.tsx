import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ring } from '@/components/charts';
import { IconChevronDown, IconChevronUp, IconGoals } from '@/components/icons';
import { Card, Chip, Chips, Row, Section } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { signOut, useSession } from '@/lib/auth';
import { dateLabel } from '@/lib/format';
import { useGoals, useProfile, useReorderGoals, useUpdateGoal } from '@/lib/queries';
import { C, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import type { GoalMetric, GoalRecord, GoalWithProgress, Profile } from '@/lib/types';

// Goals (docs/design-system.md §Goals). The active goals with their rings and their pace
// lines, the prompts the server's detection has raised, the history of what has ended,
// and — below all of it — the plan the coach reads and the account.
//
// Two rules from concept-v2 §Goals are load-bearing here:
//
//   * **A goal is never closed by the app.** `reached_candidate_at` and `stalled_since`
//     are candidates the day close wrote; this screen turns them into a question, and the
//     user's tap is what changes the status.
//   * **Priority is an order the user owns.** The arrows reorder; nothing here re-ranks a
//     goal because its numbers moved.
//
// Setting a goal is not a form: "Tell me what you're after" opens the Log sheet in goal
// mode, and the server's proposal and the confirm_date / no_date choice happen there
// (concept-v2 §Principles 7 — one input mechanism for everything).

export default function Goals() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const goals = useGoals();
  const profile = useProfile();
  const update = useUpdateGoal();
  const reorder = useReorderGoals();

  // "Not yet" on a reached prompt: the candidate stays on the row (only the measure can
  // clear it), so the dismissal is this session's, and the prompt is back tomorrow if the
  // goal really is done.
  const [dismissed, setDismissed] = useState<string[]>([]);

  const active = goals.data?.active ?? [];
  const history = goals.data?.history ?? [];

  const refreshing = goals.isRefetching || profile.isRefetching;
  const onRefresh = useCallback(() => {
    goals.refetch();
    profile.refetch();
  }, [goals, profile]);

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
    <ScrollView
      testID="goals-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}>
      <Eyebrow>{active.length === 0 ? 'Training for consistency' : `${active.length} active`}</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        Goals
      </Disp>

      {goals.isLoading && active.length === 0 ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={C.mute} />
        </View>
      ) : null}

      {!goals.isLoading && active.length === 0 ? (
        <EmptyGoals onTell={openGoalSheet} />
      ) : (
        active.map((goal, index) => (
          <View key={goal.id} style={{ marginTop: 14 }}>
            <GoalCard
              goal={goal}
              index={index}
              count={active.length}
              dismissed={dismissed.includes(goal.id)}
              busy={update.isPending || reorder.isPending}
              onMove={(by) => move(index, by)}
              onReached={() => update.mutate({ id: goal.id, patch: { status: 'reached' } })}
              onDrop={() => update.mutate({ id: goal.id, patch: { status: 'dropped' } })}
              onDismiss={() => setDismissed((current) => [...current, goal.id])}
              onAdjust={openGoalSheet}
            />
          </View>
        ))
      )}

      {active.length > 0 ? (
        <View style={{ marginTop: 18, alignSelf: 'flex-start' }}>
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

      <PlanSections profile={profile.data ?? null} onTell={() => router.push('/log')} />

      <Section title="Account">
        <Card style={{ paddingVertical: 4 }}>
          <Row title="Signed in as" sub={session?.user.email ?? '—'} />
          <Row title="Sign out" sub="You will need your password again." divider={false} onPress={() => void signOut()} />
        </Card>
      </Section>
    </ScrollView>
  );
}

/** No goal is a legitimate state, not an error (concept-v2 §Goals). */
function EmptyGoals({ onTell }: { onTell: () => void }) {
  return (
    <Card testID="goals-empty" style={{ marginTop: 18 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          borderWidth: 1,
          borderColor: C.track,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <IconGoals size={24} color={C.mute} />
      </View>
      <Disp size={26} style={{ marginTop: 14 }}>
        No goal yet
      </Disp>
      <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>
        Training for consistency: the whole body, eating around maintenance, and nothing judged
        green or red.
      </Body>
      <View style={{ marginTop: 16 }}>
        <Chips>
          <Chip label="Tell me what you're after" variant="primary" onPress={onTell} testID="tell-me" />
        </Chips>
      </View>
    </Card>
  );
}

function GoalCard({
  goal,
  index,
  count,
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
  dismissed: boolean;
  busy: boolean;
  onMove: (by: -1 | 1) => void;
  onReached: () => void;
  onDrop: () => void;
  onDismiss: () => void;
  onAdjust: () => void;
}) {
  const percent = goal.progress?.percent ?? null;
  const reached = !!goal.reached_candidate_at && !dismissed;
  const stalled = !!goal.stalled_since && !reached;

  return (
    <Card testID={`goal-${goal.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ring size={56} stroke={5} fraction={percent ?? 0}>
          <Disp size={15} style={{ color: percent == null ? C.mute : C.ink }}>
            {percent == null ? '—' : `${Math.round(percent * 100)}%`}
          </Disp>
        </Ring>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Eyebrow style={{ color: index === 0 ? C.accent : C.mute }}>
            {index === 0 ? 'Goal · primary' : `Goal · ${index + 1}`}
          </Eyebrow>
          <Disp size={22} style={{ marginTop: 4 }}>
            {goal.title}
          </Disp>
          <Sub style={[{ marginTop: 3, lineHeight: 17 }, TABULAR]}>{paceLine(goal)}</Sub>
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

      {/* The two prompts the day close can raise. Neither one closes anything by itself. */}
      {reached ? (
        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: C.track, paddingTop: 14 }}>
          <Body testID={`goal-reached-${goal.id}`}>Looks like you reached it — mark done?</Body>
          <View style={{ marginTop: 12 }}>
            <Chips>
              <Chip label="Mark reached" variant="primary" onPress={onReached} disabled={busy} />
              <Chip label="Not yet" onPress={onDismiss} disabled={busy} />
            </Chips>
          </View>
        </View>
      ) : null}

      {stalled ? (
        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: C.track, paddingTop: 14 }}>
          <Body testID={`goal-stalled-${goal.id}`}>
            Stalled — adjust? Nothing has moved since {dateLabel(goal.stalled_since!)}.
          </Body>
          <View style={{ marginTop: 12 }}>
            <Chips>
              <Chip label="Adjust it" variant="primary" onPress={onAdjust} disabled={busy} />
              <Chip label="Drop it" onPress={onDrop} disabled={busy} />
            </Chips>
          </View>
        </View>
      ) : null}

      {!reached && !stalled ? (
        <View style={{ marginTop: 14 }}>
          <Chips>
            <Chip label="Mark reached" onPress={onReached} disabled={busy} testID={`mark-reached-${goal.id}`} />
            <Chip label="Drop" onPress={onDrop} disabled={busy} />
          </Chips>
        </View>
      ) : null}
    </Card>
  );
}

/** "181 → 170 lb · by 1 Dec" — where the goal is and where it finishes, when it does. */
function paceLine(goal: GoalWithProgress): string {
  const measure = goal.progress?.metrics?.[0] ?? null;
  const spec: GoalMetric | undefined = goal.metrics[0];
  const unit = measure?.unit ?? spec?.unit ?? '';
  const current = measure?.current;
  const target = measure?.target ?? spec?.target ?? null;

  const head =
    current == null
      ? target == null
        ? 'A standing intention'
        : `Target ${target}${unit ? ` ${unit}` : ''}`
      : target == null
        ? `${round(current)}${unit ? ` ${unit}` : ''} · no finish line`
        : `${round(current)} → ${round(target)}${unit ? ` ${unit}` : ''}`;

  const by = spec?.by ?? null;
  return by ? `${head} · by ${dateLabel(by)}` : head;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : (Math.round(value * 10) / 10).toFixed(1);
}

function outcomeWords(goal: GoalRecord & { outcome: string }): string {
  if (goal.outcome === 'reached') return 'Reached';
  if (goal.outcome === 'dropped') return 'Dropped';
  if (goal.outcome === 'expired') return 'Expired';
  return goal.outcome;
}

/**
 * The plan the coach reads, rendered organised, each row dated with when it was last
 * stated (concept-v2 §Goals and profile). Editing is the same sentence again — "Tell me"
 * opens the Log sheet, which classifies it and shows what it understood.
 */
function PlanSections({ profile, onTell }: { profile: Profile | null; onTell: () => void }) {
  const stated = (profile?.stated_at ?? {}) as Record<string, string>;
  const dated = (field: string): string | null => {
    const at = stated[field];
    return at ? `Said ${dateLabel(at.slice(0, 10))}` : null;
  };
  const list = (field: 'constraints' | 'preferences'): string[] =>
    Array.isArray(profile?.[field]) ? (profile[field] as string[]) : [];

  const equipment = Array.isArray(profile?.equipment) ? (profile.equipment as string[]) : [];
  const targets = profile?.targets ?? null;

  return (
    <View>
      <Section title="How you train">
        <Card style={{ paddingVertical: 4 }}>
          <Row
            title="Days a week"
            sub={dated('training_days')}
            right={profile?.training_days == null ? '—' : String(profile.training_days)}
          />
          <Row
            title="Where"
            // The gym they named, and how much has been seen there — accrued from their own
            // logs, never a list anyone filled in (migration 0012).
            sub={
              profile?.place
                ? `${profile.place.name} · ${profile.place.equipment_count} ${
                    profile.place.equipment_count === 1 ? 'machine' : 'machines'
                  } seen`
                : dated('environment')
            }
            right={typeof profile?.environment === 'string' ? profile.environment : '—'}
          />
          <Row
            title="Equipment"
            sub={equipment.length > 0 ? equipment.join(', ') : 'Not said yet'}
            divider={false}
          />
        </Card>
      </Section>

      <Section title="How you eat">
        <Card style={{ paddingVertical: 4 }}>
          <Row
            title="Diet style"
            sub={dated('diet_style')}
            right={typeof profile?.diet_style === 'string' ? profile.diet_style : '—'}
          />
          <Row
            title="Daily target"
            sub={targets?.source === 'none' ? 'Tell me your height, age and weight' : `From ${targets?.source ?? '—'}`}
            right={targets?.eat_target == null ? '—' : String(Math.round(targets.eat_target))}
          />
          <Row
            title="Eat back what you earn"
            sub="How much of a workout the ring lets you spend"
            right={targets?.eatback ?? '—'}
            divider={false}
          />
        </Card>
      </Section>

      <Section title="Constraints" summary={`${list('constraints').length}`}>
        <Card style={{ paddingVertical: 4 }}>
          {list('constraints').length === 0 ? (
            <Row title="Nothing to work around" sub="Injuries and exercises to avoid live here." divider={false} />
          ) : (
            list('constraints').map((text, index, all) => (
              <Row key={text} title={text} divider={index < all.length - 1} />
            ))
          )}
        </Card>
        {list('preferences').length > 0 ? (
          <Card style={{ marginTop: 10, paddingVertical: 4 }}>
            <Eyebrow style={{ paddingTop: 10 }}>Preferences</Eyebrow>
            {list('preferences').map((text, index, all) => (
              <Row key={text} title={text} divider={index < all.length - 1} />
            ))}
          </Card>
        ) : null}
        <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
          <Chip label="Tell me" onPress={onTell} testID="tell-plan" />
        </View>
      </Section>

      <Section title="Health sync">
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Body>Apple Health</Body>
            <Sub style={{ marginTop: 4, lineHeight: 17 }}>
              Walks, steps and body mass, as an extra source. Needs the dev build — WP7.
            </Sub>
          </View>
          <Switch
            testID="health-sync"
            value={false}
            disabled
            trackColor={{ false: C.track, true: C.good }}
            thumbColor={C.dim}
          />
        </Card>
      </Section>
    </View>
  );
}
