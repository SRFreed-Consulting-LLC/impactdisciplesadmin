import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CurrencyPipe } from '@angular/common';

export interface RefundDialogData {
  /** Dollars still refundable (charged minus prior refunds). */
  remaining: number;
  /** Dollars already refunded by earlier partials (0 on a first refund). */
  alreadyRefunded: number;
  email: string;
  /** Whether this order granted digital-library access (shows the revoke
   *  checkbox at all - a physical-only order has nothing to revoke). */
  hasDigitalItems: boolean;
  /** $0/coupon orders can only be marked fully refunded - no amount entry. */
  allowPartial: boolean;
}

export interface RefundDialogResult {
  confirmed: boolean;
  revokeLicenses: boolean;
  /** Dollars to refund - defaults to the full remaining amount. */
  amount: number;
}

/** Refund confirmation with an admin-chosen amount: defaults to the full
 *  remaining amount; entering less makes it a PARTIAL refund (order stays
 *  open, more refunds possible later until fully refunded). The revoke
 *  checkbox ("ask at refund time", default checked) only applies to full
 *  refunds - a partial that keeps the product keeps the access. Standalone,
 *  like the ported library-manager screens - no module declaration needed. */
@Component({
  selector: 'app-refund-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, CurrencyPipe],
  template: `
    <h2 mat-dialog-title>Refund this purchase?</h2>
    <mat-dialog-content>
      @if (data.alreadyRefunded > 0) {
        <p class="refund-context">
          Previously refunded <b>{{ data.alreadyRefunded | currency }}</b> of
          <b>{{ data.alreadyRefunded + data.remaining | currency }}</b>.
        </p>
      }
      <p>
        Refunds go to <b>{{ data.email }}</b> through PayPal and cannot be
        undone from here.
      </p>
      @if (data.allowPartial) {
        <mat-form-field appearance="outline" class="refund-amount-field">
          <mat-label>Amount to refund</mat-label>
          <span matTextPrefix>$&nbsp;</span>
          <input matInput type="number" [(ngModel)]="amount" min="0.01"
                 [max]="data.remaining" step="0.01" (keyup.enter)="confirm()">
          <mat-hint>Up to {{ data.remaining | currency }}</mat-hint>
        </mat-form-field>
        @if (!amountValid()) {
          <p class="refund-invalid">Enter an amount between $0.01 and {{ data.remaining | currency }}.</p>
        } @else if (isFull()) {
          <p class="refund-kind">This is a <b>full</b> refund - the order will be closed.</p>
        } @else {
          <p class="refund-kind">This is a <b>partial</b> refund - the order stays open and
            more can be refunded later.</p>
        }
      } @else {
        <p>This order has no PayPal charge - it will simply be marked refunded
          (<b>{{ data.remaining | currency }}</b>).</p>
      }
      @if (data.hasDigitalItems && isFull()) {
        <mat-checkbox [(ngModel)]="revokeLicenses">
          Also revoke the digital-library access this purchase granted
        </mat-checkbox>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="cancel()">Cancel</button>
      <button mat-raised-button color="warn" type="button"
              [disabled]="!amountValid()" (click)="confirm()">
        {{ isFull() ? 'Refund' : 'Refund ' + (roundedAmount() | currency) }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .refund-context { color: rgba(0, 0, 0, 0.6); font-size: 13px; }
    .refund-amount-field { width: 100%; margin-top: 4px; }
    .refund-invalid { color: #c62828; font-size: 12.5px; }
    .refund-kind { font-size: 13px; }
  `],
})
export class RefundDialogComponent {
  readonly data = inject<RefundDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<RefundDialogComponent, RefundDialogResult>>(MatDialogRef);

  revokeLicenses = true;
  amount: number = this.data.remaining;

  // Cents-rounded so 33.333 or float dust can't sneak past validation or
  // miscompare against remaining.
  roundedAmount(): number {
    return Math.round((Number(this.amount) || 0) * 100) / 100;
  }

  amountValid(): boolean {
    if (!this.data.allowPartial) {
      return true;
    }
    const cents = Math.round(this.roundedAmount() * 100);
    return cents > 0 && cents <= Math.round(this.data.remaining * 100);
  }

  isFull(): boolean {
    if (!this.data.allowPartial) {
      return true;
    }
    return Math.round(this.roundedAmount() * 100) === Math.round(this.data.remaining * 100);
  }

  cancel(): void {
    this.dialogRef.close({ confirmed: false, revokeLicenses: false, amount: 0 });
  }

  confirm(): void {
    if (!this.amountValid()) {
      return;
    }
    this.dialogRef.close({
      confirmed: true,
      revokeLicenses: this.isFull() && this.data.hasDigitalItems && this.revokeLicenses,
      amount: this.data.allowPartial ? this.roundedAmount() : this.data.remaining,
    });
  }
}
