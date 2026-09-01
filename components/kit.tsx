import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, View, type ViewProps, type ViewStyle } from 'react-native';

import { IconClose, IconPhoto } from '@/components/icons';
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

export type ChipVariant = 'primary' | 'secondary' | 'danger';

/**
 * Pill, 12/700. Primary is `ink` on `bg`; secondary is a 1px `track` outline.
 *
 * `danger` is the outline in accent — for a control that takes something away, like
 * *Replace today's plan*. It is a warning, not a wall: the second tap is what commits, and
 * the colour is there so the first one is not pressed absent-mindedly.
 */
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
  const danger = variant === 'danger';
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
        borderColor: danger ? C.accent : C.track,
      })}>
      <Body
        style={{
          fontFamily: FONT.semi,
          fontSize: 12,
          color: primary ? C.bg : danger ? C.accent : C.ink,
        }}>
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

/** How long an armed control waits before it gives up and goes back to being an ✕. */
export const DELETE_ARM_MS = 3000;
/** Both states are at least this tall and wide: 44 pt is the smallest honest target. */
export const DELETE_TARGET = 44;

/**
 * Every control that is currently armed, so that arming one — or a scroll, or a tap
 * anywhere else — puts the others back. Module-level because "elsewhere" is by definition
 * not inside this component.
 */
const armedControls = new Set<() => void>();

/** Put every armed delete back to its ✕. Called on scroll and on any other row's tap. */
export function dismissDeletes(): void {
  const armed = [...armedControls];
  armedControls.clear();
  for (const disarm of armed) disarm();
}

/**
 * The ✕ on a logged row, and the one control it turns into.
 *
 * It used to arm into "Delete? ✓ ✕" — three targets in the width of a thumb, two of them
 * a tick and a cross that mean opposite things and look alike. Reported 2026-08-31: the
 * targets were too small and the two marks were confusable. So it is **one morphing
 * control**: at rest a single ✕ with 44 pt of target, and armed the same spot becomes one
 * wide pill reading "Delete?" — the whole pill is the target and there is nothing beside
 * it to hit by mistake. Tapping the pill deletes.
 *
 * Getting out of it is everything except that pill: a tap anywhere else on the screen, a
 * scroll, another row's ✕, or three seconds of nothing. A destructive action should be
 * easy to abandon and hard to do by accident, and this is what that looks like when the
 * cancel button is *not* sitting next to the confirm one.
 */
