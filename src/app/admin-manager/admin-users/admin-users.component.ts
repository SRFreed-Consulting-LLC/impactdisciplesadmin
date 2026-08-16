import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { ScreenPermission } from 'src/app/common/models/admin/screen-permission.model';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService, PermissionNode } from 'src/app/common/services/permission.service';
import { Role } from 'src/app/common/lists/roles.enum';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

type PermissionAction = 'view' | 'add' | 'edit' | 'delete';

// One row of the Permissions tab's table - a registry node (from
// PermissionService.buildPermissionTree()) plus this particular user's
// current, editable grant on it. Checkboxes reflect ONLY explicit grants -
// never a synthesized "inherited" checked state (see PermissionService.
// canView()'s own comment on the view-only ancestor inheritance this table
// deliberately doesn't visualize).
interface PermissionRow extends PermissionNode {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
}

// Full-page in-place edit view (mode: 'list' | 'edit', no popup - see
// events.component.ts/products.component.ts for the established
// precedent this mirrors), replacing the old AdminUserDialogComponent -
// needed the extra room for the new Permissions tab's Manager > Screen >
// Tab table, which doesn't fit comfortably in a small dialog.
@Component({
    selector: 'app-admin-users',
    templateUrl: './admin-users.component.html',
    styleUrls: ['./admin-users.component.scss'],
    standalone: false
})
export class AdminUsersComponent implements OnInit {
  mode: 'list' | 'edit' = 'list';

  // ---- List state ----
  users$: Observable<AdminUser[]>;

