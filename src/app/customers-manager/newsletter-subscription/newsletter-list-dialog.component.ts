import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { EmailList } from 'src/app/common/models/utils/email-list.model';
import { NewsletterSubscriptionModel } from 'src/app/common/models/domain/newsletter-subscription.model';
import { EmailListService } from 'src/app/common/services/data/email-list.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface NewsletterListDialogData {
  item: EmailList | null;
  // The subscriber rows currently checked in the main grid - becomes the
  // list's membership, matching the original's onListSave() which set
  // selectedList.list = selectedSubscribers regardless of add vs. edit.
  members: NewsletterSubscriptionModel[];
}

@Component({
    selector: 'app-newsletter-list-dialog',
    templateUrl: './newsletter-list-dialog.component.html',
    styleUrls: ['./newsletter-list-dialog.component.scss'],
    standalone: false
})
export class NewsletterListDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  constructor(
    private dialogRef: MatDialogRef<NewsletterListDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: NewsletterListDialogData,
    private fb: FormBuilder,
    private service: EmailListService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      name: [data.item?.name ?? '', Validators.required]
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
    const value: EmailList = {
      ...this.data.item,
      name: this.form.value.name,
      type: 'newsletter',
      list: this.data.members
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success('List ' + (this.isEdit ? 'Updated' : 'Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
