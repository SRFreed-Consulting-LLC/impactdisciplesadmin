import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { LunchAndLearnModel } from 'impactdisciplescommon/src/models/domain/lunch-and-learn.model';
import { LunchAndLearnService } from 'impactdisciplescommon/src/services/data/lunch-and-learn.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { SnackbarService } from '../../shared/snackbar.service';
import { timeStringToTimestamp, timestampToTimeString } from '../../shared/time-of-day.util';

export interface LunchAndLearnDialogData {
  item: LunchAndLearnModel | null;
}

@Component({
    selector: 'app-lunch-and-learn-dialog',
    templateUrl: './lunch-and-learn-dialog.component.html',
    styleUrls: ['./lunch-and-learn-dialog.component.scss'],
    standalone: false
})
export class LunchAndLearnDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Lunch and Learn Request';

  constructor(
    private dialogRef: MatDialogRef<LunchAndLearnDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: LunchAndLearnDialogData,
    private fb: FormBuilder,
    private service: LunchAndLearnService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [data.item?.email ?? '', Validators.required],
      requestedDate: [dateFromTimestamp(data.item?.requestedDate) ?? null, Validators.required],
      requestedStartTime: [timestampToTimeString(data.item?.requestedStartTime), Validators.required],
      requestedEndTime: [timestampToTimeString(data.item?.requestedEndTime), Validators.required],
      locationName: [data.item?.locationName ?? ''],
      locationAddress: this.fb.group({
        address1: [data.item?.locationAddress?.address1 ?? ''],
        address2: [data.item?.locationAddress?.address2 ?? ''],
        city: [data.item?.locationAddress?.city ?? ''],
        state: [data.item?.locationAddress?.state ?? ''],
        zip: [data.item?.locationAddress?.zip ?? '']
      }),
      coordinator: [data.item?.coordinator ?? '', Validators.required],
      coordinatorPhone: this.fb.group({
        countryCode: [data.item?.coordinatorPhone?.countryCode ?? '', Validators.required],
        number: [data.item?.coordinatorPhone?.number ?? '', Validators.required],
        type: [data.item?.coordinatorPhone?.type ?? null]
      })
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
    const raw = this.form.getRawValue();
    const requestedDate: Date | null = raw.requestedDate;
    const value: LunchAndLearnModel = {
      ...this.data.item,
      ...raw,
      requestedDate: requestedDate ? Timestamp.fromDate(requestedDate) : null,
      requestedStartTime: timeStringToTimestamp(raw.requestedStartTime, requestedDate),
      requestedEndTime: timeStringToTimestamp(raw.requestedEndTime, requestedDate)
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

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
