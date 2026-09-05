import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { BaseEntityDialogComponent } from '../../shared/base-entity-dialog.component';
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
export class OrganizationLocationDialogComponent extends BaseEntityDialogComponent<LocationModel> {
  readonly itemType = 'Location';

  constructor(
    protected readonly dialogRef: MatDialogRef<OrganizationLocationDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: OrganizationLocationDialogData,
    private fb: FormBuilder,
    protected readonly service: LocationService,
    protected readonly snackbar: SnackbarService
  ) {
    super();
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

  // Two fields the form does not hold: the parent organization comes from
  // the dialog DATA (fixed, not pickable - see the interface), and rooms
  // are carried across untouched because they are edited on the Summit
  // screen, never here.
  protected override buildValue(): LocationModel {
    return {
      ...super.buildValue(),
      organization: this.data.organizationId,
      trainingrooms: this.data.item?.trainingrooms ?? []
    };
  }
}