export function DeleteControl({
  label,
  onDelete,
  testID,
}: {
  /** What is being deleted, for the screen reader: "Delete Bench Press". */
  label: string;
  onDelete: () => void;
  testID?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const disarm = () => setArmed(false);
    armedControls.add(disarm);
    const timer = setTimeout(() => {
      armedControls.delete(disarm);
      setArmed(false);
    }, DELETE_ARM_MS);
    return () => {
      armedControls.delete(disarm);
      clearTimeout(timer);
    };
  }, [armed]);

  if (!armed) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${label}`}
        hitSlop={8}
        onPress={() => {
          // One armed control at a time: two open questions on one screen is one too many.
          dismissDeletes();
          setArmed(true);
        }}
        style={{
          width: DELETE_TARGET - 16,
          height: DELETE_TARGET - 16,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <IconClose size={16} color={C.dim} />
      </Pressable>
    );
  }

  return (
    <Pressable
      testID={testID ? `${testID}-confirm` : undefined}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${label}, tap to confirm`}
      hitSlop={6}
      onPress={() => {
        setArmed(false);
        onDelete();
      }}
      style={{
        minWidth: 92,
        height: 32,
        paddingHorizontal: 14,
        borderRadius: RADIUS.pill,
        backgroundColor: C.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Body style={{ fontFamily: FONT.semi, fontSize: 12, color: C.bg }}>Delete?</Body>
    </Pressable>
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
  pressLabel,
  onTitlePress,
  titleMedia,
  onMediaPress,
  onDelete,
  deleteLabel,
  divider = true,
  testID,
  children,
}: {
  /**
   * The clock stamp, and whether this list has a clock column at all. A string draws it,
   * `null` reserves the column without a stamp (so a timed list stays aligned), and leaving
   * the prop off drops the column entirely — see the note in the body.
   */
  time?: string | null;
  title: string;
  sub?: string | null;
  right?: string | null;
  rightColor?: string;
  /** The row body: opens the saved row for a correction (concept-v2 §Principles 7). */
  onPress?: () => void;
  /** What the row body's tap is, for the screen reader. Defaults to "<title> — open to correct". */
  pressLabel?: string;
  /**
   * The title alone is tappable — an exercise name opening its sheet. Underlined, because
   * a row that is a link in some rows and not in others has to say which it is.
   */
  onTitlePress?: () => void;
  /**
   * How many photographs the sheet behind the title has. Above zero draws a small `dim`
   * photo glyph after the name, so the underline says what the tap will get before it is
   * taken (field report 2026-09-01). Undefined — an older server, a title that is not an
   * exercise — draws nothing, which is the honest answer rather than a glyph that lies.
   */
  titleMedia?: number | null;
  /**
   * Makes the photo glyph its own door, separate from the title's.
   *
   * A DONE row leads with the receipt: tapping it — name included — opens what was actually
   * logged, because that is what the user came to look at once the set is behind them
   * (user decision 2026-09-01). The how-to sheet is still one tap away, and this is the tap:
   * a small trailing affordance beside the name, sized to a real hit target rather than to
   * the 13px glyph it draws.
   */
  onMediaPress?: () => void;
  /** A logged row can be taken back: draws {@link DeleteControl} at the end of the row. */
  onDelete?: () => void;
  /** What the ✕ says it is deleting, when the title is not the readable name. */
  deleteLabel?: string;
  divider?: boolean;
  testID?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 11,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: C.line,
      }}>
      {/* The clock column, and only for a list that keeps one. It used to be drawn
          unconditionally, which left a 50 pt gutter down the left of every untimed list —
          the coach's plan, its finisher, the goal history — and the field report of
          2026-09-01 was a screenshot of it with "why is this space here?".

          The contract is `time !== undefined`, not `time`: a timed list where one row has
          no stamp passes `time={null}` and keeps its column, so the times below it stay in
          line. Omitting the prop entirely is what says "this list has no clock in it". */}
      {time !== undefined ? (
        <View style={{ width: 50 }}>
          {time ? <Sub style={[{ paddingTop: 2 }, TABULAR]}>{time}</Sub> : null}
        </View>
      ) : null}
      <View style={{ flex: 1, paddingRight: 10 }}>
        {onTitlePress ? (
          <Pressable
            onPress={onTitlePress}
            accessibilityRole="button"
            accessibilityLabel={`${title} — how it is done`}
            style={({ alignSelf: 'flex-start' })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Body style={{ textDecorationLine: 'underline', textDecorationColor: C.track }}>
                {title}
              </Body>
              {(titleMedia ?? 0) > 0 && !onMediaPress ? (
                <View testID={testID ? `${testID}-photo` : undefined}>
                  <IconPhoto size={13} color={C.dim} />
                </View>
              ) : null}
            </View>
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Body>{title}</Body>
            {onMediaPress ? <MediaDoor testID={testID} title={title} onPress={onMediaPress} /> : null}
          </View>
        )}
        {sub ? <Sub style={{ marginTop: 2 }}>{sub}</Sub> : null}
        {children}
      </View>
      {right ? (
        <Disp size={18} style={{ color: rightColor ?? C.ink, paddingTop: 1 }}>
          {right}
        </Disp>
      ) : null}
      {onDelete ? (
        <View style={{ marginLeft: 8, paddingTop: 2 }}>
          <DeleteControl
            label={deleteLabel ?? title}
            onDelete={onDelete}
            testID={testID ? `${testID}-delete` : undefined}
          />
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  // Three targets on one row, innermost first: the exercise name opens its sheet, the ✕
  // deletes, and everything else opens the row for a correction. React Native gives the
  // touch to the innermost responder, so the order is settled by the nesting, not by z.
  return (
    <Pressable
      testID={testID ? `${testID}-open` : undefined}
      accessibilityRole="button"
      accessibilityLabel={pressLabel ?? `${title} — open to correct`}
      onPress={() => {
        // A tap anywhere that is not the armed pill is an answer of "no" (DeleteControl).
        dismissDeletes();
        onPress();
      }}
      style={({ opacity: 1 })}>
      {body}
    </Pressable>
  );
}

/** The eyebrow above a group of rows inside a section (a muscle group, a meal slot). */
/**
 * The how-to door on a row whose own tap belongs to something else. A done exercise opens
 * its logged record when you press it; this is the small trailing button that still gets
 * you to the photographs and the numbered steps (user decision 2026-09-01: "you can add a
 * small side button that takes you to how the workout is done").
 *
 * The glyph is 13px because that is what reads beside a name; the TARGET is 32 and padded
 * out around it, because a 13px tap target is a dead tap on a phone in a gym.
 */
function MediaDoor({ testID, title, onPress }: { testID?: string; title: string; onPress: () => void }) {
  return (
    <Pressable
      testID={testID ? `${testID}-photo` : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${title} — how it is done`}
      hitSlop={8}
      onPress={onPress}
      style={({
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 1,
      })}>
      <IconPhoto size={15} color={C.mute} />
    </Pressable>
  );
}

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

/**
 * The one big button on a screen — the thing the screen is FOR.
 *
 * The Log sheet's "Log" used to be a `Chip`, the same size and shape as "From library"
 * beside it, and greyed while it was disabled: reported 2026-08-31 as unfindable ("the
 * user cannot tell what to press"). A primary action is not a chip. This is the Today
 * coach button's weight — full width, 56 pt, `accent` with a `bg` label — and it keeps
 * that shape in every state: disabled is the same button at reduced opacity, and pending
 * is the same button with a spinner in it. It never shrinks back into a chip.
 */
export function BigButton({
  label,
  onPress,
  disabled = false,
  pending = false,
  pendingLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Draws the spinner and `pendingLabel`; the button stays exactly where it was. */
  pending?: boolean;
  pendingLabel?: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || pending }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || pending}
      style={{
        height: 56,
        borderRadius: RADIUS.pill,
        backgroundColor: C.accent,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 10,
        opacity: disabled ? 0.45 : 1,
      }}>
      {pending ? <ActivityIndicator color={C.bg} size="small" /> : null}
      <Disp size={20} weight="semi" style={{ color: C.bg }}>
        {pending ? (pendingLabel ?? label) : label}
      </Disp>
    </Pressable>
  );
}
