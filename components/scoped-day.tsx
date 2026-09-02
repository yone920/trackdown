import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { DayEating } from '@/components/day-eating';
import { DayTraining } from '@/components/day-training';
import { IconChevronLeft, IconChevronRight } from '@/components/icons';
import { Card, dismissDeletes, Skeleton, SkeletonLines } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { addDays } from '@/lib/days-weeks';
import { OFFLINE_MESSAGE, readerLine } from '@/lib/errors';
import { dateLabel, kcal } from '@/lib/format';
import { localDateKey, useDay } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { sessionSpan, splitBySource } from '@/lib/training-groups';
import { C, SPACE, TABULAR } from '@/lib/theme';

// A past day, read in ONE domain (user decision 2026-09-02, on the shipped calendar:
// "in train it should show me only the train … they have their own page — the historic data
// should also have their own page").
//
// The tabs are domain-scoped, so their history is too. Three doors, three shapes:
//
//   · Progress → Days → `/day/<date>`        the whole-day archive: verdict, In short,
//                                            training, eating, body, the coach's ask.
//   · Train  → calendar → `/day/<date>/train` the session, and nothing else.
//   · Eat    → calendar → `/day/<date>/eat`   the meals, and nothing else.
//
// This screen is the second and third of those. It is **not** a filtered copy of the day
// page: it draws the same `DayTraining` / `DayEating` components that page draws, so a
// workout reads identically through either door, and it deliberately carries **no verdict
// and no In-short** — a verdict is a judgement about a whole day, and half a day cannot be
// judged. The prev/next chevrons stay inside the scope, so browsing backwards through
// sessions never lands the reader in a meal.

export type DayScope = 'train' | 'eat';

const SCOPE = {
  train: {
    title: 'Training',
    /** Where the open day actually lives: the tab, which is the only live page for it. */
    liveTab: '/train' as const,
    back: 'Train',
  },
  eat: {
    title: 'Eating',
    liveTab: '/eat' as const,
    back: 'Eat',
  },
};

export function ScopedDay({ scope }: { scope: DayScope }) {
  const router = useRouter();
  const insets = useScreenInsets();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = localDateKey();
  const date = typeof params.date === 'string' && params.date ? params.date : today;
  const words = SCOPE[scope];

  // The open day has exactly ONE page per domain and it is the tab (user decision
  // 2026-09-01). A calendar tap on today, or an old link, goes there rather than drawing a
  // second, quieter copy of the day the tab is already showing.
  const isToday = date >= today;
  useEffect(() => {
    if (isToday) router.replace(words.liveTab);
  }, [isToday, router, words.liveTab]);

  const day = useDay(date, { enabled: !isToday });
  const view = day.data ?? null;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace(words.liveTab));
  /** Stepping a day keeps the scope: browsing sessions stays in sessions. */
  const step = (by: -1 | 1) => router.replace(`/day/${addDays(date, by)}/${scope}`);

  if (isToday) return <View testID={`${scope}-day-redirect`} style={{ flex: 1, backgroundColor: C.bg }} />;

  const { logged, health } = view ? splitBySource(view.items.activities) : { logged: [], health: [] };
  const span = sessionSpan(logged);

  return (
    <ScrollView
      testID={`${scope}-day-scroll`}
      style={{ flex: 1, backgroundColor: C.bg }}
      onScrollBeginDrag={dismissDeletes}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          testID={`${scope}-day-back`}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${words.back}`}
          onPress={goBack}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}>
          <IconChevronLeft size={18} color={C.mute} />
          <Sub>{words.back}</Sub>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            testID={`${scope}-day-prev`}
            accessibilityRole="button"
            accessibilityLabel="The day before"
            onPress={() => step(-1)}
            style={{ padding: 6 }}>
            <IconChevronLeft size={20} color={C.mute} />
          </Pressable>
          <Sub style={[{ minWidth: 92, textAlign: 'center' }, TABULAR]}>{dateLabel(date)}</Sub>
          <Pressable
            testID={`${scope}-day-next`}
            accessibilityRole="button"
            accessibilityLabel="The day after"
            accessibilityState={{ disabled: date >= today }}
            disabled={date >= today}
            onPress={() => step(1)}
            style={{ padding: 6, opacity: date >= today ? 0.3 : 1 }}>
            <IconChevronRight size={20} color={C.mute} />
          </Pressable>
        </View>
      </View>

      {/* The date, and what this page is of. No verdict: half a day cannot be judged. */}
      <View style={{ marginTop: 14 }}>
        <Eyebrow testID={`${scope}-day-eyebrow`}>{words.title}</Eyebrow>
        <Disp size={30} testID={`${scope}-day-title`} style={{ marginTop: 6 }}>
          {dateLabel(date)}
        </Disp>
        {view && scope === 'train' ? (
          <Sub testID="train-day-line" style={[{ marginTop: 6 }, TABULAR]}>
            {[
              logged.length === 0 && health.length === 0
                ? 'Nothing logged'
                : `${kcal(view.earned)} kcal earned`,
              span,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Sub>
        ) : null}
        {view && scope === 'eat' ? (
          <Sub testID="eat-day-line" style={[{ marginTop: 6 }, TABULAR]}>
            {view.items.meals.length === 0 ? 'Nothing logged' : `${kcal(view.eaten)} kcal eaten`}
          </Sub>
        ) : null}
      </View>

      {day.isLoading && !view ? (
        <View testID={`${scope}-day-skeleton`} style={{ paddingTop: 22 }}>
          <Skeleton width="45%" height={22} />
          <Card style={{ marginTop: 18 }}>
            <SkeletonLines lines={3} />
          </Card>
        </View>
      ) : null}

      {day.error && !view ? (
        <Card style={{ marginTop: 20 }}>
          <Sub style={{ color: C.accent }}>{readerLine(day.error, OFFLINE_MESSAGE)}</Sub>
        </Card>
      ) : null}

      {view && scope === 'train' ? (
        <DayTraining
          view={view}
          onCorrect={(kind, id) =>
            router.push({ pathname: '/log', params: { editDate: date, editId: id, editKind: kind } })
          }
        />
      ) : null}

      {view && scope === 'eat' ? (
        <DayEating
          view={view}
          onCorrect={(kind, id) =>
            router.push({ pathname: '/log', params: { editDate: date, editId: id, editKind: kind } })
          }
        />
      ) : null}

      {/* The whole day is still one tap away: this page is a scope, not a wall. */}
      {view ? (
        <Pressable
          testID={`${scope}-day-whole`}
          accessibilityRole="button"
          accessibilityLabel="The whole day"
          onPress={() => router.push(`/day/${date}`)}
          style={{ marginTop: 26, alignSelf: 'flex-start', paddingVertical: 8 }}>
          <Sub style={{ color: C.mute, textDecorationLine: 'underline', textDecorationColor: C.track }}>
            The whole day
          </Sub>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
