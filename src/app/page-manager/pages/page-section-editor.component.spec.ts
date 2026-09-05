import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import {
  PageContentBlock, PageContentItem, SectionColumn
} from '@impact-common/shared/models/domain/page-content.model';
import { CONTENT_PIECES, SECTION_ARCHETYPE } from '@impact-common/shared/lists/section_kit';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { TestimonialModel } from '@impact-common/shared/models/domain/testimonial.model';
import { TESTIMONIAL_TYPES } from '@impact-common/shared/lists/testimonial_types.enum';
import { FormDefinitionService } from 'src/app/common/services/data/form-definition.service';
import { PageSectionEditorComponent, freshKey } from './page-section-editor.component';
import { kitPage } from './kit-page.adapter';
import { PageEntryDialogData } from './page-entry-dialog.component';

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

/**
 * TURNING A COLUMN LEVER OFF HAS TO REMOVE THE KEY, not set it to undefined.
 *
 * TypeScript cannot tell the two apart - `column.align` reads as undefined
 * either way, and `'align' in column` is the only thing that differs - which
 * is why the original shipped and why this suite exists. Firestore can tell:
 * a key holding undefined makes it reject the ENTIRE document write with
 * "Unsupported field value: undefined", so switching a toggle ON saved and
 * switching it OFF killed the whole save, taking every other edit made in
 * the same sitting with it. Live on Coaching with Impact, 2026-09-04.
 *
 * `toEqual({})` is doing real work in these: Jasmine's toEqual treats a key
 * holding undefined as absent, so the assertions below check `in` explicitly
 * rather than trusting an object comparison to notice.
 */
describe('a column lever switched back off', () => {
  function column(): SectionColumn {
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } }
      ]
    });
    return { key: 'c1', pieces: [] };
  }

  function editor(): PageSectionEditorComponent {
    return TestBed.inject(PageSectionEditorComponent);
  }

  it('leaves NO align key behind', () => {
    const c = column();
    const e = editor();

    e.setColumnAlign(c, true);
    expect(c.align).toBe('centre');

    e.setColumnAlign(c, false);
    expect('align' in c).withContext('align survived as an undefined key').toBeFalse();
  });

  it('leaves NO measure, inset or full key behind', () => {
    const c = column();
    const e = editor();

    e.setColumnMeasure(c, true);
    e.setColumnInset(c, true);
    e.setColumnFull(c, true);
    expect([c.measure, c.inset, c.full]).toEqual([true, true, true]);

    e.setColumnMeasure(c, false);
    e.setColumnInset(c, false);
    e.setColumnFull(c, false);

    for (const key of ['measure', 'inset', 'full']) {
      expect(key in c).withContext(`${key} survived as an undefined key`).toBeFalse();
    }
  });

  it('leaves NO ground key behind when the select says "No box"', () => {
    // ngModel has already written undefined onto the column by the time the
    // handler runs - this proves the handler drops it again.
    const c = column();
    const e = editor();

    c.ground = 'panel';
    e.setColumnGround(c);
    expect(c.ground).toBe('panel');

    (c as { ground?: string }).ground = undefined;
    e.setColumnGround(c);
    expect('ground' in c).withContext('ground survived as an undefined key').toBeFalse();
  });

  it('never writes a key holding undefined, whatever the toggles do', () => {
    // The property the document actually needs, stated once over the whole
    // column rather than field by field.
    const c = column();
    const e = editor();

    e.setColumnAlign(c, true);
    e.setColumnMeasure(c, true);
    e.setColumnAlign(c, false);
    e.setColumnMeasure(c, false);
    e.setColumnInset(c, false);
    e.setColumnFull(c, false);

    const bag = c as unknown as Record<string, unknown>;
    const undefinedKeys = Object.keys(bag).filter((k) => bag[k] === undefined);
    expect(undefinedKeys).toEqual([]);
  });
});

