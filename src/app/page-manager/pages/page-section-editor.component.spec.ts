import { TestBed } from '@angular/core/testing';
import { PageContentBlock } from '@impact-common/shared/models/domain/page-content.model';
import { CONTENT_PIECES, SECTION_ARCHETYPE } from '@impact-common/shared/lists/section_kit';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { FormDefinitionService } from 'src/app/common/services/data/form-definition.service';
import { PageSectionEditorComponent, freshKey } from './page-section-editor.component';
import { kitPage } from './kit-page.adapter';

/**
 * THE COLUMN EDITOR - the half of the Section archetype that lives in the
 * admin.
 *
 * TestBed as an INJECTOR: this component takes its two services through
 * inject(), so `new`-ing it throws NG0203. Nothing here renders a template.
 */
describe('editing a section built from columns', () => {
  function build(section: Partial<PageContentBlock> = {}): PageSectionEditorComponent {
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'k1', type: SECTION_ARCHETYPE.SECTION, variant: 'columns', columns: [], ...section
    } as PageContentBlock;
    component.kind = kitPage({ id: 'seminars', title: 'Seminars', blocks: [] } as never)
      .kinds.find((k) => k.type === SECTION_ARCHETYPE.SECTION)!;
    return component;
  }

  it('shows the column editor only for a Section', () => {
    // ONE build per spec: TestBed cannot be reconfigured once it has handed
    // out an instance, so the second case swaps the kind on the same
    // component rather than asking for another.
    const component = build();
    expect(component.isColumnSection).toBe(true);

    // A LIST is the other member, and the only other thing this can now be.
    // It repeats ONE item shape and has no columns to edit - offering the
    // column editor there would be offering to arrange something that does
    // not exist.
    component.kind = { ...component.kind, type: SECTION_ARCHETYPE.LIST };
    expect(component.isColumnSection).toBe(false);
  });

  it('adds empty columns up to the count asked for', () => {
    const component = build();
    component.setColumnCount(3);

    expect(component.columns.length).toBe(3);
    expect(component.columns.every((c) => c.pieces?.length === 0)).toBe(true);
  });

  it('gives every column and piece a key nothing else in the section uses', () => {
    // The lists are tracked BY KEY. Two rows sharing one behave as a single
    // row: dragging one moves the other, deleting one deletes both.
    const component = build();
    component.setColumnCount(3);
    for (const column of component.columns) {
      component.addPiece(column, 'heading');
      component.addPiece(column, 'heading');
    }

    const keys = component.columns.flatMap((c) => [c.key, ...(c.pieces ?? []).map((p) => p.key)]);
    expect(new Set(keys).size)
      .withContext('two things in this section were given the same key')
      .toBe(keys.length);
  });

  it('drops an empty column when the count goes down', () => {
    const component = build();
    component.setColumnCount(3);
    component.setColumnCount(1);

    expect(component.columns.length).toBe(1);
    expect(component.columnWarning).toBe('');
  });

  it('REFUSES to drop a column that still has something in it, and says why', () => {
    // Dropping it silently would take the pieces with it, and the pieces are
    // the work. Staff empty it first, which is a deliberate act.
    const component = build();
    component.setColumnCount(2);
    component.addPiece(component.columns[1], 'text');

    component.setColumnCount(1);

    expect(component.columns.length)
      .withContext('a column with content was dropped without asking')
      .toBe(2);
    expect(component.columnWarning).toContain('Empty the last column');
  });

  it('starts a new heading at section level, never as the page title', () => {
    // There is one page title per page and it is not the thing being added
    // twelve times.
    const component = build();
    component.setColumnCount(1);
    component.addPiece(component.columns[0], 'heading');

    expect(component.columns[0].pieces?.[0].level).toBe('section');
  });

  it('removes the piece that was asked for, not the one beside it', () => {
    const component = build();
    component.setColumnCount(1);
    const column = component.columns[0];
    component.addPiece(column, 'heading');
    component.addPiece(column, 'text');
    component.addPiece(column, 'buttons');

    component.removePiece(column, column.pieces![1]);

    expect(column.pieces!.map((p) => p.kind)).toEqual(['heading', 'buttons']);
  });
});

