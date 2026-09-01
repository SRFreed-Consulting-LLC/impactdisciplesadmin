import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { AdminAuthService } from '../common/forms/admin/admin-auth.service';
import { PageContentService } from '../common/services/data/page-content.service';
import { PermissionService } from '../common/services/permission.service';
import { SnackbarService } from '../shared/snackbar.service';
import { PageManagerComponent } from './page-manager.component';
import { SitePagesNavService } from './pages/site-pages-nav.service';

/**
 * CREATING A PAGE MUST NOT BE ABLE TO DESTROY ONE.
 *
 * `PageContentService.update()` is setDoc with NO MERGE - a whole-document
 * overwrite. So "create a page called Seminars" and "replace the Seminars
 * page with an empty draft" are the same write, and the only thing between
 * them is a check on the slug.
 *
 * Until 2026-09-01 that check lived solely in the dialog, over a list
 * captured by value when the dialog opened. Opening the New Page dialog on a
 * cold load - a bookmark on ?new=1, or clicking New Page as the first thing
 * after the app boots - handed it an EMPTY list, and it never refreshed. The
 * guard was simply off, and the page it overwrote was gone with no undo.
 *
 * These are that guard's tests. They drive the component's own dialog flow
 * with a stub dialog that returns whatever a person would have typed.
 */
describe('PageManagerComponent - creating a page', () => {
  let written: { id: string; page: { title?: string; blocks?: unknown[] } }[];
  let messages: { kind: 'ok' | 'bad'; text: string }[];
  let existing: Record<string, { id: string; title: string; blocks: unknown[] }>;
  let leaves: { label: string; slug: string }[];
  let dialogData: { existingSlugs: () => readonly string[] } | undefined;
  let typed: { slug: string; title: string; surface: string } | undefined;

  const build = (): PageManagerComponent => {
    written = [];
    messages = [];
    dialogData = undefined;

    TestBed.configureTestingModule({
      providers: [
        PageManagerComponent,
        {
          provide: PageContentService,
          useValue: {
            // Resolves undefined for a document that does not exist, which
            // is what FirebaseDAO.getById really does.
            getById: (id: string) => Promise.resolve(existing[id]),
            update: (id: string, page: { title?: string; blocks?: unknown[] }) => {
              written.push({ id, page });
              return Promise.resolve(page);
            },
            streamAll: () => of([])
          }
        },
        { provide: SitePagesNavService, useValue: { leaves$: of(leaves), get leaves() { return leaves; } } },
        {
          provide: MatDialog,
          useValue: {
            open: (_c: unknown, config: { data: { existingSlugs: () => readonly string[] } }) => {
              dialogData = config.data;
              return { afterClosed: () => of(typed) };
            }
          }
        },
        {
          provide: SnackbarService,
          useValue: {
            success: (t: string) => messages.push({ kind: 'ok', text: t }),
            error: (t: string) => messages.push({ kind: 'bad', text: t })
          }
        },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map()) } },
        { provide: PermissionService, useValue: { canView: () => true, canEdit: () => true, permissions$: of([]) } },
        // The shell base takes this, and it reaches Firebase Auth. Nothing
        // here exercises the shell - only the create-a-page flow.
        { provide: AdminAuthService, useValue: { currentUser$: of(null), adminUser: null } }
      ]
    });

    return TestBed.inject(PageManagerComponent);
  };

  const openDialog = async (c: PageManagerComponent): Promise<void> => {
    // The private method the ?new=1 query param triggers.
    await (c as unknown as { openNewPageDialog: () => Promise<void> }).openNewPageDialog();
  };

  beforeEach(() => {
    existing = {
      seminars: { id: 'seminars', title: 'Seminars', blocks: [{ key: 'a' }, { key: 'b' }] }
    };
    leaves = [{ label: 'Seminars', slug: 'seminars' }];
  });

  afterEach(() => TestBed.resetTestingModule());

  it('REFUSES to write over a page that already exists', async () => {
    // THE ONE THAT MATTERS. Somebody names a new page "Seminars" - by
    // accident, or because the dialog told them the name was free. The write
    // that follows would replace the real Seminars page with an empty draft.
    typed = { slug: 'seminars', title: 'Seminars', surface: 'light' };
    const c = build();

    await openDialog(c);

    expect(written)
      .withContext('WROTE OVER AN EXISTING PAGE - this is the data-loss bug')
      .toEqual([]);
    expect(messages.some((m) => m.kind === 'bad' && m.text.includes('/seminars')))
      .withContext('refused silently, so somebody thinks the page was created')
      .toBeTrue();
  });

  it('refuses even when the page list has not arrived yet', async () => {
    // THE ACTUAL FAILURE MODE, and the reason the check cannot live in the
    // dialog alone. On a cold load of ?new=1 the pages stream has emitted
    // nothing, so there is no list to check against - and the database is
    // the only thing that still knows the truth.
    leaves = [];
    typed = { slug: 'seminars', title: 'Seminars', surface: 'light' };
    const c = build();

    await openDialog(c);

    expect(written)
      .withContext('an empty nav list disabled the guard, which is how this shipped')
      .toEqual([]);
  });

  it('creates a page whose slug really is free', async () => {
    // The other direction, so the guard above cannot be "refuse everything".
    typed = { slug: 'mens-retreat', title: "Men's Retreat", surface: 'dark' };
    const c = build();

    await openDialog(c);

    expect(written.length).toBe(1);
    expect(written[0].id).toBe('mens-retreat');
    expect(written[0].page.blocks).toEqual([]);
    expect(messages.some((m) => m.kind === 'ok')).toBeTrue();
  });

  it('hands the dialog a LIVE list, not a snapshot of an empty one', async () => {
    // The dialog's own check is the courtesy that says "that name is taken"
    // while somebody is still typing. Handed an array it froze whatever
    // existed at open time; handed a function it answers with whatever has
    // arrived since.
    leaves = [];
    typed = undefined;
    const c = build();

    await openDialog(c);

    expect(typeof dialogData?.existingSlugs)
      .withContext('a captured array cannot see pages that arrive later')
      .toBe('function');

    leaves = [{ label: 'Seminars', slug: 'seminars' }];

    expect(dialogData?.existingSlugs()).toEqual(['seminars']);
  });
});
