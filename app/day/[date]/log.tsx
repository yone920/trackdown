import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EvidenceThumbs } from '@/components/evidence';
import { IconCamera, IconChevronLeft, IconHeart, IconKeyboard, IconMic } from '@/components/icons';
import { Card } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { clock, dateLabel } from '@/lib/format';
import { localDateKey, useDayLog } from '@/lib/queries';
import { C, FONT, SPACE, TABULAR } from '@/lib/theme';
import type { DayLogEntry, DayLogIcon } from '@/lib/types';

// "The log, as recorded" (docs/design-system.md §DayLog). The Day screen is a reading;
// this is what was actually said, in the order it was said, with what the app made of it
// underneath. It is the audit trail behind "confirm, don't trust" (concept-v2 §Principles
// 3), which is why every row is a tap away from a correction.

const ICONS: Record<DayLogIcon, (p: { size?: number; color?: string }) => React.ReactElement> = {
  camera: IconCamera,
  mic: IconMic,
  keyboard: IconKeyboard,
  heart: IconHeart,
};

export default function DayLog() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = typeof params.date === 'string' && params.date ? params.date : localDateKey();

  const log = useDayLog(date);
  const entries = log.data?.entries ?? [];

  const correct = (entry: DayLogEntry) => {
    if (!entry.editable) return;
    router.push({ pathname: '/log', params: { editDate: date, editId: entry.id, editKind: entry.kind } });
  };

  return (
    <ScrollView
      testID="day-log-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}
      refreshControl={undefined}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace(`/day/${date}`))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>{dateLabel(date)}</Sub>
      </Pressable>

      <Disp size={28} style={{ marginTop: 4 }}>
        The log, as recorded
      </Disp>
      <Sub style={{ marginTop: 8, lineHeight: 18 }}>
        Every entry as it arrived, and what it was understood to be. Tap one to correct it.
      </Sub>

      {log.isLoading && entries.length === 0 ? (
        <View style={{ paddingTop: 50, alignItems: 'center' }}>
          <ActivityIndicator color={C.mute} />
        </View>
      ) : null}

      {!log.isLoading && entries.length === 0 ? (
        <Card style={{ marginTop: 20 }}>
          <Sub>Nothing was logged on this day.</Sub>
        </Card>
      ) : null}

      <View style={{ marginTop: 16 }}>
        {entries.map((entry) => (
          <LogRow key={`${entry.kind}-${entry.id}`} entry={entry} onPress={() => correct(entry)} />
        ))}
      </View>
    </ScrollView>
  );
}

/** time · icon · the words in quotes (or "photo") · source · what it became · confidence. */
function LogRow({ entry, onPress }: { entry: DayLogEntry; onPress: () => void }) {
  const Icon = ICONS[entry.icon] ?? IconKeyboard;
  const photos = entry.evidence.filter((item) => item.kind === 'photo');
  const meta = [
    entry.source === 'health' ? 'Health' : entry.source === 'fused' ? 'read from evidence' : null,
    entry.understood,
    entry.confidence ? `${entry.confidence} confidence` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      testID={`log-entry-${entry.id}`}
      accessibilityRole="button"
      onPress={onPress}
      disabled={!entry.editable}
      style={({ pressed }) => ({ opacity: pressed && entry.editable ? 0.7 : 1 })}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          paddingVertical: 13,
          borderBottomWidth: 1,
          borderBottomColor: C.line,
        }}>
        <Sub style={[{ width: 50, paddingTop: 3 }, TABULAR]}>{clock(entry.logged_at)}</Sub>
        <View style={{ width: 26, paddingTop: 1 }}>
          <Icon size={18} color={C.mute} />
        </View>
        <View style={{ flex: 1 }}>
          {entry.raw_text ? (
            <Body style={{ lineHeight: 21 }}>&ldquo;{entry.raw_text}&rdquo;</Body>
          ) : (
            <Body style={{ fontStyle: 'italic', color: C.mute }}>
              {photos.length > 0 ? (photos.length === 1 ? 'photo' : `${photos.length} photos`) : 'no words recorded'}
            </Body>
          )}
          <Sub style={{ marginTop: 4, lineHeight: 17 }}>{meta}</Sub>
          <EvidenceThumbs photos={photos.map((photo) => ({ ...photo, kind: photo.kind }))} size={48} />
          {entry.editable ? null : (
            <Eyebrow style={{ marginTop: 6, fontFamily: FONT.semi }}>Kept on your plan</Eyebrow>
          )}
        </View>
      </View>
    </Pressable>
  );
}
