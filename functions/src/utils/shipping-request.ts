// Allowlist for the body of get_shipping_rates (sweep finding S4).
//
// That endpoint is UNAUTHENTICATED - it has to be, the storefront prices
// shipping before anyone has an account - and it hands its body to a
// CREDENTIALED ShipEngine client. Until 2026-08-28 it forwarded
// request.body verbatim, so an anonymous caller chose what our billing
// account was asked to do.
//
// The approach here is to REBUILD the request from named fields rather
// than to reject unknown ones. Rejecting means predicting what an
// attacker sends; rebuilding means knowing only what WE send, which is
// pinned by ShippingRequest in the shared submodule
// (models/domain/shipment.model.ts). Anything not named below simply
// never reaches the vendor.
//
// Keep this in step with that model: a field added there and not here is
// silently dropped, which surfaces as ShipEngine rejecting a quote rather
// than as a type error. shipping-request.test.js is the guard.

import {Countries} from "../common/shared/lists/countries.enum";

type Dict = Record<string, unknown>;

// Caps exist so a single anonymous request cannot turn into an expensive
// vendor call. They are far above anything a real cart produces.
const MAX_STR = 100;
const MAX_CARRIERS = 10;
const MAX_PACKAGES = 20;

// Every address field either storefront sends. shipTo and shipFrom use
// overlapping but not identical subsets, so one list covers both and the
// absent ones are simply not copied.
const ADDRESS_FIELDS = [
  "companyName",
  "name",
  "phone",
  "addressLine1",
  "addressLine2",
  "cityLocality",
  "stateProvince",
  "postalCode",
  "countryCode",
  "addressResidentialIndicator",
] as const;

/**
 * Narrows an unknown to a plain object (not null, not an array).
 * @param {unknown} v Value to test.
 * @return {boolean} True when v is a plain object.
 */
function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Accepts a non-empty string, trimmed and truncated to MAX_STR.
 * @param {unknown} v Value to coerce.
 * @return {string|undefined} The clean string, or undefined.
 */
function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, MAX_STR) : undefined;
}

// Country NAME -> ISO alpha-2 code, lower-cased, built once from the shared
// Countries enum (whose keys are the codes and values the names the
// storefront's dropdown shows).
const CODE_BY_NAME = new Map<string, string>(
  Object.entries(Countries).map(([code, name]) => [name.toLowerCase(), code])
);
const KNOWN_CODES = new Set(Object.keys(Countries));

/**
 * Normalises a stored country into the ISO alpha-2 code ShipEngine wants.
 *
 * REGRESSION, 2026-09-03. The storefront's checkout stores the country as
 * the dropdown's DISPLAY value - "United States" - and this file forwarded
 * it verbatim as country_code. ShipEngine saw a ship-to country that did
 * not equal the ship-from's "US", classified every parcel as international
 * and refused each label with "Customs items are required". Every Print
 * Label click on production failed. The unit test fed `country: "US"`, a
 * shape no real purchase has, so it could not go red.
 *
 * Accepts a code in any case ("us"), a name in any case ("united states"),
 * or nothing (defaults to US - the org ships domestically). Anything else
 * is passed through UNCHANGED so the vendor refuses it with a message that
 * names it; silently relabelling an unknown country as US would buy a
 * domestic label for a foreign address.
 * @param {unknown} v A country as stored - code, name or absent.
 * @return {string} An ISO alpha-2 code, or the unrecognised input.
 */
export function countryCode(v: unknown): string {
  const s = str(v);
  if (!s) return "US";
  const upper = s.toUpperCase();
  if (KNOWN_CODES.has(upper)) return upper;
  return CODE_BY_NAME.get(s.toLowerCase()) ?? s;
}

/**
 * Accepts a finite, non-negative number. Rejects NaN/Infinity, which
 * would otherwise serialise into the vendor payload as null.
 * @param {unknown} v Value to coerce.
 * @return {number|undefined} The number, or undefined.
 */
function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Copies only the known address fields off an untrusted object.
 * @param {unknown} v The candidate address.
 * @return {Dict|undefined} A clean address, or undefined.
 */
