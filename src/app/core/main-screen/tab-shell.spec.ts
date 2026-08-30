import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { SitePagesNavService } from 'src/app/page-manager/pages/site-pages-nav.service';
import { PageManagerComponent } from 'src/app/page-manager/page-manager.component';
import { AdminManagerComponent } from 'src/app/admin-manager/admin-manager.component';

// CHARACTERIZATION tests, written BEFORE the nine *-manager tab shells are
// collapsed onto one base (2026-08-27 sweep, P2). They describe what the
// shells do TODAY so the extraction has something to change against.
//
// This matters more than an ordinary dedupe because TWO SECURITY FIXES were
// replicated across those nine copies by hand, and each shell's comment
// points at a DIFFERENT sibling for the reasoning - contacts cites events,
// library cites contacts, everyone cites campaigns - so the explanation has
// no owner and a tenth manager is copy-paste #10.
//
// The two behaviours that must survive the extraction:
//
//   1. selectedTab starts EMPTY. A hardcoded default tab renders a screen's
//      content to anyone whose secureItems is empty - the direct-URL bypass
//      admin-manager's own comment warns about.
//   2. Permissions and ?tab= are read as a LIVE combineLatest, not once.
//      The left nav lets an admin click between sibling tabs on the same
//      route, which Angular resolves as a query-param-only navigation: no
//      new component instance, ngOnInit does not re-fire, and a snapshot
//      read would go stale after the first click. A later permission
//      emission must also re-filter (the cold-load race, live-diagnosed
//      2026-08-18).
//
// Plus the one real divergence: admin-manager ALSO gates the E2E Dashboard
// to Root, which no permission grant can express.

interface NavItemLike { slug: string; label: string }
interface ShellLike {
  items: NavItemLike[];
  secureItems: NavItemLike[];
  selectedTab: string;
  ngOnInit(): void;
  ngOnDestroy(): void;
}

/** Grants exactly the slugs it is given. */
class FakePermissionService {
  readonly allowed = new Set<string>();
  canViewNavItem(_group: unknown, item: NavItemLike): boolean {
    return this.allowed.has(item.slug);
  }
}

/** A ParamMap-shaped object carrying one ?tab= value. */
function paramMap(tab?: string) {
  return { get: (key: string) => (key === 'tab' ? tab ?? null : null) };
}

/** The live inputs both shells combineLatest over. */
function harness(allowed: string[], role = 'Admin') {
  const permissions = new FakePermissionService();
  allowed.forEach((slug) => permissions.allowed.add(slug));

  const loggedInUser$ = new BehaviorSubject<unknown>({ role });
  const queryParamMap$ = new BehaviorSubject(paramMap());

  return {
    permissions,
    loggedInUser$,
    queryParamMap$,
    authService: { dao: { loggedInUser$ } },
    route: { queryParamMap: queryParamMap$ as unknown as Observable<unknown> },
  };
}

