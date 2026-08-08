import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { AnnouncementModel } from 'impactdisciplescommon/src/models/domain/announcement.model.ts';
import { EventAnnouncementService } from 'impactdisciplescommon/src/services/data/event-announcement.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { SnackbarService } from '../../../../shared/snackbar.service';

export interface AnnouncementDialogData {
  item: AnnouncementModel | null;
  eventId: string;
}

// title is [isRequired] in the original dx-form; announcement (the textarea)
// is bound via plain ngModel outside the form with no validation, so it
// stays optional here too. date/sentBy are never user-edited - date is
// re-stamped to now() on every save (add or edit, matching the original)
// and sentBy is looked up from the current admin user, same as before.
@Component({
    selector: 'app-announcement-dialog',
    templateUrl: './announcement-dialog.component.html',
    styleUrls: ['./announcement-dialog.component.scss'],
    standalone: false
})
export class AnnouncementDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Event Announcement';

  constructor(
    private dialogRef: MatDialogRef<AnnouncementDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: AnnouncementDialogData,
    private fb: FormBuilder,
    private service: EventAnnouncementService,
    private authService: AdminAuthService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      title: [data.item?.title ?? '', Validators.required],
      announcement: [data.item?.announcement ?? '']
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  async onSave(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const user = await this.authService.getLoggedInUser();
    const value: AnnouncementModel = {
      ...this.data.item,
      ...this.form.value,
      eventId: this.data.eventId,
      date: Timestamp.now(),
      sentBy: user.firstName + ' ' + user.lastName
    };

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
