// Normalizes the date fields MIGRATION.md documented as existing in 3
// inconsistent shapes in the same collection (real Timestamp / malformed
// {seconds,nanoseconds} map / plain string). Scoped to fields actually
// confirmed affected by a live sweep of BOTH projects - don't guess at
// others; extend FIELDS_BY_COLLECTION deliberately if more turn up.
//
// 2026-08-27: swept every field of every collection for mixed types and
// added the two that turned up.
//
// 2026-09-04: THIS NOW WALKS ARRAYS, and that is the whole of what was left.
// The previous version said only top-level fields belonged here, and
// deliberately left the two nested offenders alone -
// purchases.cartItems[].dateProcessed and customers.notes[].date - on the
// grounds that nothing read the first and dateFromTimestamp() covered the
// second. A fresh sweep of dev and prod showed that reasoning had quietly
// stopped being true of the SET: every remaining malformed value in either
// project was nested inside an array, so "we do not walk arrays" had become
// "we do not fix anything". A path may contain ONE `[]` segment
// (`cartItems[].dateProcessed`); no field in this data needs two, and a
// walker that guesses at arbitrary depth is a walker nobody can review.
//
// EPOCH-MILLIS NUMBERS ARE NOT IN SCOPE AND MUST NOT BE ADDED. The library
// and reader collections (libraryUsers, discussionGroups, commonTranslations,
// errorLogs, groupLicenses, ...) store dates as bare epoch-millisecond
// numbers - about 3,400 fields of them. That is a consistent, deliberate
// convention on that side of the app, and the reader reads them as numbers
// (see DigitalBookUserReportComponent, which does `new Date(user.createdAt)`
// precisely because they are numbers). Converting them would break the
// reader, not fix it.
//
// CAUTION on naive strings: `events.endDate` values like "2025-09-29T03:00:00"
// carry no timezone and therefore parse as LOCAL time. Run this from the
// ministry's own timezone (America/New_York) or the converted instant
// shifts; assertLocalTimezone() below refuses rather than trusting you to
// have remembered. Converting preserves whatever was displayed before -
// including on the 13 events whose stored end time is 12 hours early (a lost
// PM marker: a 9-to-3 seminar written as T03:00:00). Those are a separate
// DATA correctness problem, deliberately not touched here, and still
// outstanding.

const FIELDS_BY_COLLECTION = {
  purchases: [
    "dateProcessed",
    "refundedAt",
    // 882 malformed maps in both dev and prod - the single largest
    // remaining pocket, and the one the old top-level-only walker could not
    // see.
    "cartItems[].dateProcessed",
    "statusHistory[].date",
    "refunds[].date",
  ],
  events: [
    "startDate",
    "endDate",
    "agendaItems[].startDate",
    "agendaItems[].endDate",
  ],
  "event-registrations": ["registrationDate", "receiptEmailDate"],
  customers: [
    "newsletterSubscribedDate",
    "prayerTeamSubscribedDate",
    "notes[].date",
    "pendingChanges[].detectedDate",
  ],
};

/**
 * Refuses to run outside the timezone the naive date strings were written
 * in.
 *
 * A naive "2025-09-29T03:00:00" means 3am WHERE IT WAS TYPED. Parsed
 * anywhere else it silently becomes a different instant, and the damage is
 * invisible - every value still looks like a plausible date.
 * @param {string} [expected] IANA zone the data was authored in.
 */
function assertLocalTimezone(expected = "America/New_York") {
  const actual = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (actual !== expected) {
    throw new Error(
      `Refusing to convert naive date strings from timezone "${actual}". ` +
      `They were written as local time in "${expected}" and would shift. ` +
      `Re-run with TZ=${expected}.`
    );
  }
}

/** True for an ISO-ish string carrying no timezone designator. */
function isNaiveString(s) {
  return typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}[T ]/.test(s) &&
    !/(Z|[+-]\d{2}:?\d{2})$/.test(s);
}

