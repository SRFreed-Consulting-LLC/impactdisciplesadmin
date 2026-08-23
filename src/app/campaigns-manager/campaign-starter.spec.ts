import { ProductModel } from '@impact-common/shared/models/utils/product.model';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EmailBlock } from 'src/app/common/models/admin/email-design.model';
import {
  eventStarter,
  productStarter,
  starterCaption,
  starterDesign,
  starterPopupHtml
} from './campaign-starter';

// The starter turns a product or an event into content an admin then EDITS.
// What is worth pinning is the part that is easy to get subtly wrong and hard
// to notice: the email starter must emit real blocks, because generated markup
// in an html block renders perfectly and cannot be edited in the designer -
// which would defeat the feature while looking like it worked.

const SITE = 'https://example.test';

function product(over: Partial<ProductModel> = {}): ProductModel {
  return {
    id: 'p1',
    title: 'Finding Your Identity',
    cost: 10,
    salePrice: 0,
    description: 'A study on identity.',
    imageUrl: { url: 'https://img.test/p1.png' },
    ...over
  } as ProductModel;
}

function event(over: Partial<EventModel> = {}): EventModel {
  return {
    id: 'e1',
    eventName: 'Summit 2027',
    startDate: new Date('2027-03-14T12:00:00Z'),
    description: 'Three days together.',
    imageUrl: { url: 'https://img.test/e1.png' },
    ...over
  } as EventModel;
}

function blocksOf(design: ReturnType<typeof starterDesign>): EmailBlock[] {
  return design.sections
    .flatMap((s) => s.rows)
    .flatMap((r) => r.columns)
    .flatMap((c) => c.blocks);
}

describe('productStarter', () => {
  it('uses the sale price when one applies, the cost otherwise', () => {
    expect(productStarter(product({ cost: 10 }), SITE).subline).toBe('$10.00');
    expect(productStarter(product({ cost: 10, salePrice: 7.5 }), SITE).subline).toBe('$7.50');
  });

  it('says Free rather than $0.00', () => {
    expect(productStarter(product({ cost: 0 }), SITE).subline).toBe('Free');
  });

  it('points at the product page and asks for the sale', () => {
    const starter = productStarter(product(), SITE);
    expect(starter.url).toBe('https://example.test/product-details/p1');
    expect(starter.ctaLabel).toBe('Shop Now');
  });

  it('strips markup out of the blurb', () => {
    const starter = productStarter(product({ description: '<p>Hello <b>there</b></p>' }), SITE);
    expect(starter.blurb).toBe('Hello there');
  });

  it('trims a long blurb to a teaser', () => {
    const starter = productStarter(product({ description: 'x'.repeat(400) }), SITE);
    expect(starter.blurb.length).toBeLessThanOrEqual(160);
    expect(starter.blurb.endsWith('…')).toBeTrue();
  });
});

describe('eventStarter', () => {
  it('reads as date and place on one line', () => {
    const starter = eventStarter(event({ venue: { name: 'Grace Chapel' } } as never), SITE);
    expect(starter.subline).toContain('2027');
    expect(starter.subline).toContain('Grace Chapel');
  });

  it('copes with either half missing', () => {
    expect(eventStarter(event({ startDate: undefined }), SITE).subline).toBe('');
  });

  it('points at the event page and asks for a registration', () => {
    const starter = eventStarter(event(), SITE);
    expect(starter.url).toBe('https://example.test/event-details/e1');
    expect(starter.ctaLabel).toBe('Register Now');
  });
});

describe('starterDesign', () => {
  it('emits editable BLOCKS, never a lump of html', () => {
    // The failure this guards: an html block renders correctly and cannot be
    // edited, so the starter would look right and be useless.
    const design = starterDesign(productStarter(product(), SITE), 'https://cta.test');
    const types = blocksOf(design).map((b) => b.type);

    expect(types).not.toContain('html');
    expect(types).toContain('heading');
    expect(types).toContain('button');
  });

  it('puts the headline, price and blurb into the design', () => {
    const design = starterDesign(productStarter(product(), SITE), 'https://cta.test');
    const blocks = blocksOf(design);

    const heading = blocks.find((b) => b.type === 'heading');
    expect((heading as { props: { html: string } }).props.html).toBe('Finding Your Identity');

    const texts = blocks.filter((b) => b.type === 'text')
      .map((b) => (b as { props: { html: string } }).props.html);
    expect(texts.some((t) => t.includes('$10.00'))).toBeTrue();
    expect(texts.some((t) => t.includes('A study on identity.'))).toBeTrue();
  });

  it('sends the button and the image to the attributed url', () => {
    const design = starterDesign(productStarter(product(), SITE), 'https://cta.test?cid=camp-1');
    const blocks = blocksOf(design);

    const button = blocks.find((b) => b.type === 'button') as { props: { href: string } };
    const image = blocks.find((b) => b.type === 'image') as { props: { href: string | null } };

    expect(button.props.href).toBe('https://cta.test?cid=camp-1');
    expect(image.props.href).toBe('https://cta.test?cid=camp-1');
  });

  it('omits the image block when the item has no picture', () => {
    const starter = productStarter(product({ imageUrl: undefined }), SITE);
    const types = blocksOf(starterDesign(starter, 'https://cta.test')).map((b) => b.type);
    expect(types).not.toContain('image');
  });

  it('keeps the standard header/body/footer sections', () => {
    const design = starterDesign(productStarter(product(), SITE), 'https://cta.test');
    expect(design.sections.map((s) => s.kind)).toEqual(['header', 'body', 'footer']);
  });
});

describe('starterPopupHtml', () => {
  it('inlines its styles, since the popup shares no stylesheet with anything', () => {
    const html = starterPopupHtml(productStarter(product(), SITE));
    expect(html).toContain('style="text-align:center;"');
    expect(html).toContain('Finding Your Identity');
  });

  it('drops the image tag entirely when there is no picture', () => {
    const html = starterPopupHtml(productStarter(product({ imageUrl: undefined }), SITE));
    expect(html).not.toContain('<img');
  });
});

describe('starterCaption', () => {
  it('opens differently for a product and an event', () => {
    expect(starterCaption(productStarter(product(), SITE))).toContain('Now available');
    expect(starterCaption(eventStarter(event(), SITE))).toContain("You're invited");
  });

  it('carries no markup and no link - a human pastes this by hand', () => {
    const caption = starterCaption(productStarter(product(), SITE));
    expect(caption).not.toContain('<');
    expect(caption).not.toContain('http');
  });
});
