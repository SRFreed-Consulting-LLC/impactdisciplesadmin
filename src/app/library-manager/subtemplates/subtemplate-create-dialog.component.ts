import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { LibrarySubtemplateType } from 'src/app/common/models/domain/library/library-subtemplate.model';

export interface SubtemplateCreateDialogResult {
  name: string;
  type: LibrarySubtemplateType;
}

// Ported from impact-discipleship-library-manager-new's
// features/subtemplates/subtemplate-create-dialog.component.ts.
@Component({
  selector: 'app-subtemplate-create-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './subtemplate-create-dialog.component.html',
})
export class SubtemplateCreateDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<SubtemplateCreateDialogComponent>);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: ['' as LibrarySubtemplateType | '', [Validators.required]],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const result: SubtemplateCreateDialogResult = {
      name: raw.name.trim(),
      type: raw.type as LibrarySubtemplateType,
    };
    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