/**
 * CONTENT AND APPEARANCE TABS.
 *
 * The editor asks two kinds of question - what a section SAYS and what it
 * LOOKS like - and used to ask them in one column with the look first, so the
 * words sat below six controls. The tabs are the owner's chosen split.
 *
 * Two things here are worth pinning rather than eyeballing, because both fail
 * invisibly: a kit page whose tabs never appear (the strip is conditional),
 * and the twelve original pages losing their content when the strip is
 * correctly absent but the content region is gated on a tab that is never
 * shown.
 */
describe('the section editor’s two tabs', () => {
  function build(kind: Record<string, unknown>, section: Partial<PageContentBlock> = {}) {
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'k1', type: SECTION_ARCHETYPE.LIST, items: [], ...section
    } as PageContentBlock;
    component.kind = kind as never;
    return component;
  }

  const KIT_KIND = {
    type: SECTION_ARCHETYPE.LIST,
    variants: [
      { key: 'tiles', label: 'Tiles', fields: {} },
      { key: 'quoteCards', label: 'Quote cards', fields: {} }
    ],
    surfaces: ['inherit', 'light', 'photo']
  };

  it('opens on Content, because that is what a section is for', () => {
    expect(build(KIT_KIND).editorTab).toBe('content');
  });

  it('offers the strip only where the look is actually a choice', () => {
    // The twelve original pages each have their own component in the web app.
    // They declare no variants and no surfaces, so an Appearance tab would
    // open on nothing - and the CONTENT region must not be gated behind a tab
    // strip that never renders, or those pages go blank.
    // ONE build per spec - TestBed cannot be reconfigured once it has handed
    // out an instance - so the second case swaps the kind on the same one.
    const component = build({ type: SECTION_ARCHETYPE.SECTION, variants: [], surfaces: [] });
    expect(component.hasAppearanceControls).toBe(false);

    component.kind = KIT_KIND as never;
    expect(component.hasAppearanceControls).toBe(true);
  });

  it('counts the entries on the Content tab so the badge is not a guess', () => {
    const component = build(KIT_KIND, { items: [{ title: 'a', isActive: true }, { title: 'b', isActive: true }, { title: 'c', isActive: true }] });
    expect(component.contentCount).toBe(3);
  });

  it('says what the look is WITHOUT switching to the tab that holds it', () => {
    // The preview beside this editor renders the result of both tabs, so a
    // section can change shape for a reason sitting on the hidden tab.
    const component = build(KIT_KIND, { variant: 'quoteCards', surface: 'inherit', cardsPerRow: 2 });
    expect(component.appearanceSummary).toBe('Quote cards \u00b7 Same as the page \u00b7 2 per row');
  });

  it('leaves the summary empty rather than printing separators for nothing', () => {
    const component = build({ type: SECTION_ARCHETYPE.SECTION, variants: [], surfaces: [] });
    expect(component.appearanceSummary).toBe('');
  });

  it('switches tabs', () => {
    const component = build(KIT_KIND);
    component.showTab('appearance');
    expect(component.editorTab).toBe('appearance');
    component.showTab('content');
    expect(component.editorTab).toBe('content');
  });
});

/**
 * WRITING A QUOTE FROM THE PAGE THAT SHOWS IT.
 *
 * The section could order quotes and nothing else. Two things here fail
 * quietly rather than loudly and are what these specs are for: a new quote
 * seeded with the wrong type saves successfully and then is simply not in the
 * list (the list holds one type), which reads as a lost save; and a row
 * patched in place after an edit stays visible even when the edit switched
 * the quote off.
 */