  columns: DataGridColumn<AdminUser>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'phone', label: 'Number', value: (item) => item.phone?.number ?? '' }
  ];

  itemType = 'Admin User';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<AdminUser>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: (item) => !this.isSelf(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Used to hide the delete action on the signed-in admin's own row - the
  // deleteAdminUser Cloud Function already blocks this server-side, but
  // catching it client-side avoids a confusing failed-request round trip
  // for an action that was never going to succeed.
  private currentUserFirebaseUID: string | undefined;

  // ---- Edit state ----
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit = false;

  // Admin Users can be Admin, Employee, or Editor (the former standalone
  // library-manager app's staff role, ported in - see Role.EDITOR's own
  // comment) - Root is deliberately excluded (single, manually-assigned
  // account, not something assignable from this dropdown) unless the
  // record being edited is already Root, in which case it's added so the
  // field shows its real value instead of rendering blank - still editable
  // (e.g. to correct a mistake), just not offered to every other user.
  roles: Role[] = [Role.ADMIN, Role.EMPLOYEE, Role.EDITOR];

  // Every Manager > Screen > Tab row this user could be granted, plus
  // their current view/add/edit/delete state on each - built fresh every
  // time the edit view opens (buildPermissionRows()). Only shown/editable
  // when the form's role is Employee - Admin/Root always have full access
  // and have nothing to configure here (see PermissionService.isFullAccess()).
  permissionRows: PermissionRow[] = [];

  private editingItem: AdminUser | null = null;

  constructor(
    private service: AdminUserService,
    private authService: AdminAuthService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUserFirebaseUID = user?.firebaseUID;
    });

    this.users$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  isSelf(item: AdminUser): boolean {
    return !!item.firebaseUID && item.firebaseUID === this.currentUserFirebaseUID;
  }

  delete(item: AdminUser): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record? This also removes their login access.</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.deleteAdminUser(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        }).catch((err) => {
          this.snackbar.error('There was an error deleting the account: ' + (err?.message ?? 'Unknown error'));
        });
      }
    });
  }

  // ---- Edit view ----

  get isEmployeeRole(): boolean {
    return this.form?.get('role')?.value === Role.EMPLOYEE;
  }

  showAddModal(): void {
    this.editingItem = null;
    this.isEdit = false;
    this.roles = [Role.ADMIN, Role.EMPLOYEE, Role.EDITOR];
    this.buildForm(null);
    this.mode = 'edit';
  }

  showEditModal(item: AdminUser): void {
    this.editingItem = item;
    this.isEdit = true;
    this.roles = item.role === Role.ROOT ? [Role.ADMIN, Role.EMPLOYEE, Role.EDITOR, Role.ROOT] : [Role.ADMIN, Role.EMPLOYEE, Role.EDITOR];
    this.buildForm(item);
    this.mode = 'edit';
  }

  private buildForm(item: AdminUser | null): void {
    // Email is the real Firebase Auth sign-in identity once an account is
    // linked (firebaseUID set) - editing it here would only change the
    // Firestore copy and desync it from what the person actually signs in
    // with, since changing a Firebase Auth account's own email needs the
    // Admin SDK, which update() doesn't call. Only editable while adding a
    // new (not-yet-linked) account.
    const emailLocked = !!item?.firebaseUID;
    this.form = this.fb.group({
      firstName: [item?.firstName ?? '', Validators.required],
      lastName: [item?.lastName ?? '', Validators.required],
      email: [{ value: item?.email ?? '', disabled: emailLocked }, Validators.required],
      role: [item?.role ?? null, Validators.required],
      firebaseUID: [{ value: item?.firebaseUID ?? '', disabled: true }],
      phone: this.fb.group({
        countryCode: [item?.phone?.countryCode ?? ''],
        number: [item?.phone?.number ?? ''],
        type: [item?.phone?.type ?? null]
      }),
      shippingAddress: this.fb.group({
        address1: [item?.shippingAddress?.address1 ?? ''],
        address2: [item?.shippingAddress?.address2 ?? ''],
        city: [item?.shippingAddress?.city ?? ''],
        state: [item?.shippingAddress?.state ?? ''],
        zip: [item?.shippingAddress?.zip ?? ''],
        country: [item?.shippingAddress?.country ?? '']
      }),
      billingAddress: this.fb.group({
        address1: [item?.billingAddress?.address1 ?? ''],
        address2: [item?.billingAddress?.address2 ?? ''],
        city: [item?.billingAddress?.city ?? ''],
        state: [item?.billingAddress?.state ?? ''],
        zip: [item?.billingAddress?.zip ?? ''],
        country: [item?.billingAddress?.country ?? '']
      })
    });

    this.buildPermissionRows(item);
  }

  private buildPermissionRows(item: AdminUser | null): void {
    const existing = item?.permissions ?? [];
    this.permissionRows = this.permissionService.buildPermissionTree().map((node) => {
      const grant = existing.find((p) => p.screenKey === node.key);
      return { ...node, view: grant?.view ?? false, add: grant?.add ?? false, edit: grant?.edit ?? false, delete: grant?.delete ?? false };
    });
  }

  toggle(row: PermissionRow, action: PermissionAction, checked: boolean): void {
    row[action] = checked;
  }

  // Drops rows with all 4 boxes unchecked before persisting - matches the
  // sibling app's own setPermission() convention of not storing empty
  // grants (see PermissionService's file comment).
  private buildPermissionsPayload(): ScreenPermission[] {
    return this.permissionRows
      .filter((row) => row.view || row.add || row.edit || row.delete)
      .map((row) => ({ screenKey: row.key, view: row.view, add: row.add, edit: row.edit, delete: row.delete }));
  }

  onCancel(): void {
    this.inProgress$.next(false);
    this.mode = 'list';
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const raw = this.form.getRawValue();
    // Only Employee accounts have a meaningful permissions array - Admin/
    // Root always have full access (PermissionService.isFullAccess()) and
    // this table isn't even shown for them, so don't write stale/unrelated
    // grants onto their record.
    const permissions = raw.role === Role.EMPLOYEE ? this.buildPermissionsPayload() : this.editingItem?.permissions;

    if (this.isEdit) {
      const value: AdminUser = { ...this.editingItem, ...raw, permissions };
      this.service.update(value.id!, value).then((result) => {
        if (result) {
          this.snackbar.success(this.itemType + ' Updated');
          this.mode = 'list';
          this.inProgress$.next(false);
        } else {
          this.inProgress$.next(false);
          this.snackbar.error('Some Error Occured');
        }
      });
      return;
    }

    // Create branch: goes through the createAdminUser Cloud Function so the
    // Firebase Auth account and the admin_users profile are created
    // together, then emails the new admin a password-setup link - see
    // AdminUserService.createAdminUser. That function doesn't know about
    // `permissions` (it's this app's own addition, not shared with the
    // Cloud Function's payload shape), so a brand-new account always
    // starts with no field at all unless followed up here - explicitly
    // writing `permissions: []` (rather than leaving it unset) is what
    // tells PermissionMigrationService this account was created AFTER this
    // system shipped and should never be auto-seeded with the legacy grant
    // set meant for pre-existing Employee accounts.
    this.service.createAdminUser({
      email: raw.email,
      firstName: raw.firstName,
      lastName: raw.lastName,
      role: raw.role,
      phone: raw.phone,
      shippingAddress: raw.shippingAddress,
      billingAddress: raw.billingAddress
    }).then(async (docId) => {
      // update() is a full setDoc, not a merge (see FirebaseDAO.update()) -
      // has to carry the whole just-created record, not just the new
      // `permissions` field, or every other field the Cloud Function just
      // wrote (role, firebaseUID, etc.) would be wiped out.
      const created = await this.service.getById(docId);
      await this.service.update(docId, { ...created, permissions: raw.role === Role.EMPLOYEE ? permissions : [] });
    }).then(() => {
      this.snackbar.success(this.itemType + ' Added - a password setup email has been sent.');
      this.mode = 'list';
      this.inProgress$.next(false);
    }).catch((err) => {
      this.inProgress$.next(false);
      this.snackbar.error('There was an error creating the account: ' + (err?.message ?? 'Unknown error'));
    });
  }
}
