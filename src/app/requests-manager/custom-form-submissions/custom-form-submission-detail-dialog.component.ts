import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { formatFieldValue } from 'src/app/common/models/domain/form-field.model';
import { FormSubmissionModel } from 'src/app/common/models/domain/form-submission.model';

export interface CustomFormSubmissionDetailDialogData {
  item: FormSubmissionModel;
}

interface DetailRow {
  label: string;
  value: string;
}

// Read-only - renders fieldSnapshot zipped with values via
// formatFieldValue() (form-field.model.ts), so this dialog stays simple
// presentation with no per-type branching of its own. Reads the
// submission's own stored snapshot, never the live FormDefinitionModel -
// stays correct even if that form was since edited or deleted.
@Component({
    selector: 'app-custom-form-submission-detail-dialog',
    templateUrl: './custom-form-submission-detail-dialog.component.html',
    styleUrls: ['./custom-form-submission-detail-dialog.component.scss'],
    standalone: false
})
export class CustomFormSubmissionDetailDialogComponent {
  rows: DetailRow[];

  constructor(@Inject(MAT_DIALOG_DATA) public data: CustomFormSubmissionDetailDialogData, private dialogRef: MatDialogRef<CustomFormSubmissionDetailDialogComponent>) {
    const item = data.item;
    this.rows = (item.fieldSnapshot ?? []).map((field) => ({
      label: field.label,
      value: formatFieldValue(field.type, item.values?.[field.id])
    }));
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
