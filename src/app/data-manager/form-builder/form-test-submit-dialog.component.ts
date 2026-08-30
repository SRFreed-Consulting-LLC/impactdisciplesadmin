import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { flattenDataFields, FormControlStyle, FormFieldDef } from '@impact-common/shared/models/domain/form-field.model';
import { FormSubmissionModel } from '@impact-common/shared/models/domain/form-submission.model';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface FormTestSubmitDialogData {
  formId: string;
  formName: string;
  fields: FormFieldDef[];
  backgroundColor?: string;
  controlStyle?: FormControlStyle;
}

// Hosts app-form-renderer in 'fill' mode so an admin can actually fill out
// and submit their own form from inside the builder - the submission is
// real (written via FormSubmissionService.add(), same path a public form
// will eventually use) but flagged isTest so the Custom Form Submissions
// list can tell it apart. Lets the whole storage -> submissions-list ->
// detail-view pipeline be verified end-to-end without a public-facing form
// existing yet.
@Component({
    selector: 'app-form-test-submit-dialog',
    templateUrl: './form-test-submit-dialog.component.html',
    styleUrls: ['./form-test-submit-dialog.component.scss'],
    standalone: false
})
export class FormTestSubmitDialogComponent {
  submitting = false;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: FormTestSubmitDialogData,
    private dialogRef: MatDialogRef<FormTestSubmitDialogComponent>,
    private submissionService: FormSubmissionService,
    private snackbar: SnackbarService
  ) {}

  onSubmit(values: Record<string, unknown>): void {
    this.submitting = true;
    const dataFields = flattenDataFields(this.data.fields);
    const submission: FormSubmissionModel = {
      formId: this.data.formId,
      formName: this.data.formName,
      fieldSnapshot: dataFields.map((f) => ({ id: f.id, label: f.label, type: f.type })),
      values,
      submittedAt: new Date(),
      isTest: true
      // newRecordStatus is deliberately NOT set - see
      // dynamic-form.component.ts in the web repo. A test submit still
      // must not light the staff bell, but that is now guaranteed by
      // isTest, which onFormSubmissionCreated skips explicitly, rather
      // than as a side effect of pre-setting a field the trigger owns.
      // Sweep finding S7, 2026-08-28.
    };

    this.submissionService
      .add(submission)
      .then(() => {
        this.snackbar.success('Test Submission Recorded');
        this.dialogRef.close(true);
      })
      .catch(() => {
        this.submitting = false;
        this.snackbar.error('Some Error Occured');
      });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
