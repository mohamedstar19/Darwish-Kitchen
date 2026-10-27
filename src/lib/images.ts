import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { newId } from './id';

export type ImageSource = 'camera' | 'library';
export type ImageFolder = 'recipe-images' | 'profile-images';

const isWeb = Platform.OS === 'web';

function folder(name: ImageFolder) {
  const dir = new Directory(Paths.document, name);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Lets the user take or choose a photo, shrinks it, and stores it permanently.
 * Returns a URI to keep, or null if the user cancelled.
 * - Mobile: a JPEG file inside the app's document folder.
 * - Web: a compressed data URI (saved in the browser with the data).
 */
export async function pickImage(
  source: ImageSource,
  { target = 'recipe-images', square = false }: { target?: ImageFolder; square?: boolean } = {},
): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('camera-permission');
  } else if (!isWeb) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('library-permission');
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: !isWeb,
    aspect: square ? [1, 1] : [4, 3],
    quality: 0.8,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const maxWidth = square ? 512 : isWeb ? 900 : 1400;
  const context = ImageManipulator.manipulate(asset.uri);
  if (!asset.width || asset.width > maxWidth) context.resize({ width: maxWidth });
  const rendered = await context.renderAsync();

  if (isWeb) {
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
    return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : saved.uri;
  }

  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
  const file = new File(folder(target), `${newId()}.jpg`);
  new File(saved.uri).copy(file);
  return file.uri;
}

export const pickRecipeImage = (source: ImageSource) => pickImage(source);

/** True for images this app stored itself (device files or web data URIs), not remote URLs. */
export function isLocalImage(uri?: string): uri is string {
  return !!uri && (uri.startsWith('data:') || uri.includes('/recipe-images/') || uri.includes('/profile-images/'));
}

/** Deletes an image file this app stored on the device. Remote URLs and data URIs are ignored. */
export function deleteStoredImage(uri?: string) {
  if (!uri || isWeb || uri.startsWith('data:') || !isLocalImage(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The image is already gone; nothing to clean up.
  }
}

/** Raw JPEG bytes of a stored image, for uploading a backup. */
export async function readImageBytes(uri: string): Promise<ArrayBuffer> {
  if (uri.startsWith('data:')) {
    const binary = atob(uri.slice(uri.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  return new File(uri).arrayBuffer();
}

/** Downloads a backed-up image and stores it like a freshly picked one. */
export async function storeDownloadedImage(url: string, target: ImageFolder, headers: Record<string, string> = {}): Promise<string> {
  if (isWeb) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`download-${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  const file = await File.downloadFileAsync(url, new File(folder(target), `${newId()}.jpg`), { headers });
  return file.uri;
}
