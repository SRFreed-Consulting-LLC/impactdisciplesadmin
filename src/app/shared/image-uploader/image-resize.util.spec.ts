import { RESIZE_PRESETS, isResizable, resizeImage } from './image-resize.util';

// Real canvas work in a real browser - Karma gives us one, and the whole
// point of this utility is what the browser does with the pixels.

/** A solid-colour PNG of the given size, as a File. */
async function pngFile(w: number, h: number, name = 'shot.png', alpha = 1): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // A gradient rather than a flat fill: a single colour compresses to almost
  // nothing, which would make every size assertion below meaningless.
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `rgba(200, 30, 40, ${alpha})`);
  grad.addColorStop(1, `rgba(20, 80, 200, ${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return new File([blob!], name, { type: 'image/png' });
}

async function widthOf(file: File): Promise<number> {
  const bitmap = await createImageBitmap(file);
  const w = bitmap.width;
  bitmap.close();
  return w;
}

describe('the upload sizes on offer', () => {
  it('leads with Original, so a prepared file can be left alone', () => {
    expect(RESIZE_PRESETS[0].key).toBe('original');
    expect(RESIZE_PRESETS[0].width).toBeUndefined();
  });

  it('caps at the same 2000px the optimise script uses', () => {
    // Two different answers to "how big should a picture be" is how a re-run
    // of scripts/optimise-page-images.js starts undoing what the uploader
    // just did.
    const widths = RESIZE_PRESETS.map((p) => p.width).filter(Boolean);
    expect(Math.max(...(widths as number[]))).toBe(2000);
  });
});

describe('what can be resized', () => {
  it('takes the raster formats', () => {
    expect(isResizable(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBeTrue();
    expect(isResizable(new File([], 'a.png', { type: 'image/png' }))).toBeTrue();
  });

  it('refuses SVG - it has no pixels to lose, and rasterising is worse', () => {
    expect(isResizable(new File([], 'logo.svg', { type: 'image/svg+xml' }))).toBeFalse();
  });

  it('refuses GIF, which a canvas would silently stop animating', () => {
    expect(isResizable(new File([], 'a.gif', { type: 'image/gif' }))).toBeFalse();
  });
});

describe('resizing a picture on its way in', () => {
  it('brings a large image down to the width asked for', async () => {
    const original = await pngFile(2400, 1200);
    const out = await resizeImage(original, 800);

    expect(await widthOf(out)).toBe(800);
    expect(out.size).toBeLessThan(original.size);
  });

  it('keeps the aspect ratio - it must never crop or re-frame', async () => {
    const out = await resizeImage(await pngFile(2000, 1000), 1000);
    const bitmap = await createImageBitmap(out);

    expect(bitmap.width / bitmap.height).toBeCloseTo(2, 1);
    bitmap.close();
  });

  it('leaves an image already narrower than the cap completely alone', async () => {
    // Byte-identical, not merely similar: re-encoding costs quality for
    // nothing, so picking a size can only ever help.
    const original = await pngFile(500, 400);
    const out = await resizeImage(original, 800);

    expect(out).toBe(original);
  });

  it('leaves the file alone when no width is asked for', async () => {
    const original = await pngFile(3000, 2000);
    expect(await resizeImage(original, undefined)).toBe(original);
  });

  it('writes a photograph as JPEG, and renames it to match', async () => {
    const out = await resizeImage(await pngFile(2400, 1200, 'screenshot.png'), 800);

    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('screenshot.jpg');
  });

  it('keeps a see-through image as PNG, so a logo gains no white box', async () => {
    // The reason the transparency test exists at all - JPEG has no alpha to
    // flatten back, so a cut-out would arrive with a white rectangle.
    const out = await resizeImage(await pngFile(2400, 1200, 'logo.png', 0.5), 800);

    expect(out.type).toBe('image/png');
    expect(out.name).toBe('logo.png');
  });

  it('never returns something BIGGER than what it was given', async () => {
    // Re-encoding a small optimised file can genuinely cost more than it
    // saves; shipping that would make the whole feature harmful.
    const original = await pngFile(900, 700);
    const out = await resizeImage(original, 800);

    expect(out.size).toBeLessThanOrEqual(original.size);
  });

  it('hands back the original rather than throwing on an undecodable file', async () => {
    // A failed resize must not cost somebody their upload.
    const junk = new File([new Uint8Array([1, 2, 3, 4])], 'broken.png', { type: 'image/png' });

    expect(await resizeImage(junk, 800)).toBe(junk);
  });
});
