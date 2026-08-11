import { Injectable } from '@angular/core';
import { AdminAuthService } from '../forms/admin/admin-auth.service';
import { AdminUserService } from './data/admin-user.service';
import { Role } from '../lists/roles.enum';
import { ScreenPermission } from '../models/admin/screen-permission.model';

// A handful of things already allowed Employee role broadly before this
// permission system existed: Events' Attendees tab
// (isVisible(['Admin','Employee'])), and Purchases/Fulfillment's nav
// entries (NavLeaf.roles: [Admin, Employee]) - none of which had any
// further Add/Edit/Delete restriction once visible, so full CRUD is the
// accurate "what they could already do" baseline to seed. Purchases/
// Fulfillment's screenKey prefix changed from store-manager to
// customers-manager in the 2026-08 nav reorg (see nav-config.ts's own
// comment) - updated here too, or this seed would silently write dead keys
// that match nothing in the current registry the next time it fires.
const LEGACY_EMPLOYEE_GRANTS: ScreenPermission[] = [
  { screenKey: 'events-manager.events.attendees', view: true, add: true, edit: true, delete: true },
  { screenKey: 'customers-manager.purchases', view: true, add: true, edit: true, delete: true },
  { screenKey: 'customers-manager.fulfillment', view: true, add: true, edit: true, delete: true }
];

// One-time, idempotent seed for Employee accounts that existed before this
// granular permission system shipped - not a standalone migration script,
// just a check that runs on the next login for any Employee whose
// AdminUser.permissions is still `undefined` (never touched by this
// system). Writing a permissions array - even the seed above - marks that
// account "migrated" for good; this never re-runs or re-seeds after that,
// even if an Admin later revokes everything down to `[]`.
//
// New Employees created after this system shipped start at `permissions: []`
// on their own (see AdminUserDialogComponent's create path) and are
// deliberately NOT touched here - only `undefined` qualifies.
//
// providedIn: 'root' alone doesn't instantiate this - something has to
// actually inject it once to start the subscription. MainScreenComponent
// does that (the shell every authenticated route mounts inside), purely to
// trigger construction.
@Injectable({
  providedIn: 'root'
})
export class PermissionMigrationService {
  constructor(authService: AdminAuthService, private userService: AdminUserService) {
    authService.dao.loggedInUser$.subscribe((user) => {
      if (user?.id && user.role === Role.EMPLOYEE && user.permissions === undefined) {
        this.userService.update(user.id, { ...user, permissions: LEGACY_EMPLOYEE_GRANTS }).catch((err) => {
          console.error('PermissionMigrationService: failed to seed legacy Employee permissions:', err);
        });
      }
    });
  }
}
