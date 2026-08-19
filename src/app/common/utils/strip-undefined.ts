// Firestore rejects an entire write if ANY field, however deeply nested, is
// explicitly `undefined` ("Unsupported field value: undefined") - and
// FirebaseDAO.update() setDoc()s the whole object, so one stray undefined
// buried in a nested structure fails the save. See CLAUDE.md's "Firestore
// write gotcha". Models should use `null` for "unset" in the first place;
// this is the belt-and-braces sweep run over complex documents (e.g. the
// email designer's EmailDesign tree) just before persisting.
//
// Only plain objects and arrays are recursed into - class instances
// (Timestamp, Date, etc.) are passed through untouched.
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && (value as object).constructor === Object) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) {
        result[key] = stripUndefinedDeep(entry);
      }
    }
    return result as T;
  }
  return value;
}