function address(v: unknown): Dict | undefined {
  if (!isDict(v)) return undefined;
  const out: Dict = {};
  for (const key of ADDRESS_FIELDS) {
    const s = str(v[key]);
    if (s !== undefined) out[key] = s;
  }
  // The web client sends the stored display name here too ("United
  // States"). The rates endpoint has tolerated that so far; the labels
  // endpoint did not, and depending on the difference is not a plan.
  if (out.countryCode !== undefined) {
    out.countryCode = countryCode(out.countryCode);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Rebuilds the packages array, keeping only {weight:{value,unit}}.
 * @param {unknown} v The candidate packages array.
 * @return {Dict[]|undefined} Clean packages, or undefined if none.
 */
function packages(v: unknown): Dict[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Dict[] = [];
  for (const raw of v.slice(0, MAX_PACKAGES)) {
    if (!isDict(raw) || !isDict(raw.weight)) continue;
    const w = raw.weight as Dict;
    const value = num(w.value);
    const unit = str(w.unit);
    if (value === undefined || unit === undefined) continue;
    out.push({weight: {value, unit}});
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Rebuilds a ShipEngine rate request from an untrusted body.
 *
 * Returns null when the body could not describe a real quote, so the
 * caller can answer 400 without the vendor ever being contacted.
 * @param {unknown} body The raw request body.
 * @return {Dict|null} A clean vendor payload, or null if unusable.
 */
export function sanitizeRateRequest(body: unknown): Dict | null {
  if (!isDict(body) || !isDict(body.shipment)) return null;
  const shipment = body.shipment as Dict;

  const shipTo = address(shipment.shipTo);
  const shipFrom = address(shipment.shipFrom);
  const pkgs = packages(shipment.packages);

  // A quote needs a destination, an origin and something to weigh. The
  // destination postal code is singled out because it is what the rate
  // is actually priced from - and what S3's label-time destination check
  // will later compare a stored rate against.
  if (!shipTo || !shipFrom || !pkgs) return null;
  if (!shipTo.postalCode) return null;

  const clean: Dict = {
    shipment: {
      // Never caller-controlled: both storefronts send exactly this, and
      // letting a caller turn address validation on would change what we
      // are billed for.
      validateAddress: "no_validation",
      shipTo,
      shipFrom,
      packages: pkgs,
    },
  };

  // rateOptions is optional - omitted rather than defaulted, so a caller
  // cannot widen the carrier set and we do not invent one.
  const opts = isDict(body.rateOptions) ? body.rateOptions : undefined;
  if (opts && Array.isArray(opts.carrierIds)) {
    const ids: string[] = [];
    for (const id of opts.carrierIds.slice(0, MAX_CARRIERS)) {
      const s = str(id);
      if (s !== undefined) ids.push(s);
    }
    if (ids.length > 0) clean.rateOptions = {carrierIds: ids};
  }

  return clean;
}

// ---------------------------------------------------------------------------
// Label purchase (sweep finding S3)
// ---------------------------------------------------------------------------
//
// The attack this closes: get_shipping_rates is anonymous, so anyone could
// mint a rate id against the org's ShipEngine account describing a heavy
// shipment to an address of their choosing. create_paypal_order wrote the
// client's shippingRateId onto the purchase verbatim, and get_shipping_label
// then bought a label from that id - so a $5 order could buy an attacker's
// postage, and the admin UI showed the ORDER, not the shipment the rate id
// encoded. The operator had nothing to notice.
//
// The fix is not to validate the rate id but to stop using it. The label is
// bought from SHIPMENT DETAILS we build here out of the purchase's own
// stored address and its products' own weights. The only things carried over
// from the stored rate are service_code and carrier_id, which name a service
// level and our own billing account and carry no address, so trusting them
// costs nothing. (Carrying them was always the intent; until 2026-09-02 this
// comment described it and the code did not do it - see buildLabelShipment.)
//
// Chosen over re-quoting because it is the same ONE vendor call the old
// code made - re-quoting would have doubled rate requests per shipped
// order for no additional safety (owner's call, 2026-08-28).

/**
 * Normalises a phone into the digits a carrier will accept, or undefined.
 *
 * TWO REASONS THIS IS NOT JUST str(). The org phone is stored in `config`
 * as a NUMBER (6788549322), and str() rejects anything that is not a
 * string - so the ship-from phone was being silently dropped on every
 * label. And UPS rejects a label whose ShipTo phone is under ten
 * alphanumeric characters, which is a vendor 400 the operator sees as a
 * generic failure; a value too short to be dialled is worth dropping here
 * so the rest of the label still buys.
 * @param {unknown} v A phone as stored - string, number or absent.
 * @return {string|undefined} Ten-plus digits, or undefined.
 */
export function phoneDigits(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const digits = String(v).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(0, MAX_STR) : undefined;
}

/**
 * Maps an Address (address1/city/state/zip) onto ShipEngine's field
 * names. Returns undefined when there is no usable destination.
 * @param {unknown} addr The stored Address.
 * @param {string} name Recipient name.
 * @param {unknown} phone Recipient phone.
 * @return {Dict|undefined} A ShipEngine address, or undefined.
 */
export function toShipEngineAddress(
  addr: unknown,
  name: string,
  phone?: unknown
): Dict | undefined {
  if (!isDict(addr)) return undefined;
  const postalCode = str(addr.zip);
  const addressLine1 = str(addr.address1);
  // Without these two the carrier cannot deliver and ShipEngine would
  // reject the buy anyway - fail here instead, with our own message.
  if (!postalCode || !addressLine1) return undefined;

  const out: Dict = {
    name: str(name) ?? "Customer",
    addressLine1,
    postalCode,
    // Stored as "United States" by the storefront; the vendor wants "US".
    countryCode: countryCode(addr.country),
    addressResidentialIndicator: "yes",
  };
  const line2 = str(addr.address2);
  const city = str(addr.city);
  const state = str(addr.state);
  const tel = phoneDigits(phone);
  if (line2) out.addressLine2 = line2;
  if (city) out.cityLocality = city;
  if (state) out.stateProvince = state;
  if (tel) out.phone = tel;
  return out;
}

// NO SHIP DATE IS SENT, AND ONE CANNOT BE.
//
// The SDK's own Shipment type declares `shipDate: string` as REQUIRED, but
// its formatParams() does not map the field at all - it is dropped between
// the call and the wire. ShipEngine defaults ship_date to today when it is
// absent, which is what we want anyway: the rate on the purchase was quoted
// when the shopper checked out, possibly days before anyone presses Print,
// and a carrier refuses a ship date in the past.
//
// Setting it here would look like it was being sent and would not be - the
// exact shape of the bug this file was just fixed for. Left off, and
// written down instead.

/**
 * Builds the shipment a label is bought from, entirely out of values the
 * SERVER read back from Firestore.
 *
 * WHY carrierId AND serviceCode ARE REQUIRED HERE. ShipEngine's
 * POST /v1/labels answers 400 without them - they are what decides who
 * carries the parcel and at what service level, and there is no default.
 * Between 2026-08-28 and 2026-09-02 this function omitted both: the SDK
 * client is typed `any` (it is lazily require()d, see shipping.functions),
 * so nothing caught it at compile time, the fake vendor returned 200 for
 * any body so nothing caught it in test, and EVERY label bought from the
 * Purchases workflow failed with a generic "Unable to purchase a shipping
 * label." Refusing here, before the vendor is called, is what turns that
 * back into a message that names the cause.
 * @param {object} input Server-sourced pieces of the shipment.
 * @param {Dict|undefined} input.shipTo Recipient, already mapped.
 * @param {Dict|undefined} input.shipFrom Origin, already mapped.
 * @param {number} input.totalWeightOunces Recomputed order weight.
 * @param {unknown} input.serviceCode Carrier service, e.g. "ups_ground".
 * @param {unknown} input.carrierId The ShipEngine carrier account billed.
 * @return {Dict|null} A shipment for createLabelFromShipmentDetails.
 */
export function buildLabelShipment(input: {
  shipTo: Dict | undefined;
  shipFrom: Dict | undefined;
  totalWeightOunces: number;
  serviceCode?: unknown;
  carrierId?: unknown;
}): Dict | null {
  const {shipTo, shipFrom, totalWeightOunces} = input;
  if (!shipTo || !shipFrom) return null;
  const weight = num(totalWeightOunces);
  // A zero-weight package is not a shippable thing. Refusing here beats
  // buying a label for it and finding out at the counter.
  if (weight === undefined || weight <= 0) return null;

  const serviceCode = str(input.serviceCode);
  const carrierId = str(input.carrierId);
  if (!serviceCode || !carrierId) return null;

  return {
    validateAddress: "no_validation",
    carrierId,
    serviceCode,
    shipTo,
    shipFrom,
    packages: [{weight: {value: weight, unit: "ounce"}}],
  };
}
