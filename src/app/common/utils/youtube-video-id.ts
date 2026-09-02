/**
 * Turns whatever somebody pasted into a YouTube video id, or nothing.
 *
 * WHY THIS EXISTS. The Summit's "Promo Video Id" field was a bare text
 * input with no hint, no example and no validation, and the value goes
 * straight into `<youtube-player [videoId]>` on the public site. On
 * 2026-09-02 the Summit 2027 page had no video at all because the field
 * held `YN9xKK-kWJ3op23B` - the `si=` TRACKING PARAMETER off a YouTube
 * Share link, not the id:
 *
 *     https://youtu.be/dQw4w9WgXcQ?si=YN9xKK-kWJ3op23B
 *                      ^^^^^^^^^^^     ^^^^^^^^^^^^^^^^
 *                      the id          what got pasted
 *
 * The share parameter is 16 characters of the same alphabet as an id, so
 * it looks entirely plausible. Nothing objected, and the page rendered an
 * empty box: no poster frame, no title, no player. The public template's
 * `videoId || <hardcoded fallback>` could not help either - `||` only
 * falls back on an EMPTY value, and a wrong string is not empty.
 *
 * "Was I meant to paste the URL or the id?" is a fair question that the
 * field never answered. So it accepts either now, and rejects what is
 * neither rather than storing it.
 */
import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * A YouTube video id: exactly 11 characters of the URL-safe base64
 * alphabet. The length is the whole check - it is what separates an id
 * from the 16-character `si=` value that caused this.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The paths a video id can sit in, across every form YouTube hands out:
 * `watch?v=`, the `youtu.be` short link, `/embed/`, `/shorts/` and
 * `/live/`. Matched against the URL's path or query, never against the
 * whole string, so a stray 11-character run elsewhere cannot be mistaken
 * for an id.
 */
const PATH_FORMS = [/^\/embed\/([^/?#]+)/, /^\/shorts\/([^/?#]+)/, /^\/live\/([^/?#]+)/];

/** Hosts whose FIRST path segment is the id (the share-link short form). */
const SHORT_HOSTS = ['youtu.be'];

/** Hosts whose id lives in `?v=` or one of PATH_FORMS. */
const LONG_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'];

/**
 * Extracts the video id from a bare id or any YouTube URL.
 *
 * Returns null for anything that is not one - including a `si=` share
 * parameter, a playlist-only link, or a URL for some other site - so a
 * caller can refuse it rather than store something the player cannot use.
 */
export function extractYouTubeVideoId(input: string | null | undefined): string | null {
  const value = (input ?? '').trim();
  if (!value) {
    return null;
  }

  // Already an id. Checked first so an id is never run through the URL
  // parser, which would have to guess at a scheme.
  if (VIDEO_ID.test(value)) {
    return value;
  }

  // A URL, with or without a scheme - people paste `youtu.be/x` as often
  // as the full thing, and `new URL()` needs a scheme to parse either.
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;

  if (SHORT_HOSTS.includes(host)) {
    candidate = url.pathname.slice(1).split('/')[0] || null;
  } else if (LONG_HOSTS.includes(host)) {
    candidate = url.searchParams.get('v');
    if (!candidate) {
      for (const form of PATH_FORMS) {
        const hit = form.exec(url.pathname);
        if (hit) {
          candidate = hit[1];
          break;
        }
      }
    }
  }

  // The candidate still has to BE an id. A share link's `si=` never
  // reaches here, but a truncated or malformed one would, and storing it
  // is exactly the failure this function exists to prevent.
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** True when the value is empty (the field is optional) or usable. */
export function isUsableYouTubeVideo(input: string | null | undefined): boolean {
  return !(input ?? '').trim() || extractYouTubeVideoId(input) !== null;
}

/**
 * Reactive-forms validator for a promo-video field. Empty passes - an
 * event with no video of its own is normal, and the public page falls
 * back to its own. Only a non-empty value that is not a video fails.
 */
export function youTubeVideoIdValidator(
  control: AbstractControl
): ValidationErrors | null {
  return isUsableYouTubeVideo(control.value as string) ? null : { youtubeVideoId: true };
}
