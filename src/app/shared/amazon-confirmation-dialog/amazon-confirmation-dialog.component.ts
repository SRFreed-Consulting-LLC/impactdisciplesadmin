import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { SnackbarService } from '../snackbar.service';

export interface AmazonConfirmationDialogData {
  item: CheckoutForm;
}

// The Amazon fulfillment path's final step (2026-08-19 workflow change):
// send the customer their shipped-via-Amazon confirmation email - rendered
// from the admin-editable "Amazon Shipping Confirmation" template, with an
// optional tracking number/link - and close the order in the same action.
// Lives in SharedModule (like OrderWorkflowDialogComponent) because the
// Dashboard's eagerly-loaded dialog opens it too. Closes with the saved
// purchase so callers can update their local copy.
@Component({
    selector: 'app-amazon-confirmation-dialog',
    templateUrl: './amazon-confirmation-dialog.component.html',
    styleUrls: ['./amazon-confirmation-dialog.component.scss'],
    standalone: false
})
export class AmazonConfirmationDialogComponent {
  tracking = '';
  sending = false;

  constructor(
    private dialogRef: MatDialogRef<AmazonConfirmationDialogComponent, CheckoutForm | null>,
    @Inject(MAT_DIALOG_DATA) public data: AmazonConfirmationDialogData,
    private service: PurchasesService,
    private snackbar: SnackbarService
  ) {}

  async send(): Promise<void> {
    this.sending = true;
    try {
      const saved = await this.service.sendAmazonConfirmation(this.data.item, this.tracking);
      this.snackbar.success('Confirmation email sent - order closed');
      this.dialogRef.close(saved);
    } catch (err) {
      this.snackbar.error((err as Error)?.message ?? 'Sending the confirmation failed - please try again.');
    } finally {
      this.sending = false;
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
