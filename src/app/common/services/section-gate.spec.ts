import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PermissionService } from './permission.service';
import { AdminAuthService } from '../forms/admin/admin-auth.service';
import { Role } from '@impact-common/shared/lists/roles.enum';
import { NAV_SECTIONS } from '../../core/main-screen/nav-config';

// THE TAB-LEVEL ROLE GATE (2026-08-30, owner's call; Site widened 2026-09-03):
//
//   Site     Administrators, Root and Employees - and past the tab, the
//            per-screen grant decides
//   Admin    Administrators, Root and Employees
//   Library  no gate; the items decide
//
// This is an ACCESS-CONTROL boundary, not a display preference, which is why
// it is tested here against PermissionService rather than only against the
// drawer. Hiding a tab stops nobody typing a URL - if this gate lived only in
// MainScreenComponent, an Employee holding a grant on a Site screen would
// still reach it, and the drawer would have told us it was safe.
//
// SITE USED TO BE ADMIN/ROOT ONLY, and this file asserted that in three
// tests for four days after it stopped being true. The owner reversed it on
// 2026-09-03 for an Employee who administers Coaching with Impact and
// Disciple Making Minute and nothing else; delegating PORTIONS of the site is
// the pattern going forward. The tests went red and stayed red, which is the
// part worth not repeating: a red suite that everyone knows about protects
// nothing, and this one guards who can edit the public website.
//
// So the SHAPE of what is guarded changed rather than the fact of it. The
// blanket refusal is gone; what replaced it is narrower and needs saying
// out loud - an Employee reaches exactly the Site screens they hold a grant
// on, and no others, by URL or otherwise. That is now the test that matters
// most in this file.
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
      expect(NAV_SECTIONS.find((s) => s.id === 'site')?.roles).toEqual([Role.ADMIN, Role.EMPLOYEE]);
      expect(serviceFor(Role.ROOT).canView('page-manager.give')).toBeTrue();
    });

    it('lets an Employee in on a screen they hold', () => {
      // The 2026-09-03 reversal. Before it, a grant was not enough on this
      // tab and this expectation was toBeFalse().
      const svc = serviceFor(Role.EMPLOYEE, granted('page-manager.give'));
      expect(svc.canView('page-manager.give')).toBeTrue();
    });

    it('REFUSES an Employee on a Site screen they do NOT hold', () => {
      // WHAT NOW CARRIES THE WEIGHT the blanket refusal used to. Delegating
      // one page must not delegate the site: this user administers Coaching
      // with Impact and nothing else, and the URL of any other page has to
      // stay shut. Enforced in canView() rather than only in the drawer,
      // because a hidden row is not a closed door.
      const svc = serviceFor(Role.EMPLOYEE, granted('page-manager.coaching-with-impact'));

      expect(svc.canView('page-manager.coaching-with-impact')).toBeTrue();
      for (const key of ['page-manager.about-us', 'page-manager.give', 'data.products',
        'navigation', 'footer']) {
        expect(svc.canView(key)).withContext(`${key} let an Employee through`).toBeFalse();
      }
    });

    it('reaches each Site group only where the grant actually is', () => {
      // The groups on this tab are four, and a grant on one must not carry
      // to the others - they were a single Admin/Root decision until
      // 2026-09-03 and are four independent ones now.
      const svc = serviceFor(Role.EMPLOYEE, granted('data.products'));

      expect(svc.canView('data.products')).toBeTrue();
      expect(svc.canView('data.testimonials')).toBeFalse();
      expect(svc.canView('page-manager.about-us')).toBeFalse();
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
