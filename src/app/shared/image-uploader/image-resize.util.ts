/**
 * DOWNSAMPLING A PICTURE ON ITS WAY IN, so the site is not left to serve
 * whatever came off a phone or a screenshot key.
 *
 * WHY IT IS NEEDED. Coaching with Impact loaded 3.78MB of pictures on
 * 2026-09-04, and 2.6MB of that was four macOS screenshots stored as PNG at
 * 1000x649 - 953KB, 948KB, 375KB and 330KB for images the page paints about
 * 300px wide. The Store's covers are the same story: 29 PNGs, 26.3MB, most
 * of them near a megabyte each. Nothing was broken; it was all just far
 * larger than anything the site ever paints. `scripts/optimise-page-images.js`
 * has been cleaning this up after the fact - this is the same job done
 * before the file lands, which is the only version of it nobody has to
 * remember to run.
 *
 * THE WIDTHS AND THE QUALITY MATCH THAT SCRIPT (MAX_WIDTH 2000, QUALITY 85)
 * on purpose. Two different answers to "how big should a picture be" is how
 * a re-run of the script starts undoing what the uploader just did.
 *
 * IT NEVER CROPS OR RE-FRAMES. These are the ministry's own photographs and
 * must look exactly as before, only smaller - the same rule the script
 * states. Aspect ratio is preserved and an image already narrower than the
 * chosen width is passed through untouched rather than re-encoded, so
 * picking a size can only ever help.
 */

/** A size a staff member can pick at upload time. `width` absent = as-is. */
export interface ResizePreset {
  key: string;
  label: string;
  /** The longest edge, in CSS pixels. Absent means no resizing at all. */
  width?: number;
  /** Said under the label, so the choice does not need explaining twice. */
  hint: string;
}

/**
 * FOUR, and deliberately not a free-text box.
 *
 * The widths are the ones the site actually paints at: a full-bleed hero
 * band is the only thing that ever needs 2000, a page's own picture sits in
 * a column around 700 wide (so 1400 covers it on a 2x screen), and a tile or
 * a book cover is smaller again. "Original" stays first because a staff
 * member who has already prepared a file should not have it re-encoded
 * behind their back.
 */
export const RESIZE_PRESETS: readonly ResizePreset[] = [
  { key: 'original', label: 'Original', hint: 'upload the file exactly as it is' },
  { key: 'large', label: 'Large', width: 2000, hint: 'a full-width banner or hero' },
  { key: 'medium', label: 'Medium', width: 1400, hint: 'a picture beside text, or a wide row' },
  { key: 'small', label: 'Small', width: 800, hint: 'a tile, a book cover, a headshot' }
];

/** JPEG quality, matching scripts/optimise-page-images.js. */
const QUALITY = 0.85;

/**
 * Formats worth resizing.
 *
 * SVG is a drawing and has no pixels to lose - painting it to a canvas would
 * turn it INTO pixels, which is strictly worse. GIF may be animated, and a
 * canvas keeps only the first frame, so a resized one would silently stop
 * moving. Both are passed through untouched.
 */
const RESIZABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/avif'];

export function isResizable(file: File): boolean {
  return RESIZABLE.includes(file.type);
}

/**
 * Whether any pixel is actually see-through.
 *
 * MATTERS BECAUSE OF THE OUTPUT FORMAT. A resized photograph is written as
 * JPEG, which has no alpha - so a logo or a cut-out would gain a white box
 * nobody asked for. One that IS transparent stays PNG instead, and simply
 * gets smaller dimensions.
 *
 * Sampled rather than exhaustive, and lifted from the same check in
 * scripts/optimise-page-images.js: a stride over the alpha bytes, plus the
 * whole of the first and last row, which is where a cut-out shows first.
 * @param ctx A context holding the drawn image.
 * @param w Canvas width.
 * @param h Canvas height.
 * @return True when at least one pixel is not opaque.
 */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4 * 7) {
    if (data[i] < 250) {
      return true;
    }
  }
  const lastRow = (h - 1) * w * 4;
  for (let x = 0; x < w; x++) {
    if (data[x * 4 + 3] < 250 || data[lastRow + x * 4 + 3] < 250) {
      return true;
    }
  }
  return false;
}

/** The name a resized file takes - same stem, extension following the
 *  format it was actually written in, so a .png that became a JPEG does not
 *  keep lying about itself. */
function renamed(original: string, type: string): string {
  const stem = original.replace(/\.[^.]+$/, '');
  return `${stem}.${type === 'image/png' ? 'png' : 'jpg'}`;
}

/**
 * One picture, no wider than `maxWidth`.
 *
 * Returns the ORIGINAL FILE UNCHANGED when there is nothing to gain - an
 * unsupported format, no width asked for, an image already narrower, or a
 * browser that could not decode it. Never throws: a failed resize must not
 * cost somebody their upload, it should just upload what they picked.
 * @param file The file chosen in the picker.
 * @param maxWidth The longest edge to allow, or undefined for as-is.
 * @return The file to actually upload.
 */
export async function resizeImage(file: File, maxWidth?: number): Promise<File> {
  if (!maxWidth || !isResizable(file)) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // Undecodable here - let the server have the original.
  }

  if (bitmap.width <= maxWidth) {
    bitmap.close();
    return file;
  }

  const scale = maxWidth / bitmap.width;
  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const type = hasTransparency(ctx, canvas.width, canvas.height) ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === 'image/jpeg' ? QUALITY : undefined)
  );
  if (!blob) {
    return file;
  }

  // A RESIZE THAT MADE IT BIGGER IS NOT A RESIZE. Re-encoding a small,
  // already-optimised PNG can genuinely cost more bytes than it saves, and
  // shipping that would make the feature actively harmful.
  if (blob.size >= file.size) {
    return file;
  }

  return new File([blob], renamed(file.name, type), {
    type,
    lastModified: file.lastModified
  });
}
