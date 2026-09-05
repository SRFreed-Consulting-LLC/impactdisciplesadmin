import { TestBed } from '@angular/core/testing';
import { DesignerSidePanelComponent } from './designer-side-panel.component';
import { EmailRow } from 'src/app/common/models/admin/email-design.model';
import { CHROME_PIECES } from 'src/app/common/utils/email/chrome-pieces';

// CHARACTERIZATION tests, written 2026-08-21 immediately BEFORE splitting
// this component (refactor sweep, bucket A item #5 - third god component).
//
// What remains here after the 2026-09-05 extraction is what the PANEL still
// decides: setRowColumns (the one place that can move author content
// between columns), the ratio presets, selection titling, and the two
// palettes whose index order is load-bearing. Every per-block-type test
// moved to block-settings/*.spec.ts with the code it covers.
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
  const component = TestBed.runInInjectionContext(
    () => new DesignerSidePanelComponent(state as never)
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

describe('DesignerSidePanelComponent', () => {
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

    it('offers every block type exactly once, and each has a settings editor', () => {
      // A palette entry with no @case in the template renders an empty
      // settings panel; the template's switch is mirrored by this list.
      const { component } = makeComponent();
      const types = component.palette.map((p) => p.type);
      expect(new Set(types).size).toBe(types.length);
      expect(types).toEqual(jasmine.arrayWithExactContents([
        'heading', 'text', 'image', 'logo', 'button', 'divider', 'spacer', 'video', 'social', 'footer', 'html'
      ]));
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
