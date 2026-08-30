import { TextInput, View } from 'react-native';

import { Eyebrow } from '@/components/type';
import { C, FONT, RADIUS, TABULAR } from '@/lib/theme';

// The editable fields of the confirm card: "editable fields in a 3-col grid (`disp` 18
// values)" (docs/design-system.md §Log). Every AI reading is shown before it counts and
// is correctable in one tap (concept-v2 §Principles 3) — which is what these are for.

export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>{children}</View>;
}

/** One cell: eyebrow label over a `disp` 18 value the user can retype. */
export function Field({
  label,
  value,
  onChangeText,
  numeric = false,
  width = '30%',
  placeholder,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  numeric?: boolean;
  width?: `${number}%` | number;
  placeholder?: string;
  testID?: string;
}) {
  return (
    <View style={{ flexGrow: 1, flexBasis: width }}>
      <Eyebrow>{label}</Eyebrow>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? '—'}
        placeholderTextColor={C.dim}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        style={[
          {
            marginTop: 4,
            fontFamily: FONT.disp,
            fontSize: 18,
            color: C.ink,
            backgroundColor: C.bg,
            borderRadius: RADIUS.thumb,
            paddingHorizontal: 10,
            paddingVertical: 8,
          },
          numeric ? TABULAR : null,
        ]}
      />
    </View>
  );
}

/** A whole-width text field — a meal's description, a goal's title, a statement. */
export function LineField(props: Omit<Parameters<typeof Field>[0], 'width'>) {
  return <Field {...props} width="100%" />;
}
