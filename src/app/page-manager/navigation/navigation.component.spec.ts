import { NavigationComponent } from './navigation.component';
import { SiteNavItem } from '@impact-common/shared/models/domain/site-navigation.model';
import { SITE_ROUTES } from '@impact-common/shared/lists/site_routes';

// Page Manager > Site > Navigation - the PUBLIC SITE'S TOP MENU. The one
// piece of content that appears on every page of the site, and therefore the
// one that is wrong everywhere at once when it is wrong.
//
// Shaped like the page section stack since 2026-08-30: an ordered stack,
// drag to reorder, one item edited full screen, a dropdown's children one
// level down inside it.
//
// Hand-constructed with a duck-typed service, the house style for this suite.

interface Harness {
  screen: NavigationComponent;
  saved: SiteNavItem[][];
  said: string[];
  /** What the confirm dialog was asked, so a test can assert the wording a
   *  person actually reads before agreeing. */
  asked: string[];
  /** Answer the next confirm with this. Removing an item asks since
   *  2026-09-01; everything else here never opens a dialog. */
  setConfirm: (answer: boolean) => void;
}

const route = (key: string) => SITE_ROUTES.find((r) => r.key === key)!;

function setup(items: SiteNavItem[] | null = [], failLoad = false, failSave = false): Harness {
  const saved: SiteNavItem[][] = [];
  const service = {
    load: () => (failLoad ? Promise.reject(new Error('nope')) : Promise.resolve(items)),
    save: (next: SiteNavItem[]) => {
      if (failSave) {
        return Promise.reject(new Error('permission-denied'));
      }
      saved.push(JSON.parse(JSON.stringify(next)));
      return Promise.resolve();
    }
  };
  const said: string[] = [];
  const snackbar = {
    success: (m: string) => said.push('ok: ' + m),
    error: (m: string) => said.push('err: ' + m)
  };
  const asked: string[] = [];
  let confirmAnswer = true;
  const confirm = {
    confirm: (message: string, title: string) => {
      asked.push(title + ' | ' + message);
      return Promise.resolve(confirmAnswer);
    }
  };
  // The pages this admin has made. Offered in the Add menu since 2026-09-01;
  // before that the picker could only see the hand-written SITE_ROUTES.
  const sitePages = { pages: madePages };
  return {
    screen: new NavigationComponent(
      service as never, snackbar as never, confirm as never, sitePages as never
    ),
    saved, said, asked,
    setConfirm: (answer: boolean) => { confirmAnswer = answer; }
  };
}

/** Pages staff created, as the picker sees them. Set per test. */
let madePages: { slug: string; title: string; isPublished: boolean }[] = [];

/** Loads the screen the way it really loads. */
async function opened(items: SiteNavItem[] | null = [], failLoad = false, failSave = false): Promise<Harness> {
  const h = setup(items, failLoad, failSave);
  h.screen.ngOnInit();
  await Promise.resolve();
  await Promise.resolve();
  return h;
}

const page = (id: string, key: string, over: Partial<SiteNavItem> = {}): SiteNavItem =>
  ({ id, title: key, kind: 'page', routeKey: key, visible: true, ...over } as SiteNavItem);

const group = (id: string, children: SiteNavItem[]): SiteNavItem =>
  ({ id, title: 'Training', kind: 'group', visible: true, children });

