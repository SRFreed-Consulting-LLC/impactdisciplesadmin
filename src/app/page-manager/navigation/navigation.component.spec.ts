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
  return { screen: new NavigationComponent(service as never), saved };
}

/** Loads the screen the way it really loads, which `dirty` depends on - it is
 *  false until the screen knows what it started from. */
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
      expect(screen.dirty).toBeFalse();
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

    it('reorders by dragging', async () => {
      const { screen } = await opened([page('a', 'give'), page('b', 'team')]);

      screen.reorder({ previousIndex: 1, currentIndex: 0 } as never);

      expect(screen.items.map((i) => i.id)).toEqual(['b', 'a']);
      expect(screen.dirty).toBeTrue();
    });

    it('removes an item wherever it sits, including inside a dropdown', async () => {
      const { screen } = await opened([group('g', [page('c', 'seminars')])]);

      screen.remove(screen.items[0].children![0]);

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

      screen.addPage(route('seminars'));

      expect(screen.items.map((i) => i.routeKey)).toEqual(['give', 'seminars']);
      expect(screen.items[1].title).toBe('Seminars');
      expect(screen.dirty).toBeTrue();
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
      const { screen } = await opened([page('a', 'give')]);
      screen.edit(screen.items[0]);

      screen.remove(screen.items[0]);

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

  describe('problems, and refusing to save them', () => {
    it('lists an empty dropdown before anybody presses save', async () => {
      const { screen } = await opened([group('g', [])]);

      expect(screen.problems.length).toBe(1);
      expect(screen.problems[0]).toContain('nothing in it');
    });

    it('will not save while there is a problem', async () => {
      const { screen, saved } = await opened([page('a', 'give')]);
      screen.addDropdown(); // empty, so invalid

      screen.save();

      expect(saved.length).toBe(0);
    });

    it('saves a valid menu and stops being dirty', async () => {
      const { screen, saved } = await opened([page('a', 'give')]);
      screen.addPage(route('team'));

      screen.save();
      await Promise.resolve();

      expect(saved.length).toBe(1);
      expect(saved[0].map((i) => i.routeKey)).toEqual(['give', 'team']);
      expect(screen.dirty).toBeFalse();
      expect(screen.justSaved).toBeTrue();
    });

    it('reports a refused save and STAYS dirty, so the work is not lost', async () => {
      const { screen } = await opened([page('a', 'give')], false, true);
      screen.addPage(route('team'));

      screen.save();
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.error).toBeTruthy();
      expect(screen.dirty).withContext('the edit was silently marked saved').toBeTrue();
      expect(screen.saving).toBeFalse();
    });

    it('reverts to what was loaded, not to empty', async () => {
      const { screen } = await opened([page('a', 'give')]);
      screen.addPage(route('team'));
      screen.addDropdown();

      screen.revert();

      expect(screen.items.map((i) => i.routeKey)).toEqual(['give']);
      expect(screen.dirty).toBeFalse();
      expect(screen.editing).toBeNull();
    });
  });
});
