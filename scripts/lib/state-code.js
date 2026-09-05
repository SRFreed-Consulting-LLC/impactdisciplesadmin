// Canonicalises a US state into the two-letter code that is this codebase's
// stated storage convention.
//
// WHY CODES AND NOT NAMES. EnumHelper.getState2LetterTypesAsArray()'s own
// comment has said it all along - "the 2-letter code (to store) and the full
// name (to display)" - but only some writers followed it, so the data ended
// up split down the middle: `customers` is 85% codes, `purchases` is 99.8%
// full names. That split is not cosmetic. On 2026-09-03 it took production
// down twice in one hour: ShipEngine began enforcing "ship_to state_province
// must be two characters when country_code equals US", every rate quote
// 502'd and every Print Label failed, and functions/src/utils/
// shipping-request.ts had to grow stateCode() to translate on the way out.
// That translation stays as a boundary guard, but the vendor should never
// have been the thing that discovered our data was inconsistent.
//
// A DELIBERATE DUPLICATE of that function, for the same reason
// scripts/lib/tenancy.js duplicates the TypeScript seam: scripts/ is plain
// Node run straight from source with no build step and cannot import either
// the submodule's TypeScript or functions/'s compiled output.

const path = require("path");
const fs = require("fs");

// Parsed out of the shared enum rather than retyped. Fifty hand-copied pairs
// is fifty chances to typo one, and the failure would be silent - a state
// that simply never normalises.
const ENUM_PATH = path.join(
  __dirname, "..", "..", "src", "common", "src", "shared", "lists", "states.enum.ts"
);

/**
 * Reads the shared States enum as {CODE: "Name"}.
 * @return {Object<string,string>} Code-to-name map.
 */
function loadStates() {
  const src = fs.readFileSync(ENUM_PATH, "utf8");
  // Matched up to the SAME quote that opened it, for the reason written out
  // in country-code.js's copy of this line: `[^"']+` stops at an apostrophe.
  // No US state name contains one, so this was latent here rather than live -
  // which is exactly why the two files should be fixed together.
  const pairs = [...src.matchAll(/["']([A-Z]{2})["']\s*=\s*(["'])(.*?)\2/g)]
    .map((m) => [m[1], m[3]]);
  if (pairs.length < 50) {
    throw new Error(
      `Parsed only ${pairs.length} states from ${ENUM_PATH} - expected 50. ` +
      "The enum's shape changed; fix this parser rather than running a " +
      "migration that would silently leave states unconverted."
    );
  }
  return Object.fromEntries(pairs);
}

const STATES = loadStates();
const KNOWN_CODES = new Set(Object.keys(STATES));
const CODE_BY_NAME = new Map(
  Object.entries(STATES).map(([code, name]) => [name.toLowerCase(), code])
);

// USPS codes that are NOT among the 50 and never will be: DC, the
// territories, and the three Armed Forces "states" for military mail
// (Americas, Europe, Pacific). AA and AP are both live on real customer
// records. A normaliser that did not know them would either mangle them or
// report them as junk forever.
//
// Their NAMES are mapped too - "Puerto Rico" is a value a shopper can type,
// and leaving it unrecognised would strand it exactly as "Georgia" was
// stranded before this ran.
const EXTRA_NAMES = {
  "district of columbia": "DC",
  "washington dc": "DC",
  "washington d.c.": "DC",
  "puerto rico": "PR",
  "virgin islands": "VI",
  "us virgin islands": "VI",
  "u.s. virgin islands": "VI",
  "guam": "GU",
  "american samoa": "AS",
  "northern mariana islands": "MP",
  "armed forces americas": "AA",
  "armed forces europe": "AE",
  "armed forces pacific": "AP",
};

const EXTRA_CODES = new Set(Object.values(EXTRA_NAMES));
for (const [name, code] of Object.entries(EXTRA_NAMES)) {
  CODE_BY_NAME.set(name, code);
}

/** Every code this migration treats as already canonical. */
const ALL_CODES = new Set([...KNOWN_CODES, ...EXTRA_CODES]);

