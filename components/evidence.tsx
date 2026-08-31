import { Image } from 'expo-image';
import { ScrollView, View } from 'react-native';

import { authHeaders, evidenceUrl } from '@/lib/api';
import { C, RADIUS } from '@/lib/theme';
import type { EvidencePhoto } from '@/lib/types';

// The photo row under a logged exercise or meal. `/api/evidence/:id` is authenticated —
// the uploads volume is never served statically (backend/src/routes/evidence.ts) — so
// every thumbnail carries the session's bearer token in its request headers.

export function EvidenceThumbs({ photos, size = 56 }: { photos: EvidencePhoto[]; size?: number }) {
  if (photos.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
      {photos.map((photo) => (
        <View
          key={photo.id}
          style={{
            width: size,
            height: size,
            borderRadius: RADIUS.thumb,
            overflow: 'hidden',
            backgroundColor: C.track,
          }}>
          <Image
            source={{ uri: evidenceUrl(photo.id), headers: authHeaders() }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={120}
            // An evidence photo never changes once it is uploaded, and the same
            // thumbnails are scrolled past every time the day is opened: on disk they
            // cost one request ever, rather than one per visit.
            cachePolicy="disk"
            recyclingKey={photo.id}
            accessibilityLabel="Logged photo"
          />
        </View>
      ))}
    </ScrollView>
  );
}
