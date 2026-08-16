import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { LibraryPermissionService } from 'src/app/common/services/data/library/library-permission.service';
import { Role } from 'src/app/common/lists/roles.enum';
import { LibraryNodeType } from 'src/app/common/models/domain/library/library-node-permission.model';

export interface LibraryPermissionDialogData {
  nodeType: LibraryNodeType;
  nodeId: string;
  nodeTitle: string;
}

type LibraryPermissionAction = 'view' | 'add' | 'edit' | 'delete';

interface LibraryPermissionRow {
  docId: string;
  displayName: string;
  email: string;
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
}

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/shell/dialogs/permission-dialog.component.ts. Only lists
 * Role.EDITOR accounts - Admin/Root always have full access (not shown,
 * nothing to grant them), and Employee has no relationship to the Library
 * section at all (can't even see it, see nav-config.ts). Opened from a
 * "Manage Permissions" action on a Browse row (see that component).
 */
@Component({
  selector: 'app-library-permission-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule, MatProgressSpinnerModule],
  templateUrl: './library-permission-dialog.component.html',
  styleUrl: './library-permission-dialog.component.scss',
})
export class LibraryPermissionDialogComponent {
  private readonly adminUserService = inject(AdminUserService);
  private readonly permissionService = inject(LibraryPermissionService);
  readonly data = inject<LibraryPermissionDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly rows = signal<LibraryPermissionRow[]>([]);

  constructor() {
    this.adminUserService.getAll().then((users) => {
      this.rows.set(
        users
          .filter((user) => user.role === Role.EDITOR)
          .map((user) => {
            const grant = user.libraryPermissions?.find(
              (p) => p.nodeType === this.data.nodeType && p.nodeId === this.data.nodeId,
            );
            return {
              docId: user.id!,
              displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
              email: user.email,
              view: grant?.view ?? false,
              add: grant?.add ?? false,
              edit: grant?.edit ?? false,
              delete: grant?.delete ?? false,
            };
          }),
      );
      this.loading.set(false);
    });
  }

  async toggle(row: LibraryPermissionRow, action: LibraryPermissionAction, event: MatCheckboxChange): Promise<void> {
    const checked = event.checked;
    this.rows.set(this.rows().map((r) => (r.docId === row.docId ? { ...r, [action]: checked } : r)));
    await this.permissionService.setPermission(
      row.docId,
      this.data.nodeType,
      this.data.nodeId,
      { [action]: checked },
      { targetName: row.displayName, nodeTitle: this.data.nodeTitle },
    );
  }
}
