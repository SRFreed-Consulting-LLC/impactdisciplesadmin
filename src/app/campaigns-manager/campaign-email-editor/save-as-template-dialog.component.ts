import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface SaveAsTemplateData {
  /** Pre-filled from the email's label/subject so the common case is one click. */
  suggestedName: string;
}

// Names the CAMPAIGN template about to be created from the email currently
// open in the editor. Deliberately create-only - there is no "overwrite an
// existing template" option, so saving can never damage a template another
// campaign is about to start from. Same shape as the image uploader's
// new-folder dialog.
@Component({
    selector: 'app-save-as-template-dialog',
    templateUrl: './save-as-template-dialog.component.html',
    styleUrls: ['./save-as-template-dialog.component.scss'],
    standalone: false
})
export class SaveAsTemplateDialogComponent {
  form: FormGroup;

  constructor(
    private dialogRef: MatDialogRef<SaveAsTemplateDialogComponent, string | false>,
    @Inject(MAT_DIALOG_DATA) public data: SaveAsTemplateData,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      name: [data?.suggestedName ?? '', Validators.required]
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
    this.dialogRef.close((this.form.value.name as string).trim());
  }
}
