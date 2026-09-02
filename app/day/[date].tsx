import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';

import { DayEating } from '@/components/day-eating';
import { DayTraining } from '@/components/day-training';
import {
  IconAlertCircle,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconShare,
} from '@/components/icons';
import { Card, Chip, dismissDeletes, Section, Skeleton, SkeletonLines } from '@/components/kit';
import { ReadingCard } from '@/components/reading-card';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { addDays } from '@/lib/days-weeks';
import { dateLabel, kcal } from '@/lib/format';
import { localDateKey, useDay } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, SPACE, TABULAR } from '@/lib/theme';
import type { DayView, Verdict } from '@/lib/types';
import { OFFLINE_MESSAGE, readerLine } from '@/lib/errors';

// A closed day (docs/design-system.md §Day; concept-v2 §The two day views: "Day is a
// reading, not a replay"). The verdict against the goal that was active *that* day, the
// paragraph written when the day closed, training by muscle group with each lift's delta,
// eating as macros and meals, the body, and the coach ask if there was one.
//
// Nothing here is computed: `GET /api/day/:date` returns the verdict, the reading, the
// muscle summary, the macros, the pattern line and the brief. The raw rows live one tap
// further in, behind "See the log as recorded".

const VERDICT_COLOR: Record<Verdict, string> = {
  served: C.good,
  missed: C.accent,
  unlogged: C.mute,
  none: C.mute,
};

