import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { ShippingFromAddress } from 'src/app/common/models/domain/shipment.model';
import { ShippingLabelBatchRequest } from 'src/app/common/models/domain/shipment-label-batch-request.model';
import { ShippingLabelBatchService } from 'src/app/common/services/data/shipping-label-batch.service';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { SnackbarService } from '../../shared/snackbar.service';

export interface FromAddressDialogData {
  batch: ShippingLabelBatchRequest;
  shipFrom: ShippingFromAddress;
}

@Component({
    selector: 'app-from-address-dialog',
    templateUrl: './from-address-dialog.component.html',
    styleUrls: ['./from-address-dialog.component.scss'],
    standalone: false
})
export class FromAddressDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  states: { key: string; value: string }[] = EnumHelper.getState2LetterTypesAsArray().map((entry: [string, string]) => ({ key: entry[0], value: entry[1] }));
  countries: { key: string; value: string }[] = EnumHelper.getCountry2LetterTypesAsArray().map((entry: [string, string]) => ({ key: entry[0], value: entry[1] }));

  constructor(
    private dialogRef: MatDialogRef<FromAddressDialogComponent, ShippingFromAddress | false>,
    @Inject(MAT_DIALOG_DATA) public data: FromAddressDialogData,
    private fb: FormBuilder,
    private batchService: ShippingLabelBatchService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      name: [data.shipFrom?.name ?? '', Validators.required],
      addressLine1: [data.shipFrom?.addressLine1 ?? '', Validators.required],
      cityLocality: [data.shipFrom?.cityLocality ?? '', Validators.required],
      stateProvince: [data.shipFrom?.stateProvince ?? 'GA', Validators.required],
      postalCode: [data.shipFrom?.postalCode ?? '', Validators.required],
      countryCode: [data.shipFrom?.countryCode ?? 'US', Validators.required],
      phone: [data.shipFrom?.phone ?? '', Validators.required]
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
    const shipFrom: ShippingFromAddress = { ...new ShippingFromAddress(), ...this.form.value };
    const value: ShippingLabelBatchRequest = { ...this.data.batch, shipFrom };

    this.batchService.update(this.data.batch.id!, value).then((result) => {
      if (result) {
        this.snackbar.success("From Address Saved");
        this.dialogRef.close(shipFrom);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
