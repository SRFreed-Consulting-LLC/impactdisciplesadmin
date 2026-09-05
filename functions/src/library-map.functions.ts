import {tenantPath, triggerPath} from "./common/shared/lists/tenancy";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {getFirestore} from "firebase-admin/firestore";

/**
 * KEEPS THE PUBLIC READER MAP IN STEP WITH `libraryUsers`.
 *
 * The Library tab's own world map reads `libraryUsers` directly and names
 * each reader in a popup. That is correct behind a staff login and
 * unpublishable anywhere else: the collection's read rule is
 * `callerEmail() == email || isAdminRole()`, and each document carries an
 * email address, a phone number, a name, book licences and a last-login time.
 *
 * The public site therefore never reads it. This derives one document -
 * `library_map/points` - holding COORDINATES, THE PLACE NAMES THAT GO WITH
 * THEM, and a total. Nothing that could be joined back to a person: no name,
 * no email, no id, no phone, no licences, no last-login. That document's read
 * rule is `if true`; this function is the only thing that writes it, which is
 * why the rule's write side is `false` (the Admin SDK bypasses rules).
 *
 * The place names were added 2026-09-05, for the map's popup, and they
 * disclose nothing the coordinate did not: a coordinate IS a place. What
 * stays out is everything that says WHO, and that line has not moved.
 *
 * A TRIGGER RATHER THAN A SCHEDULE, so the map is genuinely live: a reader
 * signing in for the first time appears on the public page within a second or
 * two. The cost of that choice is that this runs on every write to a
 * libraryUser - including the `lastLogin` stamp on every sign-in - and each
 * run re-reads the collection. At 101 documents that is trivial. If the
 * library grows into the thousands, move to an hourly schedule rather than
 * making this cleverer; a map of reader locations does not need to be
 * accurate to the second.
 */

/** Where the derived document lives. One document, fixed id. */
const MAP_DOC_ID = "points";

/**
 * How far a dot may be moved from the reader's geolocated position, in
 * degrees. Roughly 8km at the equator.
 *
 * WHY MOVE IT AT ALL. IP geolocation resolves to a city centroid, so every
 * reader in one city shares an identical coordinate: twenty of them draw as
 * one dot and the map badly under-reports itself (at the time of writing, 29
 * readers across 15 distinct places - a third of the dots invisible). The
 * offset separates them into a visible cluster.
 *
 * It is also the honest thing to publish. The coordinate in a world-readable
 * document is then not the one the geolocation service returned.
 */
const JITTER_DEGREES = 0.07;

/**
 * A stable pseudo-random pair in [-1, 1] for a given key.
 *
 * Seeded from the reader's own document id so the same reader always lands in
 * the same spot: a dot that wandered on every recompute would read as
 * somebody moving house twice an hour, and the web app's own dot-tracking
 * would treat it as a new arrival each time.
 * @param key The libraryUsers document id (an email address).
 * @return Two numbers in [-1, 1].
 */
export function jitterFor(key: string): [number, number] {
  // FNV-1a, twice, over different salts. Not cryptographic and does not need
  // to be - it only has to be stable and evenly spread.
  const hash = (salt: string): number => {
    let h = 0x811c9dc5;
    const text = salt + key;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  return [
    (hash("lat") / 0xffffffff) * 2 - 1,
    (hash("lng") / 0xffffffff) * 2 - 1,
  ];
}

/** A location as libraryUsers stores it, as far as this cares. */
interface StoredLocation {
  lat?: unknown;
  lng?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
}

/** What a published point may carry. */
interface PublicPoint {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  country?: string;
}

/**
 * A place name, if it is one - trimmed, and absent rather than empty.
 * @param raw Whatever libraryUsers had in the field.
 * @return A usable string, or undefined.
 */
function place(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const text = raw.trim();
  // A cap, because this is going into a world-readable document and a field
  // that should hold "Atlanta" holding a paragraph means something upstream
  // is wrong and should not be republished.
  return text && text.length <= 80 ? text : undefined;
}

/**
 * Turns the raw collection into the points the public document publishes.
 *
 * Exported for its own test: this is the whole privacy boundary in one
 * function, and what it drops matters more than what it keeps.
 * @param users The libraryUsers documents, as [id, data] pairs.
 * @return One jittered point per reader with a usable location.
 */
export function pointsFrom(
  users: readonly [string, {location?: StoredLocation}][]
): PublicPoint[] {
  const points: PublicPoint[] = [];
  for (const [id, data] of users) {
    const lat = data?.location?.lat;
    const lng = data?.location?.lng;
    // A location that is missing, non-numeric or out of range is skipped
    // rather than clamped: a dot at 0,0 is the Gulf of Guinea, and a map with
    // a permanent mystery reader in the sea invites exactly one question.
    if (typeof lat !== "number" || typeof lng !== "number") {
      continue;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      continue;
    }
    const [jLat, jLng] = jitterFor(id);
    // The place names travel with the point for the map's popup. They
    // disclose nothing the coordinate did not - a coordinate IS a place - and
    // the fields are spread conditionally so an absent one is ABSENT rather
    // than present-and-undefined, which Firestore rejects outright.
    const city = place(data?.location?.city);
    const region = place(data?.location?.region);
    const country = place(data?.location?.country);
    points.push({
      // Rounded to four decimals - about 11 metres, far finer than anything
      // this draws, and it keeps the document small and diffable.
      lat: Math.round((lat + jLat * JITTER_DEGREES) * 1e4) / 1e4,
      lng: Math.round((lng + jLng * JITTER_DEGREES) * 1e4) / 1e4,
      ...(city ? {city} : {}),
      ...(region ? {region} : {}),
      ...(country ? {country} : {}),
    });
  }
  return points;
}

export const onLibraryUserWritten = onDocumentWritten(
  triggerPath("libraryUsers", "{email}"),
  async () => {
    const db = getFirestore();
    try {
      // The WHOLE collection each time, deliberately. The alternative -
      // patching the one changed reader into the stored array - has to handle
      // deletes, a location appearing, a location changing and a document
      // that was never in the array, and gets the count wrong forever if any
      // of those is missed. A hundred-document read is cheaper than a
      // permanently drifting figure.
      const snap = await db.collection(tenantPath("libraryUsers")).get();
      const points = pointsFrom(
        snap.docs.map((d) => [d.id, d.data() as {location?: StoredLocation}])
      );

      await db.collection(tenantPath("library_map")).doc(MAP_DOC_ID).set({
        points,
        total: points.length,
        updatedAt: Date.now(),
      });
    } catch (err) {
      // Never rethrow. A failure here must not retry-loop over a collection
      // read, and the public map going stale is not worth failing a sign-in
      // path over - the next write to any reader rebuilds it.
      logger.error("Could not rebuild the public reader map", err);
    }
  }
);
