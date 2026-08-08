import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, map, Observable, startWith } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { SeminarModel } from 'impactdisciplescommon/src/models/domain/seminar.model';
import { SeminarService } from 'impactdisciplescommon/src/services/data/seminar.service';
import { CoachModel } from 'impactdisciplescommon/src/models/domain/coach.model';
import { CoachService } from 'impactdisciplescommon/src/services/data/coach.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { SnackbarService } from '../../shared/snackbar.service';
import { timeStringToTimestamp, timestampToTimeString } from '../../shared/time-of-day.util';

export interface SeminarDialogData {
  item: SeminarModel | null;
}

@Component({
    selector: 'app-seminar-dialog',
    templateUrl: './seminar-dialog.component.html',
    styleUrls: ['./seminar-dialog.component.scss'],
    standalone: false
})
export class SeminarDialogComponent implements OnInit {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  coachNames: string[] = [];
  filteredCoachNames$: Observable<string[]>;

  private itemType = 'Seminar Request';

  constructor(
    private dialogRef: MatDialogRef<SeminarDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SeminarDialogData,
    private fb: FormBuilder,
    private service: SeminarService,
    private coachService: CoachService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      preferredTrainer: [data.item?.preferredTrainer ?? ''],
      requestedDate: [dateFromTimestamp(data.item?.requestedDate) ?? null, Validators.required],
      requestedStartTime: [timestampToTimeString(data.item?.requestedStartTime), Validators.required],
      requestedEndTime: [timestampToTimeString(data.item?.requestedEndTime), Validators.required],
      preferredLocationName: [data.item?.preferredLocationName ?? '', Validators.required],
      preferredLocation: this.fb.group({
        address1: [data.item?.preferredLocation?.address1 ?? '', Validators.required],
        address2: [data.item?.preferredLocation?.address2 ?? ''],
        city: [data.item?.preferredLocation?.city ?? '', Validators.required],
        state: [data.item?.preferredLocation?.state ?? '', Validators.required],
        zip: [data.item?.preferredLocation?.zip ?? '', Validators.required]
      }),
      eventCoordinator: [data.item?.eventCoordinator ?? ''],
      email: [data.item?.email ?? ''],
      phone: this.fb.group({
        countryCode: [data.item?.phone?.countryCode ?? ''],
        number: [data.item?.phone?.number ?? ''],
        type: [data.item?.phone?.type ?? null]
      }),
      hasProjectingDevice: [data.item?.hasProjectingDevice ?? false],
      volunteersAvailable: [data.item?.volunteersAvailable ?? false],
      isPrivateEvent: [data.item?.isPrivateEvent ?? false],
      isPersonalRegistration: [data.item?.isPersonalRegistration ?? false],
      requestedTicketPrice: [data.item?.requestedTicketPrice ?? null],
      isLunchProvided: [data.item?.isLunchProvided ?? false],
      isLunchIncluded: [data.item?.isLunchIncluded ?? false],
      comments: [data.item?.comments ?? '', Validators.required]
    });
  }

  async ngOnInit(): Promise<void> {
    const coaches = await this.coachService.getAll();
    this.coachNames = coaches.map((coach: CoachModel) => coach.fullname ?? `${coach.firstName} ${coach.lastName}`);

    this.filteredCoachNames$ = this.form.get('preferredTrainer')!.valueChanges.pipe(
      startWith(this.form.value.preferredTrainer ?? ''),
      map((value: string) => {
        const term = (value ?? '').toLowerCase();
        return this.coachNames.filter((name) => name.toLowerCase().includes(term));
      })
    );
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
    const value: SeminarModel = {
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
