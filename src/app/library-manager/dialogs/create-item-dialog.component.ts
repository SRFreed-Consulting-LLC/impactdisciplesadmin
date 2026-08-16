import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface CreateItemDialogData {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
}

// Ported from impact-discipleship-library-manager-new's
// features/shell/dialogs/create-item-dialog.component.ts - a generic
// name-prompt dialog reused across the Library section (creating a lesson
// template, a header/layout/footer subtemplate from the Lesson Template
// editor's "+" buttons, etc.).
@Component({
  selector: 'app-library-create-item-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './create-item-dialog.component.html',
})
export class CreateItemDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<CreateItemDialogComponent>);
  readonly data = inject<CreateItemDialogData>(MAT_DIALOG_DATA);

  readonly form = this.fb.nonNullable.group({
    name: [this.data.initialValue ?? '', [Validators.required, Validators.minLength(2)]],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(this.form.getRawValue().name.trim());
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