export default function Day() {
  const router = useRouter();
  const insets = useScreenInsets();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = localDateKey();
  const date = typeof params.date === 'string' && params.date ? params.date : today;

  const isToday = date >= today;

  // The open day has exactly ONE page and it is the Today tab (user decision 2026-09-01).
  // A link can still land here on today's date — an old deep link, the Days list before it
  // was taught otherwise, a typed URL — so it goes home rather than drawing a second,
  // quieter copy of today that groups the same rows a different way.
  useEffect(() => {
    if (isToday) router.replace('/train');
  }, [isToday, router]);

  const day = useDay(date, { enabled: !isToday });
  const view = day.data ?? null;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/days'));

  if (isToday) return <View testID="day-redirect" style={{ flex: 1, backgroundColor: C.bg }} />;

  return (
    <ScrollView
      testID="day-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      onScrollBeginDrag={dismissDeletes}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}>
      {/* Nav: back to Days, then the date with a day either side of it. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={goBack}
          accessibilityLabel="Back to Days"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}>
          <IconChevronLeft size={18} color={C.mute} />
          <Sub>Days</Sub>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            testID="day-prev"
            accessibilityLabel="The day before"
            onPress={() => router.replace(`/day/${addDays(date, -1)}`)}
            style={{ padding: 6 }}>
            <IconChevronLeft size={20} color={C.mute} />
          </Pressable>
          <Sub style={[{ minWidth: 92, textAlign: 'center' }, TABULAR]}>{dateLabel(date)}</Sub>
          <Pressable
            testID="day-next"
            accessibilityLabel="The day after"
            disabled={date >= today}
            onPress={() => router.replace(`/day/${addDays(date, 1)}`)}
            style={{ padding: 6, opacity: date >= today ? 0.3 : 1 }}>
            <IconChevronRight size={20} color={C.mute} />
          </Pressable>
        </View>
      </View>

      {/* The day, in outline, while it is fetched: the verdict line, the paragraph, and
          the three stats — in the places they are about to appear, so nothing jumps. */}
      {day.isLoading && !view ? (
        <View testID="day-skeleton" style={{ paddingTop: 22 }}>
          <Skeleton width="45%" height={26} />
          <Card style={{ marginTop: 18 }}>
            <SkeletonLines lines={3} />
          </Card>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            {[0, 1, 2].map((index) => (
              <Card key={index} style={{ flex: 1 }}>
                <Skeleton width="70%" height={22} />
                <Skeleton width="50%" height={10} style={{ marginTop: 10 }} />
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      {day.error && !view ? (
        <Card style={{ marginTop: 20 }}>
          <Sub style={{ color: C.accent }}>{readerLine(day.error, OFFLINE_MESSAGE)}</Sub>
        </Card>
      ) : null}

      {view ? (
        <DayBody
          view={view}
          onOpenLog={() => router.push(`/day/${date}/log`)}
          // A row on the reading opens the same review-and-tell screen the record view
          // routes to, for the day being read rather than for today.
          onCorrect={(kind, id) =>
            router.push({ pathname: '/log', params: { editDate: date, editId: id, editKind: kind } })
          }
        />
      ) : null}
    </ScrollView>
  );
}

function DayBody({
  view,
  onOpenLog,
  onCorrect,
}: {
  view: DayView;
  onOpenLog: () => void;
  onCorrect: (kind: 'activity' | 'meal', id: string) => void;
}) {
  const color = VERDICT_COLOR[view.verdict] ?? C.mute;
  const Mark = view.verdict === 'served' ? IconCheckCircle : IconAlertCircle;
  // Lifts print no calories, so their block's figure is a MET estimate (concept-v2
  // §Calories). Said on the Earned tile here, and on the Training line inside DayTraining.
  const earnedEstimated = view.blocks.some((block) => block.kcal_estimated);

  const exportDay = () =>
    Share.share({
      title: `TrackDown · ${dateLabel(view.date)}`,
      message: JSON.stringify(view, null, 2),
    }).catch(() => undefined);

  return (
    <View>
      {/* The verdict */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 14 }}>
        {view.verdict === 'unlogged' || view.verdict === 'none' ? null : (
          <View style={{ paddingTop: 2, marginRight: 12 }}>
            <Mark size={36} color={color} strokeWidth={1.6} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Disp size={32} style={{ color }}>
            {view.verdict_words}
          </Disp>
          <Sub style={[{ marginTop: 6, lineHeight: 18 }, TABULAR]}>
            {[
              view.verdict_why,
              view.goal ? `Goal · ${view.goal.title}` : 'No goal that day',
              `Day ${view.day_number}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Sub>
        </View>
      </View>

      {/* In short */}
      {view.reading ? (
        <View style={{ marginTop: 18 }}>
          <ReadingCard eyebrow="In short" text={view.reading.text} live={view.is_today} />
        </View>
      ) : null}

      {/* Eaten · Earned · Allowance */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Stat label="Eaten" value={kcal(view.eaten)} />
        <Stat
          label="Earned"
          value={kcal(view.earned)}
          unit={earnedEstimated ? 'estimated' : undefined}
          color={view.earned > 0 ? C.good : C.ink}
        />
        <Stat label="Allowance" value={view.allowance == null ? '—' : kcal(view.allowance)} />
      </View>

      {/* Training and Eating are components now, shared with the domain-scoped readings
          behind the Train and Eat calendars (user decision 2026-09-02). Nothing about
          either changed in the move; two copies of this JSX is how two doors onto one
          workout would start disagreeing about it. */}
      <DayTraining view={view} onCorrect={onCorrect} />

      <DayEating view={view} onCorrect={onCorrect} />

      {/* Body */}
      <Section title="Body">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="Weight" value={view.weight.day == null ? '—' : view.weight.day.toFixed(1)} unit="lb" />
          <Stat label="7-day avg" value={view.weight.avg_7d == null ? '—' : view.weight.avg_7d.toFixed(1)} unit="lb" />
          <Stat
            label="Trend"
            value={
              view.weight.trend_per_week == null
                ? '—'
                : `${view.weight.trend_per_week > 0 ? '+' : '−'}${Math.abs(view.weight.trend_per_week).toFixed(1)}`
            }
            unit="lb / wk"
          />
        </View>
      </Section>

      {/* The ask made that day, if there was one */}
      {view.coach ? (
        <Card style={{ marginTop: 22, borderLeftWidth: 3, borderLeftColor: C.accent }}>
          <Eyebrow>You asked the coach</Eyebrow>
          <Disp size={20} weight="semi" style={{ marginTop: 6 }}>
            {view.coach.headline ?? 'The brief'}
          </Disp>
          {view.coach.nudge ? <Sub style={{ marginTop: 6, lineHeight: 18 }}>{view.coach.nudge}</Sub> : null}
        </Card>
      ) : null}

      {/* Footer */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26 }}>
        <Chip label="See the log as recorded" onPress={onOpenLog} testID="open-day-log" />
        <Pressable
          testID="export-day"
          accessibilityLabel="Export this day"
          onPress={exportDay}
          style={({
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: C.track,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 1,
          })}>
          <IconShare size={18} color={C.ink} />
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <Card style={{ flex: 1, padding: 14 }}>
      <Eyebrow>{label}</Eyebrow>
      <Disp size={26} style={[{ marginTop: 6, color: color ?? C.ink }, TABULAR]}>
        {value}
      </Disp>
      {unit ? <Sub style={{ marginTop: 2 }}>{unit}</Sub> : null}
    </Card>
  );
}
