import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { PageContentBlock } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { PageStackComponent, uniqueKey } from './page-stack.component';
import { SECTION_ARCHETYPE, SECTION_PRESETS } from '@impact-common/shared/lists/section_kit';
import { kitPage } from './kit-page.adapter';

// TestBed as an INJECTOR, not as a renderer: this component takes everything
// through inject(), so `new`-ing it throws NG0203, and nothing here needs a
// template. See CLAUDE.md's Test program section.
describe('PageStackComponent', () => {
  let saved: PageContentBlock[][];
  let loaded: PageContentBlock[];

  const build = (): PageStackComponent => {
    saved = [];
    TestBed.configureTestingModule({
      providers: [
        PageStackComponent,
        {
          provide: PageContentService,
          useValue: {
            getById: () => Promise.resolve({ blocks: loaded }),
            // updateFields, NOT update. update() is setDoc with no merge - a
            // whole-document overwrite - and a page staff created also holds
            // `title`, `theme` and `isPublished` that a section save must not
            // touch. Losing `title` would 404 the page.
            //
            // Stubbing the wrong one here would let that regression back in
            // silently, so `update` is deliberately ABSENT: if the component
            // reverts to it, these specs throw rather than pass.
            updateFields: (_slug: string, partial: { blocks: PageContentBlock[] }) => {
              saved.push(partial.blocks.map((b) => ({ ...b })));
              return Promise.resolve();
            }
          }
        },
        { provide: PermissionService, useValue: { canEdit: () => true, canDelete: () => true } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => ({ toPromise: () => Promise.resolve(undefined) }) }) } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: SnackbarService, useValue: { success: () => undefined, error: () => undefined } }
      ]
    });
    const c = TestBed.inject(PageStackComponent);
    // A KIT page - the only kind left after the twelve cut over (2026-08-31).
    c.page = kitPage({ id: 'seminars', title: 'Seminars', blocks: [] } as never);
    return c;
  };

  beforeEach(() => {
    loaded = [
      { key: 'pageHeader', type: 'heroBand', heading: 'Seminars' },
      { key: 'overview', type: 'copyCentred', heading: 'OVERVIEW' },
      {
        key: 'prices', type: 'listGrid', variant: 'price',
        items: [
          { title: 'In person', isActive: true },
          { title: 'Online', isActive: false }
        ]
      }
    ] as never;
  });

  it('loads the page it is pointed at, and shows what is live', async () => {
    const c = build();
    await c.ngOnChanges();

    expect(c.sections.length).toBe(3);
    expect(c.liveCount).toBe(3);
    expect(c.liveSections.map((s) => s.key)).toEqual(['pageHeader', 'overview', 'prices']);
  });

  it('reorders by moving the array and saves that, with no order field', async () => {
    // The array's order IS the page's order. Nothing carries a number that
    // could disagree with its position - so what is asserted here is that the
    // SAVED array is in the new order and nothing else changed.
    const c = build();
    await c.ngOnChanges();

    await c.reorder({ previousIndex: 2, currentIndex: 0 } as never);

    expect(saved.length).toBe(1);
    expect(saved[0].map((s) => s.key)).toEqual(['prices', 'pageHeader', 'overview']);
    expect(saved[0].every((s) => !('order' in s))).toBe(true);
  });

  it('does not write when a drop lands where it started', async () => {
    const c = build();
    await c.ngOnChanges();

    await c.reorder({ previousIndex: 1, currentIndex: 1 } as never);

    expect(saved.length).toBe(0);
  });

  it('refuses every write when the load failed', async () => {
    // Saving over content it never read is how a page gets silently emptied,
    // and these documents are the only copy of a page's words.
    const c = build();
    c.loadFailed = true;
    c.sections = [...loaded];

    await c.reorder({ previousIndex: 0, currentIndex: 2 } as never);
    await c.toggleLive(c.sections[0]);
    await c.remove(c.sections[0]);

    expect(saved.length).toBe(0);
  });

  it('switches a section off rather than deleting it', async () => {
    const c = build();
    await c.ngOnChanges();

    await c.toggleLive(c.sections[1]);

    expect(saved[0][1].isActive).toBe(false);
    expect(saved[0].length).toBe(3);
    expect(c.liveSections.map((s) => s.key)).toEqual(['pageHeader', 'prices']);
  });

  it('hides a singleton from the Add menu once one is placed', async () => {
    const c = build();
    await c.ngOnChanges();

    const offered = c.addableKinds.map((k) => k.type);

    // Seminars' page header is a singleton and one is already on the page;
    // its price tiles and cards repeat.
    expect(offered).not.toContain(SECTION_ARCHETYPE.HERO_BAND);
    expect(offered).toContain(SECTION_ARCHETYPE.LIST_GRID);
    expect(offered).toContain(SECTION_ARCHETYPE.COPY_MEDIA);
  });

  it('adds a section switched OFF, so nothing half-written reaches the site', async () => {
    const c = build();
    await c.ngOnChanges();
    const cards = c.page.kinds.find((k) => k.type === 'listGrid')!;

    await c.add(cards);

    const added = saved[0][saved[0].length - 1];
    expect(added.isActive).toBe(false);
    expect(added.items).toEqual([]);
  });

  it('counts a list in the page\'s own words, and says when some are hidden', async () => {
    const c = build();
    await c.ngOnChanges();

    expect(c.summary(c.sections[2])).toBe('2 tiles, 1 showing');
    expect(c.summary(c.sections[1])).toBe('OVERVIEW');
  });

  it('says plainly when a section has nothing to edit', () => {
    // A HAND-MADE fieldless kind, not a real archetype. It pointed at
    // `fixedBand` until 2026-08-31, when the consultation banner became an
    // ordinary photo band and that archetype retired - leaving the kit with
    // nothing fieldless in it and this spec asserting against a type that no
    // longer existed. The BEHAVIOUR is still real and still worth pinning:
    // any kind can end up with no editable fields, and a row that silently
    // does nothing when clicked is worse than one that says why.
    const c = build();
    c.page = {
      slug: 'x', label: 'X', path: '/x', blurb: '',
      kinds: [{ type: 'nothingHere', label: 'Nothing', blurb: '', icon: 'block', singleton: false, fields: {} }]
    } as never;
    const row = { key: 'b', type: 'nothingHere' as never };

    expect(c.summary(row)).toBe('nothing to edit - move it or switch it off');
    expect(c.isEditable(c.kindOf(row)!)).toBe(false);
  });

  it('strips markup out of a row summary', () => {
    const c = build();

    expect(c.summary({ key: 'k', type: 'copyCentred' as never, heading: 'WHAT YOU <strong>GET</strong>' }))
      .toBe('WHAT YOU GET');
  });
});

