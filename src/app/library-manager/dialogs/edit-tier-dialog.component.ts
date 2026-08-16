import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { BulkDiscountTier } from '@impact-common/models/bulk-discount-tier.model';

export interface EditTierDialogData {
  /** Present only when editing an existing row - numberOfBooks is then
   *  locked, since the doc id is derived from it (see
   *  LibraryBulkDiscountTierService's doc comment). */
  existingTier?: BulkDiscountTier;
}

export interface EditTierDialogResult {
  numberOfBooks: number;
  percentOff: number;
}

/** Ported near-verbatim from impact-discipleship-library-manager-new's
 *  features/config/edit-tier-dialog.component.ts - no Firestore access of
 *  its own, so nothing to adapt. */
@Component({
  selector: 'app-edit-tier-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './edit-tier-dialog.component.html',
})
export class EditTierDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<EditTierDialogComponent, EditTierDialogResult>);
  readonly data = inject<EditTierDialogData>(MAT_DIALOG_DATA);

  readonly isEditMode = !!this.data.existingTier;

  readonly form = this.fb.nonNullable.group({
    numberOfBooks: [
      { value: this.data.existingTier?.numberOfBooks ?? 0, disabled: this.isEditMode },
      [Validators.min(1)],
    ],
    percentOff: [this.data.existingTier?.percentOff ?? 0, [Validators.min(1), Validators.max(100)]],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    this.dialogRef.close({ numberOfBooks: raw.numberOfBooks, percentOff: raw.percentOff });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
