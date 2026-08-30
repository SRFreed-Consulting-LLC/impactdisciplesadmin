import { BehaviorSubject, of } from 'rxjs';
import { MainScreenComponent } from './main-screen.component';
import { NAV_CONFIG, NavGroup, sectionOf } from './nav-config';

// The drawer gained three TABS on 2026-08-29 - Admin / Site / Library - and
// a drag-resizable width. Both are display state layered over a nav config
// that did not otherwise change, which is exactly the kind of thing that
// looks right on the one screen you tried it on:
//
//   - a tab that does not follow the URL shows a nav the current screen is
//     not in, and nothing about that reads as broken;
//   - a Role.EDITOR sees only Library, so the other two tabs are empty for
//     them - landing on an empty Admin tab is a locked door, not a bug
//     report;
//   - a width read straight from Firestore can be anything at all.
//
// Hand-constructed with duck-typed deps, matching nav-accordion.spec.ts:
// none of this touches a service.

/** Records what was written to admin_users, so a spec can prove the write
 *  was PARTIAL. A whole-record write here is the bug that had ThemeService
 *  and this component erasing each other's fields. */
interface WriteLog {
  calls: Array<{ method: string; id: string; payload: unknown }>;
}

function shell(writes: WriteLog = { calls: [] }): MainScreenComponent {
  const adminUserService = {
    update: (id: string, payload: unknown) => {
      writes.calls.push({ method: 'update', id, payload });
      return Promise.resolve(payload);
    },
    updateFields: (id: string, payload: unknown) => {
      writes.calls.push({ method: 'updateFields', id, payload });
      return Promise.resolve();
    }
  };

  return new MainScreenComponent(
    null as never, // AdminAuthService
    null as never, // PermissionService
    null as never, // PermissionMigrationService
    adminUserService as never, // AdminUserService
    null as never, // MatDialog
    { url: '/', events: { pipe: () => ({ subscribe: () => undefined }) } } as never, // Router
    null as never // Injector - afterNextRender is not reached on these paths
  );
}

/** secureNav is normally built from the auth stream. Setting it directly is
 *  the honest way to pose "this is what this user can see". */
function visible(nav: MainScreenComponent, ...groupIds: string[]): void {
  nav.secureNav = NAV_CONFIG.filter((g) => groupIds.includes(g.id));
}

function everything(nav: MainScreenComponent): void {
  nav.secureNav = [...NAV_CONFIG];
}

function navigateTo(nav: MainScreenComponent, url: string): void {
  (nav as unknown as { syncActiveFromUrl(u: string): void }).syncActiveFromUrl(url);
}

function ensureSectionVisible(nav: MainScreenComponent): void {
  (nav as unknown as { ensureSectionVisible(): void }).ensureSectionVisible();
}

const idsOf = (groups: NavGroup[]) => groups.map((g) => g.id);

