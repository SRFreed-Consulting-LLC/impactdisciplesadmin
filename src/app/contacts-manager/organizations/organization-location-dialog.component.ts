import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface OrganizationLocationDialogData {
  item: LocationModel | null;
  // The parent org - fixed, not pickable: this dialog only opens from
  // inside that organization's details view.
  organizationId: string;
}

// Add/edit one of an organization's child locations (adapted from the old
// standalone Locations screen's dialog, retired in the 2026-08
// restructure). Deliberately NO trainingrooms editing - rooms belong to
// the pinned Summit venue and are edited on the Summit screen only.
@Component({
    selector: 'app-organization-location-dialog',
    templateUrl: './organization-location-dialog.component.html',
    styleUrls: ['./organization-location-dialog.component.scss'],
    standalone: false
})
export class OrganizationLocationDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  constructor(
    private dialogRef: MatDialogRef<OrganizationLocationDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: OrganizationLocationDialogData,
    private fb: FormBuilder,
    private service: LocationService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      name: [data.item?.name ?? '', Validators.required],
      contactName: [data.item?.contactName ?? ''],
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
    const value: LocationModel = {
      ...this.data.item,
      ...this.form.value,
      organization: this.data.organizationId,
      trainingrooms: this.data.item?.trainingrooms ?? []
    };

    const request = this.isEdit
      ? this.service.update(value.id!, value)
      : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success('Location ' + (this.isEdit ? 'Updated' : 'Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
