import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PermissionService } from './permission.service';
import { AdminAuthService } from '../forms/admin/admin-auth.service';
import { Role } from '@impact-common/shared/lists/roles.enum';
import { NAV_SECTIONS } from '../../core/main-screen/nav-config';

// THE TAB-LEVEL ROLE GATE (2026-08-30, owner's call):
//
//   Site     Administrators and Root only - what the public sees is not
//            delegated, whatever an Employee may be granted underneath
//   Admin    Administrators, Root and Employees
//   Library  no gate; the items decide
//
// This is an ACCESS-CONTROL boundary, not a display preference, which is why
// it is tested here against PermissionService rather than only against the
// drawer. Hiding a tab stops nobody typing a URL - if this gate lived only in
// MainScreenComponent, an Employee holding a grant on a Site screen would
// still reach it, and the drawer would have told us it was safe.
//
// TestBed-as-injector: PermissionService takes AdminAuthService through the
// constructor and reads a stream from it, so it needs a real injector but no
// template.

function serviceFor(role: Role | undefined, permissions: { screenKey: string; view: boolean }[] = []) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      PermissionService,
      {
        provide: AdminAuthService,
        useValue: { dao: { loggedInUser$: of(role ? { role, permissions } : null) } }
      }
    ]
  });
  return TestBed.inject(PermissionService);
}

/** A grant broad enough that only the tab gate could refuse it. */
const granted = (key: string) => [{ screenKey: key, view: true }];

describe('the tab-level role gate', () => {
  describe('the Site tab - the public website', () => {
    it('lets an Administrator in', () => {
      expect(serviceFor(Role.ADMIN).canView('page-manager.give')).toBeTrue();
      expect(serviceFor(Role.ADMIN).canView('navigation')).toBeTrue();
      expect(serviceFor(Role.ADMIN).canView('footer')).toBeTrue();
      expect(serviceFor(Role.ADMIN).canView('data.products')).toBeTrue();
    });

    it('lets Root in, without Root being listed anywhere', () => {
      // hasRole() gives Root everything Admin has. Listing Root on each tab
      // would be a second place for that rule to drift.
      expect(NAV_SECTIONS.find((s) => s.id === 'site')?.roles).toEqual([Role.ADMIN]);
      expect(serviceFor(Role.ROOT).canView('page-manager.give')).toBeTrue();
    });

    it('REFUSES an Employee even when they hold a grant on the screen', () => {
      // The whole point. A grant is not enough on this tab, and the grant is
      // deliberately present so the refusal cannot come from anywhere else.
      const svc = serviceFor(Role.EMPLOYEE, granted('page-manager.give'));
      expect(svc.canView('page-manager.give')).toBeFalse();
    });

    it('REFUSES an Employee on every group that sits on the Site tab', () => {
      const svc = serviceFor(Role.EMPLOYEE, [
        ...granted('page-manager.about-us'),
        ...granted('data.products'),
        ...granted('navigation'),
        ...granted('footer')
      ]);
      for (const key of ['page-manager.about-us', 'data.products', 'navigation', 'footer']) {
        expect(svc.canView(key)).withContext(`${key} let an Employee through`).toBeFalse();
      }
    });

    it('REFUSES an Editor, who is scoped to Library anyway', () => {
      expect(serviceFor(Role.EDITOR, granted('data.products')).canView('data.products')).toBeFalse();
    });
  });

  describe('the Admin tab - the back office', () => {
    it('lets an Employee in where they hold a grant', () => {
      const svc = serviceFor(Role.EMPLOYEE, granted('contacts-manager.contacts'));
      expect(svc.canView('contacts-manager.contacts')).toBeTrue();
    });

    it('still refuses an Employee where they hold NO grant', () => {
      // The tab gate only ever narrows - it does not hand out access the
      // grant system would have refused.
      const svc = serviceFor(Role.EMPLOYEE, granted('contacts-manager.contacts'));
      expect(svc.canView('events-manager.summit')).toBeFalse();
    });

    it('refuses an Editor, who is hard-scoped to Library', () => {
      expect(serviceFor(Role.EDITOR, granted('contacts-manager.contacts'))
        .canView('contacts-manager.contacts')).toBeFalse();
    });
  });

  describe('the Library tab - no gate, the items decide', () => {
    it('carries no role list at all', () => {
      expect(NAV_SECTIONS.find((s) => s.id === 'library')?.roles).toBeUndefined();
    });

    it('lets an Editor in', () => {
      expect(serviceFor(Role.EDITOR).canView('library-manager.browse')).toBeTrue();
    });

    it('still refuses an Employee, because every Library item refuses them', () => {
      // Not the tab gate doing this - employeeGrantable: false on each leaf.
      // Asserted so that removing the tab gate later cannot silently open
      // Library to Employees.
      const svc = serviceFor(Role.EMPLOYEE, granted('library-manager.browse'));
      expect(svc.canView('library-manager.browse', false)).toBeFalse();
    });
  });

  describe('the gate cannot lock anybody out by accident', () => {
    it('lets a key through when its group is not in the registry', () => {
      // A stale or unknown key is the grant lookup's problem, not this
      // gate's. Being permissive here is safe: the gate only ever narrows on
      // top of a grant that was already required.
      const svc = serviceFor(Role.EMPLOYEE, granted('no-such-manager.thing'));
      expect(svc.canView('no-such-manager.thing')).toBeTrue();
    });

    it('never narrows anything for an Administrator', () => {
      const svc = serviceFor(Role.ADMIN);
      for (const key of ['navigation', 'footer', 'data.products', 'library-manager.browse',
        'contacts-manager.contacts', 'no-such-manager.thing']) {
        expect(svc.canView(key)).withContext(key).toBeTrue();
      }
    });
  });
});
