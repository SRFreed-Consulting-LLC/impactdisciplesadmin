import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface RenameDialogData {
  currentName: string;
}

@Component({
    selector: 'app-rename-dialog',
    templateUrl: './rename-dialog.component.html',
    styleUrls: ['./rename-dialog.component.scss'],
    standalone: false
})
export class RenameDialogComponent {
  form: FormGroup;

  constructor(
    private dialogRef: MatDialogRef<RenameDialogComponent, string | false>,
    @Inject(MAT_DIALOG_DATA) public data: RenameDialogData,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      name: [data.currentName, Validators.required]
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onRename(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(this.form.value.name);
  }
}
