import { forwardRef, useState } from 'react';
import {
  Animated,
  Platform,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

const HAIRLINE = '#E8E1D6';
const INK = '#1A1714';
const ASH = '#9A938A';

type Props = Omit<TextInputProps, 'style'> & {
  label?: string;
  textStyle?: TextInputProps['style'];
};

export const UnderlineField = forwardRef<TextInput, Props>(function UnderlineField(
  { label, textStyle, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <View>
      {label && (
        <Text
          className="text-[10px] text-ash pb-3"
          style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
          {label}
        </Text>
      )}
      <TextInput
        ref={ref}
        placeholderTextColor="#C9C2B8"
        underlineColorAndroid="transparent"
        selectionColor={INK}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            color: INK,
            fontSize: 18,
            paddingVertical: Platform.OS === 'ios' ? 6 : 4,
            paddingHorizontal: 0,
            margin: 0,
            borderWidth: 0,
            backgroundColor: 'transparent',
          },
          textStyle,
        ]}
      />
      <Animated.View
        style={{
          height: focused ? 1.5 : 1,
          backgroundColor: focused ? INK : HAIRLINE,
          marginTop: 2,
        }}
      />
    </View>
  );
});

export { ASH };
