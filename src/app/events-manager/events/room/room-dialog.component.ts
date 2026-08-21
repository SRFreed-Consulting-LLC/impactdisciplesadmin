import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TrainingRoomModel } from '@impact-common/shared/models/domain/training-room.model';

export interface RoomDialogData {
  item: TrainingRoomModel | null;
}

// Unlike every other dialog in this migration, there's no Firestore service
// here to call - rooms live embedded in the parent Location's own document
// (see RoomComponent's @Input() trainingRooms). This dialog just validates
// and hands the edited value back to RoomComponent via dialogRef.close(),
// which owns the actual array mutation (matching the original's behavior of
// mutating the shared @Input() array in place rather than through a service).
// Neither field was [isRequired] in the original dx-form, so none are
// Validators.required here either.
@Component({
    selector: 'app-room-dialog',
    templateUrl: './room-dialog.component.html',
    styleUrls: ['./room-dialog.component.scss'],
    standalone: false
})
export class RoomDialogComponent {
  form: FormGroup;
  isEdit: boolean;

  constructor(
    private dialogRef: MatDialogRef<RoomDialogComponent, TrainingRoomModel | false>,
    @Inject(MAT_DIALOG_DATA) public data: RoomDialogData,
    private fb: FormBuilder
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      name: [data.item?.name ?? ''],
      capacity: [data.item?.capacity ?? null]
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    const value: TrainingRoomModel = { ...this.data.item, ...this.form.value };
    this.dialogRef.close(value);
  }
}
