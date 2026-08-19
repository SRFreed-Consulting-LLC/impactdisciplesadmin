import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';

export interface AddContactNoteResult {
  note: string;
  private: boolean;
}

// Small popup for composing a new customer note - replaces the old flow of
// pushing a blank ContactNoteModel straight into the list and editing it
// inline (see contact-details.component.ts's addNote()). Existing notes
// still edit in place; this dialog only handles creating a new one, and
// hands the finished text back to the caller rather than writing to
// Firestore itself - ContactDetailsComponent still owns persistNotes().
@Component({
    selector: 'app-add-contact-note-dialog',
    templateUrl: './add-contact-note-dialog.component.html',
    styleUrls: ['./add-contact-note-dialog.component.scss'],
    standalone: false
})
export class AddContactNoteDialogComponent {
  form: FormGroup;

  constructor(
    private dialogRef: MatDialogRef<AddContactNoteDialogComponent, AddContactNoteResult | undefined>,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      note: ['', Validators.required],
      private: [false]
    });
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close({ note: this.form.value.note, private: this.form.value.private });
  }
}
