import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { AppUser } from 'src/app/common/models/admin/appuser.model';
import { AppUserService } from 'src/app/common/services/data/user.service';
import { Role } from 'src/app/common/lists/roles.enum';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { SnackbarService } from '../../shared/snackbar.service';

export interface UserDialogData {
  item: AppUser | null;
}

@Component({
    selector: 'app-user-dialog',
    templateUrl: './user-dialog.component.html',
    styleUrls: ['./user-dialog.component.scss'],
    standalone: false
})
export class UserDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  roles: Role[] = EnumHelper.getRoleTypesAsArray();

  private itemType = 'User';

  constructor(
    private dialogRef: MatDialogRef<UserDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: UserDialogData,
    private fb: FormBuilder,
    private service: AppUserService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [data.item?.email ?? '', Validators.required],
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
    const value: AppUser = { ...this.data.item, ...this.form.getRawValue() };

    const request = this.isEdit
      ? this.service.update(value.id!, value)
      : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
