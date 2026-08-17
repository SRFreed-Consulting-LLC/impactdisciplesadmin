import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * Phase 6 port of the reader app's libraryUsers self-service PROFILE
 * writes (LibraryUserService.recordLogin/createProfile/
 * updateOwnPreferences). Moving these behind callables means the caller's
 * identity comes exclusively from their Auth token (email/uid are never
 * accepted as parameters) and each write is limited to an explicit field
 * allowlist - a client can no longer touch licensedBookIds/bookLicenses/
 * revoked or any other field on its own profile doc, which lets Phase 7's
 * rules close direct client writes to the libraryUsers PROFILE DOC
 * entirely (its offline-critical subcollections - lessonStatus/
 * lessonHighlights/submissions/fcmTokens/messages - deliberately stay
 * direct client writes under owner-path rules; see the consolidation
 * plan's Phase 6 "offline-preserving split" decision).
 *
 * The `location` a client reports is validated for shape but still
 * client-claimed (same trust level as before this port) - the sticky
 * internationalUser flag it can set gates free reading, an accepted
 * honest-path policy per the original design. Server-side IP geolocation
 * would harden it and is a candidate for the Phase 7 pass.
 */
const db = admin.firestore();

interface LocationInput {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  updatedAt: number;
}

/**
 * Extracts the caller's normalized email + uid or throws.
 * @param {CallableRequest} request The callable request.
 * @return {{email: string, uid: string}} Verified caller identity.
 */
function callerIdentity(request: CallableRequest): {
  email: string;
  uid: string;
} {
  const email = request.auth?.token.email?.trim().toLowerCase();
  const uid = request.auth?.uid;
  if (!email || !uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return {email, uid};
}

/**
 * Validates and narrows a client-reported location to exactly the fields
 * the LibraryUserLocation model defines - anything malformed is dropped
 * (best-effort data, never worth failing a login over).
 * @param {unknown} raw The client-supplied location value.
 * @return {LocationInput | undefined} A clean location, or undefined.
 */
function cleanLocation(raw: unknown): LocationInput | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const loc = raw as Record<string, unknown>;
  if (typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    return undefined;
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const out: LocationInput = {
    lat: loc.lat,
    lng: loc.lng,
    updatedAt: Date.now(),
  };
  const city = str(loc.city);
  const region = str(loc.region);
  const country = str(loc.country);
  const countryCode = str(loc.countryCode);
  if (city) out.city = city;
  if (region) out.region = region;
  if (country) out.country = country;
  if (countryCode) out.countryCode = countryCode;
  return out;
}

/**
 * Session-entry stamp (authGuard calls this on every session start).
 * Updates userId/lastLogin/location on an EXISTING doc; only creates a
 * missing doc for an international patron (their free-reading grant is
 * enforced by rules reading this doc, so it must exist). The sticky
 * internationalUser flag is only ever set true, never cleared.
 */
export const recordMyLogin = onCall(async (request) => {
  const {email, uid} = callerIdentity(request);
  const location = cleanLocation((request.data ?? {}).location);
  const isInternational =
    !!location?.countryCode && location.countryCode !== "US";

  const ref = db.collection("libraryUsers").doc(email);
  const now = Date.now();
  const snap = await ref.get();
  if (!snap.exists) {
    if (!isInternational) {
      return {recorded: false};
    }
    await ref.set({
      email,
      userId: uid,
      lastLogin: now,
      location,
      internationalUser: true,
      bookLicenses: [],
      licensedBookIds: [],
      createdAt: now,
      updatedAt: now,
    });
    return {recorded: true};
  }
  await ref.update({
    userId: uid,
    lastLogin: now,
    ...(location ? {location} : {}),
    ...(isInternational ? {internationalUser: true} : {}),
  });
  return {recorded: true};
});

/**
 * Creates (or links, for a legacy-imported email) the caller's own
 * profile doc right after signup - merge:true so an existing imported
 * doc's licenses/legacy fields are linked up, never clobbered.
 */
export const createMyReaderProfile = onCall(async (request) => {
  const {email, uid} = callerIdentity(request);
  const {firstName, lastName} = (request.data ?? {}) as {
    firstName?: string;
    lastName?: string;
  };
  if (typeof firstName !== "string" || typeof lastName !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "firstName and lastName are required."
    );
  }
  const location = cleanLocation((request.data ?? {}).location);
  const isInternational =
    !!location?.countryCode && location.countryCode !== "US";

  const ref = db.collection("libraryUsers").doc(email);
  const now = Date.now();
  const existing = await ref.get();
  await ref.set(
    {
      email,
      userId: uid,
      firstName: firstName.trim().slice(0, 100),
      lastName: lastName.trim().slice(0, 100),
      lastLogin: now,
      createdAt: existing.exists ? existing.data()!.createdAt : now,
      updatedAt: now,
      ...(location ? {location} : {}),
      ...(isInternational ? {internationalUser: true} : {}),
      ...(existing.exists ? {} : {bookLicenses: [], licensedBookIds: []}),
    },
    {merge: true}
  );
  return {created: true};
});

const PREFERENCE_FIELDS = [
  "darkMode",
  "preferredLanguage",
  "lightColorTheme",
  "darkColorTheme",
  "notificationsEnabled",
] as const;

/**
 * Self-service appearance/locale preferences (Settings/ThemeService).
 * Strict allowlist - anything outside PREFERENCE_FIELDS is rejected, not
 * silently dropped, so a buggy (or malicious) client learns immediately.
 * Creates the doc if missing: saving your own preferences is a deliberate
 * act any signed-in patron may take.
 */
export const updateMyPreferences = onCall(async (request) => {
  const {email, uid} = callerIdentity(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const changes: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!(PREFERENCE_FIELDS as readonly string[]).includes(key)) {
      throw new HttpsError("invalid-argument", `Not a preference: ${key}`);
    }
    const expected =
      key === "darkMode" || key === "notificationsEnabled" ?
        "boolean" :
        "string";
    if (typeof value !== expected) {
      throw new HttpsError(
        "invalid-argument",
        `${key} must be a ${expected}.`
      );
    }
    changes[key] = value as string | boolean;
  }
  if (Object.keys(changes).length === 0) {
    throw new HttpsError("invalid-argument", "Nothing to update.");
  }

  const ref = db.collection("libraryUsers").doc(email);
  const now = Date.now();
  const existing = await ref.get();
  await ref.set(
    {
      email,
      userId: uid,
      ...changes,
      createdAt: existing.exists ? existing.data()!.createdAt : now,
      updatedAt: now,
      ...(existing.exists ? {} : {bookLicenses: [], licensedBookIds: []}),
    },
    {merge: true}
  );
  return {updated: true};
});
