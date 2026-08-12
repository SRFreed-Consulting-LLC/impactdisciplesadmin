// Pre-suppresses the "new" bell/dashboard indicator (newRecordStatus) and,
// for purchases, the physical-fulfillment workflow status too, for records
// that are old enough a human doesn't need to be alerted about them.
//
// Mechanism: new-record-alerts.functions.ts's onCreate trigger only sets
// newRecordStatus (and bumps the meta/newRecordCounts aggregate) if the doc
// doesn't already have that field set; purchase-fulfillment.functions.ts's
// onCreate trigger works the same way for fulfillmentStatus. So baking the
// suppressed value into the doc BEFORE it's created (i.e. during import,
// not as a follow-up fix) means the triggers see the field already set and
// skip - no "2000+ new" badge flood, no follow-up cleanup pass needed.
//
// Without this, reimporting years of historical Prod purchases/event-
// registrations into a freshly wiped Dev would mark literally all of them
// "new" - not useful, since none of them are actually new to staff.

const OLD_PURCHASE_CUTOFF = new Date("2026-08-01T00:00:00Z");

/**
 * Mirrors purchase-fulfillment.functions.ts's own hasPhysicalItem() check -
 * kept in sync deliberately, not imported, since this is plain JS run
 * outside the functions/ TypeScript build.
 * @param {Array<{isEBook?: boolean, isDigitalBook?: boolean, isEvent?: boolean}>} cartItems
 * @return {boolean} Whether at least one line item needs physical shipping.
 */
function hasPhysicalItem(cartItems) {
  if (!Array.isArray(cartItems)) return false;
  return cartItems.some((item) => !item.isEBook && !item.isDigitalBook && !item.isEvent);
}

/**
 * Extracts a comparable Date from a Firestore Timestamp/Date/string field,
 * already-restored (not the portable JSON form).
 * @param {*} value A date-shaped field value.
 * @return {Date|null} A Date, or null if unparseable/absent.
 */
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Suppresses the "new" indicators on a purchase doc if it's older than the
 * cutoff - see OLD_PURCHASE_CUTOFF.
 * @param {Object} data Purchase doc data (already Timestamp-restored).
 * @return {Object} Possibly-modified copy (input not mutated).
 */
function suppressOldPurchase(data) {
  const processedDate = toDate(data.dateProcessed);
  if (!processedDate || processedDate >= OLD_PURCHASE_CUTOFF) {
    return data;
  }
  const out = {...data, newRecordStatus: "seen"};
  if (hasPhysicalItem(data.cartItems)) {
    out.fulfillmentStatus = "closed";
  }
  return out;
}

/**
 * Suppresses the "new" indicator on an event-registration doc if the event
 * it's registered for has already started (per the events collection's own
 * startDate field).
 * @param {Object} data Event-registration doc data.
 * @param {Map<string, Date|null>} eventStartDatesById Map of event doc id ->
 * that event's startDate (already Timestamp-restored, or null if missing).
 * @param {Date} now Reference "now" to compare against (injected for
 * testability/determinism, not just `new Date()` inline).
 * @return {Object} Possibly-modified copy (input not mutated).
 */
function suppressPastEventRegistration(data, eventStartDatesById, now) {
  const eventStart = eventStartDatesById.get(data.eventId);
  if (!eventStart || eventStart >= now) {
    return data;
  }
  return {...data, newRecordStatus: "seen"};
}

module.exports = {
  OLD_PURCHASE_CUTOFF,
  hasPhysicalItem,
  toDate,
  suppressOldPurchase,
  suppressPastEventRegistration,
};
