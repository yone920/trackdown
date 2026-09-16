import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { IconCamera, IconChevronDown, IconChevronUp } from '@/components/icons';
import { Thumbnail } from '@/components/plan-exercise-card';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { openExercise } from '@/lib/exercise';
import { C, RADIUS, TABULAR } from '@/lib/theme';
import type { BriefFinisherItem } from '@/lib/types';

// The finisher's own card — the same shell as the Do list's (header bar, real photo,
// chevron toggle, "View photo" as its own tap target), minus what a finisher has no use
// for: there is no Log here, because nothing computes a DONE state for a stretch the way
// completion.ts does for a logged set (user field report 2026-09-17 — "why is To Finish
// still showing old cards" was the visual mismatch this closes; tracking a finisher as
// done is a separate piece of work this does not attempt).

type Props = {
  item: BriefFinisherItem;
  index: number;
  open: boolean;
  onToggle: () => void;
};

export function PlanFinisherCard({ item, index, open, onToggle }: Props) {
  const router = useRouter();
  const openPhoto = () => openExercise(router, { id: item.exercise_id, name: item.name, mediaCount: item.media_count });

  const line = [item.minutes != null ? `${item.minutes} min` : null, item.note].filter(Boolean).join(' · ');

  if (!open) {
    return (
      <Pressable
        testID={`plan-finisher-${index}`}
        onPress={onToggle}
        style={{
          backgroundColor: C.track,
          borderRadius: RADIUS.tile + 2,
          padding: 13,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}>
        <Thumbnail exercise={item} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Disp size={17}>{item.name}</Disp>
          {line ? <Sub style={[{ marginTop: 1 }, TABULAR]}>{line}</Sub> : null}
        </View>
        <IconChevronDown size={18} color={C.mute} strokeWidth={2} />
      </Pressable>
    );
  }

  return (
    <View style={{ borderRadius: RADIUS.card, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,122,26,0.35)' }}>
      <Pressable
        testID={`plan-finisher-${index}-header`}
        onPress={onToggle}
        style={{ backgroundColor: C.track, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Thumbnail exercise={item} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Disp size={19}>{item.name}</Disp>
        </View>
        <IconChevronUp size={18} color={C.ink} strokeWidth={2.2} />
      </Pressable>

      <View style={{ backgroundColor: C.card, padding: 16, paddingTop: 14, gap: 12 }}>
        <Pressable
          testID={`plan-finisher-${index}-photo`}
          onPress={openPhoto}
          style={{
            alignSelf: 'flex-start',
            height: 44,
            paddingHorizontal: 16,
            paddingLeft: 12,
            borderRadius: 22,
            backgroundColor: C.track,
            borderWidth: 1,
            borderColor: C.line,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
          <IconCamera size={17} color={C.accent} />
          <Body style={{ fontSize: 14 }}>View photo</Body>
        </Pressable>

        {item.minutes != null ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, backgroundColor: C.track, borderRadius: 12, padding: 10, paddingHorizontal: 12 }}>
              <Eyebrow style={{ color: C.dim }}>Duration</Eyebrow>
              <Disp size={20} style={[{ marginTop: 2 }, TABULAR]}>{item.minutes} min</Disp>
            </View>
          </View>
        ) : null}

        {item.note ? <Sub style={{ fontSize: 13.5 }}>{item.note}</Sub> : null}
      </View>
    </View>
  );
}
