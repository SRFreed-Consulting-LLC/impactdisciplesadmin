import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CustomerModel } from 'src/app/common/models/domain/utils/customer.model';
import { EventModel } from 'src/app/common/models/domain/event.model';

export interface CustomerDetailsDialogData {
  item: CustomerModel;
  events: EventModel[];
}

// Thin MatDialog shell around app-customer-details - only exists for
// PurchaseDetailsComponent's "View Customer Record" jump (see its own
// viewCustomer()), so that cross-screen peek doesn't lose the Purchases
// screen's own in-progress edit underneath it. CustomersComponent's own
// edit flow hosts app-customer-details directly, no dialog - see
// customer-details.component.ts's header comment for the full reasoning.
@Component({
    selector: 'app-customer-details-dialog',
    templateUrl: './customer-details-dialog.component.html',
    styleUrls: ['./customer-details-dialog.component.scss'],
    standalone: false
})
export class CustomerDetailsDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<CustomerDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CustomerDetailsDialogData
  ) {}

  close(): void {
    this.dialogRef.close();
  }
}
