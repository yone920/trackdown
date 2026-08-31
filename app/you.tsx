import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { IconChevronLeft } from '@/components/icons';
import { Card, Chip, Row, Section } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { signOut, useSession } from '@/lib/auth';
import { dateLabel } from '@/lib/format';
import { useProfile } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, SPACE } from '@/lib/theme';
import type { Profile, ProfileTargets } from '@/lib/types';

// You — the plan the coach reads, rendered organised, and the account (concept-v2 §Goals
// and profile; design-system §Goals, whose bottom half this is).
//
// It moved off the Goals tab when Goals and Progress merged (user decision 2026-08-31):
// the Progress tab answers "what am I chasing and where do I stand", and none of this
// does. It is reached from the avatar on Today's header and from the one on Progress.
//
// **NO FORMS** (concept-v2 §Principles 7). Every row here is read-only and every one of
// them is changed the same way: say it again. "Tell me" opens the Log sheet, the classifier
// routes it, and the confirm card shows what was understood. The only control on this
// screen that is not a sentence is the Health toggle, and it is disabled until WP7.

export default function You() {
  const router = useRouter();
  const insets = useScreenInsets();
  const { session } = useSession();
  const profile = useProfile();

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const tell = () => router.push('/log');

  const data = profile.data ?? null;
  const stated = (data?.stated_at ?? {}) as Record<string, string>;
  const dated = (field: string): string | null => {
    const at = stated[field];
    return at ? `Said ${dateLabel(at.slice(0, 10))}` : null;
  };
  const list = (field: 'constraints' | 'preferences'): string[] =>
    Array.isArray(data?.[field]) ? (data[field] as string[]) : [];

  const equipment = Array.isArray(data?.equipment) ? (data.equipment as string[]) : [];
  const targets = data?.targets ?? null;

  return (
    <ScrollView
      testID="you-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}>
      <Pressable
        onPress={goBack}
        accessibilityLabel="Back"
        testID="you-back"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, alignSelf: 'flex-start' }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Back</Sub>
      </Pressable>

      <Eyebrow style={{ marginTop: 6 }}>What I know about you</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        You
      </Disp>

      <Section title="How you train">
        <Card style={{ paddingVertical: 4 }}>
          <Row
            title="Days a week"
            sub={dated('training_days')}
            right={data?.training_days == null ? '—' : String(data.training_days)}
          />
          <Row
            title="Where"
            // The gym they named, and how much has been seen there — accrued from their own
            // logs, never a list anyone filled in (migration 0012).
            sub={
              data?.place
                ? `${data.place.name} · ${data.place.equipment_count} ${
                    data.place.equipment_count === 1 ? 'machine' : 'machines'
                  } seen`
                : dated('environment')
            }
            right={typeof data?.environment === 'string' ? data.environment : '—'}
          />
          <Row
            title="Equipment"
            sub={equipment.length > 0 ? equipment.join(', ') : 'Not said yet'}
            divider={false}
          />
        </Card>
        <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
          <Chip label="Tell me" onPress={tell} testID="tell-training" />
        </View>
      </Section>

      <Section title="How you eat">
        <Card style={{ paddingVertical: 4 }}>
          <Row
            title="Diet style"
            sub={dated('diet_style')}
            right={typeof data?.diet_style === 'string' ? data.diet_style : '—'}
          />
          <Row
            title="Daily target"
            sub={targetProvenance(targets?.source)}
            right={targets?.eat_target == null ? '—' : String(Math.round(targets.eat_target))}
          />
          <Row
            title="Eat back what you earn"
            sub="How much of a workout the ring lets you spend"
            right={targets?.eatback ?? '—'}
            divider={false}
          />
        </Card>
        <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
          <Chip label="Tell me" onPress={tell} testID="tell-eating" />
        </View>
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
          <Chip label="Tell me" onPress={tell} testID="tell-plan" />
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

      <Section title="Account">
        <Card style={{ paddingVertical: 4 }}>
          <Row title="Signed in as" sub={session?.user.email ?? '—'} />
          <Row title="Sign out" sub="You will need your password again." divider={false} onPress={() => void signOut()} />
        </Card>
      </Section>
    </ScrollView>
  );
}

/**
 * The line under "Daily target": where the number came from, in words.
 *
 * This used to print the wire value — "From stated" — for every source but `none`, which
 * meant a fresh account was told its 2100 was something it had said. 2100 is the
 * `daily_calorie_target` column's DEFAULT; nobody stated anything. The server separates the
 * two (backend services/tdee.ts §TargetSource) and `default` says so.
 */
function targetProvenance(source: ProfileTargets['source'] | undefined): string {
  if (source === 'derived') return 'From your stats';
  if (source === 'stated') return 'From stated';
  if (source === 'default') return 'Default until you tell me more';
  return 'Tell me your height, age and weight';
}

/** Kept beside the screen it types: the plan row as `GET /api/profile` returns it. */
export type YouProfile = Profile;
