import {
  BLOCK_PALETTE_ID,
  BRAND_ADDRESS_TOKEN,
  BlockDropEvent,
  CHROME_PALETTE_ID,
  LAYOUT_PALETTE_ID,
  LAYOUT_PRESETS,
  applyBlockSeed,
  applyChromeSeed,
  createRowFromLayout,
  handleBlockDrop,
  handleRowDrop
} from './block-drop.util';
import { CHROME_PIECES, chromePieceById } from 'src/app/common/utils/email/chrome-pieces';
import {
  BlockType,
  EmailBlock,
  EmailRow,
  FooterBlock,
  SocialBlock,
  SocialNetworkLink,
  createBlock,
  createRow
} from 'src/app/common/models/admin/email-design.model';

// Characterization tests for the designer's two drop handlers, written
// BEFORE the chrome palette was added (2026-08-27) so the change that adds a
// third palette id has something to change against. These describe what the
// handlers do TODAY - if one starts failing, behaviour an admin relies on
// moved, not just the code.
//
// Both handlers mutate the arrays they are handed and return whether the
// design changed (callers wrap the call in state.commit()), so every
// assertion here is about those arrays afterwards plus that boolean.

/** A drop event with the structural shape the handlers read. Passing the
 *  SAME OBJECT as both containers is how handleBlockDrop/handleRowDrop tell
 *  a reorder from a transfer. */
function dropEvent(
  previous: { id: string; data: unknown },
  container: { id: string; data: unknown },
  previousIndex: number,
  currentIndex: number
): BlockDropEvent {
  return { previousContainer: previous, container, previousIndex, currentIndex };
}

describe('handleBlockDrop', () => {
  it('copies a NEW block out of the palette into a column', () => {
    const types: BlockType[] = ['heading', 'text', 'image'];
    const blocks: EmailBlock[] = [];

    const changed = handleBlockDrop(
      dropEvent({ id: BLOCK_PALETTE_ID, data: types }, { id: 'col-abc', data: blocks }, 1, 0)
    );

    expect(changed).toBe(true);
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe('text');
    // The palette is a source of TYPES, never of block instances - dragging
    // a chip must not consume it.
    expect(types.length).toBe(3);
  });

  it('inserts the palette block AT the drop index rather than appending', () => {
    const blocks: EmailBlock[] = [createBlock('heading'), createBlock('divider')];

    handleBlockDrop(
      dropEvent(
        { id: BLOCK_PALETTE_ID, data: ['button'] as BlockType[] },
        { id: 'col-abc', data: blocks },
        0,
        1
      )
    );

    expect(blocks.map((b) => b.type)).toEqual(['heading', 'button', 'divider']);
  });

  it('reorders within one column when the container is the same object', () => {
    const blocks: EmailBlock[] = [createBlock('heading'), createBlock('text'), createBlock('image')];
    const column = { id: 'col-abc', data: blocks };

    const changed = handleBlockDrop(dropEvent(column, column, 2, 0));

    expect(changed).toBe(true);
    expect(blocks.map((b) => b.type)).toEqual(['image', 'heading', 'text']);
  });

  it('transfers between two different columns', () => {
    const moved = createBlock('button');
    const stayed = createBlock('text');
    const from: EmailBlock[] = [createBlock('heading'), moved];
    const to: EmailBlock[] = [stayed];

    const changed = handleBlockDrop(
      dropEvent({ id: 'col-from', data: from }, { id: 'col-to', data: to }, 1, 0)
    );

    expect(changed).toBe(true);
    expect(from.length).toBe(1);
    expect(to.map((b) => b.id)).toEqual([moved.id, stayed.id]);
  });

  it('refuses a drop whose TARGET is not a column', () => {
    const blocks: EmailBlock[] = [];

    const changed = handleBlockDrop(
      dropEvent(
        { id: BLOCK_PALETTE_ID, data: ['text'] as BlockType[] },
        { id: 'rows-sec', data: blocks },
        0,
        0
      )
    );

    expect(changed).toBe(false);
    expect(blocks.length).toBe(0);
  });

  it('refuses a drop from an unrecognised SOURCE', () => {
    const blocks: EmailBlock[] = [];

    const changed = handleBlockDrop(
      dropEvent({ id: 'palette-something-else', data: ['text'] }, { id: 'col-abc', data: blocks }, 0, 0)
    );

    expect(changed).toBe(false);
    expect(blocks.length).toBe(0);
  });
});

