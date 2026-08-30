import { Pressable, View, type ViewProps } from 'react-native';

import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';

// The small shared pieces of docs/design-system.md §Shared components: the card every
// surface is made of, Section, Row and Chips.

export function Card({ style, children, ...rest }: ViewProps) {
  return (
    <View
      {...rest}
      style={[
        { backgroundColor: C.card, borderRadius: RADIUS.card, padding: SPACE.card },
        style,
      ]}>
      {children}
    </View>
  );
}

/** `disp` 20 title left, 12 `mute` summary right, 26 top padding. */
export function Section({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ paddingTop: 26 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Disp size={20} weight="semi">
          {title}
        </Disp>
        {summary ? <Sub>{summary}</Sub> : null}
      </View>
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

export type ChipVariant = 'primary' | 'secondary';

/** Pill, 12/700. Primary is `ink` on `bg`; secondary is a 1px `track` outline. */
export function Chip({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: ChipVariant;
  disabled?: boolean;
  testID?: string;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        borderRadius: RADIUS.pill,
        paddingHorizontal: 14,
        paddingVertical: 8,
        backgroundColor: primary ? C.ink : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: C.track,
      })}>
      <Body style={{ fontFamily: FONT.semi, fontSize: 12, color: primary ? C.bg : C.ink }}>
        {label}
      </Body>
    </Pressable>
  );
}

export function Chips({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
  );
}

/** time (12 `mute`, 50 wide) · title 15/500 + sub 12 `mute` · right numeral `disp` 18. */
export function Row({
  time,
  title,
  sub,
  right,
  rightColor,
  onPress,
  divider = true,
  dashed = false,
  children,
}: {
  time?: string | null;
  title: string;
  sub?: string | null;
  right?: string | null;
  rightColor?: string;
  onPress?: () => void;
  divider?: boolean;
  /** The expected-but-missing placeholder: the same row, drawn as an outline. */
  dashed?: boolean;
  children?: React.ReactNode;
}) {
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 11,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: C.line,
        borderStyle: dashed ? 'dashed' : 'solid',
        opacity: dashed ? 0.6 : 1,
      }}>
      <View style={{ width: 50 }}>
        {time ? <Sub style={[{ paddingTop: 2 }, TABULAR]}>{time}</Sub> : null}
      </View>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Body>{title}</Body>
        {sub ? <Sub style={{ marginTop: 2 }}>{sub}</Sub> : null}
        {children}
      </View>
      {right ? (
        <Disp size={18} style={{ color: rightColor ?? C.ink, paddingTop: 1 }}>
          {right}
        </Disp>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}

/** The eyebrow above a group of rows inside a section (a muscle group, a meal slot). */
export function GroupHeading({ label, right }: { label: string; right?: string | null }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 14,
        marginBottom: 2,
      }}>
      <Eyebrow>{label}</Eyebrow>
      {right ? <Eyebrow>{right}</Eyebrow> : null}
    </View>
  );
}
