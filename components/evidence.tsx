import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { IconClose } from '@/components/icons';
import { authHeaders, evidenceUrl } from '@/lib/api';
import { C, RADIUS } from '@/lib/theme';
import type { EvidencePhoto } from '@/lib/types';

// The photo row under a logged exercise or meal, and the same row before anything is
// saved. `/api/evidence/:id` is authenticated — the uploads volume is never served
// statically (backend/src/routes/evidence.ts) — so every thumbnail carries the session's
// bearer token in its request headers.
//
// Two things a thumbnail can have, and neither is on by default:
//
//   * **A remove badge** (`onRemove`), for photos that have not been saved yet. Tapping the
//     image itself used to delete it, with no affordance at all — reported 2026-08-31 by a
//     user who discovered removal by accident. The ✕ badge is now the only thing that
//     removes a photo, and the image body does nothing.
//   * **A lightbox** (`zoomable`), for looking at what was attached. A 56 px thumbnail of a
//     tuna label is a rectangle; the point of keeping the photo is being able to read it.

const THUMB = 56;

/** One image, whatever it is addressed by, with its optional ✕ badge. */
function Thumb({
  uri,
  headers,
  size,
  label,
  onPress,
  onRemove,
  removeLabel,
  testID,
}: {
  uri: string;
  headers?: Record<string, string>;
  size: number;
  label: string;
  onPress?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  testID?: string;
}) {
  const image = (
    <Image
      source={headers ? { uri, headers } : { uri }}
      style={{ width: '100%', height: '100%' }}
      contentFit="cover"
      transition={120}
      // An evidence photo never changes once it is uploaded, and the same thumbnails are
      // scrolled past every time the day is opened: on disk they cost one request ever,
      // rather than one per visit.
      cachePolicy="disk"
      recyclingKey={uri}
      accessibilityLabel={label}
    />
  );

  return (
    // The badge overhangs the corner, so the wrapper cannot clip.
    <View style={{ width: size, height: size }}>
      <Pressable
        testID={testID}
        accessibilityRole={onPress ? 'button' : 'image'}
        accessibilityLabel={label}
        onPress={onPress}
        // Without a lightbox the image is not a control: it must not remove the photo, and
        // it must not pretend to do anything else either.
        disabled={!onPress}
        style={{
          width: size,
          height: size,
          borderRadius: RADIUS.thumb,
          overflow: 'hidden',
          backgroundColor: C.track,
        }}>
        {image}
      </Pressable>
      {onRemove ? (
        <Pressable
          testID={testID ? `${testID}-remove` : undefined}
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? 'Remove this photo'}
          onPress={onRemove}
          // 24 pt drawn, 40 with the slop: the badge is small on purpose and must not be.
          hitSlop={8}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: C.bg,
            borderWidth: 1,
            borderColor: C.track,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <IconClose size={13} color={C.ink} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Full screen, dark, one image and a ✕. No zoom gestures and no new dependency. */
function Lightbox({
  uri,
  headers,
  onClose,
}: {
  uri: string;
  headers?: Record<string, string>;
  onClose: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000EE' }}>
        <Pressable
          testID="photo-close"
          accessibilityRole="button"
          accessibilityLabel="Close the photo"
          onPress={onClose}
          style={{ alignSelf: 'flex-end', padding: 20, paddingTop: 60 }}>
          <IconClose size={26} color={C.ink} />
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close the photo">
          <Image
            testID="photo-full"
            source={headers ? { uri, headers } : { uri }}
            style={{ flex: 1, marginBottom: 60 }}
            contentFit="contain"
            cachePolicy="disk"
            accessibilityLabel="Logged photo, full size"
          />
        </Pressable>
      </View>
    </Modal>
  );
}

/** Photos already saved, addressed by their evidence id. */
export function EvidenceThumbs({
  photos,
  size = THUMB,
  zoomable = false,
  testID,
}: {
  photos: { id: string; kind?: string }[] | EvidencePhoto[];
  size?: number;
  /** Tapping opens the photo full screen. Off inside a row, where the row owns the tap. */
  zoomable?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = photos.filter((photo) => (photo.kind ?? 'photo') === 'photo');
  if (shown.length === 0) return null;

  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
      {shown.map((photo) => (
        <Thumb
          key={photo.id}
          testID={`evidence-${photo.id}`}
          uri={evidenceUrl(photo.id)}
          headers={authHeaders()}
          size={size}
          label="Logged photo"
          {...(zoomable ? { onPress: () => setOpen(photo.id) } : {})}
        />
      ))}
      {open ? (
        <Lightbox uri={evidenceUrl(open)} headers={authHeaders()} onClose={() => setOpen(null)} />
      ) : null}
    </ScrollView>
  );
}

/** Photos picked on the phone and not yet uploaded — the Log sheet's attachments. */
export function LocalThumbs({
  photos,
  size = 64,
  onRemove,
  zoomable = true,
  testID,
}: {
  photos: { uri: string }[];
  size?: number;
  /** Draws the ✕ badge. Only the badge removes; the image body is not a control. */
  onRemove?: (uri: string) => void;
  zoomable?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (photos.length === 0) return null;

  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingTop: 12, paddingRight: 8 }}>
      {photos.map((photo) => (
        <Thumb
          key={photo.uri}
          testID={`photo-${photo.uri}`}
          uri={photo.uri}
          size={size}
          label="Attached photo"
          removeLabel="Remove this photo"
          {...(zoomable ? { onPress: () => setOpen(photo.uri) } : {})}
          {...(onRemove ? { onRemove: () => onRemove(photo.uri) } : {})}
        />
      ))}
      {open ? <Lightbox uri={open} onClose={() => setOpen(null)} /> : null}
    </ScrollView>
  );
}
