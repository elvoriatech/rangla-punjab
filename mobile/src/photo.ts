import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/**
 * Getting a photo off this device, in the two steps every caller needs:
 * ASK where it comes from, then TAKE it there — and, for anything that
 * is going to be uploaded, shrink it first.
 *
 * Extracted from `issue-sheet.tsx`, which grew all of this for the
 * guest's complaint photo and is now one of two callers (the other is
 * the owner's dish photo in `staff-menu.tsx`). The rules that must not
 * drift between them live here: which permission is asked for which
 * source, which MIME types the servers accept, and how an unknown or
 * platform-specific type (HEIC) becomes a JPEG.
 *
 * Nothing here throws. A picker that fails is an outcome, not an
 * exception — the sheet showing it has one line of space for a message.
 */

/** The RN file descriptor `FormData` streams off disk: not a browser
 *  `File`, which is why every caller casts it on the way in. */
export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
}

export type PhotoSource = "camera" | "library";

export type PickOutcome =
  | {
      ok: true;
      photo: PickedPhoto;
      /** The picked pixels, so a caller that downscales knows which edge
       *  is the long one. 0 when the picker didn't say. */
      width: number;
      height: number;
    }
  | { ok: false; reason: "cancelled" | "denied" | "too_large" | "failed" };

/** What both upload routes accept; anything else is refused server-side
 *  with `invalid_photo`, so it is normalised to JPEG here instead. */
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * The "where from?" question, as the system action sheet.
 *
 * Camera first: someone photographing a cold curry — or the dish they
 * just plated — is standing over it. The library is the second option
 * rather than the only one.
 */
export function askPhotoSource(
  labels: { title: string; camera: string; library: string; cancel: string },
  onChoose: (source: PhotoSource) => void,
): void {
  Alert.alert(labels.title, undefined, [
    { text: labels.camera, onPress: () => onChoose("camera") },
    { text: labels.library, onPress: () => onChoose("library") },
    { text: labels.cancel, style: "cancel" },
  ]);
}

/**
 * Present the picker for one source and describe what came back.
 *
 * NOTE for callers: this presents the system picker while the sheet that
 * called it is still VISIBLE, which is safe — iOS will stack a presenter
 * on a settled modal. What is NOT safe is closing the sheet and
 * presenting in the same tick (see `owner-menu.tsx`), so no caller may
 * close itself on this path.
 */
export async function pickPhoto(
  source: PhotoSource,
  options?: {
    /** Refuse anything bigger before it is uploaded, when the picker
     *  reports a size at all. */
    maxBytes?: number;
    /** `< 1` makes the picker re-encode to JPEG, which is how HEIC stops
     *  being a problem this app has to solve. */
    quality?: number;
  },
): Promise<PickOutcome> {
  try {
    // Asked LAZILY, on the tap, and only for the source that was chosen:
    // someone who picks from their library is never asked for the
    // camera, and vice versa.
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: "denied" };

    const launchOptions = {
      mediaTypes: ["images"] as ImagePicker.MediaType[],
      allowsEditing: false,
      quality: options?.quality ?? 0.8,
    };
    const picked =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(launchOptions)
        : await ImagePicker.launchImageLibraryAsync(launchOptions);
    if (picked.canceled || picked.assets.length === 0) return { ok: false, reason: "cancelled" };

    const asset = picked.assets[0];
    const maxBytes = options?.maxBytes;
    if (
      typeof maxBytes === "number" &&
      typeof asset.fileSize === "number" &&
      asset.fileSize > maxBytes
    ) {
      return { ok: false, reason: "too_large" };
    }
    const type =
      asset.mimeType && PHOTO_TYPES.includes(asset.mimeType) ? asset.mimeType : "image/jpeg";
    return {
      ok: true,
      photo: { uri: asset.uri, name: asset.fileName ?? `photo.${extensionFor(type)}`, type },
      width: typeof asset.width === "number" ? asset.width : 0,
      height: typeof asset.height === "number" ? asset.height : 0,
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export function extensionFor(type: string): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

/** A dish photo is shown at most a screen wide; a modern phone camera
 *  hands over 4000 px of it. 1600 is the longest edge worth keeping. */
export const UPLOAD_MAX_EDGE = 1600;
/** JPEG quality. 0.82 is where the artefacts stop being visible on a
 *  photo of food and the file is still ~200–400 KB. */
export const UPLOAD_QUALITY = 0.82;

/**
 * Shrink a picked photo to something worth uploading over a restaurant's
 * wifi: longest edge {@link UPLOAD_MAX_EDGE}, re-encoded JPEG at
 * {@link UPLOAD_QUALITY}.
 *
 * An image already smaller than the cap is NOT enlarged — it is only
 * re-encoded, which is what makes the size predictable either way.
 *
 * Uses the contextual API (`manipulate(...).renderAsync()`); the old
 * `manipulateAsync` is deprecated in SDK 57.
 */
export async function shrinkPhoto(
  photo: PickedPhoto,
  size?: { width: number; height: number } | null,
  options?: { maxEdge?: number; quality?: number },
): Promise<PickedPhoto> {
  const maxEdge = options?.maxEdge ?? UPLOAD_MAX_EDGE;
  const quality = options?.quality ?? UPLOAD_QUALITY;
  try {
    let width = size && size.width > 0 ? size.width : 0;
    let height = size && size.height > 0 ? size.height : 0;
    let context = ImageManipulator.manipulate(photo.uri);
    if (width === 0 || height === 0) {
      // The picker didn't say how big it is — decode once to find out,
      // then manipulate the decoded image rather than the file again.
      const probe = await context.renderAsync();
      width = probe.width;
      height = probe.height;
      context = ImageManipulator.manipulate(probe);
    }
    // Only ONE dimension is given, so the other follows the ratio.
    if (width >= height && width > maxEdge) context = context.resize({ width: maxEdge });
    else if (height > width && height > maxEdge) context = context.resize({ height: maxEdge });

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    return { uri: saved.uri, name: jpegName(photo.name), type: "image/jpeg" };
  } catch {
    // A manipulator that can't open the file is not a reason to lose the
    // photo: the original is still a valid upload, just a heavier one.
    return photo;
  }
}

/** "curry.HEIC" → "curry.jpg" — the bytes are JPEG now, so the name
 *  the server stores must not claim otherwise. */
function jpegName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]+$/, "");
  return `${base || "photo"}.jpg`;
}
