import { ProductModel } from '@impact-common/shared/models/utils/product.model';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import {
  EmailDesign,
  createBlock,
  createDefaultDesign,
  createRow,
  ButtonBlock,
  HeadingBlock,
  ImageBlock,
  TextBlock
} from 'src/app/common/models/admin/email-design.model';

// Starting content for a campaign that spotlights a product or an event
// (Campaign Manager v3).
//
// One normalizer, three renderers. A product and an event differ only in
// which fields feed the same shape - image, headline, one line of detail, a
// blurb, and a call to action - so the surfaces render from a StarterItem
// rather than each knowing about both models.
//
// The three surfaces are NOT interchangeable, which is the point of keeping
// them here together:
//   - the popup stores raw HTML,
//   - the email stores a structured block tree and compiles HTML from it,
//   - social is plain text a human pastes.
// An email starter that emitted markup would render correctly and be
// UNEDITABLE in the designer, which would defeat the feature.

export interface StarterItem {
  kind: 'product' | 'event';
  id: string;
  /** Headline - the product title or the event name. */
  title: string;
  /** One line under the headline: a price, or a date. */
  subline: string;
  /** Plain-text blurb, tags stripped, trimmed to a sensible length. */
  blurb: string;
  imageUrl: string | null;
  /** Public-site destination, WITHOUT attribution - callers decorate. */
  url: string;
  ctaLabel: string;
}

const BLURB_LIMIT = 160;

/** Tags out, whitespace collapsed, trimmed to a length that reads as a teaser. */
function toBlurb(description: string | undefined): string {
  const text = (description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > BLURB_LIMIT ? text.slice(0, BLURB_LIMIT - 3).trimEnd() + '…' : text;
}

function money(value: number): string {
  return '$' + value.toFixed(2);
}

export function productStarter(product: ProductModel, publicSiteUrl: string): StarterItem {
  // salePrice is a computed field now (campaigns own discounts), so it is the
  // live price when set and the cost otherwise - same rule the storefront uses.
  const price = product.salePrice > 0 ? product.salePrice : product.cost;

  return {
    kind: 'product',
    id: product.id ?? '',
    title: product.title ?? '',
    subline: price > 0 ? money(price) : 'Free',
    blurb: toBlurb(product.description),
    imageUrl: product.imageUrl?.url ?? null,
    url: `${publicSiteUrl}/product-details/${product.id}`,
    ctaLabel: 'Shop Now'
  };
}

export function eventStarter(event: EventModel, publicSiteUrl: string): StarterItem {
  const date = dateFromTimestamp(event.startDate as never);
  const venue = event.venue?.name ?? '';
  const when = date
    ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  return {
    kind: 'event',
    id: event.id ?? '',
    title: event.eventName ?? '',
    // Date and place read as one line; either half may be missing.
    subline: [when, venue].filter(Boolean).join(' · '),
    blurb: toBlurb(event.description),
    imageUrl: event.imageUrl?.url ?? null,
    url: `${publicSiteUrl}/event-details/${event.id}`,
    ctaLabel: 'Register Now'
  };
}

// ---------------------------------------------------------------- popup

/**
 * Popup body markup.
 *
 * Inline-styled so it renders identically in the editor, the preview and the
 * storefront's [innerHTML] - none of which share a stylesheet.
 */
export function starterPopupHtml(item: StarterItem): string {
  const image = item.imageUrl
    ? `<p style="text-align:center;"><img src="${item.imageUrl}" style="max-width:60%;" alt="${item.title}"></p>`
    : '';
  const subline = item.subline
    ? `<p style="text-align:center;"><strong>${item.subline}</strong></p>`
    : '';
  const blurb = item.blurb ? `<p style="text-align:center;">${item.blurb}</p>` : '';

  return image + `<h2 style="text-align:center;">${item.title}</h2>` + subline + blurb;
}

// ---------------------------------------------------------------- email

/**
 * A starting email design: image, headline, detail line, blurb, button.
 *
 * Emits BLOCKS, never markup. Dropping generated HTML into an html block would
 * render fine and leave the admin unable to click the headline and retype it,
 * which is the whole reason this exists.
 *
 * @param ctaUrl The destination, already attribution-decorated by the caller -
 *   this module does not know a campaign id.
 */
export function starterDesign(item: StarterItem, ctaUrl: string): EmailDesign {
  const design = createDefaultDesign();
  const body = design.sections.find((section) => section.kind === 'body') ?? design.sections[0];

  const blocks = [];

  if (item.imageUrl) {
    const image = createBlock('image') as ImageBlock;
    image.props.src = item.imageUrl;
    image.props.alt = item.title;
    image.props.href = ctaUrl;
    image.styles.align = 'center';
    blocks.push(image);
  }

  const heading = createBlock('heading') as HeadingBlock;
  heading.props.html = item.title;
  heading.props.level = 1;
  heading.styles.align = 'center';
  blocks.push(heading);

  if (item.subline) {
    const subline = createBlock('text') as TextBlock;
    subline.props.html = `<strong>${item.subline}</strong>`;
    subline.styles.align = 'center';
    blocks.push(subline);
  }

  if (item.blurb) {
    const blurb = createBlock('text') as TextBlock;
    blurb.props.html = item.blurb;
    blocks.push(blurb);
  }

  const button = createBlock('button') as ButtonBlock;
  button.props.label = item.ctaLabel;
  button.props.href = ctaUrl;
  button.styles.align = 'center';
  blocks.push(button);

  const row = createRow(1);
  row.columns[0].blocks = blocks;
  body.rows.push(row);

  return design;
}

// ---------------------------------------------------------------- social

/**
 * A starting social caption.
 *
 * Plain text: a human pastes this into Facebook or X by hand, so no markup and
 * no link - the composer appends its own attributed link per channel.
 */
export function starterCaption(item: StarterItem): string {
  const opener = item.kind === 'event'
    ? `You're invited: ${item.title}`
    : `Now available: ${item.title}`;

  return [opener, item.subline, item.blurb].filter(Boolean).join('\n\n');
}
