import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconCalendar, IconChevronLeft, IconChevronRight } from '@/components/icons';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import {
  dotTone,
  monthGrid,
  monthOf,
  monthTitle,
  rowsByDate,
  shiftMonth,
  WEEKDAY_LABELS,
  type DotTone,
} from '@/lib/calendar';
import { localDateKey, useDaysInMonth } from '@/lib/queries';
import { C, RADIUS, TABULAR } from '@/lib/theme';

// The way back to any day (user request 2026-09-02: "the train only shows today … there
// should be some sort of calendar so anyone can easily go back and see what they did last
// week or a specific day. Same for the eat").
//
// ONE component, used by the Train header and the Eat header, because it is one question
// asked from two places. It is deliberately NOT a third copy of the Days list: Progress
// keeps its archive with verdict words and week tallies, and this is a month at a glance —
// which days have something on them, and a tap to read one. Two doors, the same records.
//
// A day cell says only what a calendar can honestly say: a dot when something was logged,
// coloured by that day's own verdict (the Days list's colours, components/days-list.tsx),
// nothing at all when the day is empty, a ring around today, and no door on a day that has
// not happened yet.

const DOT_COLOR: Record<DotTone, string> = { good: C.good, mute: C.mute, accent: C.accent };

/** The header button. Sized to a real target, not to the 20 px glyph it draws. */
export function CalendarButton({ onPress, testID }: { onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Open the calendar"
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: C.track,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
      }}>
      <IconCalendar size={20} color={C.mute} />
    </Pressable>
  );
}

export function CalendarSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = localDateKey();
  const [month, setMonth] = useState(() => monthOf(today));

  // Only while it is open: a sheet nobody has asked for should not be fetching months.
  const days = useDaysInMonth(month, { enabled: visible });
  const rows = useMemo(() => rowsByDate(days.data?.days ?? [], month), [days.data, month]);
  const weeks = useMemo(() => monthGrid(month, today), [month, today]);

  /**
   * Any day opens its own page. `/day/<today>` redirects to Train on its own (user decision
   * 2026-09-01: the open day has one live page and it is the tab), so this does not special-
   * case today — one route, one rule about it.
   */
  const open = (date: string) => {
    onClose();
    router.push(`/day/${date}`);
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} testID="calendar-sheet">
      <Pressable
        testID="calendar-backdrop"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <Pressable
          // Swallows the tap, so pressing the sheet does not close it.
          onPress={() => {}}
          style={{
            backgroundColor: C.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingHorizontal: 18,
            paddingTop: 16,
            paddingBottom: insets.bottom + 20,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Eyebrow style={{ flex: 1 }}>Go to a day</Eyebrow>
            {days.isLoading ? <ActivityIndicator color={C.dim} size="small" /> : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <MonthStep
              testID="calendar-prev"
              label="Previous month"
              onPress={() => setMonth((current) => shiftMonth(current, -1))}>
              <IconChevronLeft size={18} color={C.mute} />
            </MonthStep>
            <Disp size={22} testID="calendar-title" style={{ flex: 1, textAlign: 'center' }}>
              {monthTitle(month)}
            </Disp>
            <MonthStep
              testID="calendar-next"
              label="Next month"
              // Nothing to read in a month that has not started: the button stops at the
              // month today is in.
              disabled={month >= monthOf(today)}
              onPress={() => setMonth((current) => shiftMonth(current, 1))}>
              <IconChevronRight size={18} color={C.mute} />
            </MonthStep>
          </View>

          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Sub key={index} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: C.dim }}>
                {label}
              </Sub>
            ))}
          </View>

          <View testID="calendar-grid" style={{ marginTop: 4 }}>
            {weeks.map((week, index) => (
              <View key={index} style={{ flexDirection: 'row' }}>
                {week.map((cell, position) => (
                  <DayCell
                    key={cell.date ?? `pad-${index}-${position}`}
                    date={cell.date}
                    day={cell.day}
                    isToday={cell.isToday}
                    future={cell.future}
                    tone={cell.date ? dotTone(rows.get(cell.date)) : null}
                    onPress={open}
                  />
                ))}
              </View>
            ))}
          </View>

          <Pressable
            testID="calendar-close"
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={{ marginTop: 14, alignSelf: 'flex-start', paddingVertical: 8 }}>
            <Sub style={{ color: C.mute }}>Close</Sub>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MonthStep({
  testID,
  label,
  disabled = false,
  onPress,
  children,
}: {
  testID: string;
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}>
      {children}
    </Pressable>
  );
}

function DayCell({
  date,
  day,
  isToday,
  future,
  tone,
  onPress,
}: {
  date: string | null;
  day: number | null;
  isToday: boolean;
  future: boolean;
  tone: DotTone | null;
  onPress: (date: string) => void;
}) {
  // Padding: the cell before the 1st is space, not a button.
  if (!date || day == null) return <View style={{ flex: 1, height: 44 }} />;

  return (
    <Pressable
      testID={`calendar-day-${date}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: future }}
      accessibilityLabel={`${date}${tone ? ', has a log' : ''}`}
      disabled={future}
      onPress={() => onPress(date)}
      style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', opacity: future ? 0.25 : 1 }}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: RADIUS.thumb,
          alignItems: 'center',
          justifyContent: 'center',
          // Today is ringed rather than filled: the day is not over.
          borderWidth: isToday ? 1.5 : 0,
          borderColor: C.good,
        }}>
        <Body style={[{ fontSize: 13, color: isToday ? C.ink : C.mute }, TABULAR]}>{day}</Body>
      </View>
      <View
        testID={tone ? `calendar-dot-${date}` : undefined}
        style={{
          width: 5,
          height: 5,
          borderRadius: 2.5,
          marginTop: 1,
          backgroundColor: tone ? DOT_COLOR[tone] : 'transparent',
        }}
      />
    </Pressable>
  );
}
