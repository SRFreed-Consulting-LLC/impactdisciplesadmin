import { of } from 'rxjs';
import { PermissionService } from './permission.service';
import { AdminAuthService } from '../forms/admin/admin-auth.service';
import { AdminUser } from '../models/admin/admin-user.model';
import { Role } from '@impact-common/shared/lists/roles.enum';
import { ScreenPermission } from '../models/admin/screen-permission.model';

// PermissionService's only real dependency is
// authService.dao.loggedInUser$ - a plain object matching that shape
// stands in for the whole AdminAuthService/FireAuthDao/AngularFire DI
// graph, which would otherwise need a real Firebase app to construct.
function authServiceWith(user: Partial<AdminUser> | null): AdminAuthService {
  return { dao: { loggedInUser$: of(user as AdminUser | null) } } as unknown as AdminAuthService;
}

function employeeWith(permissions: ScreenPermission[]): AdminAuthService {
  return authServiceWith({ role: Role.EMPLOYEE, permissions });
}

describe('PermissionService', () => {
  describe('isFullAccess', () => {
    it('is true for Admin', () => {
      const service = new PermissionService(authServiceWith({ role: Role.ADMIN }));
      expect(service.isFullAccess()).toBeTrue();
    });

    it('is true for Root, via hasRole()\'s own Root-inherits-Admin fallthrough', () => {
      const service = new PermissionService(authServiceWith({ role: Role.ROOT }));
      expect(service.isFullAccess()).toBeTrue();
    });

    it('is false for Employee', () => {
      const service = new PermissionService(employeeWith([]));
      expect(service.isFullAccess()).toBeFalse();
    });

    it('is false with no signed-in user', () => {
      const service = new PermissionService(authServiceWith(null));
      expect(service.isFullAccess()).toBeFalse();
    });
  });

  describe('effectivePermission', () => {
    it('grants everything to Admin regardless of any stored grant', () => {
      const service = new PermissionService(authServiceWith({ role: Role.ADMIN, permissions: [] }));
      expect(service.effectivePermission('any-screen')).toEqual({ view: true, add: true, edit: true, delete: true });
    });

    it('derives view from any of add/edit/delete for an Employee grant', () => {
      const service = new PermissionService(employeeWith([
        { screenKey: 'a', view: false, add: true, edit: false, delete: false }
      ]));
      expect(service.effectivePermission('a').view).toBeTrue();
    });

    it('is all-false for a key with no grant at all', () => {
      const service = new PermissionService(employeeWith([]));
      expect(service.effectivePermission('nope')).toEqual({ view: false, add: false, edit: false, delete: false });
    });
  });

  describe('canView - ancestor inheritance', () => {
    it('a grant 3 levels deep makes both ancestors canView-true without granting them real rights', () => {
      const service = new PermissionService(employeeWith([
        { screenKey: 'events-manager.events.attendees', view: true, add: false, edit: false, delete: false }
      ]));

      expect(service.canView('events-manager')).toBeTrue();
      expect(service.canView('events-manager.events')).toBeTrue();
      expect(service.canView('events-manager.events.attendees')).toBeTrue();

      // Inherited visibility never becomes real add/edit/delete rights on
      // the ancestor screens.
      expect(service.canAdd('events-manager.events')).toBeFalse();
      expect(service.canEdit('events-manager.events')).toBeFalse();
      expect(service.canDelete('events-manager.events')).toBeFalse();
    });

    it('does not leak visibility to an unrelated sibling screen', () => {
      const service = new PermissionService(employeeWith([
        { screenKey: 'events-manager.events.attendees', view: true, add: false, edit: false, delete: false }
      ]));

      expect(service.canView('events-manager.coaches')).toBeFalse();
    });

    it('returns false with no grant anywhere under the key', () => {
      const service = new PermissionService(employeeWith([]));
      expect(service.canView('events-manager')).toBeFalse();
    });

    it('a grant that is all-false does not count as inheritable (matches library-app "empty grant = no grant" convention)', () => {
      const service = new PermissionService(employeeWith([
        { screenKey: 'events-manager.events.attendees', view: false, add: false, edit: false, delete: false }
      ]));
      expect(service.canView('events-manager')).toBeFalse();
    });
  });

  describe('the Site tab, delegated by screen (2026-09-03)', () => {
    const grants: ScreenPermission[] = [
      { screenKey: 'page-manager.coaching-with-impact', view: true, add: true, edit: true, delete: true },
      { screenKey: 'data.disciple-making-minute', view: true, add: false, edit: true, delete: false }
    ];

    it('an Employee sees exactly the Site screens they hold a grant on', () => {
      const service = new PermissionService(employeeWith(grants));
      expect(service.canView('page-manager.coaching-with-impact')).toBeTrue();
      expect(service.canView('data.disciple-making-minute')).toBeTrue();
      // The group headers inherit view, so the drawer can show the way in.
      expect(service.canView('page-manager')).toBeTrue();
      expect(service.canView('data')).toBeTrue();
      // Neighbours on the same tab, same groups: refused.
      expect(service.canView('page-manager.about-us')).toBeFalse();
      expect(service.canView('data.products')).toBeFalse();
      expect(service.canView('footer.docking-bar')).toBeFalse();
    });

    it('an Editor is still kept off the Site tab, grants or not', () => {
      const service = new PermissionService(authServiceWith({ role: Role.EDITOR, permissions: grants }));
      expect(service.canView('page-manager.coaching-with-impact')).toBeFalse();
      expect(service.canView('data.disciple-making-minute')).toBeFalse();
    });
  });

  describe('employeeGrantable hard block', () => {
    it('blocks view even with a direct grant on that exact key', () => {
      const service = new PermissionService(employeeWith([
        { screenKey: 'admin-manager.admin-users', view: true, add: true, edit: true, delete: true }
      ]));

      expect(service.canView('admin-manager.admin-users', false)).toBeFalse();
    });

    it('does not block Admin/Root - isFullAccess() short-circuits first', () => {
      const service = new PermissionService(authServiceWith({ role: Role.ADMIN }));
      expect(service.canView('admin-manager.admin-users', false)).toBeTrue();
    });
  });

  describe('buildPermissionTree', () => {
    it('excludes Home and any employeeGrantable: false leaf (Admin Users)', () => {
      const service = new PermissionService(authServiceWith({ role: Role.ADMIN }));
      const tree = service.buildPermissionTree();

      expect(tree.some((n) => n.key === 'home')).toBeFalse();
      expect(tree.some((n) => n.key === 'admin-manager.admin-users')).toBeFalse();
    });

    it('lists streamed page leaves under PAGES so ONE page can be granted', () => {
      // PAGES has no static leaves - every page is a page_content document
      // (SitePagesNavService). Without this the editor offered the group as
      // a whole and never a page, and a page is the unit of delegation on
      // the Site tab since 2026-09-03.
      const service = new PermissionService(authServiceWith({ role: Role.ADMIN }));
      const tree = service.buildPermissionTree({
        'page-manager': [
          { label: 'Coaching with Impact', slug: 'coaching-with-impact' },
          { label: 'About Us', slug: 'about-us' }
        ]
      });

      expect(tree.some((n) => n.key === 'page-manager' && n.depth === 0)).toBeTrue();
      const coaching = tree.find((n) => n.key === 'page-manager.coaching-with-impact');
      expect(coaching?.label).toBe('Coaching with Impact');
      expect(coaching?.depth).toBe(1);
      expect(tree.some((n) => n.key === 'page-manager.about-us')).toBeTrue();
    });

    it('offers no PAGES rows at all when no pages have streamed in yet', () => {
      const service = new PermissionService(authServiceWith({ role: Role.ADMIN }));
      const tree = service.buildPermissionTree();
      expect(tree.some((n) => n.key.startsWith('page-manager'))).toBeFalse();
    });

    it('includes Events\' tabs as depth-2 rows under the Events screen', () => {
      const service = new PermissionService(authServiceWith({ role: Role.ADMIN }));
      const tree = service.buildPermissionTree();

      const attendeesRow = tree.find((n) => n.key === 'events-manager.events.attendees');
      expect(attendeesRow).toBeTruthy();
      expect(attendeesRow?.depth).toBe(2);
    });
  });
});