describe('adding and editing a quote from the section', () => {
  let opened: { data: { item: TestimonialModel } } | undefined;
  let closedWith: boolean;
  let reads: number;

  function build(ids: string[] = []): PageSectionEditorComponent {
    opened = undefined;
    closedWith = true;
    reads = 0;
    const live: TestimonialModel[] = [
      { id: 't1', author: 'Ann', text: 'One', isActive: true } as TestimonialModel,
      { id: 't2', author: 'Bob', text: 'Two', isActive: true } as TestimonialModel
    ];
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        {
          provide: TestimonialService,
          useValue: {
            getAllByValue: () => {
              reads++;
              return Promise.resolve(live);
            }
          }
        },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } },
        {
          provide: MatDialog,
          useValue: {
            open: (_c: unknown, config: { data: { item: TestimonialModel } }) => {
              opened = config;
              return { afterClosed: () => of(closedWith) };
            }
          }
        }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'quotes', type: SECTION_ARCHETYPE.LIST, variant: 'quotes', testimonialIds: ids
    } as PageContentBlock;
    component.kind = {
      type: SECTION_ARCHETYPE.LIST,
      variants: [{ key: 'quotes', label: 'Quotes', fields: { testimonials: true } }]
    } as never;
    return component;
  }

  it('seeds a NEW quote with this list’s own type, switched on', () => {
    // The list reads one type only. A quote saved as anything else is written
    // successfully and then invisible - a save that looks like a failure.
    const component = build();
    component.addQuote();

    expect(opened!.data.item.type).toBe(TESTIMONIAL_TYPES.COACHING);
    expect(opened!.data.item.isActive).toBe(true);
    expect(opened!.data.item.id).toBeUndefined();
  });

  it('hands the dialog the quote itself to edit, not a copy', () => {
    // A testimonial belongs to no one page. Editing a copy here would give the
    // site two versions of the same quote and no way to tell which is showing.
    const component = build();
    const quote = { id: 't2', author: 'Bob' } as TestimonialModel;
    component.editQuote(quote);

    expect(opened!.data.item).toBe(quote);
  });

  it('re-reads the list after a save, because an edit can remove a row', () => {
    const component = build();
    component.addQuote();

    // ngOnInit is not run here, so this is the reload and nothing else.
    expect(reads).toBe(1);
  });

  it('does not re-read when the dialog was cancelled', () => {
    const component = build();
    closedWith = false;
    component.addQuote();

    expect(reads).toBe(0);
  });
});

/**
 * A LIST THAT READS AS A LIST.
 *
 * Every entry used to hold every field it has open at once, so eight coaches
 * were eight stacked forms. The row identifies the entry now and the fields
 * are in a dialog - which puts the weight on two things that were free
 * before: the row has to say WHICH entry it is even when the obvious field is
 * empty, and the dialog must not be able to half-apply an abandoned edit.
 */
