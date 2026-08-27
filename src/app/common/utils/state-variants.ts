import { States } from '@impact-common/shared/lists/states.enum';

/**
 * Every spelling a US state may be STORED as, given the one value a report's
 * picker offers.
 *
 * The reports' state pickers are built from `EnumHelper.getStateTypesAsArray()`,
 * which yields full names ("Georgia"). The data is not consistent with that:
 *
 *   purchases   1711 full names,  4 two-letter codes
 *   customers    662 full names,  3752 two-letter codes
 *
 * So filtering Contacts by "Georgia" used to return 266 records when 2,184
 * existed - the other 1,918 are stored as "GA". Across every state the
 * full-name filter reached about 15% of contacts that have one.
 *
 * The codebase's own stated convention (see getState2LetterTypesAsArray's
 * comment: "the 2-letter code (to store) and the full name (to display)")
 * says codes are what should be stored - `customers` follows it, `purchases`
 * and the web checkout form do not. Reconciling the DATA to one spelling is
 * a separate job that would rewrite financial records and the checkout form;
 * until then a report must match either spelling, which is what this is for.
 *
 * @param state A value from a state picker - a full name or a 2-letter code.
 * @returns The distinct spellings to query for; `[]` for a blank input, and
 *   `[value]` unchanged for anything not in the States enum (a free-typed or
 *   non-US value still gets an exact-match query rather than being dropped).
 */
export function stateVariants(state: string | null | undefined): string[] {
  const value = (state ?? '').trim();
  if (!value) {
    return [];
  }
  const entries = Object.entries(States) as [string, string][];
  const lower = value.toLowerCase();
  const match =
    entries.find(([code]) => code.toLowerCase() === lower) ??
    entries.find(([, name]) => name.toLowerCase() === lower);

  if (!match) {
    return [value];
  }
  const [code, name] = match;
  // The picker's own value first so the common case is the first query.
  return Array.from(new Set([value, code, name]));
}