describe('uniqueKey', () => {
  it('uses the type itself when nothing has taken it', () => {
    expect(uniqueKey('prose', [])).toBe('prose');
  });

  it('numbers a repeat rather than colliding', () => {
    // A duplicate key would make two rows behave as one: the list is tracked
    // by key, and a saved dialog is matched back to its row by key.
    const existing = [{ key: 'prose' }, { key: 'prose-2' }] as never;

    expect(uniqueKey('prose', existing)).toBe('prose-3');
  });
});


/** The dialog stub the newer describes share. Hoisted so a provider list
 *  stays inside the line length rather than running off the side. */
const dialogStub = {
  open: () => ({ afterClosed: () => ({ toPromise: () => Promise.resolve(undefined) }) })
};

/**
 * PRESETS - the mitigation for the one thing this refactor gives up.
 *
 * "Hero band" used to MEAN something: one per page, a page title, over a
 * photo. A freeform builder makes every arrangement equally easy, including
 * three page titles and a wall of unstyled text. Presets keep the Add menu
 * reading the way it read before, each placing a Section already arranged.
 */
describe('placing a preset', () => {
  let saved: PageContentBlock[][];

  const build = (): PageStackComponent => {
    saved = [];
    TestBed.configureTestingModule({
      providers: [
        PageStackComponent,
        {
          provide: PageContentService,
          useValue: {
            getById: () => Promise.resolve({ blocks: [] }),
            updateFields: (_slug: string, partial: { blocks: PageContentBlock[] }) => {
              saved.push(partial.blocks.map((b) => ({ ...b })));
              return Promise.resolve();
            }
          }
        },
        { provide: PermissionService, useValue: { canEdit: () => true, canDelete: () => true } },
        { provide: MatDialog, useValue: dialogStub },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: SnackbarService, useValue: { success: () => undefined, error: () => undefined } }
      ]
    });
    const component = TestBed.inject(PageStackComponent);
    component.page = kitPage({ id: 'seminars', title: 'Seminars', blocks: [] } as never);
    component.sections = [];
    return component;
  };

  it('offers every preset on a kit page', () => {
    expect(build().addablePresets.length).toBe(SECTION_PRESETS.length);
  });

  it('offers none on a page whose kit has no Section', () => {
    // The twelve original pages declared their own fixed kinds. Offering
    // them a menu of things their renderer cannot draw would place a section
    // that silently never appears.
    const component = build();
    component.page = { ...component.page, kinds: [] };

    expect(component.addablePresets).toEqual([]);
  });

  it('places a real Section, arranged, and switched OFF', () => {
    const component = build();
    const hero = SECTION_PRESETS.find((p) => p.key === 'hero')!;

    return component.addPreset(hero).then(() => {
      const placed = component.sections[0];

      expect(placed.type).toBe(SECTION_ARCHETYPE.SECTION);
      expect(placed.variant).toBe('columns');
      // Nothing reaches the live site until staff say so - the same rule
      // every other added section follows.
      expect(placed.isActive).toBe(false);
      expect((placed.columns ?? []).length).toBe(hero.seed.columns.length);
      expect((placed.columns?.[0].pieces ?? []).length)
        .toBe(hero.seed.columns[0].pieces.length);
    });
  });

  it('carries the preset styling rather than leaving it to be redone by hand', () => {
    // The whole value of a preset is the MEASURED styling. A preset that
    // placed the right pieces with the wrong look would be worse than none,
    // because it looks finished.
    const component = build();
    const hero = SECTION_PRESETS.find((p) => p.key === 'hero')!;

    return component.addPreset(hero).then(() => {
      expect(component.sections[0].surface).toBe(hero.seed.surface);
    });
  });

  it('gives two of the same preset different keys', () => {
    // A list tracked BY KEY treats two rows sharing one as a single row -
    // dragging one moves the other and deleting one deletes both. Minted
    // here rather than stored on the preset for exactly this reason.
    const component = build();
    const hero = SECTION_PRESETS.find((p) => p.key === 'hero')!;

    return component.addPreset(hero)
      .then(() => component.addPreset(hero))
      .then(() => {
        const keys = component.sections.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
      });
  });

  it('writes the page rather than only changing the screen', () => {
    const component = build();
    const hero = SECTION_PRESETS.find((p) => p.key === 'hero')!;

    return component.addPreset(hero).then(() => {
      expect(saved.length).toBe(1);
      expect(saved[0][0].type).toBe(SECTION_ARCHETYPE.SECTION);
    });
  });
});

