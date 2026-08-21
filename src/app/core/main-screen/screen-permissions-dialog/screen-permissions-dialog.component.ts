import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { ScreenPermission } from 'src/app/common/models/admin/screen-permission.model';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { Role } from '@impact-common/shared/lists/roles.enum';

export interface ScreenPermissionsDialogData {
  screenKey: string;
  screenLabel: string;
}

type PermissionAction = 'view' | 'add' | 'edit' | 'delete';

interface UserPermissionRow {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
}

// The left nav's per-screen "who has access" view - opened from a small
// icon next to a screen's pin toggle (see main-screen.component.html), one
// per NAV_CONFIG screen. Mirrors impact-discipleship-library-manager-new's
// own tree-node "Manage Permissions" menu (PermissionDialogComponent) -
// same shape (one row per user, View/Add/Edit/Delete checkboxes, Admin/Root
// shown as a non-editable "Full access" badge instead of checkboxes) but
// against this app's static screenKey rather than a Firestore content-tree
// node id. This is the inverse view of Admin Users' own Permissions tab
// (that's "one employee x every screen"; this is "one screen x every
// employee") - same underlying AdminUser.permissions[] data, edited from
// whichever direction is more convenient at the time.
@Component({
    selector: 'app-screen-permissions-dialog',
    templateUrl: './screen-permissions-dialog.component.html',
    styleUrls: ['./screen-permissions-dialog.component.scss'],
    standalone: false
})
export class ScreenPermissionsDialogComponent implements OnInit {
  loading = true;
  rows: UserPermissionRow[] = [];

  // Full AdminUser records keyed by id, populated alongside rows - toggle()
  // writes back through these (a full setDoc, no merge - see
  // AdminUserService.update()) rather than re-fetching each record on every
  // single checkbox click.
  private usersById = new Map<string, AdminUser>();

  constructor(
    private userService: AdminUserService,
    @Inject(MAT_DIALOG_DATA) public data: ScreenPermissionsDialogData,
    private dialogRef: MatDialogRef<ScreenPermissionsDialogComponent>
  ) {}

  ngOnInit(): void {
    this.userService.getAll().then((users) => {
      this.rows = users
        .map((user) => {
          this.usersById.set(user.id!, user);
          const grant = user.permissions?.find((p) => p.screenKey === this.data.screenKey);
          return {
            id: user.id!,
            displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
            email: user.email,
            role: user.role,
            view: grant?.view ?? false,
            add: grant?.add ?? false,
            edit: grant?.edit ?? false,
            delete: grant?.delete ?? false
          };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      this.loading = false;
    });
  }

  isFullAccess(row: UserPermissionRow): boolean {
    return row.role === Role.ADMIN || row.role === Role.ROOT;
  }

  toggle(row: UserPermissionRow, action: PermissionAction, event: MatCheckboxChange): void {
    const user = this.usersById.get(row.id);
    if (!user) {
      return;
    }

    const checked = event.checked;
    const previous = { ...row };
    row[action] = checked;

    const existing = user.permissions ?? [];
    const index = existing.findIndex((p) => p.screenKey === this.data.screenKey);
    const updated: ScreenPermission = {
      screenKey: this.data.screenKey,
      view: row.view,
      add: row.add,
      edit: row.edit,
      delete: row.delete
    };
    const hasAnyGrant = updated.view || updated.add || updated.edit || updated.delete;

    let nextPermissions: ScreenPermission[];
    if (hasAnyGrant) {
      nextPermissions = index >= 0 ? existing.map((p, i) => (i === index ? updated : p)) : [...existing, updated];
    } else {
      // All 4 unchecked - drop the grant entirely rather than keep a dead
      // all-false record, matching the Admin Users Permissions tab's own
      // save convention.
      nextPermissions = index >= 0 ? existing.filter((_, i) => i !== index) : existing;
    }

    const updatedUser: AdminUser = { ...user, permissions: nextPermissions };

    this.userService.update(row.id, updatedUser).then(() => {
      this.usersById.set(row.id, updatedUser);
    }).catch((err) => {
      console.error('ScreenPermissionsDialogComponent: failed to save permission change:', err);
      Object.assign(row, previous);
    });
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