describe('a closed entry row and the dialog behind it', () => {
  let opened: { data: PageEntryDialogData } | undefined;
  let closeWith: PageContentItem | undefined;

  function build(items: PageContentItem[] = []): PageSectionEditorComponent {
    opened = undefined;
    closeWith = undefined;
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } },
        {
          provide: MatDialog,
          useValue: {
            open: (_c: unknown, config: { data: PageEntryDialogData }) => {
              opened = config;
              return { afterClosed: () => of(closeWith) };
            }
          }
        }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'list', type: SECTION_ARCHETYPE.LIST, variant: 'tiles', items
    } as PageContentBlock;
    component.kind = {
      type: SECTION_ARCHETYPE.LIST,
      variants: [{
        key: 'tiles', label: 'Tiles',
        fields: { entries: true },
        entry: { noun: 'card', fields: { title: true, description: true, image: true } }
      }]
    } as never;
    return component;
  }

  it('names a row by whatever that kind of entry actually carries', () => {
    // No one field is on all of them: a price tile has no title, a quote
    // card's words are its body, a feature row is a headline and a sentence.
    const component = build([
      { title: 'Kevin Wilson', isActive: true },
      { title: '', heading: 'Second', isActive: true },
      { title: '', description: 'Only some copy', isActive: true },
      { title: '', body: '<p>Words <em>in</em> a quote</p>', isActive: true }
    ] as PageContentItem[]);

    expect(component.entryLabel(component.entries[0], 0)).toBe('Kevin Wilson');
    expect(component.entryLabel(component.entries[1], 1)).toBe('Second');
    expect(component.entryLabel(component.entries[2], 2)).toBe('Only some copy');
    expect(component.entryLabel(component.entries[3], 3)).toBe('Words in a quote');
  });

  it('never draws a blank row, which is the one thing a closed list must not do', () => {
    const component = build([{ title: '', isActive: true }] as PageContentItem[]);
    expect(component.entryLabel(component.entries[0], 0)).toBe('Untitled card 1');
  });

  it('does not repeat the label as its own second line', () => {
    const component = build([
      { title: 'Kevin Wilson', description: 'Coaches in Georgia', isActive: true },
      { title: '', description: 'Only some copy', isActive: true }
    ] as PageContentItem[]);

    expect(component.entryDetail(component.entries[0], 0)).toBe('Coaches in Georgia');
    expect(component.entryDetail(component.entries[1], 1)).toBe('');
  });

  it('hands the dialog a COPY, so Cancel really cancels', () => {
    // A shallow copy would not be enough: an entry holds an image object and
    // a focal point, and the dialog edits both in place.
    const component = build([
      { title: 'Kevin', isActive: true, photoFocusPoint: { x: 20, y: 30 } }
    ] as PageContentItem[]);
    component.openEntry(0);

    const handed = opened!.data.entry;
    expect(handed).not.toBe(component.entries[0]);
    expect(handed.photoFocusPoint).not.toBe(component.entries[0].photoFocusPoint);

    // Cancelled: nothing came back, so nothing was applied.
    expect(component.entries[0].title).toBe('Kevin');
  });

  it('applies what the dialog returns, in place, to that one entry', () => {
    const component = build([
      { title: 'One', isActive: true },
      { title: 'Two', isActive: true }
    ] as PageContentItem[]);
    closeWith = { title: 'Two, renamed', isActive: true } as PageContentItem;
    component.openEntry(1);

    expect(component.entries.map((e) => e.title)).toEqual(['One', 'Two, renamed']);
  });

  it('adds a NEW entry only if the dialog was seen through', () => {
    // The old Add appended a blank row you then had to find and fill in, and
    // an abandoned one sat in the list drawing an empty card.
    const component = build([]);
    component.addEntry();
    expect(component.entries.length).toBe(0);
    expect(opened!.data.isNew).toBe(true);

    closeWith = { title: 'Written', isActive: true } as PageContentItem;
    component.addEntry();
    expect(component.entries.map((e) => e.title)).toEqual(['Written']);
  });
});

/**
 * THE FORM PICKER'S OPTIONS.
 *
 * `form` is a PIECE kind as well as a section field, and a piece's fields are
 * not the section's - so a section whose form sits in a column read as having
 * no form at all, never loaded the list, and drew an empty picker under a
 * floating label. The section was correctly configured and looked unset.
 */
describe('loading the forms a form piece can choose from', () => {
  let reads: number;

  function build(kind: Record<string, unknown>): PageSectionEditorComponent {
    reads = 0;
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        {
          provide: FormDefinitionService,
          useValue: {
            getAll: () => {
              reads++;
              return Promise.resolve([{ id: 'f1', name: 'Consultation Request' }]);
            }
          }
        },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(undefined) }) } }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'k', type: SECTION_ARCHETYPE.SECTION, variant: 'columns', columns: []
    } as PageContentBlock;
    component.kind = kind as never;
    return component;
  }

  it('loads them for a COLUMN section, where a form piece can live', async () => {
    // Seminars' "START TODAY": a form piece in the right-hand column. Nothing
    // on the section or its variants says "form", and that is not a reason to
    // leave the picker empty.
    const component = build({ type: SECTION_ARCHETYPE.SECTION, fields: {}, variants: [] });
    component.ngOnInit();
    await Promise.resolve();

    expect(reads).toBe(1);
    expect(component.formOptions.map((f) => f.name)).toEqual(['Consultation Request']);
  });

  it('does not read them for a LIST, which has no pieces at all', async () => {
    const component = build({
      type: SECTION_ARCHETYPE.LIST,
      fields: {},
      variants: [{ key: 'tiles', label: 'Tiles', fields: {} }]
    });
    component.ngOnInit();
    await Promise.resolve();

    expect(reads).toBe(0);
  });
});