describe('applyBlockSeed', () => {
  const links: SocialNetworkLink[] = [
    { network: 'facebook', url: 'https://facebook.com/impact', label: 'Facebook', iconUrl: null }
  ];

  it('fills a social block with the organisation links, copied not shared', () => {
    const block = createBlock('social') as SocialBlock;

    applyBlockSeed(block, { socialLinks: links });

    expect(block.props.networks.length).toBe(1);
    expect(block.props.networks[0].url).toBe('https://facebook.com/impact');
    expect(block.props.networks[0]).not.toBe(links[0]);
  });

  it('fills a footer block with the postal address', () => {
    const block = createBlock('footer') as FooterBlock;

    applyBlockSeed(block, { addressHtml: '<div>PO Box 1</div>' });

    expect(block.props.addressHtml).toBe('<div>PO Box 1</div>');
  });

  it('leaves the block alone with no seed, an empty seed, or empty links', () => {
    const social = createBlock('social') as SocialBlock;
    const before = JSON.stringify(social.props);

    applyBlockSeed(social, undefined);
    applyBlockSeed(social, {});
    applyBlockSeed(social, { socialLinks: [] });

    expect(JSON.stringify(social.props)).toBe(before);
  });

  it('passes through a block type the seed has nothing to say about', () => {
    const heading = createBlock('heading');
    const before = JSON.stringify(heading.props);

    applyBlockSeed(heading, { socialLinks: links, addressHtml: '<div>PO Box 1</div>' });

    expect(JSON.stringify(heading.props)).toBe(before);
  });
});

describe('createRowFromLayout', () => {
  it('builds one column per width, carrying the ratio', () => {
    const row = createRowFromLayout({ label: '2/3 + 1/3', widths: [66.66, 33.34] });

    expect(row.columns.length).toBe(2);
    expect(row.columns.map((c) => c.widthPercent)).toEqual([66.66, 33.34]);
  });

  it('builds every shipped preset', () => {
    for (const preset of LAYOUT_PRESETS) {
      const row = createRowFromLayout(preset);
      expect(row.columns.length).toBe(preset.widths.length);
    }
  });
});

