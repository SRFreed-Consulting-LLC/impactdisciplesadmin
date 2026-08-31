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
    // Re-pointed at the KIT's consultation band when the equipping pages -
    // the last catalogue holders of consultBanner - cut over (2026-08-30).
    const c = build();
    c.page = kitPage({ id: 'x', title: 'X', blocks: [] } as never);
    const banner = { key: 'b', type: 'fixedBand' as never };

    expect(c.summary(banner)).toBe('nothing to edit - move it or switch it off');
    expect(c.isEditable(c.kindOf(banner)!)).toBe(false);
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
