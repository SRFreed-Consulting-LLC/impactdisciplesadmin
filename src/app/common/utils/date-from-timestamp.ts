import { fromUnixTime, isDate, isValid, parse } from 'date-fns';

export const dateFromTimestamp = (item) => {
  if (!item) {
    return null;
  }

  if (isDate(item)) {
    return item;
  }

  if (typeof item === 'string') {
    return parseStringDate(item);
  }

  let normalizedDate;

  if (item?.seconds) {
    normalizedDate = fromUnixTime(item.seconds);
  }

  return isValid(normalizedDate) ? normalizedDate : null;
};

// Single canonical "give me a sortable number" helper - use this instead of
// a private per-component toMillis(). Delegates entirely to
// dateFromTimestamp() above, so it correctly handles a real Date, a date
// string, AND a raw Firestore Timestamp (including the {seconds,
// nanoseconds}-shaped map some documents have instead of a genuine
// Timestamp instance - see the comment on FirebaseDAO.streamAll() /
// purchases.dateProcessed's own history for why that shape exists).
// Several components used to hand-roll this themselves, each covering a
// different subset of these shapes (some only handled a real Date,
// silently sorting anything else to 0/epoch) - that inconsistency is
// exactly what this consolidates away.
export const toMillis = (item: unknown): number => {
  const date = dateFromTimestamp(item);
  if (date instanceof Date) {
    return date.getTime();
  }
  // parseStringDate()'s "MM/dd/yyyy" regex (below) only handles that one
  // literal format - it doesn't match the ISO strings ("2026-01-30T02:00:00")
  // most `events` documents actually store startDate as, so those still fall
  // through unparsed even after fixing the regex's literal-not-digit typo
  // (2026-08-12 fullsweep fix - it used to never match anything at all).
  // This fallback covers ISO/native-Date-parseable strings and numbers;
  // between the two, dateFromTimestamp()'s string branch now handles every
  // real date shape seen in this app's data.
  if (typeof item === 'string' || typeof item === 'number') {
    const fallback = new Date(item);
    if (!isNaN(fallback.getTime())) {
      return fallback.getTime();
    }
  }
  return 0;
};

const parseStringDate = (dateString: string): null | Date | string => {
  //console.warn('Wrong Date format detected: all dates must be stored as Timestamp in DB', dateString);

  if (!dateString) {
    return null;
  }
  if (dateString.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const date = parse(dateString, 'MM/dd/yyyy', new Date());
    return isValid(date) ? date : null;
  }
  //console.warn('Wrong date format detected: unsupported string format', dateString);
  return dateString;
};
