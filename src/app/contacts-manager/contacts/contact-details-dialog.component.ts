import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { EventModel } from 'src/app/common/models/domain/event.model';

export interface ContactDetailsDialogData {
  item: ContactModel;
  events: EventModel[];
}

// Thin MatDialog shell around app-contact-details - only exists for
// PurchaseDetailsComponent's "View Contact Record" jump (see its own
// viewCustomer()), so that cross-screen peek doesn't lose the Purchases
// screen's own in-progress edit underneath it. ContactsComponent's own
// edit flow hosts app-contact-details directly, no dialog - see
// contact-details.component.ts's header comment for the full reasoning.
@Component({
    selector: 'app-contact-details-dialog',
    templateUrl: './contact-details-dialog.component.html',
    styleUrls: ['./contact-details-dialog.component.scss'],
    standalone: false
})
export class ContactDetailsDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<ContactDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ContactDetailsDialogData
  ) {}

  close(): void {
    this.dialogRef.close();
  }
}