// Only wrapping punctuation and whitespace. NOT `[^A-Za-z]`, which was the
// first version and was too eager: it turned "1234 Georgia" - a street
// address typed into the state box - into "GA", inventing a state from a
// value nobody had established was one. Anything this does not resolve is
// reported as unknown and left alone, which is the outcome that keeps a
// human in the loop.
const WRAPPING = /^[\s"'`.,;:()[\]]+|[\s"'`.,;:()[\]]+$/g;

/**
 * Canonicalises one stored state value.
 *
 * Outcomes, and why each is separate rather than collapsed into "did it
 * change": a migration that cannot tell "already correct" from "gave up"
 * cannot be verified, and this one rewrites financial records.
 *
 *  - `ok`        already a canonical code, byte for byte; leave it.
 *  - `converted` a full name (any case) mapped to its code.
 *  - `cleaned`   resolved after trimming case/space/punctuation, or a
 *                "MO 65355" state+zip mash. Reported per value, never silent.
 *  - `unknown`   nothing recognisable. LEFT UNCHANGED, deliberately: a
 *                Canadian province or a free-typed value is data we do not
 *                own, and blanking it loses an address a human can read.
 *
 * @param {*} raw The value as stored.
 * @return {{value: *, status: string, note?: string}} Outcome.
 */
function toStateCode(raw) {
  if (raw === null || raw === undefined) {
    return {value: raw, status: "ok"};
  }
  if (typeof raw !== "string") {
    return {value: raw, status: "unknown", note: `non-string ${typeof raw}`};
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {value: raw, status: "ok"};
  }

  const upper = trimmed.toUpperCase();
  if (ALL_CODES.has(upper)) {
    // Compared against RAW, not the trimmed form: " GA " reads as already
    // correct the moment you compare a trimmed value to itself, and the
    // surrounding spaces then survive the migration that existed to remove
    // them. Firestore equality is byte equality; " GA " never matches "GA".
    return raw === upper ?
      {value: upper, status: "ok"} :
      {
        value: upper,
        status: "cleaned",
        note: `case/space ${JSON.stringify(raw)} -> "${upper}"`,
      };
  }

  const byName = CODE_BY_NAME.get(trimmed.toLowerCase());
  if (byName) {
    return {value: byName, status: "converted"};
  }

  // "MO 65355" - a state and a zip typed into one box. Checked BEFORE the
  // punctuation strip below so the report says what actually happened
  // ("zip dropped") rather than the vaguer "punctuation".
  const mash = trimmed.match(/^([A-Za-z]{2})[\s,]+\d{5}(-\d{4})?$/);
  if (mash) {
    const code = mash[1].toUpperCase();
    if (ALL_CODES.has(code)) {
      return {
        value: code,
        status: "cleaned",
        note: `state+zip ${JSON.stringify(raw)} -> "${code}" ` +
          "(zip dropped - it is not a state)",
      };
    }
  }

  // Junk that a strip of wrapping punctuation resolves. Live examples: `NC"`,
  // `GA"`, `Georgia"` - a stray quote that came in through some import and
  // has left those records unqueryable ever since.
  const stripped = trimmed.replace(WRAPPING, "");
  if (stripped && stripped !== trimmed) {
    const inner = toStateCode(stripped);
    // "cleaned" counts as resolved here too, not just ok/converted. The junk
    // in this data compounds: `MO 65355"` is a state+zip mash AND a stray
    // quote, so the strip hands the mash branch a value it can read. Refusing
    // an inner "cleaned" left every such value unresolved while reporting the
    // simpler `NC"` beside it as fixed.
    if (inner.status !== "unknown") {
      return {
        value: inner.value,
        status: "cleaned",
        note: `punctuation ${JSON.stringify(raw)} -> "${inner.value}"`,
      };
    }
  }

  return {value: raw, status: "unknown", note: `unrecognised ${JSON.stringify(raw)}`};
}

module.exports = {toStateCode, STATES, KNOWN_CODES, EXTRA_CODES, ALL_CODES};
