import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// Photos for the log. Both modules ship inside Expo Go, so the morning test can take a
// picture of a machine without a dev build (docs/build-plan.md §Morning test).
//
// Everything is downscaled on the phone before it is uploaded: concept-v2 §Logging says
// ~1280 px JPEG, ~300 KB. The server downscales again as a safety net, but a gym on a
// phone signal is not the place to send a 4 MB HEIC.

/** Four photos is a machine, its display, the weight stack and the plate. */
export const MAX_PHOTOS = 4;
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.7;

export type LocalPhoto = { uri: string; filename: string; type: string };

/** Downscale to `MAX_EDGE` on the long side and re-encode as JPEG. Never upscales. */
export async function prepare(asset: {
  uri: string;
  width?: number | null;
  height?: number | null;
}): Promise<LocalPhoto> {
  const context = ImageManipulator.manipulate(asset.uri);
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    // Resize on the long edge, so a portrait shot of a weight stack keeps its detail.
    if (width >= height) context.resize({ width: MAX_EDGE });
    else context.resize({ height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return {
    uri: saved.uri,
    filename: `photo-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`,
    type: 'image/jpeg',
  };
}

async function prepareAll(assets: ImagePicker.ImagePickerAsset[]): Promise<LocalPhoto[]> {
  const photos: LocalPhoto[] = [];
  for (const asset of assets) photos.push(await prepare(asset));
  return photos;
}

/** The camera. Returns [] when the user backs out or refuses the permission. */
export async function takePhoto(): Promise<LocalPhoto[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return [];
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
  });
  if (result.canceled) return [];
  return prepareAll(result.assets);
}

/** The library, up to `remaining` more photos. */
export async function pickPhotos(remaining: number): Promise<LocalPhoto[]> {
  if (remaining <= 0) return [];
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: remaining > 1,
    selectionLimit: remaining,
    quality: 1,
    exif: false,
  });
  if (result.canceled) return [];
  return prepareAll(result.assets.slice(0, remaining));
}
