import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { ShippingLabelRequest } from 'src/app/common/models/domain/shipment-label-batch-request.model';
import { ShippingModel, ShippingRequest, ShippingToAddress } from '@impact-common/shared/models/domain/shipment.model';
import { ShippingLabelService } from 'src/app/common/services/data/shipping-label.service';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { SnackbarService } from '../../shared/snackbar.service';

export interface ShippingLabelDialogData {
  item: ShippingLabelRequest | null;
  batchId: string;
}

@Component({
    selector: 'app-shipping-label-dialog',
    templateUrl: './shipping-label-dialog.component.html',
    styleUrls: ['./shipping-label-dialog.component.scss'],
    standalone: false
})
export class ShippingLabelDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  // 2-letter codes (this screen posts directly to a real shipping carrier
  // API, which requires 2-letter state/country codes) - a different array
  // shape than the rest of the app's state/country dropdowns.
  states: { key: string; value: string }[] = EnumHelper.getState2LetterTypesAsArray().map((entry: [string, string]) => ({ key: entry[0], value: entry[1] }));
  countries: { key: string; value: string }[] = EnumHelper.getCountry2LetterTypesAsArray().map((entry: [string, string]) => ({ key: entry[0], value: entry[1] }));

  private itemType = 'Shipping Label';

  constructor(
    private dialogRef: MatDialogRef<ShippingLabelDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: ShippingLabelDialogData,
    private fb: FormBuilder,
    private service: ShippingLabelService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    const shipTo = data.item?.request?.shipment?.shipTo;

    this.form = this.fb.group({
      name: [shipTo?.name ?? '', Validators.required],
      addressLine1: [shipTo?.addressLine1 ?? '', Validators.required],
      cityLocality: [shipTo?.cityLocality ?? '', Validators.required],
      stateProvince: [shipTo?.stateProvince ?? 'GA', Validators.required],
      countryCode: [shipTo?.countryCode ?? 'US', Validators.required],
      postalCode: [shipTo?.postalCode ?? '', Validators.required],
      weight: [data.item?.request?.weight ?? null, Validators.required]
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
    const value = this.form.value;

    const shipTo: ShippingToAddress = {
      ...new ShippingToAddress(),
      name: value.name,
      addressLine1: value.addressLine1,
      cityLocality: value.cityLocality,
      stateProvince: value.stateProvince,
      countryCode: value.countryCode,
      postalCode: value.postalCode
    };

    // New items match the original's onInitNewRow() shape exactly; edits
    // preserve everything the form doesn't touch (status, dates, the
    // purchased shippingLabel/shippingRate) by starting from the existing
    // item rather than building a fresh one.
    const item: ShippingLabelRequest = this.isEdit
      ? {
          ...this.data.item!,
          request: { ...this.data.item!.request, shipment: { ...this.data.item!.request.shipment, shipTo }, weight: value.weight }
        }
      : {
          ...new ShippingLabelRequest(),
          batchId: this.data.batchId,
          status: 'NEW',
          request: {
            ...new ShippingRequest(),
            weight: value.weight,
            shipment: { ...new ShippingModel(), shipTo }
          }
        };

    const request = this.isEdit ? this.service.update(item.id!, item) : this.service.add(item);

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
