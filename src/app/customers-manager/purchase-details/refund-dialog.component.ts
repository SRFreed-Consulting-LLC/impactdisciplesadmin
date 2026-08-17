import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CurrencyPipe } from '@angular/common';

export interface RefundDialogData {
  total: number;
  email: string;
  /** Whether this order granted digital-library access (shows the revoke
   *  checkbox at all - a physical-only order has nothing to revoke). */
  hasDigitalItems: boolean;
}

export interface RefundDialogResult {
  confirmed: boolean;
  revokeLicenses: boolean;
}

/** Pre-prod #6 refund confirmation - "ask at refund time": the revoke
 *  checkbox defaults to checked, but the admin can leave access in place
 *  (e.g. a goodwill refund). Standalone, like the ported library-manager
 *  screens - no module declaration needed. */
@Component({
  selector: 'app-refund-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, CurrencyPipe],
  template: `
    <h2 mat-dialog-title>Refund this purchase?</h2>
    <mat-dialog-content>
      <p>
        This will refund <b>{{ data.total | currency }}</b> to
        <b>{{ data.email }}</b> through PayPal. This cannot be undone from
        here - a second refund attempt is rejected.
      </p>
      @if (data.hasDigitalItems) {
        <mat-checkbox [(ngModel)]="revokeLicenses">
          Also revoke the digital-library access this purchase granted
        </mat-checkbox>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="cancel()">Cancel</button>
      <button mat-raised-button color="warn" type="button" (click)="confirm()">
        Refund
      </button>
    </mat-dialog-actions>
  `,
})
export class RefundDialogComponent {
  readonly data = inject<RefundDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<RefundDialogComponent, RefundDialogResult>>(MatDialogRef);

  revokeLicenses = true;

  cancel(): void {
    this.dialogRef.close({ confirmed: false, revokeLicenses: false });
  }

  confirm(): void {
    this.dialogRef.close({
      confirmed: true,
      revokeLicenses: this.data.hasDigitalItems && this.revokeLicenses,
    });
  }
}
