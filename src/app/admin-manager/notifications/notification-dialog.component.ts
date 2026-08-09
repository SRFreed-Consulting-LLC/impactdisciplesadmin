import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Functions, HttpsCallable, httpsCallable } from '@angular/fire/functions';
import { NotificationRegistrationModel } from 'src/app/common/models/admin/notification-registration.model';
import { SnackbarService } from '../../shared/snackbar.service';

export interface NotificationDialogData {
  item: NotificationRegistrationModel | null;
}

// Faithful port of a pre-existing bug in the original, kept exactly as-is
// per explicit request rather than fixed: clicking SEND shows a success
// toast and closes immediately, but 5 seconds later sendMessage() throws
// because selectedRegistration is never actually set - the original only
// ever called showEditModal (which never touched selectedRegistration);
// showSendMessage, the one method that *did* set it, was dead code never
// wired to anything in the template. So no notification is ever really
// sent today. The title/body typed into the form are captured by the form
// only - the original's sendMessage() read separate always-empty
// this.title/this.body fields instead, never the form's values; that
// disconnect is preserved here too (the class-level title/body below are
// never written to, same as the original).
@Component({
    selector: 'app-notification-dialog',
    templateUrl: './notification-dialog.component.html',
    styleUrls: ['./notification-dialog.component.scss'],
    standalone: false
})
export class NotificationDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Notifications';
  private functions: Functions;
  private addMessageFunction: HttpsCallable;
  private title = '';
  private body = '';
  private selectedRegistration: NotificationRegistrationModel;

  constructor(
    private dialogRef: MatDialogRef<NotificationDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: NotificationDialogData,
    private fb: FormBuilder,
    private snackbar: SnackbarService,
    functions: Functions
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      title: [''],
      body: ['']
    });
    // Injected, not a raw getFunctions() call - see app.module.ts's
    // provideFunctions() / FireAuthDao's own Auth for why (same "Calling
    // Firebase APIs outside of an Injection context" fix).
    this.functions = functions;
    this.addMessageFunction = httpsCallable(this.functions, 'sendNotification');
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    this.inProgress$.next(true);
    this.snackbar.success(this.itemType + ' Sent');

    setTimeout(() => {
      this.sendMessage();
      this.snackbar.success(this.itemType + ' Sent');
    }, 5000);

    this.dialogRef.close(true);
  }

  private sendMessage(): void {
    this.addMessageFunction({ title: this.title, body: this.body, token: this.selectedRegistration.fcmId }).then(() => {
      this.body = '';
      this.title = '';
    });
  }
}
