import {tenantPath} from "../common/shared/lists/tenancy";
const OFFERS = tenantPath("campaign_offers");
import {DocumentData, getFirestore} from "firebase-admin/firestore";
import {toMillis} from "./date-normalize.functions";

/**
 * Server-side mirror of the shared campaign-offer resolver
 * (src/common/src/shared/models/utils/campaign-offer.model.ts).
 *
 * A mirror rather than an import for the same reason effectiveCampaignStatus
 * is one: sync-shared only copies SDK-free slices into functions, and the
 * shared model imports Timestamp from the client SDK. Keep the two in step -
 * they decide the same prices, and the shared file carries the reasoning.
 *
 * This is the AUTHORITATIVE side. What the storefront computes is a display;
 * what happens here is what a card is charged.
 */

export interface OfferDoc {
  campaignId?: string;
  target?: {kind?: string; id?: string};
  discount?: {type?: string; value?: number};
  freeShipping?: boolean;
  isActive?: boolean;
  startsAt?: unknown;
  endsAt?: unknown;
  requiresAttribution?: boolean;
}

export interface OfferSubject {
  kind: "product" | "event";
  id: string;
  series?: string | null;
}

/** @return {number} Value rounded to cents. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Every currently-active offer.
 * @return {Promise<OfferDoc[]>} The active offers.
 */
export async function getActiveOffers(): Promise<OfferDoc[]> {
  const snap = await getFirestore()
    .collection(OFFERS)
    .where("isActive", "==", true)
    .get();
  return snap.docs.map((d) => d.data() as DocumentData as OfferDoc);
}

/**
 * Whether an offer's own window is open.
 * @param {OfferDoc} offer The offer.
 * @param {number} now Milliseconds.
 * @return {boolean} True when open.
 */
function withinWindow(offer: OfferDoc, now: number): boolean {
  const startsAt = offer.startsAt ? toMillis(offer.startsAt) : 0;
  const endsAt = offer.endsAt ? toMillis(offer.endsAt) : 0;
  if (startsAt > 0 && startsAt > now) {
    return false;
  }
  return endsAt === 0 || endsAt >= now;
}

/**
 * Whether an offer's target names this subject.
 * @param {OfferDoc} offer The offer.
 * @param {OfferSubject} subject The thing being priced.
 * @return {boolean} True on a match.
 */
function targets(offer: OfferDoc, subject: OfferSubject): boolean {
  const target = offer.target;
  if (!target?.id || !target.kind) {
    return false;
  }
  if (target.kind === "series") {
    return subject.kind === "product" &&
      !!subject.series && subject.series === target.id;
  }
  if (target.kind === "product") {
    return subject.kind === "product" && subject.id === target.id;
  }
  return subject.kind === "event" && subject.id === target.id;
}

/**
 * Whether an offer applies to a subject right now.
 * @param {OfferDoc} offer The offer.
 * @param {OfferSubject} subject The thing being priced.
 * @param {number} now Milliseconds.
 * @param {string | null} attributedCampaignId The buyer's attribution.
 * @return {boolean} True when it applies.
 */
export function offerApplies(
  offer: OfferDoc,
  subject: OfferSubject,
  now: number,
  attributedCampaignId: string | null
): boolean {
  if (offer.isActive !== true || !withinWindow(offer, now)) {
    return false;
  }
  // The early-bird rule: only a buyer who reached the item through this
  // campaign gets the price. Enforced HERE as well as in the storefront,
  // because the storefront is a display and this is the charge.
  if (offer.requiresAttribution === true &&
      attributedCampaignId !== offer.campaignId) {
    return false;
  }
  return targets(offer, subject);
}

/**
 * The price a discount produces.
 * @param {number} basePrice The undiscounted price.
 * @param {OfferDoc["discount"]} discount The discount.
 * @return {number} The resulting price, to the cent.
 */
export function offerPrice(
  basePrice: number,
  discount: OfferDoc["discount"]
): number {
  const base = Number.isFinite(basePrice) ? basePrice : 0;
  if (discount?.type === "fixedPrice") {
    return round2(Math.max(0, discount.value ?? 0));
  }
  const percent = Math.min(100, Math.max(0, discount?.value ?? 0));
  return round2(Math.max(0, base - (base * percent) / 100));
}

/**
 * The best price among competing offers, or null when none apply.
 * @param {OfferDoc[]} offers Active offers.
 * @param {OfferSubject} subject The thing being priced.
 * @param {number} basePrice The undiscounted price.
 * @param {number} now Milliseconds.
 * @param {string | null} attributedCampaignId The buyer's attribution.
 * @return {number | null} The best price, or null.
 */
export function bestOfferPrice(
  offers: OfferDoc[],
  subject: OfferSubject,
  basePrice: number,
  now: number,
  attributedCampaignId: string | null
): number | null {
  const prices = (offers ?? [])
    .filter((offer) => offerApplies(offer, subject, now, attributedCampaignId))
    .map((offer) => offerPrice(basePrice, offer.discount));
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Whether any applicable offer grants free shipping.
 * @param {OfferDoc[]} offers Active offers.
 * @param {OfferSubject} subject The thing being priced.
 * @param {number} now Milliseconds.
 * @param {string | null} attributedCampaignId The buyer's attribution.
 * @return {boolean} True when shipping is free.
 */
export function grantsFreeShipping(
  offers: OfferDoc[],
  subject: OfferSubject,
  now: number,
  attributedCampaignId: string | null
): boolean {
  return (offers ?? []).some((offer) =>
    offer.freeShipping === true &&
    offerApplies(offer, subject, now, attributedCampaignId));
}