describe('handleRowDrop', () => {
  it('copies a NEW row out of the layout palette into a section', () => {
    const rows: EmailRow[] = [];

    const changed = handleRowDrop(
      dropEvent({ id: LAYOUT_PALETTE_ID, data: LAYOUT_PRESETS }, { id: 'rows-sec', data: rows }, 1, 0)
    );

    expect(changed).toBe(true);
    expect(rows.length).toBe(1);
    expect(rows[0].columns.length).toBe(2);
    // A fresh row arrives EMPTY - blocks come from the block palette.
    expect(rows[0].columns[0].blocks).toEqual([]);
  });

  it('inserts the palette row AT the drop index', () => {
    const first = createRow(1);
    const rows: EmailRow[] = [first];

    handleRowDrop(
      dropEvent({ id: LAYOUT_PALETTE_ID, data: LAYOUT_PRESETS }, { id: 'rows-sec', data: rows }, 0, 0)
    );

    expect(rows.length).toBe(2);
    expect(rows[1].id).toBe(first.id);
  });

  it('reorders within one section when the container is the same object', () => {
    const a = createRow(1);
    const b = createRow(2);
    const rows: EmailRow[] = [a, b];
    const section = { id: 'rows-sec', data: rows };

    const changed = handleRowDrop(dropEvent(section, section, 1, 0));

    expect(changed).toBe(true);
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('transfers a row between two sections', () => {
    const moved = createRow(3);
    const from: EmailRow[] = [moved];
    const to: EmailRow[] = [];

    const changed = handleRowDrop(
      dropEvent({ id: 'rows-header', data: from }, { id: 'rows-footer', data: to }, 0, 0)
    );

    expect(changed).toBe(true);
    expect(from.length).toBe(0);
    expect(to[0].id).toBe(moved.id);
  });

  it('refuses a drop whose TARGET is not a section row list', () => {
    const rows: EmailRow[] = [];

    const changed = handleRowDrop(
      dropEvent({ id: LAYOUT_PALETTE_ID, data: LAYOUT_PRESETS }, { id: 'col-abc', data: rows }, 0, 0)
    );

    expect(changed).toBe(false);
    expect(rows.length).toBe(0);
  });

  it('refuses a drop from an unrecognised SOURCE', () => {
    const rows: EmailRow[] = [];

    const changed = handleRowDrop(
      dropEvent({ id: 'palette-something-else', data: [] }, { id: 'rows-sec', data: rows }, 0, 0)
    );

    expect(changed).toBe(false);
    expect(rows.length).toBe(0);
  });

  // The block palette is wired to COLUMN lists and the layout palette to ROW
  // lists, so neither handler should ever act on the other's drop.
  it('ignores a block-palette drag that lands on a section', () => {
    const rows: EmailRow[] = [];

    expect(
      handleRowDrop(dropEvent({ id: BLOCK_PALETTE_ID, data: ['text'] }, { id: 'rows-sec', data: rows }, 0, 0))
    ).toBe(false);
    expect(rows.length).toBe(0);
  });
});

// The chrome palette (2026-08-27) drags a ready-made header or footer onto a
// design that already exists - the thing starters could never do, because
// applying one replaced the whole email.
describe('handleRowDrop from the chrome palette', () => {
  const ids = CHROME_PIECES.map((piece) => piece.id);

  it('builds the named piece into the section', () => {
    const rows: EmailRow[] = [];
    const index = ids.indexOf('chrome-receipt-masthead');

    const changed = handleRowDrop(
      dropEvent({ id: CHROME_PALETTE_ID, data: ids }, { id: 'rows-header', data: rows }, index, 0)
    );

    expect(changed).toBe(true);
    expect(rows.length).toBe(1);
    expect(rows[0].columns[0].blocks[0].type).toBe('logo');
  });

  it('inserts AT the drop index', () => {
    const existing = createRow(1);
    const rows: EmailRow[] = [existing];

    handleRowDrop(
      dropEvent({ id: CHROME_PALETTE_ID, data: ids }, { id: 'rows-header', data: rows }, 0, 0)
    );

    expect(rows.length).toBe(2);
    expect(rows[1].id).toBe(existing.id);
  });

  it('hands out FRESH blocks on every drag', () => {
    const rows: EmailRow[] = [];
    const event = () =>
      dropEvent({ id: CHROME_PALETTE_ID, data: ids }, { id: 'rows-header', data: rows }, 0, 0);

    handleRowDrop(event());
    handleRowDrop(event());

    expect(rows.length).toBe(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(rows[0].columns[0].blocks[0]).not.toBe(rows[1].columns[0].blocks[0]);
  });

  it('substitutes the brand address token on the way in', () => {
    const piece = CHROME_PIECES.filter((p) => p.kind === 'footer').find((p) =>
      p.build().columns[0].blocks.some((b) => b.type === 'html' && b.props.html.includes(BRAND_ADDRESS_TOKEN)));
    expect(piece).withContext('expected a mined footer carrying the token').toBeTruthy();

    const rows: EmailRow[] = [];
    handleRowDrop(
      dropEvent({ id: CHROME_PALETTE_ID, data: ids }, { id: 'rows-footer', data: rows },
        ids.indexOf(piece!.id), 0),
      { addressHtml: '<div>PO Box 1, Somewhere GA</div>' }
    );

    const html = rows[0].columns[0].blocks
      .map((b) => (b.type === 'html' ? b.props.html : '')).join('');
    expect(html).toContain('PO Box 1, Somewhere GA');
    expect(html).not.toContain(BRAND_ADDRESS_TOKEN);
  });

  it('REMOVES the token even with no address loaded yet', () => {
    // The seed loads asynchronously, so a fast admin can drop before it
    // arrives. An empty gap is recoverable; a literal *|BRAND_ADDRESS|* in a
    // customer's inbox is not - nothing downstream resolves it.
    for (const piece of CHROME_PIECES) {
      const rows: EmailRow[] = [];
      handleRowDrop(
        dropEvent({ id: CHROME_PALETTE_ID, data: ids }, { id: 'rows-footer', data: rows },
          ids.indexOf(piece.id), 0)
      );
      const html = rows[0].columns[0].blocks
        .map((b) => (b.type === 'html' ? b.props.html : '')).join('');
      expect(html).withContext(piece.id).not.toContain(BRAND_ADDRESS_TOKEN);
    }
  });

  it('refuses an id that is not a real piece', () => {
    const rows: EmailRow[] = [];

    const changed = handleRowDrop(
      dropEvent({ id: CHROME_PALETTE_ID, data: ['not-a-piece'] }, { id: 'rows-header', data: rows }, 0, 0)
    );

    expect(changed).toBe(false);
    expect(rows.length).toBe(0);
  });

  it('refuses a chrome drag that lands on a COLUMN', () => {
    const blocks: EmailBlock[] = [];

    expect(handleRowDrop(
      dropEvent({ id: CHROME_PALETTE_ID, data: ids }, { id: 'col-abc', data: blocks }, 0, 0)
    )).toBe(false);
    expect(handleBlockDrop(
      dropEvent({ id: CHROME_PALETTE_ID, data: ids }, { id: 'col-abc', data: blocks }, 0, 0)
    )).toBe(false);
    expect(blocks.length).toBe(0);
  });
});

describe('applyChromeSeed', () => {
  it('leaves a row with no token untouched', () => {
    const row = chromePieceById('chrome-receipt-masthead')!.build();
    const before = JSON.stringify(row);

    applyChromeSeed(row, { addressHtml: '<div>PO Box 1</div>' });

    expect(JSON.stringify(row)).toBe(before);
  });

  it('replaces EVERY occurrence, not just the first', () => {
    const row = createRow(1);
    const block = createBlock('html');
    if (block.type === 'html') {
      block.props.html = `a${BRAND_ADDRESS_TOKEN}b${BRAND_ADDRESS_TOKEN}c`;
    }
    row.columns[0].blocks = [block];

    applyChromeSeed(row, { addressHtml: 'X' });

    expect((row.columns[0].blocks[0] as { props: { html: string } }).props.html).toBe('aXbXc');
  });
});
