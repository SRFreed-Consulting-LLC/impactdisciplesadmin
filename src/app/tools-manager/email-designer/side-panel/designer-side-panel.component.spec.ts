import { TestBed } from '@angular/core/testing';
import { DesignerSidePanelComponent } from './designer-side-panel.component';
import { EmailBlock, EmailRow } from 'src/app/common/models/admin/email-design.model';
import { CHROME_PIECES } from 'src/app/common/utils/email/chrome-pieces';

// CHARACTERIZATION tests, written 2026-08-21 immediately BEFORE splitting
// this component (refactor sweep, bucket A item #5 - third god component).
// 554 lines of TS + 395 of template, and unlike the previous two this one is
// not one dominant concern: it is a flat collection of per-block-type
// settings editors, most of them one-line setter closures the template
// composes as commitBlockChange(setXxx(...)).
//
// So these tests deliberately skip the trivial setters (a one-line
// assignment through a mutator closure has nothing to characterise) and
// concentrate on the places where this panel actually DECIDES something:
// - setRowColumns, which can move author content between columns
// - the numeric clamps, which silently rewrite out-of-range input
// - the footer address HTML round-trip
// - the image picker's two-target branch
// - value-to-null normalisation
//
// House style: hand-constructed class with duck-typed deps.
// DesignerStateService is stubbed with a real commit() that RUNS the
// mutator, because every assertion here is about what the mutator did.
//
// TestBed is used ONLY as an injection context (2026-08-27), not to build a
// fixture - the deps above are still hand-rolled. The component acquired an
// inject()ed DomSanitizer when the chrome palette landed, and a bare `new`
// throws NG0203 the moment a class takes anything that way. Constructing
// inside runInInjectionContext is what lets these tests keep their shape as
// the rest of the panel's deps move to inject().

function makeComponent(overrides: Record<string, unknown> = {}) {
  const commits: number[] = [];
  const state = {
    commit: (mutate: () => void) => {
      commits.push(1);
      mutate();
    },
    deselect: jasmine.createSpy('deselect'),
    selection$: { value: null },
    findBlock: () => null,
    findRow: () => null,
    findSection: () => null,
    ...overrides,
  };
  const http = { get: () => ({ subscribe: () => undefined }) };
  const component = TestBed.runInInjectionContext(
    () => new DesignerSidePanelComponent(state as never, http as never)
  );
  return { component, state, commits };
}

/** A row with `count` columns, each carrying one identifiable block. */
function aRow(count: number): EmailRow {
  return {
    id: 'row-1',
    columns: Array.from({ length: count }, (_, i) => ({
      id: `col-${i}`,
      widthPercent: 100 / count,
      blocks: [{ id: `block-${i}`, type: 'text' }],
    })),
  } as unknown as EmailRow;
}

const blockIds = (row: EmailRow) =>
  row.columns.map((c) => c.blocks.map((b) => b.id));