/**
 * THE PICTURE PICKER'S TARGET.
 *
 * It used to be an entry's numeric INDEX with null meaning the section,
 * which could not name a piece at all - a piece is in a column, which is in
 * a list - and silently retargeted if the entries were reordered while the
 * picker was open.
 */
describe('which thing is picking a picture', () => {
  function build(): PageSectionEditorComponent {
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'k1', type: SECTION_ARCHETYPE.SECTION, variant: 'columns', columns: []
    } as PageContentBlock;
    component.kind = kitPage({ id: 'seminars', title: 'Seminars', blocks: [] } as never)
      .kinds.find((k) => k.type === SECTION_ARCHETYPE.SECTION)!;
    return component;
  }

  const picture = { url: 'https://example.test/p.jpg', name: 'p' } as never;

  it('puts the chosen picture on the section when nothing else asked', () => {
    const component = build();
    component.showImageUploader();
    component.card.image = picture;
    component.closeImageUploader();

    expect(component.section.image).toBe(picture);
  });

  it('puts it on the piece that asked, even after the list is reordered', () => {
    // The regression the index could not survive. Reordering while the
    // picker is open used to move the picture onto a different row.
    const component = build();
    component.setColumnCount(1);
    const column = component.columns[0];
    component.addPiece(column, 'picture');
    component.addPiece(column, 'picture');
    const [first, second] = column.pieces!;

    component.showImageUploader(second);
    column.pieces = [second, first];
    component.card.image = picture;
    component.closeImageUploader();

    expect(second.image).toBe(picture);
    expect(first.image)
      .withContext('the picture landed on the wrong piece after a reorder')
      .toBeUndefined();
  });
});

describe('freshKey', () => {
  it('uses the plain name when nothing has taken it', () => {
    expect(freshKey('heading', new Set())).toBe('heading');
  });

  it('counts up rather than colliding', () => {
    expect(freshKey('heading', new Set(['heading']))).toBe('heading-2');
    expect(freshKey('heading', new Set(['heading', 'heading-2']))).toBe('heading-3');
  });
});

/**
 * THE PALETTE, and the three different things a drop can mean.
 *
 * Told apart by where the drag STARTED, which is the only thing that
 * distinguishes them - and getting it wrong is silent in every direction: a
 * palette that empties itself one drag at a time, a piece that is copied
 * instead of moved between columns, or a drop into an empty column that
 * appears to do nothing at all.
 */
