import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { ConsultationSurveyModel } from 'impactdisciplescommon/src/models/domain/consultation-survey.model';
import { ConsultationSurveyService } from 'impactdisciplescommon/src/services/data/consultation-survey.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface ConsultationSurveyDialogData {
  item: ConsultationSurveyModel | null;
}

@Component({
    selector: 'app-consultation-survey-dialog',
    templateUrl: './consultation-survey-dialog.component.html',
    styleUrls: ['./consultation-survey-dialog.component.scss'],
    standalone: false
})
export class ConsultationSurveyDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  // 1 = lowest, 5 = highest - matches the original dxRadioGroup's
  // `items: [1, 2, 3, 4, 5]`.
  levels = [1, 2, 3, 4, 5];

  private itemType = 'Consultation Survey';

  constructor(
    private dialogRef: MatDialogRef<ConsultationSurveyDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: ConsultationSurveyDialogData,
    private fb: FormBuilder,
    private service: ConsultationSurveyService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [data.item?.email ?? '', Validators.required],
      phone: this.fb.group({
        countryCode: [data.item?.phone?.countryCode ?? '', Validators.required],
        number: [data.item?.phone?.number ?? '', Validators.required],
        type: [data.item?.phone?.type ?? null]
      }),
      churchName: [data.item?.churchName ?? '', Validators.required],
      location: this.fb.group({
        address1: [data.item?.location?.address1 ?? '', Validators.required],
        address2: [data.item?.location?.address2 ?? ''],
        city: [data.item?.location?.city ?? '', Validators.required],
        state: [data.item?.location?.state ?? '', Validators.required],
        zip: [data.item?.location?.zip ?? '', Validators.required],
        country: [data.item?.location?.country ?? '', Validators.required]
      }),
      // The original dx-form bound this radio group to a field named
      // "committment" (typo) instead of the model's actual "commitment"
      // field, so the level the user picked was silently never saved -
      // named correctly here to match ConsultationSurveyModel for real.
      commitment: [data.item?.commitment ?? null, Validators.required],
      readiness: [data.item?.readiness ?? null, Validators.required],
      strategyDescription: [data.item?.strategyDescription ?? '', Validators.required],
      teamDescription: [data.item?.teamDescription ?? '', Validators.required],
      communicationDescription: [data.item?.communicationDescription ?? '', Validators.required],
      resourceDescription: [data.item?.resourceDescription ?? '', Validators.required],
      resultsDescription: [data.item?.resultsDescription ?? '', Validators.required],
      supportDescription: [data.item?.supportDescription ?? '', Validators.required]
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
    const value: ConsultationSurveyModel = { ...this.data.item, ...this.form.getRawValue() };

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