/**
 * Normalizes one field value into a real Firestore Timestamp if it is not
 * already one.
 * @param {*} value The raw field value.
 * @param {typeof import("firebase-admin").firestore} firestoreNs
 * `admin.firestore` namespace (for the Timestamp constructor).
 * @return {{value: *, changed: boolean, warning?: string}} The (possibly
 * unchanged) value, whether it was changed, and an optional warning if a
 * string value could not be parsed as a date.
 */
function normalizeValue(value, firestoreNs) {
  if (value === null || value === undefined) {
    return {value, changed: false};
  }
  if (value instanceof firestoreNs.Timestamp) {
    return {value, changed: false};
  }
  // Malformed plain map - e.g. what you get back after a naive
  // JSON.stringify/parse round-trip of a real Timestamp, with no
  // Timestamp prototype attached.
  if (typeof value === "object" && !Array.isArray(value) &&
      typeof value.seconds === "number" && typeof value.nanoseconds === "number") {
    return {
      value: new firestoreNs.Timestamp(value.seconds, value.nanoseconds),
      changed: true,
    };
  }
  if (value instanceof Date) {
    return {value: firestoreNs.Timestamp.fromDate(value), changed: true};
  }
  if (typeof value === "string") {
    if (!value.trim()) {
      return {value, changed: false};
    }
    if (isNaiveString(value)) {
      assertLocalTimezone();
    }
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return {value: firestoreNs.Timestamp.fromDate(parsed), changed: true};
    }
    return {value, changed: false, warning: `unparseable date string "${value}"`};
  }
  // A NUMBER IS LEFT ALONE - see this file's header. Epoch millis are the
  // library side's deliberate convention, not damage.
  return {value, changed: false};
}

/**
 * Normalizes every known-affected date field on one document's data.
 * @param {string} collectionName Collection the doc belongs to.
 * @param {Object} data Document data (already Timestamp/GeoPoint-restored,
 * not the portable JSON form).
 * @param {typeof import("firebase-admin").firestore} firestoreNs
 * `admin.firestore` namespace.
 * @return {{data: Object, changed: boolean, warnings: string[]}} A new data
 * object (input is not mutated), whether anything changed, and any
 * unparseable-value warnings.
 */
function normalizeDoc(collectionName, data, firestoreNs) {
  const fields = FIELDS_BY_COLLECTION[collectionName];
  if (!fields || !data) {
    return {data, changed: false, warnings: []};
  }
  let changed = false;
  const warnings = [];
  const out = {...data};

  for (const field of fields) {
    const split = field.indexOf("[].");

    if (split === -1) {
      if (!(field in out)) continue;
      const result = normalizeValue(out[field], firestoreNs);
      out[field] = result.value;
      if (result.changed) changed = true;
      if (result.warning) warnings.push(`${collectionName}.${field}: ${result.warning}`);
      continue;
    }

    const arrayKey = field.slice(0, split);
    const leaf = field.slice(split + 3);
    const source = out[arrayKey];
    if (!Array.isArray(source)) continue;

    // Copy-on-write: the array, and only the elements that actually change,
    // are rebuilt - so an untouched document comes back identical and a
    // caller comparing before/after sees no phantom diff.
    let arrayChanged = false;
    const next = source.map((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) return element;
      if (!(leaf in element)) return element;
      const result = normalizeValue(element[leaf], firestoreNs);
      if (result.warning) {
        warnings.push(`${collectionName}.${field}: ${result.warning}`);
      }
      if (!result.changed) return element;
      arrayChanged = true;
      return {...element, [leaf]: result.value};
    });

    if (arrayChanged) {
      out[arrayKey] = next;
      changed = true;
    }
  }

  return {data: out, changed, warnings};
}

module.exports = {
  normalizeDoc,
  normalizeValue,
  FIELDS_BY_COLLECTION,
  assertLocalTimezone,
  isNaiveString,
};
