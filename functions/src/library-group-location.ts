// Narrows a client-supplied structured location into the exact shape
// DiscussionGroupLocation defines (see the shared model at
// src/common/src/models/discussion-group.model.ts).
//
// Extracted from createGroup so it can be unit-tested. The inline version
// this replaces accepted "public-place"/"home" - values no client has ever
// sent, since both the shared model and the create wizard use
// 'public' | 'private' - so `locationType` always resolved to undefined and
// the whole location object was silently dropped on every create. Groups
// came out with no city, state, address or coordinates, leaving city text
// search and distance search nothing to match.

/** Signature of createGroup's own cleanText helper. Passed in rather than
 *  imported so this stays pure and independent of the callable module. */
type CleanText = (value: unknown, max?: number) => string | undefined;

/**
 * Builds the `location` object to store, or undefined when the input is not
 * a usable structured location - in which case the caller writes no
 * `location` field at all, same as before.
 * @param {unknown} raw The client-supplied location value.
 * @param {CleanText} cleanText createGroup's trim/slice helper.
 * @return {Record<string, unknown> | undefined} The narrowed location.
 */
export function normalizeGroupLocation(
  raw: unknown,
  cleanText: CleanText,
): Record<string, unknown> | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const country = cleanText(r.country, 100);
  const city = cleanText(r.city, 100);
  const locationType =
    r.locationType === "public" || r.locationType === "private" ?
      r.locationType :
      undefined;
  if (!country || !city || !locationType) {
    return undefined;
  }
  const state = cleanText(r.state, 100);
  const address1 = cleanText(r.address1, 200);
  return {
    country,
    city,
    locationType,
    // A public venue's address is inherently fine to show, so that case is
    // forced true here; for a private location this is the creator's
    // explicit opt-in, defaulting to hidden.
    addressVisible: locationType === "public" || r.addressVisible === true,
    ...(state ? {state} : {}),
    ...(address1 ? {address1} : {}),
    // Stored regardless of addressVisible - distance search must work even
    // for a privacy-hidden address; only display code checks visibility.
    ...(typeof r.lat === "number" && typeof r.lng === "number" ?
      {lat: r.lat, lng: r.lng} :
      {}),
  };
}
