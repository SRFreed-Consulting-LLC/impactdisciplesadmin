import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { Role } from 'src/app/common/lists/roles.enum';
import { SnackbarService } from '../../shared/snackbar.service';

export interface AdminUserDialogData {
  item: AdminUser | null;
}

@Component({
    selector: 'app-admin-user-dialog',
    templateUrl: './admin-user-dialog.component.html',
    styleUrls: ['./admin-user-dialog.component.scss'],
    standalone: false
})
export class AdminUserDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  // Admin Users can only ever be Admin or Employee - EnumHelper.
  // getRoleTypesAsArray() returns every Role value including Customer,
  // which doesn't belong on this screen (it's shared with CustomerModel's
  // own default role). Root is deliberately excluded too - it's a single,
  // manually-assigned account (shane.freed@gmail.com) with every
  // permission Admin has (see roles.enum.ts's hasRole()), not something
  // assignable from this dropdown. The one exception: if the record being
  // edited is already Root, it's added to the list in the constructor so
  // the field shows its real value instead of rendering blank - still
  // editable (e.g. to correct a mistake), just not offered to every other
  // user.
  roles: Role[];

  private itemType = 'Admin User';

  constructor(
    private dialogRef: MatDialogRef<AdminUserDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: AdminUserDialogData,
    private fb: FormBuilder,
    private service: AdminUserService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.roles = data.item?.role === Role.ROOT ? [Role.ADMIN, Role.EMPLOYEE, Role.ROOT] : [Role.ADMIN, Role.EMPLOYEE];
    // Email is the real Firebase Auth sign-in identity once an account is
    // linked (firebaseUID set) - editing it here would only change the
    // Firestore copy and desync it from what the person actually signs in
    // with, since changing a Firebase Auth account's own email needs the
    // Admin SDK, which update() doesn't call. Only editable while adding a
    // new (not-yet-linked) account.
    const emailLocked = !!data.item?.firebaseUID;
    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [{ value: data.item?.email ?? '', disabled: emailLocked }, Validators.required],
      role: [data.item?.role ?? null, Validators.required],
      firebaseUID: [{ value: data.item?.firebaseUID ?? '', disabled: true }],
      phone: this.fb.group({
        countryCode: [data.item?.phone?.countryCode ?? ''],
        number: [data.item?.phone?.number ?? ''],
        type: [data.item?.phone?.type ?? null]
      }),
      shippingAddress: this.fb.group({
        address1: [data.item?.shippingAddress?.address1 ?? ''],
        address2: [data.item?.shippingAddress?.address2 ?? ''],
        city: [data.item?.shippingAddress?.city ?? ''],
        state: [data.item?.shippingAddress?.state ?? ''],
        zip: [data.item?.shippingAddress?.zip ?? ''],
        country: [data.item?.shippingAddress?.country ?? '']
      }),
      billingAddress: this.fb.group({
        address1: [data.item?.billingAddress?.address1 ?? ''],
        address2: [data.item?.billingAddress?.address2 ?? ''],
        city: [data.item?.billingAddress?.city ?? ''],
        state: [data.item?.billingAddress?.state ?? ''],
        zip: [data.item?.billingAddress?.zip ?? ''],
        country: [data.item?.billingAddress?.country ?? '']
      })
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const raw = this.form.getRawValue();

    if (this.isEdit) {
      const value: AdminUser = { ...this.data.item, ...raw };
      this.service.update(value.id!, value).then((result) => {
        if (result) {
          this.snackbar.success(this.itemType + ' Updated');
          this.dialogRef.close(true);
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
    // AdminUserService.createAdminUser.
    this.service.createAdminUser({
      email: raw.email,
      firstName: raw.firstName,
      lastName: raw.lastName,
      role: raw.role,
      phone: raw.phone,
      shippingAddress: raw.shippingAddress,
      billingAddress: raw.billingAddress
    }).then(() => {
      this.snackbar.success(this.itemType + ' Added - a password setup email has been sent.');
      this.dialogRef.close(true);
    }).catch((err) => {
      this.inProgress$.next(false);
      this.snackbar.error('There was an error creating the account: ' + (err?.message ?? 'Unknown error'));
    });
  }
}
