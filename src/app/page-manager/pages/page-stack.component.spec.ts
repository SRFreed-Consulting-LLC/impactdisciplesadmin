import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { PageContentBlock } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { PageStackComponent, uniqueKey } from './page-stack.component';
import { SECTION_ARCHETYPE } from '@impact-common/shared/lists/section_kit';
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
    // The migrated shape - what Seminars actually holds since the cutover of
    // 2026-08-31. It read heroBand / copyCentred / listGrid until
    // 2026-09-01, which was a page no longer in the data: the noun lookup
    // stopped matching and this fixture started saying "2 entries" where the
    // page says "2 tiles".
    loaded = [
      {
        key: 'pageHeader', type: SECTION_ARCHETYPE.SECTION, variant: 'columns',
        columns: [{ key: 'c1', pieces: [
          { key: 'h', kind: 'heading', level: 'page', text: 'Seminars', isActive: true }
        ] }]
      },
      {
        key: 'overview', type: SECTION_ARCHETYPE.SECTION, variant: 'columns',
        heading: 'OVERVIEW'
      },
      {
        key: 'prices', type: SECTION_ARCHETYPE.LIST, variant: 'price',
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

    await c.dropIntoStack({
      previousContainer: { id: 'page-stack' }, container: { id: 'page-stack' },
      item: { data: undefined }, previousIndex: 2, currentIndex: 0
    } as never);

    expect(saved.length).toBe(1);
    expect(saved[0].map((s) => s.key)).toEqual(['prices', 'pageHeader', 'overview']);
    expect(saved[0].every((s) => !('order' in s))).toBe(true);
  });

  it('does not write when a drop lands where it started', async () => {
    const c = build();
    await c.ngOnChanges();

    await c.dropIntoStack({
      previousContainer: { id: 'page-stack' }, container: { id: 'page-stack' },
      item: { data: undefined }, previousIndex: 1, currentIndex: 1
    } as never);

    expect(saved.length).toBe(0);
  });

  it('refuses every write when the load failed', async () => {
    // Saving over content it never read is how a page gets silently emptied,
    // and these documents are the only copy of a page's words.
    const c = build();
    c.loadFailed = true;
    c.sections = [...loaded];

    await c.dropIntoStack({
      previousContainer: { id: 'page-stack' }, container: { id: 'page-stack' },
      item: { data: undefined }, previousIndex: 0, currentIndex: 2
    } as never);
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
    // HERO_BAND used to be the singleton this covered - at most one per
    // page, because a second hero puts two titles above the fold. It is
    // gone, and NEITHER of the two members is a singleton, so the kit no
    // longer supplies an example. The filter is still live and still worth
    // holding, so the example is made here instead of borrowing an archetype
    // that does not exist (2026-09-01).
    //
    // NOTE the gap this leaves: nothing now stops a page having two
    // page-level headings. That guard was a property of the hero being a
    // singleton, and its replacement - a warning on the page itself - has
    // not been built.
    const c = build();
    await c.ngOnChanges();

    const once = { ...c.page.kinds[0], type: 'onlyOnce' as never, singleton: true };
    const repeats = { ...c.page.kinds[0], type: 'asOftenAsYouLike' as never, singleton: false };
    c.page = { ...c.page, kinds: [once, repeats] };

    expect(c.addableKinds.map((k) => k.type))
      .withContext('neither is placed yet, so both are on offer')
      .toEqual(['onlyOnce', 'asOftenAsYouLike'] as never);

    c.sections = [{ key: 'k1', type: 'onlyOnce' } as never];

    expect(c.addableKinds.map((k) => k.type)).toEqual(['asOftenAsYouLike'] as never);
  });

  it('adds a section switched OFF, so nothing half-written reaches the site', async () => {
    const c = build();
    await c.ngOnChanges();
    // A LIST, which is what 'listGrid' became. The point of the test is the
    // switched-OFF default, not which member is added.
    const cards = c.page.kinds.find((k) => k.type === SECTION_ARCHETYPE.LIST)!;

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
 * ADDING ONE OF THE TWO MEMBERS.
 *
 * The bar carries a Section and a List and nothing else, which is the point
 * of the consolidation said out loud: everything on the site is one or the
 * other. Twelve presets used to sit here, and made two members look like
 * twelve types - see the epitaph in section_kit.ts for why they went.
 */
describe('adding a section or a list', () => {
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
    component.loadFailed = false;
    return component;
  };

  const memberOf = (component: PageStackComponent, type: SECTION_ARCHETYPE) =>
    component.addableMembers.find((k) => k.type === type)!;

  it('offers exactly two things, and they are Section and List', () => {
    const component = build();

    expect(component.addableMembers.map((k) => k.type))
      .withContext('the bar is meant to say "everything is one of these two"')
      .toEqual([SECTION_ARCHETYPE.SECTION, SECTION_ARCHETYPE.LIST]);
  });

  it('offers neither on a page whose kit has no Section', () => {
    const component = build();
    component.page = { ...component.page, kinds: [] };

    expect(component.addableMembers).toEqual([]);
  });

  it('gives a new Section a column to drop pieces into', () => {
    // A Section with NO columns has nowhere to put a piece, so the palette
    // would have nothing to aim at and the section would read as broken.
    const component = build();

    return component.addMember(memberOf(component, SECTION_ARCHETYPE.SECTION)).then(() => {
      const placed = component.sections[0];
      expect(placed.type).toBe(SECTION_ARCHETYPE.SECTION);
      expect(placed.columns?.length).toBe(1);
      expect(placed.columns?.[0].pieces).toEqual([]);
    });
  });

  it('gives a new List a look and an empty item list', () => {
    const component = build();

    return component.addMember(memberOf(component, SECTION_ARCHETYPE.LIST)).then(() => {
      const placed = component.sections[0];
      expect(placed.type).toBe(SECTION_ARCHETYPE.LIST);
      expect(placed.variant)
        .withContext('a List with no look draws nothing at all')
        .toBeTruthy();
      expect(placed.items).toEqual([]);
    });
  });

  it('adds it switched OFF', () => {
    // Nothing reaches the live site until staff say so.
    const component = build();

    return component.addMember(memberOf(component, SECTION_ARCHETYPE.SECTION)).then(() => {
      expect(component.sections[0].isActive).toBe(false);
    });
  });

  it('gives two of the same member different keys', () => {
    // A list tracked BY KEY treats two rows sharing one as a single row -
    // dragging one moves the other, deleting one deletes both.
    const component = build();
    const section = memberOf(component, SECTION_ARCHETYPE.SECTION);

    return component.addMember(section)
      .then(() => component.addMember(section))
      .then(() => {
        const keys = component.sections.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
      });
  });

  it('writes the page rather than only changing the screen', () => {
    const component = build();

    return component.addMember(memberOf(component, SECTION_ARCHETYPE.LIST)).then(() => {
      expect(saved.length).toBe(1);
      expect(saved[0][0].type).toBe(SECTION_ARCHETYPE.LIST);
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

/**
 * DOUBLE-CLICKING A ROW OPENS IT (Shane, 2026-08-31), and the edit button
 * that used to do it is gone.
 *
 * The risk the handler exists to manage: delete and the live toggle sit
 * inside the same row, so a double-click landing on either would open the
 * editor on top of what it just did - over a section that is mid-delete, or
 * one whose toggle is still saving.
 */
describe('opening a section by double-clicking its row', () => {
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

  const section = {
    key: 'k1', type: SECTION_ARCHETYPE.SECTION, variant: 'columns',
    columns: [{ key: 'c1', pieces: [{ key: 'h', kind: 'heading', text: 'A', isActive: true }] }]
  } as never;

  /** A double-click that landed on `el`, which is all the handler reads. */
  const clickOn = (el: HTMLElement) => ({ target: el }) as unknown as Event;

  it('opens the section when the row itself is double-clicked', () => {
    const component = build();
    component.sections = [section];

    component.editFromRow(section, clickOn(document.createElement('div')));

    expect(component.editing)
      .withContext('double-clicking the row did not open it')
      .not.toBeNull();
  });

  it('ignores a double-click on the delete button', () => {
    // Otherwise the editor opens over a section that is being deleted.
    const component = build();
    component.sections = [section];

    const row = document.createElement('div');
    const button = document.createElement('button');
    row.appendChild(button);
    component.editFromRow(section, clickOn(button));

    expect(component.editing).toBeNull();
  });

  it('ignores a double-click on the live toggle', () => {
    const component = build();
    component.sections = [section];

    const row = document.createElement('div');
    const toggle = document.createElement('mat-slide-toggle');
    const inner = document.createElement('span');
    toggle.appendChild(inner);
    row.appendChild(toggle);
    // On the toggle's INNER element, which is what a real click hits.
    component.editFromRow(section, clickOn(inner));

    expect(component.editing).toBeNull();
  });

  it('ignores a double-click on the drag handle', () => {
    const component = build();
    component.sections = [section];

    const grip = document.createElement('mat-icon');
    grip.className = 'ps__grip';
    component.editFromRow(section, clickOn(grip));

    expect(component.editing).toBeNull();
  });
});

/**
 * THE SECTION BAR, and the two things a drop into the page can mean.
 *
 * Same shape as the piece palette one level down, and the same silent
 * failures: a section that lands at the end instead of where it was dropped,
 * or a reorder mistaken for a new section.
 */
describe('dropping a section into the page', () => {
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
    component.loadFailed = false;
    component.sections = [
      { key: 'a', type: SECTION_ARCHETYPE.SECTION, variant: 'columns' },
      { key: 'b', type: SECTION_ARCHETYPE.SECTION, variant: 'columns' }
    ];
    return component;
  };

  const member = (component: PageStackComponent) =>
    component.addableMembers.find((k) => k.type === SECTION_ARCHETYPE.SECTION)!;

  const drop = (fromId: string, previousIndex: number, currentIndex: number, data?: unknown) => ({
    previousContainer: { id: fromId },
    container: { id: 'page-stack' },
    item: { data },
    previousIndex,
    currentIndex
  }) as never;

  it('places a dragged section AT the position it was dropped', () => {
    // The whole reason for a bar over a button: the button could only append,
    // so every section then had to be dragged into place anyway.
    const component = build();

    return component.dropIntoStack(drop('section-palette', 0, 1, member(component))).then(() => {
      expect(component.sections.map((s) => s.key)).toEqual(['a', 'section', 'b']);
    });
  });

  it('places one dropped at the very top', () => {
    const component = build();

    return component.dropIntoStack(drop('section-palette', 0, 0, member(component))).then(() => {
      expect(component.sections[0].type).toBe(SECTION_ARCHETYPE.SECTION);
    });
  });

  it('does NOT open the editor on a drop', () => {
    // Dragging is how you lay a page out. Being thrown into an editor after
    // every drop turns laying three sections out into three round trips.
    const component = build();

    return component.dropIntoStack(drop('section-palette', 0, 1, member(component))).then(() => {
      expect(component.editing)
        .withContext('the drop opened the editor and interrupted the layout')
        .toBeNull();
    });
  });

  it('DOES open the editor on a click, as the Add button always did', () => {
    const component = build();

    return component.addMember(member(component)).then(() => {
      expect(component.editing).not.toBeNull();
      // Appended, because a click has no position to mean.
      expect(component.sections[component.sections.length - 1].type)
        .toBe(SECTION_ARCHETYPE.SECTION);
    });
  });

  it('reorders when the drag started inside the page', () => {
    const component = build();

    return component.dropIntoStack(drop('page-stack', 1, 0)).then(() => {
      expect(component.sections.map((s) => s.key)).toEqual(['b', 'a']);
    });
  });

  it('writes the page after a drop, not only the screen', () => {
    const component = build();

    return component.dropIntoStack(drop('section-palette', 0, 0, member(component))).then(() => {
      expect(saved.length).toBe(1);
      expect(saved[0][0].type).toBe(SECTION_ARCHETYPE.SECTION);
    });
  });

  it('refuses every drop on a page whose load failed', () => {
    // Saving over content the screen never read is how a page gets silently
    // emptied, and these documents are the only copy of the words.
    const component = build();
    component.loadFailed = true;

    return component.dropIntoStack(drop('section-palette', 0, 0, member(component))).then(() => {
      expect(component.sections.length).toBe(2);
      expect(saved.length).toBe(0);
    });
  });

  it('survives a drop index past the end of the page', () => {
    // The index comes from the CDK. An out-of-range splice appends silently,
    // which looks like the drop having been ignored.
    const component = build();

    return component.dropIntoStack(drop('section-palette', 0, 99, member(component))).then(() => {
      expect(component.sections.length).toBe(3);
      expect(component.sections[2].type).toBe(SECTION_ARCHETYPE.SECTION);
    });
  });

  describe('a live page with nothing switched on', () => {
    // THE GAP SOMEBODY FALLS INTO ON THEIR FIRST PAGE (2026-09-01). A
    // section is added switched OFF on purpose, so half-written work never
    // reaches the site. They then fill it in, save it, turn the PAGE on -
    // and the public page is still blank, because the section's own Live
    // switch is a separate thing on a row they have scrolled past. The
    // empty-page message does not fire, because the page is not empty.
    // Sections assigned directly rather than loaded, so this reads the same
    // whichever describe it sits in - and `loading` is cleared explicitly,
    // because ngOnChanges returns void and awaiting IT does not wait for the
    // load it started.
    const stack = (over: { isPublished: boolean; live: boolean }): PageStackComponent => {
      const c = build();
      c.loading = false;
      c.loadFailed = false;
      c.isPublished = over.isPublished;
      c.sections = [
        { key: 'a', type: SECTION_ARCHETYPE.SECTION, variant: 'columns', isActive: over.live },
        { key: 'b', type: SECTION_ARCHETYPE.SECTION, variant: 'columns', isActive: over.live }
      ] as never;
      return c;
    };

    it('says so when the page is on the site and no section is', () => {
      const c = stack({ isPublished: true, live: false });

      expect(c.publishedButBlank)
        .withContext('a live page drawing nothing said nothing about it')
        .toBeTrue();
    });

    it('stays quiet while the page is still a draft', () => {
      // Nobody can see it, so there is nothing to warn about - and a warning
      // on every half-built page is one people learn to ignore.
      const c = stack({ isPublished: false, live: false });

      expect(c.publishedButBlank).toBeFalse();
    });

    it('stays quiet once a section is switched on', () => {
      const c = stack({ isPublished: true, live: true });

      expect(c.publishedButBlank).toBeFalse();
    });

    it('stays quiet on a page with no sections at all', () => {
      // That page has its own message, which says the right thing already.
      const c = stack({ isPublished: true, live: false });
      c.sections = [];

      expect(c.publishedButBlank).toBeFalse();
    });
  });
});
