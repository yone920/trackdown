import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { IconChevronLeft } from '@/components/icons';
import { Card, Chip, Row, Section, SkeletonLines } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { signOut, useSession } from '@/lib/auth';
import { useProfile, useYou } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, SPACE } from '@/lib/theme';
import type { Dossier, Profile } from '@/lib/types';

// You — what the app knows about you, and the account.
//
// It moved off the Goals tab when Goals and Progress merged (user decision 2026-08-31):
// the Progress tab answers "what am I chasing and where do I stand", and none of this
// does. It is reached from the avatar on Today's header and from the one on Progress.
//
// **The dossier replaced the rows** (user decision 2026-08-31). "How you train" and "How
// you eat" were two cards of label-value pairs — Days a week · 4, Diet style · —, Daily
// target · 2100 — which is a form with the inputs taken out, on a screen whose first law is
// that there are no forms (concept-v2 §Principles 7). Worse, the interesting half of a plan
// is the half nobody has said yet, and a row reading "—" is the least persuasive way there
// is to ask for it.
//
// So the top of the screen is two generated paragraphs (`GET /api/you`): what is known —
// stated facts blended with what four weeks of logs actually show — and what is missing,
// written as invitations with the benefit attached ("Tell me how long a session usually
// runs and I can size the plan to it"). Everything the rows used to print is an input to
// it, so nothing was lost except the grid.
//
// **NO FORMS** still. Everything here is read-only and changed the same way: say it again.
// "Tell me" opens the Log sheet, the classifier routes it, and the confirm card shows what
// was understood. The only control on this screen that is not a sentence is the Health
// toggle, and it is disabled until WP7.

export default function You() {
  const router = useRouter();
  const insets = useScreenInsets();
  const { session } = useSession();
  const profile = useProfile();
  const you = useYou();

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const tell = () => router.push('/log');

  const data = profile.data ?? null;
  const list = (field: 'constraints' | 'preferences'): string[] =>
    Array.isArray(data?.[field]) ? (data[field] as string[]) : [];

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

      <Eyebrow style={{ marginTop: 6 }}>
        {session?.user.email ? 'The account' : 'Your plan'}
      </Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        You
      </Disp>

      <DossierCard dossier={you.data?.dossier ?? null} loading={you.isLoading} />

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

      {/* One button, at the bottom, for everything above it. Every fact on this screen is
          changed the same way — by saying it — so there is one control rather than one per
          card (concept-v2 §Principles 7). */}
      <View style={{ marginTop: 26, alignSelf: 'flex-start' }}>
        <Chip label="Tell me" variant="primary" onPress={tell} testID="tell-me" />
      </View>
    </ScrollView>
  );
}

/**
 * The dossier: two paragraphs, and neither of them is a list.
 *
 * `known` is what the app has — stated and observed, blended, because the difference does
 * not matter to a reader who wants to know whether it has been paying attention. `missing`
 * is the half that used to be an em dash in a row, written as an invitation with the
 * benefit attached: a question earns an answer, an empty field does not.
 *
 * Absent is a state, not an error. A brand-new account has nothing to say and a provider
 * outage says nothing either; both draw one quiet line, exactly like every other generated
 * sentence in this app (backend services/readings/readings.ts).
 */
function DossierCard({ dossier, loading }: { dossier: Dossier | null; loading: boolean }) {
  return (
    <Section title="What I know about you">
      <Card testID="dossier">
        {loading && !dossier ? (
          <SkeletonLines testID="dossier-skeleton" lines={5} />
        ) : dossier ? (
          <>
            <Body testID="dossier-known" style={{ lineHeight: 15 * 1.6 }}>
              {dossier.known}
            </Body>
            <Body testID="dossier-missing" style={{ marginTop: 14, lineHeight: 15 * 1.6, color: C.mute }}>
              {dossier.missing}
            </Body>
          </>
        ) : (
          <Sub testID="dossier-empty" style={{ lineHeight: 18 }}>
            Nothing to go on yet. Tell me how you train and what you are after, and this
            fills itself in.
          </Sub>
        )}
      </Card>
    </Section>
  );
}

/** Kept beside the screen it types: the plan row as `GET /api/profile` returns it. */
export type YouProfile = Profile;
