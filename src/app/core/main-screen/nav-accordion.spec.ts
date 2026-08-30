import { MainScreenComponent } from './main-screen.component';
import { NAV_CONFIG } from './nav-config';

// The left nav became ACCORDION-EXCLUSIVE on 2026-08-29 (owner's call):
// opening one manager group closes the last. Two paths open a group - a
// click on its header, and navigation landing inside it (left nav, the
// new-record-alerts bell, a bookmarked URL) - and the rule only holds if
// BOTH go through openGroup(). Missing the navigation one is the failure
// that looks fine until you use the bell, so it is pinned here.
//
// Hand-constructed with duck-typed deps: none of this touches a service.

function shell(): MainScreenComponent {
  return new MainScreenComponent(
    null as never, // AdminAuthService
    null as never, // PermissionService
    null as never, // PermissionMigrationService
    null as never, // AdminUserService
    null as never, // MatDialog
    { url: '/', events: { pipe: () => ({ subscribe: () => undefined }) } } as never, // Router
    null as never // Injector - only used by afterNextRender, never on this path
  );
}

/** syncActiveFromUrl is private - it is the navigation path, and reaching it
 *  through the type is honest about that rather than widening the API. */
function navigateTo(component: MainScreenComponent, url: string): void {
  (component as unknown as { syncActiveFromUrl(u: string): void }).syncActiveFromUrl(url);
}

describe('left nav accordion', () => {
  it('opens a group', () => {
    const nav = shell();

    nav.toggleGroup('page-manager');

    expect([...nav.expanded]).toEqual(['page-manager']);
  });

  it('closes the previous group when another opens', () => {
    const nav = shell();

    nav.toggleGroup('page-manager');
    nav.toggleGroup('campaigns-manager');

    expect([...nav.expanded]).toEqual(['campaigns-manager']);
  });

  it('never holds more than one group however many are opened', () => {
    const nav = shell();

    for (const group of NAV_CONFIG) {
      nav.toggleGroup(group.id);
      expect(nav.expanded.size).toBeLessThanOrEqual(1);
    }
  });

  it('collapsing the open group leaves nothing open', () => {
    // Deliberate: a group that springs back when you close it reads as
    // broken. Navigation reopens the right one anyway.
    const nav = shell();

    nav.toggleGroup('page-manager');
    nav.toggleGroup('page-manager');

    expect(nav.expanded.size).toBe(0);
  });

  it('navigating into a group opens it', () => {
    const nav = shell();

    navigateTo(nav, '/page-manager?tab=home');

    expect([...nav.expanded]).toEqual(['page-manager']);
    expect(nav.activeGroupId).toBe('page-manager');
    expect(nav.activeSlug).toBe('home');
  });

  it('navigating into a DIFFERENT group closes the one that was open', () => {
    // The bell deep-links across managers, which is exactly where a
    // navigation path that only added would leave two groups open.
    const nav = shell();

    nav.toggleGroup('page-manager');
    navigateTo(nav, '/campaigns-manager?tab=campaigns');

    expect([...nav.expanded]).toEqual(['campaigns-manager']);
  });
});
