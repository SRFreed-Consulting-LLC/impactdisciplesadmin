import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export type LibraryUnsavedChangesDialogResult = 'save' | 'discard';

export interface LibraryUnsavedChangesDialogData {
  /** e.g. 'lesson', 'subtemplate', 'lesson template' - interpolated into
   *  "This {itemLabel} has changes...". */
  itemLabel: string;
}

// Ported from impact-discipleship-library-manager-new's
// features/shell/dialogs/unsaved-changes-dialog.component.ts.
@Component({
  selector: 'app-library-unsaved-changes-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  templateUrl: './library-unsaved-changes-dialog.component.html'
})
export class LibraryUnsavedChangesDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<LibraryUnsavedChangesDialogComponent, LibraryUnsavedChangesDialogResult>
  );
  readonly data = inject<LibraryUnsavedChangesDialogData>(MAT_DIALOG_DATA);

  choose(result: LibraryUnsavedChangesDialogResult): void {
    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
