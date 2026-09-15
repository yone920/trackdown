import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { IconPhoto } from '@/components/icons';
import { Body } from '@/components/type';
import { openExercise } from '@/lib/exercise';
import { C } from '@/lib/theme';

// An exercise name, drawn as a door.
//
// One component for every screen that prints one outside a `Row` — the lifts board, the
// all-lifts screen, the cardio rows, the DayLog's "How to do …" — because two field reports
// in a row were about this line and not about any one screen (2026-09-01: some names did
// nothing when tapped, and nothing said which ones had a picture behind them).
//
// Two rules, and they are the whole component:
//
//   1. **It always navigates.** A name with no catalogue id opens the sheet in name-only
//      mode, where the form video is a YouTube search and works for a movement nobody has
//      catalogued. A row that does nothing when it is pressed reads as a broken app.
//   2. **The glyph is a promise, not a badge.** It appears when, and only when, the sheet
//      has photographs — drawn `dim`, so it reads as a property of the name rather than as
//      a second thing on the row. A name without one is drawn exactly as it always was.
//      There is no legend: a small picture beside a word does not need one.
//
// `media_count` is optional everywhere it comes from, because an older server does not send
// it. Unknown draws no glyph, which is the honest answer — the alternative is a glyph that
// sometimes lies.

export function ExerciseName({
  name,
  id,
  mediaCount,
  testID,
}: {
  name: string;
  /** The catalogue row, when the server resolved one. Null opens name-only mode. */
  id?: string | null;
  /** How many photographs the sheet will have. Undefined is "nobody said". */
  mediaCount?: number | null;
  testID?: string;
}) {
  const router = useRouter();
  const hasPhotos = (mediaCount ?? 0) > 0;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${name} — how it is done`}
      onPress={() => openExercise(router, { id, name, mediaCount })}
      style={{ flexShrink: 1, alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Body style={{ textDecorationLine: 'underline', textDecorationColor: C.track }}>
          {name}
        </Body>
        {hasPhotos ? (
          <View testID={testID ? `${testID}-photo` : undefined}>
            <IconPhoto size={13} color={C.dim} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
