import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { ExerciseName } from '@/components/exercise-name';
import { IconChevronLeft } from '@/components/icons';
import { Card, Section } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { liftGroups, STALE_DAYS } from '@/lib/progress-sections';
import { useTrainingBoard } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, SPACE, TABULAR } from '@/lib/theme';
import type { BoardLift } from '@/lib/types';

// All lifts — the second half of the board (user decision 2026-08-31).
//
// Progress shows the six that are live and links here for the rest, because a tab that
// answers "where do I stand" cannot also be a twenty-row inventory: the goals, the cardio
// and the body all sit below the lifts, and on a real account nobody scrolled that far.
//
// This screen is the inventory, and it is deliberately quieter than the six. Two lines per
// row — the name with a trend dot, then the load and how long ago — and **no advice line**:
// "Hold 135 lb until 3 × 8 twice" is the sentence Progress draws for the lifts that are
// actually in play, and twenty of them is a wall of instructions nobody asked for
// (concept-v2 §Principles 8). The next step is one tap away, on the exercise's own row on
// Progress or on the coach's plan.

export default function Lifts() {
  const router = useRouter();
  const insets = useScreenInsets();
  const board = useTrainingBoard();

  const lifts = useMemo(() => board.data?.lifts ?? [], [board.data]);
  const groups = useMemo(() => liftGroups(lifts), [lifts]);

  return (
    <ScrollView
      testID="lifts-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}>
      <Pressable
        testID="lifts-back"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/progress'))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, alignSelf: 'flex-start' }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Back</Sub>
      </Pressable>

      <Eyebrow style={{ marginTop: 6 }}>
        {lifts.length === 0 ? 'Nothing in four weeks' : `${lifts.length} in four weeks`}
      </Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        All lifts
      </Disp>

      {board.isLoading && lifts.length === 0 ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={C.mute} />
        </View>
      ) : null}

      {!board.isLoading && lifts.length === 0 ? (
        <Card testID="lifts-all-empty" style={{ marginTop: 18 }}>
          <Sub>Nothing lifted in the last four weeks.</Sub>
        </Card>
      ) : null}

      {groups.map((group) => (
        <Section
          key={group.key}
          title={group.label}
          summary={`${group.lifts.length}`}
          note={group.stale ? `over ${STALE_DAYS} days` : null}>
          <Card style={{ paddingVertical: 4 }} testID={`lift-group-${group.key}`}>
            {group.lifts.map((lift, index) => (
              <CompactLiftRow
                key={lift.exercise}
                lift={lift}
                dim={group.stale}
                last={index === group.lifts.length - 1}
              />
            ))}
          </Card>
        </Section>
      ))}
    </ScrollView>
  );
}

/** Name · trend dot, then load · when. No next step: see the note at the top of the file. */
function CompactLiftRow({ lift, dim, last }: { lift: BoardLift; dim: boolean; last: boolean }) {
  const router = useRouter();
  const color = lift.sentiment === 'good' ? C.good : lift.sentiment === 'watch' ? C.accent : C.dim;

  // "60 lb · today" was the whole row, and the field report (2026-09-02) was that it does
  // not say enough: pressing it now opens every session of this movement. The NAME keeps
  // its own door to the how-to sheet — the glyph contract does not change here.
  return (
    <Pressable
      testID={`all-lift-${lift.exercise}`}
      accessibilityRole="button"
      accessibilityLabel={`${lift.exercise} — its history`}
      onPress={() => router.push({ pathname: '/history/[exercise]', params: { exercise: lift.exercise } })}
      style={{
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: C.line,
        opacity: dim ? 0.7 : 1,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ExerciseName
          testID={`all-lift-name-${lift.exercise}`}
          name={lift.exercise}
          id={lift.exercise_id}
          mediaCount={lift.media_count}
        />
        {/* Which way it has gone, as a dot. The words are on Progress; here the colour is
            the whole sentence, and `sentiment` already knows that less help is progress. */}
        <View
          testID={`all-lift-dot-${lift.exercise}`}
          accessibilityLabel={lift.delta_text ?? 'No change'}
          style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }}
        />
      </View>
      <Sub style={[{ marginTop: 2 }, TABULAR]}>
        {[lift.load_text, lift.days_since === 0 ? 'today' : `${lift.days_since}d ago`]
          .filter(Boolean)
          .join(' · ')}
      </Sub>
    </Pressable>
  );
}
