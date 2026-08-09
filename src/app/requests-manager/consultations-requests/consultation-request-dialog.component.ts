import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { ConsultationRequestModel } from 'src/app/common/models/domain/consultation-request.model';
import { ConsultationRequestService } from 'src/app/common/services/data/consultation-request.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface ConsultationRequestDialogData {
  item: ConsultationRequestModel | null;
}

@Component({
    selector: 'app-consultation-request-dialog',
    templateUrl: './consultation-request-dialog.component.html',
    styleUrls: ['./consultation-request-dialog.component.scss'],
    standalone: false
})
export class ConsultationRequestDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Consultation Request';

  constructor(
    private dialogRef: MatDialogRef<ConsultationRequestDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: ConsultationRequestDialogData,
    private fb: FormBuilder,
    private service: ConsultationRequestService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [data.item?.email ?? '', Validators.required],
      message: [data.item?.message ?? '', Validators.required]
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

    this.inProgress$.next(true);
    const value: ConsultationRequestModel = { ...this.data.item, ...this.form.value };

    const request = this.isEdit
      ? this.service.update(value.id!, value)
      : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
