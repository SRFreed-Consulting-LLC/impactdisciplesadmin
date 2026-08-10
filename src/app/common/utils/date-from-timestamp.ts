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
  // dateFromTimestamp()'s own string branch has a known bug (see
  // parseStringDate()'s comment below) - its "is this MM/dd/yyyy" check
  // can never match, so any date string that isn't already a Date/Timestamp
  // falls through unparsed. Confirmed live against real data: `events`
  // documents mostly store startDate as a plain ISO string
  // ("2026-01-30T02:00:00"), not a Timestamp - without this fallback,
  // toMillis() would silently treat most real events as epoch/0 instead of
  // their actual date. Not fixing parseStringDate() itself here (same
  // "guard at the call site, don't touch the shared utility" call made
  // earlier this session for the identical bug in
  // CustomerDialogComponent.getEventDate()) - narrower blast radius than
  // changing a helper a dozen other services' fromFirestore hooks rely on.
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
  if (dateString.match(/dd\/dd\/dddd/)) {
    const date = parse(dateString, 'MM/dd/yyyy', new Date());
    return isValid(date) ? date : null;
  }
  //console.warn('Wrong date format detected: unsupported string format', dateString);
  return dateString;
};
