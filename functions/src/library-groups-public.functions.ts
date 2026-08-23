/* eslint-disable camelcase -- endpoint names are URL-visible and follow
   the repo's snake_case onRequest convention (newsletter_archive,
   lookup_coupon, ...). */
import {onRequest} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {
  PublicGroupSummary,
  SearchImpactGroupsResult,
} from "./common/shared/contract/web-http.types";

// The public Impact Group finder's only data source.
//
// firestore.rules gates every `discussionGroups` read behind signedIn(),
// and the public web site has no Firebase Auth at all - so it cannot query
// Firestore for groups, full stop. This function reads with the Admin SDK
// (which bypasses rules) and returns a deliberately narrow PROJECTION.
//
// What it must never return, and why:
//   - onlineInfo: free text that in practice holds meeting links and
//     passwords. Publishing it hands anyone a way into a private meeting.
//   - creatorEmail, and anything from the members subcollection: PII, and
//     never needed to decide whether to join.
//   - address1 unless the leader set addressVisible - that flag is their
//     recorded choice and this honours it exactly.
// Leader identity is reduced to "Matthew F." so a public, indexable page
// never ties a full name to a meeting place and time.
//
// Excluded rows: anything not `status === 'open'`, and anything
// `groupVisibility === 'invite-only'`. Note the reader only filters
// invite-only client-side; for anonymous traffic this makes it real.
//
//   GET /search_impact_groups?q=&bookId=&meeting=&lat=&lng=&radiusMi=
//                            &startsWithin=&limit=&cursor=

// Resolved lazily, not at module scope: the pure helpers below are
// imported directly by test/group-search-public.test.js, which has no
// Firebase app - a top-level getFirestore() throws on that import alone.
let dbInstance: FirebaseFirestore.Firestore | undefined;
const db = () => (dbInstance ??= getFirestore());

/** Safety-net cap on how many groups we scan, mirroring the shared
 *  discussion-group-queries' ALL_GROUPS_SAFETY_LIMIT. Far above today's
 *  real scale; it only bounds truly unbounded growth. */
const SCAN_LIMIT = 1000;
const DEFAULT_PAGE = 24;
const MAX_PAGE = 60;
/** How long a built projection is reused. Groups change slowly and this is
 *  an unauthenticated public endpoint, so a short window absorbs bursts
 *  without making a new group feel missing. */
const CACHE_TTL_MS = 60000;

/**
 * Derives how a group meets. Not a stored field - it follows from which of
 * location/inPersonLocation/onlineInfo the document carries.
 * @param {FirebaseFirestore.DocumentData} g Group document data.
 * @return {"in-person" | "online" | "hybrid" | "none"} Meeting type.
 */
export function meetingTypeOf(
  g: FirebaseFirestore.DocumentData
): "in-person" | "online" | "hybrid" | "none" {
  const inPerson = !!g.location || !!g.inPersonLocation;
  const online = !!g.onlineInfo;
  if (inPerson && online) return "hybrid";
  if (online) return "online";
  if (inPerson) return "in-person";
  return "none";
}

/**
 * Reduces a leader's display name to a public label: first name plus last
 * initial. Falls back to a generic label rather than ever publishing an
 * email, which is PII.
 * @param {unknown} displayName The stored creatorDisplayName.
 * @return {string} Public label, e.g. "Matthew F."
 */
export function leaderLabel(displayName: unknown): string {
  const name = typeof displayName === "string" ? displayName.trim() : "";
  if (!name) return "An Impact Group leader";
  // createGroup falls back to the caller's email when no display name was
  // supplied, so an email genuinely does reach this field.
  if (name.includes("@")) return "An Impact Group leader";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return parts[0] + " " + last.charAt(0).toUpperCase() + ".";
}

/**
 * Great-circle distance in miles.
 * @param {number} lat1 Origin latitude.
 * @param {number} lng1 Origin longitude.
 * @param {number} lat2 Target latitude.
 * @param {number} lng2 Target longitude.
 * @return {number} Distance in miles.
 */
