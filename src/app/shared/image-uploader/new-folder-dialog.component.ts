import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
    selector: 'app-new-folder-dialog',
    templateUrl: './new-folder-dialog.component.html',
    styleUrls: ['./new-folder-dialog.component.scss'],
    standalone: false
})
export class NewFolderDialogComponent {
  form: FormGroup;

  constructor(
    private dialogRef: MatDialogRef<NewFolderDialogComponent, string | false>,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      name: ['', Validators.required]
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onCreate(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(this.form.value.name);
  }
}
