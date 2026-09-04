import { EmailDesign } from 'src/app/common/models/admin/email-design.model';
import { bodyHtmlOf, withBodyHtml } from './amazon-confirmation-dialog.component';

// The two pure halves of the confirmation editor. What they guarantee is the
// reason the dialog can offer editing at all: the template is email-builder
// authored, so its html is compiled tables with Outlook conditionals, and the
// only safe place to change wording is a design block - never the html.

interface Blk { id: string; type: string; props?: Record<string, unknown>; styles?: unknown }
interface Col { blocks: Blk[] }
const blocksOf = (d: EmailDesign, section: number): Blk[] =>
  ((d.sections as unknown as { rows: { columns: Col[] }[] }[])[section]
    .rows[0].columns[0].blocks);

/** A design shaped like the real Amazon Shipping Confirmation. */
function design(): EmailDesign {
  return {
    version: 1,
    contentWidth: 600,
    globalStyles: {},
    sections: [
      {
        kind: 'header',
        rows: [{ columns: [{ blocks: [
          { id: 'h', type: 'logo', props: { src: 'logo.png' } }
        ] }] }]
      },
      {
        kind: 'body',
        rows: [{ columns: [{ blocks: [
          { id: 'b0', type: 'heading', props: { html: 'Your order is on its way!', level: 2 } },
          { id: 'b1', type: 'text', props: { html: '<p>Hi *|FNAME|*,</p>' }, styles: { fontSize: 14 } },
          { id: 'b2', type: 'divider', props: {} },
          { id: 'b3', type: 'text', props: { html: '<p>Shipped via Amazon.</p>' } }
        ] }] }]
      },
      {
        kind: 'footer',
        rows: [{ columns: [{ blocks: [
          { id: 'f0', type: 'text', props: { html: '<p>Impact Disciples, Newnan GA</p>' } }
        ] }] }]
      }
    ]
  } as unknown as EmailDesign;
}

describe('bodyHtmlOf', () => {
  it('pre-fills the editor with the body prose, in order', () => {
    expect(bodyHtmlOf(design())).toBe(
      'Your order is on its way!\n<p>Hi *|FNAME|*,</p>\n<p>Shipped via Amazon.</p>'
    );
  });

  it('leaves the footer out', () => {
    // The footer carries the ministry's address and the opt-out line. Offering
    // it per order invites changing the address on one customer's email and
    // nowhere else.
    expect(bodyHtmlOf(design())).not.toContain('Newnan');
  });

  it('leaves the header out', () => {
    expect(bodyHtmlOf(design())).not.toContain('logo.png');
  });

  it('is empty for a design with no sections at all', () => {
    expect(bodyHtmlOf({} as EmailDesign)).toBe('');
  });
});

describe('withBodyHtml', () => {
  it('puts the edited words into the body as one block', () => {
    const edited = withBodyHtml(design(), '<p>Your tracking is TBA123.</p>');
    const prose = blocksOf(edited, 1).filter((b) => b.type === 'text');

    expect(prose.length).toBe(1);
    expect(prose[0].props?.['html']).toBe('<p>Your tracking is TBA123.</p>');
  });

  it('carries a TEXT block\'s styling, not the heading\'s', () => {
    // The first prose block is a heading. Using it as the carrier would set
    // ordinary body copy at heading size.
    const edited = withBodyHtml(design(), '<p>x</p>');
    const carrier = blocksOf(edited, 1).find((b) => b.type === 'text');

    expect(carrier?.styles).toEqual({ fontSize: 14 } as never);
  });

  it('keeps what is not prose, in place', () => {
    // A divider or a picture between the paragraphs is layout, not words.
    const edited = withBodyHtml(design(), '<p>x</p>');
    expect(blocksOf(edited, 1).some((b) => b.type === 'divider')).toBeTrue();
  });

  it('puts the message where the words began', () => {
    // Before the divider, because that is where the copy was - not appended
    // after it.
    const kinds = withBodyHtml(design(), '<p>x</p>');
    expect(blocksOf(kinds, 1).map((b) => b.type)).toEqual(['text', 'divider']);
  });

  it('leaves the header and footer untouched', () => {
    const edited = withBodyHtml(design(), '<p>x</p>');
    expect(blocksOf(edited, 0)[0].type).toBe('logo');
    expect(blocksOf(edited, 2)[0].props?.['html']).toBe('<p>Impact Disciples, Newnan GA</p>');
  });

  it('NEVER mutates the loaded template - the edit is per send only', () => {
    // The loaded object is the only copy of what is stored. Editing it in
    // place would make "this order only" a lie the moment anything re-read it,
    // and an order-specific note would reach every future customer.
    const d = design();
    withBodyHtml(d, '<p>ORDER SPECIFIC</p>');

    expect(blocksOf(d, 1).length).toBe(4);
    expect(blocksOf(d, 1)[1].props?.['html']).toBe('<p>Hi *|FNAME|*,</p>');
  });

  it('does not throw on a design whose body has no prose at all', () => {
    const d = design();
    blocksOf(d, 1).length = 0;
    expect(() => withBodyHtml(d, '<p>x</p>')).not.toThrow();
  });
});
