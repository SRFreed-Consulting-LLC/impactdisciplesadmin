import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { getLibraryLanguageOptions } from 'src/app/common/services/data/library/library-language-options.util';

export interface LocaleDialogResult {
  code: string;
  label: string;
}

export interface LocaleDialogData {
  excludeLocales?: string[];
}

// Ported from impact-discipleship-library-manager-new's
// features/lesson-translation/locale-dialog.component.ts.
@Component({
  selector: 'app-library-locale-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './locale-dialog.component.html',
})
export class LocaleDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<LocaleDialogComponent>);
  private readonly data = inject<LocaleDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  readonly selectedCode = signal('');
  readonly options = computed(() => {
    const exclude = new Set(this.data?.excludeLocales ?? []);
    return getLibraryLanguageOptions().filter((o) => !exclude.has(o.code));
  });

  submit(): void {
    const option = this.options().find((o) => o.code === this.selectedCode());
    if (!option) {
      return;
    }
    const result: LocaleDialogResult = { code: option.code, label: option.label };
    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