describe('drawer sections', () => {
  describe('which tab is showing', () => {
    it('starts on Admin', () => {
      const nav = shell();
      everything(nav);

      expect(nav.activeSection).toBe('admin');
    });

    it('shows only the groups on the active tab', () => {
      const nav = shell();
      everything(nav);

      nav.selectSection('site');

      // Navigation joined Site as a top-level group on 2026-08-30 - the
      // menu is the site's frame rather than any one page's content.
      expect(idsOf(nav.sectionNav)).toEqual(['navigation', 'page-manager', 'data']);
    });

    it('keeps Page Manager OFF the Admin tab', () => {
      // The whole point of the split - if it also still showed under Admin
      // the tab would be decoration.
      const nav = shell();
      everything(nav);

      expect(idsOf(nav.sectionNav)).not.toContain('page-manager');
      expect(idsOf(nav.sectionNav)).not.toContain('library-manager');
    });

    it('follows the URL, so a bookmarked screen opens on its own tab', () => {
      const nav = shell();
      everything(nav);

      navigateTo(nav, '/page-manager?tab=give');

      expect(nav.activeSection).toBe('site');
      expect(nav.activeSlug).toBe('give');
    });

    it('follows the URL into Library too', () => {
      const nav = shell();
      everything(nav);

      navigateTo(nav, '/library-manager?tab=browse');

      expect(nav.activeSection).toBe('library');
    });

    it('leaves the tab alone for a URL that belongs to no group', () => {
      // /settings and /dashboard are on no tab. Snapping back to Admin on
      // the way to Settings would throw away where the user was.
      const nav = shell();
      everything(nav);
      nav.selectSection('site');

      navigateTo(nav, '/settings');

      expect(nav.activeSection).toBe('site');
    });
  });

  describe('tabs a user actually has', () => {
    it('hides a tab with nothing on it', () => {
      const nav = shell();
      visible(nav, 'home', 'contacts-manager');

      expect(nav.visibleSections.map((s) => s.id)).toEqual(['admin']);
    });

    it('hides the tab strip entirely when only one tab has anything', () => {
      const nav = shell();
      visible(nav, 'library-manager');

      expect(nav.showSectionTabs).toBeFalse();
    });

    it('shows the strip once a second tab has something', () => {
      const nav = shell();
      visible(nav, 'home', 'page-manager');

      expect(nav.showSectionTabs).toBeTrue();
    });

    it('moves off a tab that is empty for this user', () => {
      // A Role.EDITOR is hard-scoped to library-manager by
      // PermissionService, so Admin - the default - has nothing on it.
      // Without this they land on a blank nav.
      const nav = shell();
      visible(nav, 'library-manager');

      ensureSectionVisible(nav);

      expect(nav.activeSection).toBe('library');
    });

    it('does not STRAND a user on a tab they have nothing on', () => {
      // syncActiveFromUrl picks the section from the unfiltered registry, so
      // any navigation to a group this user cannot see used to leave them on
      // an empty tab - and with one visible section the tab strip is hidden,
      // so there was no control left to switch back with. Only a page reload
      // recovered. The bell deep-links to groups on Admin, which an Employee
      // scoped to Page Manager does not have.
      const nav = shell();
      visible(nav, 'page-manager');
      ensureSectionVisible(nav);
      expect(nav.activeSection).toBe('site');

      navigateTo(nav, '/home');

      expect(nav.activeSection).toBe('site');
      expect(nav.sectionNav.length).toBeGreaterThan(0);
    });

    it('leaves a deep link on its own tab even before the user has loaded', () => {
      // ngOnInit runs syncActiveFromUrl while secureNav is still empty (the
      // auth stream is async). Every section looks empty then, so a naive
      // fallback would snap a bookmarked Site URL back to Admin.
      const nav = shell();

      navigateTo(nav, '/page-manager?tab=give');

      expect(nav.activeSection).toBe('site');
    });

    it('does NOT move off a tab that has something on it', () => {
      // Guards the other direction: this runs on every auth emission, and
      // must never overrule a section the URL just chose.
      const nav = shell();
      everything(nav);
      nav.selectSection('site');

      ensureSectionVisible(nav);

      expect(nav.activeSection).toBe('site');
    });
  });

  describe('flattening', () => {
    it('flattens Library - no group header, screens listed directly', () => {
      const nav = shell();
      everything(nav);

      nav.selectSection('library');

      expect(nav.isSectionFlattened).toBeTrue();
      expect(nav.groupedNav).toEqual([]);
      const library = NAV_CONFIG.find((g) => g.id === 'library-manager')!;
      expect(nav.flatItems.map((e) => e.item.slug)).toEqual((library.items ?? []).map((l) => l.slug));
    });

    it('keeps the headers on Site, which is not flattened', () => {
      // Owner's call, and the reason flatten is a per-section flag rather
      // than "one group implies flat": Site was expected to gain more, and
      // did - Navigation joined it on 2026-08-30.
      const nav = shell();
      everything(nav);

      nav.selectSection('site');

      expect(nav.isSectionFlattened).toBeFalse();
      expect(idsOf(nav.groupedNav)).toEqual(['navigation', 'page-manager', 'data']);
    });

    it('never draws both lists at once', () => {
      const nav = shell();
      everything(nav);

      for (const section of nav.visibleSections) {
        nav.selectSection(section.id);
        const drawnFlat = nav.isSectionFlattened ? nav.flatItems.length : 0;
        expect(drawnFlat === 0 || nav.groupedNav.length === 0)
          .withContext(`${section.id} would render a flat list AND group headers`)
          .toBeTrue();
      }
    });

    it('un-flattens while COLLAPSED, so the icon rail is never blank', () => {
      // A flattened section has no group header, and a NavLeaf has no icon -
      // so the 64px rail had nothing at all to draw and the entire nav
      // vanished when the drawer auto-collapsed on Library.
      const nav = shell();
      everything(nav);
      nav.selectSection('library');
      nav.currentUser = { drawerPinned: false } as never; // unpinned, not hovered
      expect(nav.drawerExpanded).toBeFalse();

      expect(nav.isSectionFlattened).toBeFalse();
      expect(idsOf(nav.groupedNav)).toEqual(['library-manager']);
    });

    it('keeps a flattened row bound to its real group, so routing still works', () => {
      // Flattening is a drawing choice. The row still has to navigate to
      // /library-manager?tab=<slug> and pin under the real screenKey.
      const nav = shell();
      everything(nav);
      nav.selectSection('library');

      for (const entry of nav.flatItems) {
        expect(entry.group.id).toBe('library-manager');
        expect(sectionOf(entry.group)).toBe('library');
      }
    });
  });

  describe('pinned shortcuts', () => {
    it('shows pins on the first tab', () => {
      const nav = shell();
      everything(nav);

      expect(nav.showPinnedItems).toBeTrue();
    });

    it('hides pins on the other tabs', () => {
      const nav = shell();
      everything(nav);

      nav.selectSection('site');

      expect(nav.showPinnedItems).toBeFalse();
    });

    it('still shows pins to a user whose only tab is Library', () => {
      // An Editor has no Admin tab. Pins hard-coded to 'admin' would be
      // invisible to them forever.
      const nav = shell();
      visible(nav, 'library-manager');
      ensureSectionVisible(nav);

      expect(nav.showPinnedItems).toBeTrue();
    });
  });

  describe('the top bar name, after Settings > My Profile saves it', () => {
    // The shell listens to currentAgent$ so the greeting refreshes without a
    // reload. That stream is fed once at SIGN-IN, so it is stale with
    // respect to every preference written since - which is why only the two
    // name fields may be copied off it. Taking the whole record would revert
    // the drawer width the moment somebody saved their name.
    function bootedShell(signedInWidth: number, shared: Record<string, unknown>) {
      const currentAgent$ = new BehaviorSubject<unknown>(shared);
      const authService = {
        dao: {
          loggedInUser$: of({ id: 'a1', firstName: 'Sam', lastName: 'Taylor', drawerWidth: signedInWidth }),
          currentAgent$
        }
      };
      const permissionService = {
        isFullAccess: () => true,
        canView: () => true,
        canViewNavItem: () => true
      };
      const nav = new MainScreenComponent(
        authService as never,
        permissionService as never,
        null as never,
        null as never,
        null as never,
        { url: '/', events: { pipe: () => ({ subscribe: () => undefined }) } } as never,
        null as never
      );
      nav.ngOnInit();
      return { nav, currentAgent$ };
    }

    it('updates the greeting', () => {
      const { nav, currentAgent$ } = bootedShell(420, { firstName: 'Sam', lastName: 'Taylor' });
      expect(nav.displayName).toBe('Sam Taylor');

      currentAgent$.next({ firstName: 'Samantha', lastName: 'Rivers' });

      expect(nav.displayName).toBe('Samantha Rivers');
    });

    it('does NOT revert a width the user had already dragged to', () => {
      // The stale shared copy still says 300; the live one is 420.
      const { nav, currentAgent$ } = bootedShell(420, { firstName: 'Sam', lastName: 'Taylor' });
      expect(nav.drawerWidth).toBe(420);

      currentAgent$.next({ firstName: 'Samantha', lastName: 'Taylor', drawerWidth: 300 });

      expect(nav.displayName).toBe('Samantha Taylor');
      expect(nav.drawerWidth).toBe(420);
    });
  });

  describe('drawer width', () => {
    it('defaults to 300px when the account has never set one', () => {
      const nav = shell();

      expect(nav.drawerWidth).toBe(300);
    });

    it('uses the width the user dragged to', () => {
      const nav = shell();
      nav.currentUser = { drawerWidth: 380 } as never;

      expect(nav.drawerWidth).toBe(380);
    });

    it('clamps a stored width that is too narrow to use', () => {
      // The value round-trips through Firestore and is editable by hand.
      const nav = shell();
      nav.currentUser = { drawerWidth: 12 } as never;

      expect(nav.drawerWidth).toBe(nav.minDrawerWidth);
    });

    it('clamps a stored width that would swallow the screen', () => {
      const nav = shell();
      nav.currentUser = { drawerWidth: 9999 } as never;

      expect(nav.drawerWidth).toBe(nav.maxDrawerWidth);
    });

    it('saves ONLY the width, never the whole record', () => {
      // A whole-record setDoc here carried this component's cached copy of
      // every other field back to Firestore, erasing whatever ThemeService
      // had written from its own cached copy since login - a theme set after
      // a drag reverted, and vice versa. Dragging is now the most frequent
      // write to admin_users, so a partial write is not optional.
      const writes: WriteLog = { calls: [] };
      const nav = shell(writes);
      nav.currentUser = { id: 'admin-1', colorTheme: 'harbor-split' } as never;

      nav.onResizeStart({ preventDefault: () => undefined, clientX: 300 } as never);
      (nav as unknown as { onResizeMove(e: unknown): void })
        .onResizeMove({ clientX: 380 } as never);
      (nav as unknown as { onResizeEnd(): void }).onResizeEnd();

      expect(writes.calls.length).toBe(1);
      expect(writes.calls[0].method).toBe('updateFields');
      expect(writes.calls[0].payload).toEqual({ drawerWidth: 380 });
    });

    it('holds the drawer open for the whole drag', () => {
      // Unpinned, the drawer collapses on mouseleave - and a drag routinely
      // leaves it. Without this the drawer snaps to a 64px rail mid-drag.
      const nav = shell();
      nav.currentUser = { drawerPinned: false } as never;
      expect(nav.drawerExpanded).toBeFalse();

      nav.onResizeStart({ preventDefault: () => undefined, clientX: 300 } as never);

      expect(nav.drawerExpanded).toBeTrue();

      // onResizeStart put two listeners on WINDOW - they outlive this spec
      // and hold a reference to this component if the drag is never ended.
      (nav as unknown as { onResizeEnd(): void }).onResizeEnd();
      expect(nav.drawerExpanded).toBeFalse();
    });
  });
});
