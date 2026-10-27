import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { newId } from './id';

const MAX_WIDTH = Platform.OS === 'web' ? 900 : 1400;

export type ImageSource = 'camera' | 'library';

/**
 * Lets the user take or choose a photo, shrinks it, and stores it permanently.
 * Returns a URI to keep on the recipe, or null if the user cancelled.
 * - Mobile: a JPEG file inside the app's document folder.
 * - Web: a compressed data URI (saved in the browser with the recipe).
 */
export async function pickRecipeImage(source: ImageSource): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('camera-permission');
  } else if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('library-permission');
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: Platform.OS !== 'web',
    aspect: [4, 3],
    quality: 0.8,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  if (!asset.width || asset.width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
  const rendered = await context.renderAsync();

  if (Platform.OS === 'web') {
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
    return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : saved.uri;
  }

  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
  const dir = new Directory(Paths.document, 'recipe-images');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, `${newId()}.jpg`);
  new File(saved.uri).copy(target);
  return target.uri;
}

/** Deletes an image file this app stored on the device. Remote URLs and data URIs are ignored. */
export function deleteStoredImage(uri?: string) {
  if (!uri || Platform.OS === 'web' || !uri.includes('/recipe-images/')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The image is already gone; nothing to clean up.
  }
}
