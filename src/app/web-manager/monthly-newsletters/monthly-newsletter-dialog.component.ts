import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { MonthlyNewsletterModel } from 'src/app/common/models/domain/monthly-newsletter.model';
import { MonthlyNewletterService } from 'src/app/common/services/data/monthly-newsletter.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface MonthlyNewsletterDialogData {
  item: MonthlyNewsletterModel | null;
}

// No field here was required in the original (it used DevExtreme's inline
// row-editing, which never had explicit validation rules configured) - so
// this form intentionally has no Validators.required, to match.
@Component({
    selector: 'app-monthly-newsletter-dialog',
    templateUrl: './monthly-newsletter-dialog.component.html',
    styleUrls: ['./monthly-newsletter-dialog.component.scss'],
    standalone: false
})
export class MonthlyNewsletterDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Monthly Newletter';

  constructor(
    private dialogRef: MatDialogRef<MonthlyNewsletterDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: MonthlyNewsletterDialogData,
    private fb: FormBuilder,
    private service: MonthlyNewletterService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      date: [data.item?.date ?? null],
      title: [data.item?.title ?? ''],
      url: [data.item?.url ?? '']
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    this.inProgress$.next(true);
    const value: MonthlyNewsletterModel = { ...this.data.item, ...this.form.value };

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
