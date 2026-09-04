// Canonicalises a country into the ISO alpha-2 code, the same convention
// scripts/lib/state-code.js applies to US states and for the same reason.
//
// This is the OTHER HALF of the 2026-09-03 production incident. The
// storefront checkout stored its dropdown display value - "United States" -
// and functions/src/utils/shipping-request.ts forwarded it verbatim as
// country_code. ShipEngine saw a ship-to country that did not equal the
// ship-from "US", classified every parcel as international and refused each
// label with "Customs items are required". Every Print Label click on
// production failed. countryCode() was added there to translate on the way
// out; this normalises the stored value so that translation is a guard
// rather than the thing holding shipping together.
//
// A DELIBERATE DUPLICATE of that function, same reasoning as state-code.js:
// scripts/ is plain Node with no build step and cannot import the
// submodule's TypeScript or functions' compiled output.

const path = require("path");
const fs = require("fs");

const ENUM_PATH = path.join(
  __dirname, "..", "..", "src", "common", "src", "shared", "lists", "countries.enum.ts"
);

/**
 * Reads the shared Countries enum as {CODE: "Name"}.
 * @return {Object<string,string>} Code-to-name map.
 */
function loadCountries() {
  const src = fs.readFileSync(ENUM_PATH, "utf8");
  const pairs = [...src.matchAll(/["']([A-Z]{2})["']\s*=\s*["']([^"']+)["']/g)]
    .map((m) => [m[1], m[2]]);
  if (pairs.length < 200) {
    throw new Error(
      `Parsed only ${pairs.length} countries from ${ENUM_PATH} - expected 200+. ` +
      "The enum's shape changed; fix this parser rather than running a " +
      "migration that would silently leave countries unconverted."
    );
  }
  return Object.fromEntries(pairs);
}

const COUNTRIES = loadCountries();
const KNOWN_CODES = new Set(Object.keys(COUNTRIES));
const CODE_BY_NAME = new Map(
  Object.entries(COUNTRIES).map(([code, name]) => [name.toLowerCase(), code])
);

// Spellings people and old imports actually use that the enum does not
// carry. "USA" is live on 11 documents (organizations, locations, and the
// denormalised event venue) and is NOT in the enum - so countryCode() would
// pass it straight through to the vendor, which is the same failure the
// incident above was about, just waiting on a different record.
const ALIASES = {
  "usa": "US",
  "u.s.a.": "US",
  "u.s.": "US",
  "us": "US",
  "united states of america": "US",
  "america": "US",
  "uk": "GB",
  "u.k.": "GB",
  "great britain": "GB",
  "england": "GB",
};

for (const [name, code] of Object.entries(ALIASES)) {
  CODE_BY_NAME.set(name, code);
}

/**
 * Canonicalises one stored country value.
 *
 * Same four outcomes as toStateCode(), and the same rule for the last one:
 * anything unrecognised is LEFT UNCHANGED and reported, never guessed at and
 * never blanked. Mislabelling a country is how a domestic label gets bought
 * for a foreign address.
 *
 * @param {*} raw The value as stored.
 * @return {{value: *, status: string, note?: string}} Outcome.
 */
function toCountryCode(raw) {
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
  if (upper.length === 2 && KNOWN_CODES.has(upper)) {
    // Length-checked before the code lookup, unlike states: two-letter
    // country codes collide with nothing here, but a three-letter "USA"
    // upper-cases to something that is not a code and must fall through to
    // the alias table rather than being mistaken for one.
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
    // An alias is worth calling out separately from a plain enum name -
    // "USA" was a third spelling nobody had catalogued.
    const isAlias = ALIASES[trimmed.toLowerCase()] !== undefined &&
      COUNTRIES[byName] !== undefined &&
      COUNTRIES[byName].toLowerCase() !== trimmed.toLowerCase();
    return isAlias ?
      {
        value: byName,
        status: "cleaned",
        note: `alias ${JSON.stringify(raw)} -> "${byName}"`,
      } :
      {value: byName, status: "converted"};
  }

  const stripped = trimmed.replace(/^[\s"'`.,;:()[\]]+|[\s"'`.,;:()[\]]+$/g, "");
  if (stripped && stripped !== trimmed) {
    const inner = toCountryCode(stripped);
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

module.exports = {toCountryCode, COUNTRIES, KNOWN_CODES};