export function distanceMiles(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const earthRadiusMi = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadiusMi * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Whether a group is eligible to appear publicly at all.
 * @param {FirebaseFirestore.DocumentData} g Group document data.
 * @return {boolean} True when open and not invite-only.
 */
export function isPubliclyListed(g: FirebaseFirestore.DocumentData): boolean {
  // Always test === 'invite-only'; an absent value means public, and
  // !== 'public' would wrongly hide every pre-field group.
  return g.status === "open" && g.groupVisibility !== "invite-only";
}

/**
 * Builds the public projection of one group. Everything withheld is
 * withheld here, in one place.
 * @param {string} id Group document id.
 * @param {FirebaseFirestore.DocumentData} g Group document data.
 * @param {string | undefined} bookTitle Resolved book title.
 * @return {PublicGroupSummary} The projection.
 */
export function toPublicSummary(
  id: string,
  g: FirebaseFirestore.DocumentData,
  bookTitle?: string
): PublicGroupSummary {
  const loc = g.location as Record<string, unknown> | undefined;
  const addressVisible = !!loc && loc.addressVisible === true;
  const maxMembers =
    typeof g.maxMembers === "number" ? g.maxMembers : undefined;
  const memberCount = typeof g.memberCount === "number" ? g.memberCount : 0;
  const meeting = meetingTypeOf(g);
  return {
    id,
    title: typeof g.title === "string" ? g.title : "",
    ...(typeof g.description === "string" && g.description ?
      {description: g.description} : {}),
    bookId: typeof g.bookId === "string" ? g.bookId : "",
    ...(bookTitle ? {bookTitle} : {}),
    // 'none' is not a public meeting type - a group with no signal at all
    // is surfaced as in-person, which is what it almost certainly is (see
    // the createGroup location bug scripts/audit-group-locations.js
    // documents).
    meetingType: meeting === "none" ? "in-person" : meeting,
    ...(loc && typeof loc.city === "string" ? {city: loc.city} : {}),
    ...(loc && typeof loc.state === "string" ? {state: loc.state} : {}),
    ...(loc && typeof loc.country === "string" ? {country: loc.country} : {}),
    // Only when the leader opted in. Deliberately never falls back to
    // inPersonLocation: that legacy free text is often a full street
    // address with no visibility flag attached to it.
    ...(addressVisible && typeof loc?.address1 === "string" ?
      {address1: loc.address1 as string} : {}),
    // Kept even for a hidden address - distance search must work either
    // way; only display code checks visibility.
    ...(loc && typeof loc.lat === "number" && typeof loc.lng === "number" ?
      {lat: loc.lat as number, lng: loc.lng as number} : {}),
    startDate: typeof g.startDate === "number" ? g.startDate : 0,
    ...(typeof g.startTimeZone === "string" ?
      {startTimeZone: g.startTimeZone} : {}),
    leaderLabel: leaderLabel(g.creatorDisplayName),
    // memberCount includes the creator; maxMembers deliberately excludes
    // them (see the model), so back the creator out before subtracting.
    ...(maxMembers !== undefined ? {
      spotsLeft: Math.max(0, maxMembers - Math.max(0, memberCount - 1)),
      maxMembers,
    } : {}),
  };
}

/**
 * Free-text match over the fields a searcher would plausibly type.
 * @param {PublicGroupSummary} s The projection.
 * @param {string} q Lowercased search text.
 * @param {function(string): (string | undefined)} stateName Code to name.
 * @return {boolean} True on a match.
 */
export function matchesText(
  s: PublicGroupSummary,
  q: string,
  stateName: (code: string) => string | undefined
): boolean {
  if (!q) return true;
  const haystack = [
    s.title,
    s.description,
    s.bookTitle,
    s.city,
    s.state,
    s.state ? stateName(s.state) : undefined,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

// Minimal code -> name map so "Georgia" finds a group stored as "GA". Kept
// local rather than importing the submodule's us-states list, which is an
// Angular-facing module functions/ does not sync in.
const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const stateNameOf = (code: string) => US_STATE_NAMES[code.toUpperCase()];

let cache: {at: number; groups: PublicGroupSummary[]} | undefined;

/** Test seam: drops the memo so a test never sees a previous run's data. */
export function clearPublicGroupCache(): void {
  cache = undefined;
}

/**
 * Loads and projects every publicly listed group, memoised for CACHE_TTL_MS.
 * @return {Promise<PublicGroupSummary[]>} The projections.
 */
async function loadPublicGroups(): Promise<PublicGroupSummary[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.groups;
  }
  const snap = await db().collection("discussionGroups")
    .orderBy("startDate")
    .limit(SCAN_LIMIT)
    .get();
  const listed = snap.docs.filter((d) => isPubliclyListed(d.data()));

  // Book titles live under librarySeries/{s}/books/{b}; one collection-group
  // read beats one get() per group.
  const titles = new Map<string, string>();
  if (listed.length) {
    const books = await db().collectionGroup("books").get();
    for (const b of books.docs) {
      const title = b.data().title;
      if (typeof title === "string") titles.set(b.id, title);
    }
  }

  const groups = listed.map((d) =>
    toPublicSummary(d.id, d.data(), titles.get(d.data().bookId)));
  cache = {at: Date.now(), groups};
  return groups;
}

/**
 * Parses a numeric query-string param, rejecting blanks and non-numbers.
 * @param {unknown} v Raw query value.
 * @return {number | undefined} The number, or undefined.
 */
function num(v: unknown): number | undefined {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const search_impact_groups = onRequest(async (request, response) => {
  // CORS-open like newsletter_archive: public, read-only, and carrying
  // nothing a cross-origin reader could not already see on the site.
  response.set("Access-Control-Allow-Origin", "*");
  if (request.method === "OPTIONS") {
    response.set("Access-Control-Allow-Methods", "GET");
    response.set("Access-Control-Max-Age", "3600");
    response.status(204).send("");
    return;
  }
  if (request.method !== "GET") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const q = String(request.query.q ?? "").trim().toLowerCase();
    const bookId = String(request.query.bookId ?? "").trim();
    const meeting = String(request.query.meeting ?? "").trim();
    const lat = num(request.query.lat);
    const lng = num(request.query.lng);
    const radiusMi = num(request.query.radiusMi) ?? 25;
    const startsWithin = num(request.query.startsWithin);
    const limit = Math.min(
      MAX_PAGE, Math.max(1, num(request.query.limit) ?? DEFAULT_PAGE));
    const offset = Math.max(0, num(request.query.cursor) ?? 0);

    let groups = await loadPublicGroups();

    if (bookId) {
      groups = groups.filter((g) => g.bookId === bookId);
    }
    if (meeting === "in-person" || meeting === "online" ||
        meeting === "hybrid") {
      groups = groups.filter((g) => g.meetingType === meeting);
    }
    if (startsWithin !== undefined) {
      const cutoff = Date.now() + startsWithin * 86400000;
      groups = groups.filter((g) => g.startDate <= cutoff);
    }
    if (q) {
      groups = groups.filter((g) => matchesText(g, q, stateNameOf));
    }
    if (lat !== undefined && lng !== undefined) {
      // A group with no coordinates cannot be shown to be within the
      // radius, so it is excluded rather than guessed at.
      groups = groups
        .filter((g) => g.lat !== undefined && g.lng !== undefined)
        .map((g) => ({
          ...g,
          distanceMi: Math.round(
            distanceMiles(lat, lng, g.lat as number, g.lng as number) * 10
          ) / 10,
        }))
        .filter((g) => (g.distanceMi as number) <= radiusMi)
        .sort((a, b) => (a.distanceMi as number) - (b.distanceMi as number));
    }

    const page = groups.slice(offset, offset + limit);
    const result: SearchImpactGroupsResult = {
      groups: page,
      total: groups.length,
      ...(offset + limit < groups.length ?
        {nextCursor: String(offset + limit)} : {}),
    };
    // Short public cache, matching CACHE_TTL_MS so the CDN never serves
    // staler data than the function itself would build.
    response.set("Cache-Control", "public, max-age=60");
    response.status(200).json(result);
  } catch (error) {
    console.error("search_impact_groups failed:", error);
    response.status(500).json({error: "Unable to search groups right now."});
  }
});