describe('DesignerSidePanelComponent (characterization, pre-split)', () => {
  // The one place in this panel that can LOSE author content if it goes
  // wrong: dropping a column has to rehome the blocks that were in it.
  describe('setRowColumns', () => {
    it('moves orphaned blocks into the last surviving column, never drops them', () => {
      const { component } = makeComponent();
      const row = aRow(3);
      component.setRowColumns(row, [50, 50]);
      expect(row.columns.length).toBe(2);
      // block-2 was in the dropped third column.
      expect(blockIds(row)).toEqual([['block-0'], ['block-1', 'block-2']]);
    });

    it('collapses several dropped columns into the one survivor, in order', () => {
      const { component } = makeComponent();
      const row = aRow(4);
      component.setRowColumns(row, [100]);
      expect(blockIds(row)).toEqual([['block-0', 'block-1', 'block-2', 'block-3']]);
    });

    it('appends EMPTY columns when growing', () => {
      const { component } = makeComponent();
      const row = aRow(1);
      component.setRowColumns(row, [50, 50]);
      expect(blockIds(row)).toEqual([['block-0'], []]);
    });

    it('applies the requested widths in order', () => {
      const { component } = makeComponent();
      const row = aRow(2);
      component.setRowColumns(row, [25, 75]);
      expect(row.columns.map((c) => c.widthPercent)).toEqual([25, 75]);
    });

    it('goes through commit(), so it lands as ONE undo step', () => {
      const { component, commits } = makeComponent();
      component.setRowColumns(aRow(3), [100]);
      expect(commits.length).toBe(1);
    });
  });

  describe('column ratio presets', () => {
    it('offers presets per column count and nothing for unknown counts', () => {
      const { component } = makeComponent();
      expect(component.ratioPresetsFor(1).length).toBe(1);
      expect(component.ratioPresetsFor(2).length).toBeGreaterThan(1);
      expect(component.ratioPresetsFor(9)).toEqual([]);
    });

    it('names the current ratio, tolerating rounding', () => {
      const { component } = makeComponent();
      const row = aRow(2);
      row.columns[0].widthPercent = 33.34;
      row.columns[1].widthPercent = 66.66;
      expect(component.currentRatioLabel(row)).toBe('33 / 67');
    });

    it('calls a non-preset split "Custom"', () => {
      const { component } = makeComponent();
      const row = aRow(2);
      row.columns[0].widthPercent = 40;
      row.columns[1].widthPercent = 60;
      expect(component.currentRatioLabel(row)).toBe('Custom');
    });

    it('changeColumnCount is a no-op when the count already matches', () => {
      const { component, commits } = makeComponent();
      component.changeColumnCount(aRow(2), 2);
      expect(commits.length).toBe(0);
    });

    it('changeColumnCount applies that count\'s FIRST preset', () => {
      const { component } = makeComponent();
      const row = aRow(1);
      component.changeColumnCount(row, 2);
      expect(row.columns.map((c) => c.widthPercent)).toEqual([50, 50]);
    });

    it('changeRatio ignores a label that is not a preset', () => {
      const { component, commits } = makeComponent();
      component.changeRatio(aRow(2), 'nonsense');
      expect(commits.length).toBe(0);
    });
  });

  // Every numeric input in this panel clamps rather than validates, so bad
  // input is silently rewritten. Pinned because the bounds are invisible in
  // the template.
  describe('numeric clamps', () => {
    const run = (fn: (b: EmailBlock) => () => void, block: EmailBlock) => fn(block)();

    it('spacer height clamps to 4..200 and falls back to 24', () => {
      const { component } = makeComponent();
      const block = { props: {} } as unknown as EmailBlock;
      run((b) => component.setSpacerHeight(b, 500), block);
      expect((block as never as { props: { height: number } }).props.height).toBe(200);
      run((b) => component.setSpacerHeight(b, 1), block);
      expect((block as never as { props: { height: number } }).props.height).toBe(4);
      run((b) => component.setSpacerHeight(b, 'abc'), block);
      expect((block as never as { props: { height: number } }).props.height).toBe(24);
    });

    it('image scale clamps to 10..100 and falls back to 100', () => {
      const { component } = makeComponent();
      const block = { props: {} } as unknown as EmailBlock;
      const scale = () => (block as never as { props: { scalePercent: number } }).props.scalePercent;
      run((b) => component.setImageScale(b, 400), block);
      expect(scale()).toBe(100);
      run((b) => component.setImageScale(b, 2), block);
      expect(scale()).toBe(10);
      run((b) => component.setImageScale(b, ''), block);
      expect(scale()).toBe(100);
    });

    // The social icon-size/spacing clamps moved with the social editor -
    // see block-settings/social-block-settings.component.spec.ts.

    it('divider thickness clamps to 1..12 but keeps an explicit null', () => {
      const { component } = makeComponent();
      const block = { props: {} } as unknown as EmailBlock;
      const props = () => (block as never as { props: { thickness: number | null } }).props;
      component.setDividerOverride(block, 'thickness', 99)();
      expect(props().thickness).toBe(12);
      // null means "no override", and must survive rather than clamp to 1.
      component.setDividerOverride(block, 'thickness', null)();
      expect(props().thickness).toBeNull();
    });
  });

  describe('value normalisation', () => {
    it('an empty image href becomes null, not an empty string', () => {
      const { component } = makeComponent();
      const block = { props: {} } as unknown as EmailBlock;
      const href = () => (block as never as { props: { href: string | null } }).props.href;
      component.setImageHref(block, '   ')();
      expect(href()).toBeNull();
      component.setImageHref(block, '  https://x.test  ')();
      expect(href()).toBe('https://x.test');
    });

    // The unsubscribe-label fallback moved with the footer editor - see
    // block-settings/footer-block-settings.component.spec.ts.

    it('an empty block font becomes null, not an empty string', () => {
      const { component } = makeComponent();
      const block = { props: {} } as unknown as EmailBlock;
      component.setBlockFont(block, '')();
      expect((block as never as { props: { fontFamily: string | null } }).props.fontFamily).toBeNull();
      expect(component.blockFont(block)).toBe('');
    });

    it('fontLabel shows only the first family in a stack', () => {
      const { component } = makeComponent();
      expect(component.fontLabel('Georgia, Times, serif')).toBe('Georgia');
    });
  });



  // The picker serves two different callers, and picking the wrong branch
  // would write a thumbnail onto an image block or vice versa.
  describe('image picker targets', () => {
    it('writes a picked image onto the image target and back-fills alt', () => {
      const { component } = makeComponent();
      const target = { src: '', alt: '', naturalWidth: 200 } as never;
      component.openImagePicker(target);
      component.imageCard = { image: { url: 'https://x.test/p.png', name: 'p.png' } as never };
      component.onImagePickerClosed();
      const t = target as unknown as { src: string; alt: string; naturalWidth: number | null };
      expect(t.src).toBe('https://x.test/p.png');
      expect(t.alt).toBe('p.png');
      // Cleared so the compiler re-measures rather than reusing the old size.
      expect(t.naturalWidth).toBeNull();
    });

    it('does NOT overwrite an alt the author already wrote', () => {
      const { component } = makeComponent();
      const target = { src: '', alt: 'Existing alt', naturalWidth: null } as never;
      component.openImagePicker(target);
      component.imageCard = { image: { url: 'https://x.test/p.png', name: 'p.png' } as never };
      component.onImagePickerClosed();
      expect((target as unknown as { alt: string }).alt).toBe('Existing alt');
    });

    it('writes a picked image onto a VIDEO thumbnail and flags it custom', () => {
      const { component } = makeComponent();
      const video = { props: { url: '', thumbnailUrl: null, customThumbnail: false } } as unknown as EmailBlock;
      component.openVideoThumbnailPicker(video);
      component.imageCard = { image: { url: 'https://x.test/thumb.png', name: 't.png' } as never };
      component.onImagePickerClosed();
      const props = (video as never as { props: { thumbnailUrl: string; customThumbnail: boolean } }).props;
      expect(props.thumbnailUrl).toBe('https://x.test/thumb.png');
      expect(props.customThumbnail).toBeTrue();
    });

    it('does nothing when the picker closes with no image', () => {
      const { component, commits } = makeComponent();
      const target = { src: 'unchanged', alt: '', naturalWidth: null } as never;
      component.openImagePicker(target);
      component.imageCard = {};
      component.onImagePickerClosed();
      expect((target as unknown as { src: string }).src).toBe('unchanged');
      expect(commits.length).toBe(0);
    });

    it('clears both targets after closing, so the next pick cannot leak', () => {
      const { component } = makeComponent();
      const target = { src: '', alt: '', naturalWidth: null } as never;
      component.openImagePicker(target);
      component.imageCard = { image: { url: 'https://x.test/a.png' } as never };
      component.onImagePickerClosed();

      // Second close with no fresh openImagePicker() must not rewrite it.
      component.imageCard = { image: { url: 'https://x.test/b.png' } as never };
      component.onImagePickerClosed();
      expect((target as unknown as { src: string }).src).toBe('https://x.test/a.png');
    });
  });

  describe('html block', () => {
    it('sanitizes author markup at EDIT time, keeping layout markup', () => {
      const { component } = makeComponent();
      const block = { props: {} } as unknown as EmailBlock;
      component.setHtmlContent(block, '<div class="x">Hi</div><script>alert(1)</script>')();
      const html = (block as never as { props: { html: string } }).props.html;
      expect(html).toContain('<div');
      expect(html).toContain('Hi');
      expect(html.toLowerCase()).not.toContain('<script');
    });

    it('strips inline event handlers', () => {
      const { component } = makeComponent();
      const block = { props: {} } as unknown as EmailBlock;
      component.setHtmlContent(block, '<div onclick="steal()">Hi</div>')();
      expect((block as never as { props: { html: string } }).props.html.toLowerCase()).not.toContain('onclick');
    });

    it('treats null/undefined as empty rather than throwing', () => {
      const { component } = makeComponent();
      const block = { props: {} } as unknown as EmailBlock;
      component.setHtmlContent(block, null as never)();
      expect((block as never as { props: { html: string } }).props.html).toBe('');
    });
  });

  describe('selection', () => {
    it('has no title with nothing selected', () => {
      const { component } = makeComponent();
      expect(component.selectionTitle).toBe('');
      expect(component.selectedBlock).toBeNull();
      expect(component.selectedRow).toBeNull();
    });

    it('titles a row selection', () => {
      const { component } = makeComponent({
        selection$: { value: { kind: 'row', id: 'row-1' } },
      });
      expect(component.selectionTitle).toBe('Row');
    });

    it('titles a block selection from the palette label', () => {
      const block = { id: 'b1', type: 'heading' };
      const { component } = makeComponent({
        selection$: { value: { kind: 'block', id: 'b1' } },
        findBlock: () => ({ block }),
      });
      expect(component.selectionTitle).toBe('Heading');
    });

    it('closeSettings deselects', () => {
      const { component, state } = makeComponent();
      component.closeSettings();
      expect(state.deselect).toHaveBeenCalled();
    });
  });

  describe('palette', () => {
    it('paletteTypes stays aligned with the rendered chip order', () => {
      // handleBlockDrop reads the dragged type out of this array BY INDEX.
      const { component } = makeComponent();
      expect(component.paletteTypes).toEqual(component.palette.map((p) => p.type));
    });
  });

  describe('chrome palette', () => {
    it('chromePieceIds stays aligned with the FLATTENED group order', () => {
      // The single most breakable thing here: one cdkDropList spans both
      // groups, so handleRowDrop's index is into the flattened chip order.
      // Group the chips differently without regrouping the ids and every
      // drag silently inserts the wrong header.
      const { component } = makeComponent();
      const rendered = component.chromeGroups.flatMap((g) => g.tiles.map((t) => t.piece.id));
      expect(component.chromePieceIds).toEqual(rendered);
    });

    it('offers every piece exactly once, across both groups', () => {
      const { component } = makeComponent();
      const rendered = component.chromeGroups.flatMap((g) => g.tiles.map((t) => t.piece.id));
      expect(new Set(rendered).size).toBe(rendered.length);
      expect(new Set(rendered)).toEqual(new Set(CHROME_PIECES.map((p) => p.id)));
    });

    it('groups every tile under its own family', () => {
      const { component } = makeComponent();
      for (const group of component.chromeGroups) {
        const families = new Set(group.tiles.map((t) => t.piece.family));
        expect(families.size).withContext(group.label).toBe(1);
      }
    });

    it('labels and previews every tile', () => {
      const { component } = makeComponent();
      for (const group of component.chromeGroups) {
        expect(group.label.length).toBeGreaterThan(0);
        expect(group.hint.length).toBeGreaterThan(0);
        for (const tile of group.tiles) {
          expect(tile.srcdoc).withContext(tile.piece.id).toBeTruthy();
        }
      }
    });

    it('compiles each preview ONCE, not per read', () => {
      // A SafeHtml rebuilt per change-detection cycle makes the preview
      // iframes reload in a loop - the bug the template picker's cards carry
      // a warning about. Same object identity on every read proves it is not
      // coming from a getter.
      const { component } = makeComponent();
      const first = component.chromeGroups[0].tiles[0].srcdoc;
      expect(component.chromeGroups[0].tiles[0].srcdoc).toBe(first);
    });
  });
});
