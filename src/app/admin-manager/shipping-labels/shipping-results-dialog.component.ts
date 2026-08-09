import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ShippingLabelRequest } from 'src/app/common/models/domain/shipment-label-batch-request.model';

export interface ShippingResultsDialogData {
  results: ShippingLabelRequest[];
}

@Component({
    selector: 'app-shipping-results-dialog',
    templateUrl: './shipping-results-dialog.component.html',
    styleUrls: ['./shipping-results-dialog.component.scss'],
    standalone: false
})
export class ShippingResultsDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<ShippingResultsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ShippingResultsDialogData
  ) {}

  getCount(status: string): number {
    return this.data.results.filter((label) => label.status === status).length;
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
