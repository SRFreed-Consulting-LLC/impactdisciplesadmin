import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface OrganizationDialogData {
  item: OrganizationModel | null;
}

@Component({
    selector: 'app-organization-dialog',
    templateUrl: './organization-dialog.component.html',
    styleUrls: ['./organization-dialog.component.scss'],
    standalone: false
})
export class OrganizationDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Organization';

  constructor(
    private dialogRef: MatDialogRef<OrganizationDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: OrganizationDialogData,
    private fb: FormBuilder,
    private service: OrganizationService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      name: [data.item?.name ?? '', Validators.required],
      contactName: [data.item?.contactName ?? '', Validators.required],
      address: this.fb.group({
        address1: [data.item?.address?.address1 ?? ''],
        address2: [data.item?.address?.address2 ?? ''],
        city: [data.item?.address?.city ?? ''],
        state: [data.item?.address?.state ?? ''],
        zip: [data.item?.address?.zip ?? '']
      }),
      phone: this.fb.group({
        countryCode: [data.item?.phone?.countryCode ?? ''],
        number: [data.item?.phone?.number ?? ''],
        type: [data.item?.phone?.type ?? null]
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
    const value: OrganizationModel = { ...this.data.item, ...this.form.value };

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