describe('tab shells (characterization, pre-extraction)', () => {
  describe('PageManagerComponent', () => {
    // PageManagerComponent takes SitePagesNavService via inject() since
    // 2026-08-30 (the created pages' nav leaves), so a bare `new` throws
    // NG0203. The house rule (CLAUDE.md, the designer-side-panel case):
    // construct inside an injection context, do NOT move the dependency
    // back to the constructor. No created pages in these specs - the
    // stream is empty, so every assertion below is unchanged.
    const pagesNavStub = { leaves: [], leaves$: of([]) };
    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{ provide: SitePagesNavService, useValue: pagesNavStub }]
      });
    });
    const construct = (auth: never, perms: never, route: never): ShellLike =>
      TestBed.runInInjectionContext(() => new PageManagerComponent(auth, perms, route)) as unknown as ShellLike;

    it('starts with NO selected tab - the direct-URL bypass guard', () => {
      const h = harness([]);
      const shell = construct(h.authService as never, h.permissions as never, h.route as never);

      expect(shell.selectedTab)
        .withContext('a pre-seeded default renders content to someone with no grants')
        .toBe('');
    });

    it('shows nothing when the user has no grants for this group', () => {
      const h = harness([]);
      const shell = construct(h.authService as never, h.permissions as never, h.route as never);

      shell.ngOnInit();
      expect(shell.secureItems.length).toBe(0);
      expect(shell.selectedTab).toBe('');
      shell.ngOnDestroy();
    });

    it('re-filters when permissions re-emit - the cold-load race', () => {
      // Live-diagnosed 2026-08-18: permissions arrive AFTER first render, so
      // reading them once leaves the tab list empty forever.
      const h = harness([]);
      const shell = construct(h.authService as never, h.permissions as never, h.route as never);

      shell.ngOnInit();
      expect(shell.secureItems.length).toBe(0);

      h.permissions.allowed.add(shell.items[0].slug);
      h.loggedInUser$.next({ role: 'Admin' });

      expect(shell.secureItems.length)
        .withContext('a later permission emission must re-filter')
        .toBeGreaterThan(0);
      shell.ngOnDestroy();
    });

    it('opens the tab named by ?tab= when it is permitted', () => {
      const probe = construct(null as never, null as never, null as never);
      const target = probe.items[1] ?? probe.items[0];

      const h = harness(probe.items.map((i) => i.slug));
      const shell = construct(h.authService as never, h.permissions as never, h.route as never);

      shell.ngOnInit();
      h.queryParamMap$.next(paramMap(target.slug));

      expect(shell.selectedTab).toBe(target.label);
      shell.ngOnDestroy();
    });

    it('IGNORES ?tab= for a screen the user may not see', () => {
      const probe = construct(null as never, null as never, null as never);
      const forbidden = probe.items[probe.items.length - 1];

      const h = harness(
        probe.items.filter((i) => i.slug !== forbidden.slug).map((i) => i.slug)
      );
      const shell = construct(h.authService as never, h.permissions as never, h.route as never);

      shell.ngOnInit();
      h.queryParamMap$.next(paramMap(forbidden.slug));

      expect(shell.selectedTab)
        .withContext('typing a slug must not open a screen you lack')
        .not.toBe(forbidden.label);
      shell.ngOnDestroy();
    });

    it('stops filtering after destroy', () => {
      const h = harness([]);
      const shell = construct(h.authService as never, h.permissions as never, h.route as never);

      shell.ngOnInit();
      shell.ngOnDestroy();

      h.permissions.allowed.add(shell.items[0].slug);
      h.loggedInUser$.next({ role: 'Admin' });

      expect(shell.secureItems.length)
        .withContext('takeUntil must end the subscription')
        .toBe(0);
    });
  });

  describe('AdminManagerComponent - the one real divergence', () => {
    it('hides the E2E Dashboard from a non-Root Admin even WITH the grant', () => {
      // No permission grant can express ROOT-only, so canViewNavItem passes
      // any Admin. Without the extra check, ?tab=e2e-dashboard lets them in.
      const probe = new AdminManagerComponent(
        null as never, null as never, null as never
      ) as unknown as ShellLike;

      const h = harness(probe.items.map((i) => i.slug), 'Admin');
      const shell = new AdminManagerComponent(
        h.authService as never, h.permissions as never, h.route as never
      ) as unknown as ShellLike;

      shell.ngOnInit();
      h.queryParamMap$.next(paramMap('e2e-dashboard'));

      expect(shell.secureItems.some((i) => i.slug === 'e2e-dashboard'))
        .withContext('an Admin must not reach the Root-only dashboard')
        .toBe(false);
      shell.ngOnDestroy();
    });

    it('shows the E2E Dashboard to Root', () => {
      const probe = new AdminManagerComponent(
        null as never, null as never, null as never
      ) as unknown as ShellLike;

      const h = harness(probe.items.map((i) => i.slug), 'Root');
      const shell = new AdminManagerComponent(
        h.authService as never, h.permissions as never, h.route as never
      ) as unknown as ShellLike;

      shell.ngOnInit();
      h.queryParamMap$.next(paramMap('e2e-dashboard'));

      expect(shell.secureItems.some((i) => i.slug === 'e2e-dashboard')).toBe(true);
      shell.ngOnDestroy();
    });
  });
});

void Subject;
