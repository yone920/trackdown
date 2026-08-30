import { Pressable, View } from 'react-native';

import { Eyebrow } from '@/components/type';
import { C, RADIUS } from '@/lib/theme';

// One of the three 76px controls of the Photo / Speak / Type panel (docs/design-system.md
// §Log). Shared rather than local to the Log sheet because concept-v2 §Principles 7 is
// that there is *one* input mechanism: the coach's "anything I should know?" is the same
// panel, and two copies of it would drift apart the first time one of them was styled.

export function Control({
  label,
  onPress,
  filled = false,
  disabled = false,
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  /** Speak is the filled one where it is available. */
  filled?: boolean;
  disabled?: boolean;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => ({
          width: 76,
          height: 76,
          borderRadius: RADIUS.tile,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled ? C.ink : C.card,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        })}>
        {children}
      </Pressable>
      <Eyebrow>{label}</Eyebrow>
    </View>
  );
}
