import { EmailDesign } from 'src/app/common/models/admin/email-design.model';
import { applyEdits, collectEditableBlocks, EditableBlock } from './amazon-confirmation-dialog.component';

// The two pure halves of the confirmation editor. What they guarantee is the
// reason the dialog can offer editing at all: the template is email-builder
// authored, so its html is compiled tables with Outlook conditionals, and the
// ONLY safe place to change wording is a design block - never the html.

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
          { id: 'b1', type: 'text', props: { html: '<p>Hi *|FNAME|*,</p>' } },
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

describe('collectEditableBlocks', () => {
  it('offers the body prose, and only the body prose', () => {
    const blocks = collectEditableBlocks(design());
    expect(blocks.map((b) => b.html)).toEqual([
      'Your order is on its way!',
      '<p>Hi *|FNAME|*,</p>',
      '<p>Shipped via Amazon.</p>'
    ]);
  });

  it('leaves the footer alone', () => {
    // The footer is chrome - the ministry's address and legal line. Offering
    // it per order invites someone to change the address on one customer's
    // email and nowhere else.
    const blocks = collectEditableBlocks(design());
    expect(blocks.some((b) => b.html.includes('Newnan'))).toBeFalse();
  });

  it('skips blocks with no prose in them', () => {
    // A divider and a logo have nothing to reword; showing empty boxes for
    // them would just be noise.
    const blocks = collectEditableBlocks(design());
    expect(blocks.length).toBe(3);
  });

  it('labels the heading as such and numbers the paragraphs from one', () => {
    expect(collectEditableBlocks(design()).map((b) => b.label))
      .toEqual(['Heading', 'Paragraph 1', 'Paragraph 2']);
  });

  it('survives a design with no sections at all', () => {
    expect(collectEditableBlocks({} as EmailDesign)).toEqual([]);
  });
});

describe('applyEdits', () => {
  it('writes an edit back to the right block', () => {
    const d = design();
    const blocks = collectEditableBlocks(d);
    blocks[1].html = '<p>Hi *|FNAME|*, your tracking is TBA123.</p>';

    const edited = applyEdits(d, blocks);
    const body = (edited.sections as never as { kind: string; rows: { columns: { blocks: { props?: { html?: string } }[] }[] }[] }[])[1];
    expect(body.rows[0].columns[0].blocks[1].props?.html)
      .toBe('<p>Hi *|FNAME|*, your tracking is TBA123.</p>');
  });

  it('NEVER mutates the loaded template - the edit is per send only', () => {
    // The loaded object is the only copy of what is stored. Editing it in
    // place would make "this order only" a lie the moment anything re-read it,
    // and an order-specific note would reach every future customer.
    const d = design();
    const blocks = collectEditableBlocks(d);
    blocks[1].html = '<p>ORDER SPECIFIC</p>';

    applyEdits(d, blocks);

    const body = (d.sections as never as { rows: { columns: { blocks: { props?: { html?: string } }[] }[] }[] }[])[1];
    expect(body.rows[0].columns[0].blocks[1].props?.html).toBe('<p>Hi *|FNAME|*,</p>');
  });

  it('leaves every untouched block exactly as it was', () => {
    const d = design();
    const blocks = collectEditableBlocks(d);
    blocks[0].html = 'Changed heading';

    const edited = applyEdits(d, blocks);
    const body = (edited.sections as never as { rows: { columns: { blocks: { props?: { html?: string } }[] }[] }[] }[])[1];
    expect(body.rows[0].columns[0].blocks[3].props?.html).toBe('<p>Shipped via Amazon.</p>');
  });

  it('ignores an edit whose block no longer exists', () => {
    // Defensive: a key that does not resolve must not throw mid-send, with the
    // order already shipped and the customer waiting.
    const d = design();
    const stray: EditableBlock = { key: '9.9.9.9', label: 'Gone', html: 'x' };
    expect(() => applyEdits(d, [stray])).not.toThrow();
  });
});