describe('Page Manager > Navigation', () => {
  describe('opening it', () => {
    it('loads the stored menu', async () => {
      const { screen } = await opened([page('a', 'give')]);

      expect(screen.loaded).toBeTrue();
      expect(screen.items.map((i) => i.id)).toEqual(['a']);
    });

    it('works on a COPY, so cancel can really go back', async () => {
      const stored = [page('a', 'give')];
      const { screen } = await opened(stored);

      screen.items[0].title = 'Changed';

      expect(stored[0].title).withContext('the stored array was mutated').toBe('give');
    });

    it('says when the environment has NO menu document, rather than showing an empty one', async () => {
      // Different from an empty menu and from a failed read. Without this,
      // somebody rebuilds a menu that already exists in another environment.
      const { screen } = await opened(null);

      expect(screen.notSeeded).toBeTrue();
      expect(screen.loadFailed).toBeFalse();
    });

    it('says when the read FAILED, and switches editing off', async () => {
      // Editing a menu that never loaded risks saving an empty one over the
      // real thing.
      const { screen } = await opened([], true);

      expect(screen.loadFailed).toBeTrue();
      expect(screen.notSeeded).toBeFalse();
      expect(screen.canEdit).toBeFalse();
    });
  });

  describe('the stack', () => {
    it('counts what a VISITOR would see, not what is stored', async () => {
      const { screen } = await opened([
        page('a', 'give'),
        page('b', 'team', { visible: false }),
        group('g', [page('c', 'seminars', { visible: false })])
      ]);

      // 'give' only: the hidden page drops, and so does the dropdown left
      // with nothing visible inside it.
      expect(screen.liveCount).toBe(1);
      expect(screen.items.length).toBe(3);
    });

    it('reorders by dragging, and WRITES IT immediately', async () => {
      // Saved as you go, like every page section stack. The write and the
      // snackbar are both asserted: a silent save is indistinguishable
      // from none, which is exactly how the old model lost work.
      const { screen, saved, said } = await opened([page('a', 'give'), page('b', 'team')]);

      await screen.reorder({ previousIndex: 1, currentIndex: 0 } as never);

      expect(screen.items.map((i) => i.id)).toEqual(['b', 'a']);
      expect(saved.length).toBe(1);
      expect(saved[0].map((i) => i.id)).toEqual(['b', 'a']);
      expect(said).toEqual(['ok: Order saved']);
    });

    it('does not write when a drag ends where it started', async () => {
      const { screen, saved } = await opened([page('a', 'give')]);

      await screen.reorder({ previousIndex: 0, currentIndex: 0 } as never);

      expect(saved.length).toBe(0);
    });

    it('switches an item off and writes that too', async () => {
      const { screen, saved, said } = await opened([page('a', 'give')]);

      await screen.toggleLive(screen.items[0]);

      expect(saved[0][0].visible).toBeFalse();
      expect(said).toEqual(['ok: Taken out of the menu']);
    });

    it('puts the menu BACK when the write fails, rather than showing a lie', async () => {
      // The important half. A screen that keeps displaying a change that
      // never landed is how somebody walks away believing they saved.
      const { screen, said } = await opened([page('a', 'give')], false, true);

      await screen.toggleLive(screen.items[0]);

      expect(screen.items[0].visible).withContext('the failed edit stuck').toBeTrue();
      expect(said.some((m) => m.startsWith('err:'))).toBeTrue();
    });

    it('removes an item wherever it sits, including inside a dropdown', async () => {
      const { screen } = await opened([group('g', [page('c', 'seminars')])]);

      await screen.remove(screen.items[0].children![0]);

      expect(screen.items[0].children).toEqual([]);
    });

    it('says where a page item actually goes', async () => {
      const { screen } = await opened();
      expect(screen.summary(page('a', 'give'))).toContain('/give');
    });

    it('flags a page whose route has left the catalogue', async () => {
      // Through `unknown` on purpose: routeKey is the union of real
      // catalogue keys, so TypeScript refuses this outright - which is the
      // type doing its job. The case still has to be tested, because a key
      // can go stale in FIRESTORE after a catalogue edit, where no compiler
      // is watching.
      const { screen } = await opened();
      const stale = {
        id: 'a', title: 'Gone', kind: 'page', routeKey: 'no-such-route', visible: true
      } as unknown as SiteNavItem;

      expect(screen.isStale(stale)).toBeTrue();
      expect(screen.isStale(page('b', 'give'))).toBeFalse();
    });
  });

  describe('adding', () => {
    it('adds a page at the end, titled from the catalogue', async () => {
      const { screen } = await opened([page('a', 'give')]);

      await screen.addPage(route('seminars'));

      expect(screen.items.map((i) => i.routeKey)).toEqual(['give', 'seminars']);
      expect(screen.items[1].title).toBe('Seminars');
    });

    it('knows a page is already in the menu, including inside a dropdown', async () => {
      // The add menu greys these out - the same page twice in one menu is
      // never intended, and two rows pointing at one place is confusing to
      // untangle later.
      const { screen } = await opened([group('g', [page('c', 'seminars')])]);

      expect(screen.isInMenu(route('seminars'))).toBeTrue();
      expect(screen.isInMenu(route('team'))).toBeFalse();
    });

    it('opens a new link straight away, because it has no address yet', async () => {
      const { screen } = await opened();

      screen.addLink();

      expect(screen.editing?.id).toBe(screen.items[0].id);
    });

    it('gives every added item a unique id', async () => {
      const { screen } = await opened();
      screen.addLink();
      screen.closeEditor();
      screen.addLink();
      screen.closeEditor();
      screen.addDropdown();

      const ids = screen.items.map((i) => i.id);
      expect(new Set(ids).size).withContext(`repeated ids in ${ids}`).toBe(ids.length);
    });
  });

  describe('editing one item, full screen', () => {
    it('opens and closes back to the stack', async () => {
      const { screen } = await opened([page('a', 'give')]);

      screen.edit(screen.items[0]);
      expect(screen.editing?.id).toBe('a');

      screen.closeEditor();
      expect(screen.editing).toBeNull();
    });

    it('edits the REAL item, not a copy', async () => {
      // The stack is not destroyed underneath - it is the same in-memory
      // items - which is what makes backing out instant and is why the
      // fields bind straight to the item.
      const { screen } = await opened([page('a', 'give')]);

      screen.edit(screen.items[0]);
      screen.editing!.title = 'Donate';

      expect(screen.items[0].title).toBe('Donate');
    });

    it('closes a child back to ITS DROPDOWN, not all the way out', async () => {
      // Editing three children in a row should not mean three trips through
      // the stack.
      const { screen } = await opened([group('g', [page('c', 'seminars')])]);

      screen.edit(screen.items[0].children![0]);
      expect(screen.editingParent?.id).toBe('g');

      screen.closeEditor();

      expect(screen.editing?.id).toBe('g');
    });

    it('leaves editing when the item being edited is deleted', async () => {
      const { screen, setConfirm } = await opened([page('a', 'give')]);
      setConfirm(true);
      screen.edit(screen.items[0]);

      // AWAITED since 2026-09-01. Removal asks first now, so nothing at all
      // happens synchronously - the un-awaited call this used to make would
      // assert against a screen that had not been asked yet.
      await screen.remove(screen.items[0]);

      expect(screen.editing).toBeNull();
    });
  });

  describe('a dropdown\'s children, one level down', () => {
    it('adds a page inside the dropdown, not at the top level', async () => {
      const { screen } = await opened([group('g', [])]);

      screen.addPageToGroup(route('seminars'), screen.items[0]);

      expect(screen.items.length).toBe(1);
      expect(screen.items[0].children?.map((c) => c.routeKey)).toEqual(['seminars']);
    });

    it('reorders children', async () => {
      const { screen } = await opened([group('g', [page('c', 'seminars'), page('d', 'give')])]);

      screen.reorderChildren({ previousIndex: 1, currentIndex: 0 } as never, screen.items[0]);

      expect(screen.items[0].children?.map((c) => c.id)).toEqual(['d', 'c']);
    });

    it('lifts a child out to the top level', async () => {
      // The only way back up in this shape: you cannot drag between the two
      // lists, because you never see both at once.
      const { screen } = await opened([group('g', [page('c', 'seminars')])]);

      screen.liftOut(screen.items[0].children![0], screen.items[0]);

      expect(screen.items[0].children).toEqual([]);
      expect(screen.items.map((i) => i.id)).toEqual(['g', 'c']);
    });
  });

  describe('the wording of one item - the only thing not saved as you go', () => {
    // Structure writes itself. TEXT does not, which is the same split Page
    // Manager draws between its stack rows and its section editor - so this
    // is the only unsaved state left on the screen, and the only thing the
    // route guard has to defend.

    it('is clean the moment an item is opened', async () => {
      const { screen } = await opened([page('a', 'give')]);
      screen.edit(screen.items[0]);

      expect(screen.hasUnsavedChanges()).toBeFalse();
    });

    it('notices a changed title', async () => {
      const { screen } = await opened([page('a', 'give')]);
      screen.edit(screen.items[0]);

      screen.editing!.title = 'Donate';

      expect(screen.hasUnsavedChanges()).toBeTrue();
    });

    it('writes it, says so, and stops being unsaved', async () => {
      const { screen, saved, said } = await opened([page('a', 'give')]);
      screen.edit(screen.items[0]);
      screen.editing!.title = 'Donate';

      await screen.save();

      expect(saved[0][0].title).toBe('Donate');
      expect(said).toEqual(['ok: Saved']);
      expect(screen.hasUnsavedChanges()).toBeFalse();
    });

    it('REJECTS a failed save, so the guard can keep you on the screen', async () => {
      const { screen } = await opened([page('a', 'give')], false, true);
      screen.edit(screen.items[0]);
      screen.editing!.title = 'Donate';

      await expectAsync(screen.save()).toBeRejected();

      expect(screen.hasUnsavedChanges())
        .withContext('the edit was silently marked saved').toBeTrue();
      expect(screen.saving).toBeFalse();
    });

    it('refuses to write a menu the site could not render', async () => {
      // An empty dropdown renders as a heading that opens onto nothing. Said
      // out loud and left on screen to be finished, rather than written.
      const { screen, saved, said } = await opened([page('a', 'give')]);
      screen.addDropdown();
      // Renamed first, because SAVE only acts on wording that CHANGED - a
      // freshly added item is identical to its own snapshot, so pressing
      // save on it does nothing at all. That is the path a person actually
      // takes: add a dropdown, name it, try to save it while it is empty.
      screen.editing!.title = 'Training';

      await expectAsync(screen.save()).toBeRejected();

      expect(saved.length).toBe(0);
      expect(said.some((m) => m.startsWith('err:'))).toBeTrue();
    });

    it('puts the wording back on CANCEL', async () => {
      const { screen } = await opened([page('a', 'give')]);
      screen.edit(screen.items[0]);
      screen.editing!.title = 'Whoops';

      screen.revert();

      expect(screen.items[0].title).toBe('give');
      expect(screen.hasUnsavedChanges()).toBeFalse();
    });

    it('lists an empty dropdown as a problem', async () => {
      const { screen } = await opened([group('g', [])]);

      expect(screen.problems.length).toBe(1);
      expect(screen.problems[0]).toContain('nothing in it');
    });
  });

  describe('DONE, which used to discard what you wrote', () => {
    it('WRITES the item instead of dropping it', async () => {
      // THE BUG THIS EXISTS FOR (2026-09-01). DONE called closeEditor()
      // straight, which does not save - and clears the snapshot on the way
      // out, so hasUnsavedChanges() went false and the leave-guard stopped
      // defending the wording too. A new link, named and addressed, simply
      // vanished; the list kept showing it until the next reload, so the
      // screen said "9 of 9 showing on the site" about something the site
      // had never been told about.
      const { screen, saved } = await opened([]);
      screen.addLink();
      screen.editing!.title = 'Men’s Retreat';
      screen.onUrlChange(screen.editing!, '/mens-retreat');

      await screen.onDoneClicked();

      expect(saved.length).withContext('DONE wrote nothing at all').toBe(1);
      expect(saved[0][0].title).toBe('Men’s Retreat');
      expect(saved[0][0].url).toBe('/mens-retreat');
      expect(screen.editingId).withContext('saved but never closed').toBeNull();
    });

    it('stays OPEN when what is written cannot be saved', async () => {
      // A link with no address fails the validator. Closing over the top of
      // that is exactly how the wording went missing before, so DONE has to
      // keep somebody here to fix it.
      const { screen, saved } = await opened([]);
      screen.addLink();
      screen.editing!.title = 'Half a link';

      await screen.onDoneClicked();

      expect(saved.length).withContext('stored a link with no address').toBe(0);
      expect(screen.editingId).withContext('closed over an unsaveable item').not.toBeNull();
    });
  });

  describe('whether a link opens in a new tab', () => {
    it('leaves an address on THIS site in the same tab', async () => {
      // Every custom link was created external: true, so a link to a page on
      // this site rendered <a target="_blank"> and the top menu opened a
      // second browser tab instead of moving through the site (2026-09-01).
      const { screen } = await opened([]);
      screen.addLink();

      screen.onUrlChange(screen.editing!, '/give');

      expect(screen.editing!.external)
        .withContext('an address on this site opened a new tab')
        .toBeFalse();
    });

    it('sends an address somewhere else to a new tab', async () => {
      const { screen } = await opened([]);
      screen.addLink();

      screen.onUrlChange(screen.editing!, 'https://events.golfstatus.com/event/x');

      expect(screen.editing!.external).toBeTrue();
    });

    it('stops guessing once somebody has said which they want', async () => {
      // The address decides UNTIL a person decides. Someone who deliberately
      // wants an internal page in a new tab must be able to have it without
      // the next keystroke overruling them.
      const { screen } = await opened([]);
      screen.addLink();
      screen.onUrlChange(screen.editing!, '/give');

      screen.onExternalChange(screen.editing!, true);
      screen.onUrlChange(screen.editing!, '/give-monthly');

      expect(screen.editing!.external)
        .withContext('overruled a deliberate choice')
        .toBeTrue();
    });
  });

  describe('pages made in this admin', () => {
    beforeEach(() => {
      madePages = [
        { slug: 'mens-retreat', title: "Men's Retreat", isPublished: true },
        { slug: 'half-written', title: 'Half Written', isPublished: false }
      ];
    });
    afterEach(() => { madePages = []; });

    it('offers them, which is the whole point of the page builder', async () => {
      // THE BUG THIS EXISTS FOR (2026-09-01). The picker's only source was
      // SITE_ROUTES - a hand-written list in the shared submodule that a
      // staff-created page cannot get into without a code change and three
      // deploys. So "make a page without a developer" stopped one step
      // short of anybody being able to find the page.
      const { screen } = await opened([]);

      expect(screen.createdPages.map((p) => p.slug))
        .withContext('a page made here was not offered anywhere in the Add menu')
        .toEqual(['mens-retreat', 'half-written']);
    });

    it('stores an ADDRESS, because a key it invented would resolve nowhere', async () => {
      // A `page` item resolves its routeKey through SITE_ROUTES, and a key
      // that is not in there resolves to '' - a dead menu item on the live
      // site. The slug is the document id and cannot be changed after the
      // page is created, so this address cannot go stale.
      const { screen, saved } = await opened([]);

      await screen.addCreatedPage(screen.createdPages[0]);

      const added = saved[0][0];
      expect(added.kind).toBe('custom');
      expect(added.url).toBe('/mens-retreat');
      expect(added.title).toBe("Men's Retreat");
      expect(added.external).withContext('a page on this site opened a new tab').toBeFalse();
    });

    it('greys one out once it is already in the menu', async () => {
      const { screen } = await opened([]);
      await screen.addCreatedPage(screen.createdPages[0]);

      expect(screen.isPageInMenu(screen.createdPages[0])).toBeTrue();
      expect(screen.isPageInMenu(screen.createdPages[1])).toBeFalse();
    });

    it('recognises one already inside a dropdown too', async () => {
      const { screen } = await opened([group('g', [])]);
      await screen.addCreatedPageToGroup(screen.createdPages[0], screen.items[0]);

      expect(screen.isPageInMenu(screen.createdPages[0]))
        .withContext('offered a second copy of a page already in a dropdown')
        .toBeTrue();
    });

    it('carries the draft flag, so the picker can say so', async () => {
      // A menu item pointing at an unpublished page sends every visitor to
      // Page Not Found. The picker shows drafts but marks them.
      const { screen } = await opened([]);

      expect(screen.createdPages.find((p) => p.slug === 'half-written')?.isPublished).toBeFalse();
    });
  });

  describe('removing something from the menu', () => {
    it('ASKS before taking a link off the site', async () => {
      // One click used to remove a nav item and write that immediately, with
      // no confirmation - while deleting a PAGE gets a full warning. Same
      // kind of loss, and this one changes what every visitor can find.
      const { screen, saved, asked, setConfirm } = await opened([page('a', 'give')]);
      setConfirm(false);

      await screen.remove(screen.items[0]);

      expect(asked.length).withContext('removed without asking').toBe(1);
      expect(saved.length).withContext('wrote despite a declined confirm').toBe(0);
      expect(screen.items.length).toBe(1);
    });

    it('says how many links go with a dropdown', async () => {
      // The part somebody would not otherwise realise they were agreeing to.
      const { screen, asked, setConfirm } = await opened([
        group('g', [page('a', 'give'), page('b', 'team')])
      ]);
      setConfirm(true);

      await screen.remove(screen.items[0]);

      expect(asked[0]).toContain('2 links');
    });

    it('removes it once agreed', async () => {
      const { screen, saved, setConfirm } = await opened([page('a', 'give')]);
      setConfirm(true);

      await screen.remove(screen.items[0]);

      expect(screen.items.length).toBe(0);
      expect(saved.length).toBe(1);
    });
  });
});
