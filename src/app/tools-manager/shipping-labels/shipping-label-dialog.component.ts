import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ShippingLabelRequest } from '@impact-common/shared/models/domain/shipment-label-batch-request.model';
import { ShippingModel, ShippingRequest, ShippingToAddress } from '@impact-common/shared/models/domain/shipment.model';
import { ShippingLabelService } from 'src/app/common/services/data/shipping-label.service';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../shared/base-entity-dialog.component';

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
export class ShippingLabelDialogComponent extends BaseEntityDialogComponent<ShippingLabelRequest> {
  // 2-letter codes (this screen posts directly to a real shipping carrier
  // API, which requires 2-letter state/country codes) - a different array
  // shape than the rest of the app's state/country dropdowns.
  states: { key: string; value: string }[] = EnumHelper.getState2LetterTypesAsArray().map((entry: [string, string]) => ({ key: entry[0], value: entry[1] }));
  countries: { key: string; value: string }[] = EnumHelper.getCountry2LetterTypesAsArray().map((entry: [string, string]) => ({ key: entry[0], value: entry[1] }));

  readonly itemType = 'Shipping Label';

  constructor(
    protected readonly dialogRef: MatDialogRef<ShippingLabelDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: ShippingLabelDialogData,
    private fb: FormBuilder,
    protected readonly service: ShippingLabelService,
    protected readonly snackbar: SnackbarService
  ) {
    super();
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

  // Replaces the base entirely rather than extending it: this record is
  // NOT the form spread over the item - the form's flat address fields are
  // reshaped into a nested ShippingToAddress the carrier API expects.
  protected override buildValue(): ShippingLabelRequest {
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

    return item;
  }
}