/**
 * "NOTHING TO EDIT" HAS NOW BEEN WRONG TWICE.
 *
 * It reads a kind's FIELDS, which was the right question while a section
 * simply was its fields. It pointed at the retired fixed band once already,
 * and it would have pointed at the one member that replaces eight of them:
 * a Section declares no fields on purpose, because its content is its
 * columns. The row said "nothing to edit" and refused to open.
 */
describe('what counts as having something to edit', () => {
  const build = (): PageStackComponent => {
    TestBed.configureTestingModule({
      providers: [
        PageStackComponent,
        {
          provide: PageContentService,
          useValue: {
            getById: () => Promise.resolve({ blocks: [] }),
            updateFields: () => Promise.resolve()
          }
        },
        { provide: PermissionService, useValue: { canEdit: () => true, canDelete: () => true } },
        { provide: MatDialog, useValue: dialogStub },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: SnackbarService, useValue: { success: () => undefined, error: () => undefined } }
      ]
    });
    const component = TestBed.inject(PageStackComponent);
    component.page = kitPage({ id: 'seminars', title: 'Seminars', blocks: [] } as never);
    return component;
  };

  it('opens a Section even though it declares no fields', () => {
    const component = build();
    const section = component.page.kinds.find((k) => k.type === SECTION_ARCHETYPE.SECTION)!;

    expect(Object.keys(section.fields).length)
      .withContext('a Section is expected to declare NO fields - its content is its columns')
      .toBe(0);
    expect(component.isEditable(section)).toBe(true);
  });

  it('describes a Section by its heading piece and what it holds', () => {
    // Reading the FIELDS would call this "nothing in it yet" while it
    // carried the whole band.
    const component = build();
    const summary = component.summary({
      key: 'k1',
      type: SECTION_ARCHETYPE.SECTION,
      variant: 'columns',
      columns: [
        { key: 'c1', pieces: [
          { key: 'h', kind: 'heading', text: 'Our Vision', isActive: true },
          { key: 't', kind: 'text', html: '<p>x</p>', isActive: true }
        ] },
        { key: 'c2', pieces: [{ key: 'p', kind: 'picture', isActive: true }] }
      ]
    } as never);

    expect(summary).toContain('Our Vision');
    expect(summary).toContain('2 columns');
    expect(summary).toContain('3 pieces');
  });

  it('still describes a Section that has no heading piece yet', () => {
    const component = build();
    const summary = component.summary({
      key: 'k1',
      type: SECTION_ARCHETYPE.SECTION,
      variant: 'columns',
      columns: [{ key: 'c1', pieces: [{ key: 'p', kind: 'picture', isActive: true }] }]
    } as never);

    expect(summary).toBe('1 column, 1 piece');
  });
});
