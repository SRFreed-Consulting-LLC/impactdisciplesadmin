import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { LocationModel } from 'impactdisciplescommon/src/models/domain/location.model';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { LocationService } from 'impactdisciplescommon/src/services/data/location.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface LocationDialogData {
  item: LocationModel | null;
  organizations: OrganizationModel[];
}

@Component({
    selector: 'app-location-dialog',
    templateUrl: './location-dialog.component.html',
    styleUrls: ['./location-dialog.component.scss'],
    standalone: false
})
export class LocationDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  // Rooms are edited directly against the shared array (see RoomComponent),
  // not through the reactive form - same as the original, where
  // trainingrooms was bound straight to selectedItem, outside the dx-form.
  trainingRooms: LocationModel['trainingrooms'];

  private itemType = 'Location';

  constructor(
    private dialogRef: MatDialogRef<LocationDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: LocationDialogData,
    private fb: FormBuilder,
    private service: LocationService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.trainingRooms = data.item?.trainingrooms ?? [];
    this.form = this.fb.group({
      name: [data.item?.name ?? '', Validators.required],
      contactName: [data.item?.contactName ?? '', Validators.required],
      organization: [data.item?.organization ?? null, Validators.required],
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
    const value: LocationModel = { ...this.data.item, ...this.form.value, trainingrooms: this.trainingRooms };

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
