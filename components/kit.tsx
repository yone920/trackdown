import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View, type ViewProps, type ViewStyle } from 'react-native';

import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';

// The small shared pieces of docs/design-system.md §Shared components: the card every
// surface is made of, Section, Row and Chips.

/**
 * A block the shape of the thing that has not arrived yet. Used wherever a screen can be
 * drawn before its data is: the exercise sheet opens on the name it was tapped with and
 * fills in around it, the Day screen lays out its cards, the coach keeps its brief.
 *
 * It is the design's own colours and nothing more — `track` on `card`, the same radii, a
 * slow pulse. A skeleton that flashes or shimmers draws attention to the wait, which is
 * the opposite of the point.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = RADIUS.thumb,
  style,
  testID,
}: {
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  radius?: number;
  style?: ViewStyle;
  testID?: string;
}) {
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[
        { width, height, borderRadius: radius, backgroundColor: C.track, opacity: pulse },
        style,
      ]}
    />
  );
}

/** Two or three skeleton lines where a paragraph goes. The last one runs short. */
export function SkeletonLines({ lines = 3, testID }: { lines?: number; testID?: string }) {
  return (
    <View testID={testID}>
      {Array.from({ length: lines }, (_unused, index) => (
        <Skeleton
          key={index}
          height={12}
          width={index === lines - 1 ? '60%' : '100%'}
          style={{ marginTop: index === 0 ? 0 : 10 }}
        />
      ))}
    </View>
  );
}

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
  note,
  children,
}: {
  title: string;
  summary?: string | null;
  /** A qualifier on the summary — "est." — one step dimmer, because it is an aside. */
  note?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ paddingTop: 26 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Disp size={20} weight="semi">
          {title}
        </Disp>
        {summary ? (
          <Sub>
            {summary}
            {note ? <Sub style={{ color: C.dim }}> {note}</Sub> : null}
          </Sub>
        ) : null}
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
      style={({
        opacity: disabled ? 0.45 : 1,
        borderRadius: 16,
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
  onTitlePress,
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
  /**
   * The title alone is tappable — an exercise name opening its sheet. Underlined, because
   * a row that is a link in some rows and not in others has to say which it is.
   */
  onTitlePress?: () => void;
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
        {onTitlePress ? (
          <Pressable
            onPress={onTitlePress}
            accessibilityRole="button"
            accessibilityLabel={`${title} — how it is done`}
            style={({ alignSelf: 'flex-start' })}>
            <Body style={{ textDecorationLine: 'underline', textDecorationColor: C.track }}>
              {title}
            </Body>
          </Pressable>
        ) : (
          <Body>{title}</Body>
        )}
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
    <Pressable onPress={onPress} style={({ opacity: 1 })}>
      {body}
    </Pressable>
  );
}

/** The eyebrow above a group of rows inside a section (a muscle group, a meal slot). */
export function GroupHeading({
  label,
  right,
  note,
}: {
  label: string;
  right?: string | null;
  /** A qualifier on `right` — "est." — dimmer and unemphasised. */
  note?: string | null;
}) {
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
      {right || note ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {right ? <Eyebrow>{right}</Eyebrow> : null}
          {note ? (
            <Eyebrow style={{ color: C.dim, letterSpacing: 0.6, textTransform: 'none' }}>{note}</Eyebrow>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