describe('dropping into a column', () => {
  function build(columns = 2): PageSectionEditorComponent {
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'k1', type: SECTION_ARCHETYPE.SECTION, variant: 'columns', columns: []
    } as PageContentBlock;
    component.kind = kitPage({ id: 'seminars', title: 'Seminars', blocks: [] } as never)
      .kinds.find((k) => k.type === SECTION_ARCHETYPE.SECTION)!;
    component.setColumnCount(columns);
    return component;
  }

  /** The shape of the CDK's drop event, reduced to what the handler reads. */
  const drop = (
    fromId: string, container: unknown, data: unknown,
    previousIndex: number, currentIndex: number, previousData?: unknown
  ) => ({
    previousContainer: { id: fromId, data: previousData },
    container,
    item: { data },
    previousIndex,
    currentIndex
  }) as never;

  it('makes a NEW piece where a palette drag lands', () => {
    const component = build(1);
    const column = component.columns[0];
    const container = { id: 'piececol-' + column.key, data: column };

    component.dropIntoColumn(column, drop('piece-palette', container, 'heading', 0, 0));

    expect(column.pieces?.length).toBe(1);
    expect(column.pieces?.[0].kind).toBe('heading');
  });

  it('drops it at the POSITION it was dropped, not on the end', () => {
    // The whole reason for a palette over a button: the button could only
    // ever append, so every piece then had to be dragged into place anyway.
    const component = build(1);
    const column = component.columns[0];
    component.addPiece(column, 'heading');
    component.addPiece(column, 'buttons');
    const container = { id: 'piececol-' + column.key, data: column };

    component.dropIntoColumn(column, drop('piece-palette', container, 'text', 0, 1));

    expect(column.pieces?.map((p) => p.kind)).toEqual(['heading', 'text', 'buttons']);
  });

  it('leaves the palette alone - it must not empty itself', () => {
    const component = build(1);
    const before = component.pieceKinds.length;
    const column = component.columns[0];
    const container = { id: 'piececol-' + column.key, data: column };

    component.dropIntoColumn(column, drop('piece-palette', container, 'text', 3, 0));
    component.dropIntoColumn(column, drop('piece-palette', container, 'picture', 5, 0));

    expect(component.pieceKinds.length)
      .withContext('the palette lost the kinds that were dragged out of it')
      .toBe(before);
  });

  it('MOVES a piece dragged from another column rather than copying it', () => {
    // A copy would duplicate the key as well as the content, and two rows
    // sharing a key behave as one row.
    const component = build(2);
    const [first, second] = component.columns;
    component.addPiece(first, 'text');
    const moved = first.pieces![0];

    component.dropIntoColumn(second, drop(
      'piececol-' + first.key,
      { id: 'piececol-' + second.key, data: second },
      undefined, 0, 0, first
    ));

    expect(first.pieces?.length).withContext('it was copied, not moved').toBe(0);
    expect(second.pieces?.length).toBe(1);
    expect(second.pieces?.[0]).toBe(moved);
  });

  it('reorders within one column when it did not leave', () => {
    const component = build(1);
    const column = component.columns[0];
    component.addPiece(column, 'heading');
    component.addPiece(column, 'text');
    const container = { id: 'piececol-' + column.key, data: column };

    component.dropIntoColumn(column, {
      previousContainer: container, container, item: { data: undefined },
      previousIndex: 1, currentIndex: 0
    } as never);

    expect(column.pieces?.map((p) => p.kind)).toEqual(['text', 'heading']);
  });

  it('drops into a column that has never held anything', () => {
    // setColumnCount seeds `pieces: []`, but a column read from an older
    // document may have no array at all - and splicing into the throwaway []
    // that piecesOf() returns is a drop that silently does nothing.
    const component = build(1);
    const column = component.columns[0];
    delete (column as { pieces?: unknown }).pieces;
    const container = { id: 'piececol-' + column.key, data: column };

    component.dropIntoColumn(column, drop('piece-palette', container, 'text', 0, 0));

    expect(column.pieces?.length)
      .withContext('the piece went into an array nothing holds')
      .toBe(1);
  });

  it('names every column as a drop target, and nothing else', () => {
    const component = build(3);

    expect(component.columnListIds)
      .toEqual(component.columns.map((c) => 'piececol-' + c.key));
    expect(component.columnListIds)
      .withContext('the palette must not be a place a piece can be dropped')
      .not.toContain('piece-palette');
  });

  it('still adds by CLICK, which is the only keyboard path', () => {
    // A drag-only palette cannot be operated from a keyboard at all.
    const component = build(1);
    component.addPiece(component.columns[0], 'video');

    expect(component.columns[0].pieces?.[0].kind).toBe('video');
  });

  it('does nothing when clicked with no column to add to', () => {
    // The click path targets columns[0], which does not exist on a section
    // whose columns have not been set up yet.
    const component = build(1);
    component.section.columns = [];

    expect(() => component.addPiece(component.columns[0], 'text')).not.toThrow();
  });

  it('offers every kind the registry declares', () => {
    // The palette IS the registry - a kind that exists but cannot be reached
    // is a piece nobody can add.
    expect(build().pieceKinds.length).toBe(CONTENT_PIECES.length);
  });
});
