import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { FormSubmissionModel } from 'src/app/common/models/domain/form-submission.model';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { formatFieldValue } from 'src/app/common/models/domain/form-field.model';
import { EMailService } from 'src/app/common/services/data/email.service';
import { SnackbarService } from '../snackbar.service';

export interface RouteRequestDialogData {
  item: FormSubmissionModel;
}

// The dashboard's "New Requests" mini workflow (see dashboard.component.ts's
// comment) and Custom Form Submissions' "Forward" row action both open this
// same dialog. Staff recipients come from the same admin_users collection
// the Admin Users ("My Team") screen lists, unfiltered by role - see that
// screen's own component, which shows every admin_users record with no
// role filter either. Sending picks the plain sendHtmlEmail() path (a
// one-off composed message, not a stored mail_templates entry) since the
// body is assembled fresh from this specific submission's fields every time.
@Component({
    selector: 'app-route-request-dialog',
    templateUrl: './route-request-dialog.component.html',
    styleUrls: ['./route-request-dialog.component.scss'],
    standalone: false
})
export class RouteRequestDialogComponent implements OnInit {
  item: FormSubmissionModel;
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  staff: AdminUser[] = [];
  staffLoading = true;

  // Live preview of the exact email that will be sent - re-rendered from
  // the form's current value on every keystroke (see updatePreview()),
  // rather than a static example, so what the admin sees here always
  // matches what actually goes out.
  previewSubject = '';
  previewHtml = '';

  constructor(
    private dialogRef: MatDialogRef<RouteRequestDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: RouteRequestDialogData,
    private fb: FormBuilder,
    private adminUserService: AdminUserService,
    private authService: AdminAuthService,
    private submissionService: FormSubmissionService,
    private emailService: EMailService,
    private snackbar: SnackbarService
  ) {
    this.item = data.item;
  }

  ngOnInit(): void {
    this.form = this.fb.group({
      recipientId: ['', Validators.required],
      otherName: [''],
      otherEmail: [''],
      note: ['']
    });

    this.form.get('recipientId')!.valueChanges.subscribe(() => this.updateOtherValidators());
    this.form.valueChanges.subscribe(() => this.updatePreview());
    this.updatePreview();

    this.adminUserService.getAll().then((users) => {
      this.staff = users
        .filter((u) => !!u.email)
        .sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? '') || (a.firstName ?? '').localeCompare(b.firstName ?? ''));
      this.staffLoading = false;
    }).catch(() => {
      this.staffLoading = false;
    });
  }

  get isOther(): boolean {
    return this.form?.get('recipientId')?.value === 'other';
  }

  private updateOtherValidators(): void {
    const otherEmail = this.form.get('otherEmail')!;
    if (this.isOther) {
      otherEmail.setValidators([Validators.required, Validators.email]);
    } else {
      otherEmail.setValidators([]);
    }
    otherEmail.updateValueAndValidity({ emitEvent: false });
  }

  // Best-effort submitter identity, same fallback order dashboard.component.ts
  // uses for the New Requests table (prefer an email-type field, then a
  // name-like text field) - duplicated rather than shared since both call
  // sites are small and independent, and this one also feeds the email body.
  submitterIdentity(): string {
    const emailField = this.item.fieldSnapshot?.find((f) => f.type === 'email');
    if (emailField && this.item.values?.[emailField.id]) {
      return String(this.item.values[emailField.id]);
    }
    const nameField = this.item.fieldSnapshot?.find((f) => f.type === 'text' && /name/i.test(f.label));
    if (nameField && this.item.values?.[nameField.id]) {
      return String(this.item.values[nameField.id]);
    }
    return 'Unknown';
  }

  private recipient(): { name: string; email: string } | null {
    const raw = this.form.getRawValue();
    if (raw.recipientId === 'other') {
      return raw.otherEmail ? { name: raw.otherName || raw.otherEmail, email: raw.otherEmail } : null;
    }
    const user = this.staff.find((u) => u.id === raw.recipientId);
    return user ? { name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email, email: user.email } : null;
  }

  private buildEmailHtml(recipientName: string, note: string): string {
    const senderName = this.senderName();
    const rows = (this.item.fieldSnapshot ?? [])
      .map((field) => `
        <tr>
          <td style="padding:6px 12px;border:1px solid #ddd;font-weight:600;background:#f7f7f7;">${this.escapeHtml(field.label)}</td>
          <td style="padding:6px 12px;border:1px solid #ddd;">${this.escapeHtml(formatFieldValue(field.type, this.item.values?.[field.id]))}</td>
        </tr>`)
      .join('');

    return `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:640px;">
        <p>Hi ${this.escapeHtml(recipientName)},</p>
        <p>${this.escapeHtml(senderName)} has forwarded a new <strong>${this.escapeHtml(this.item.formName)}</strong> request to you${note ? ', with the note below:' : '.'}</p>
        ${note ? `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #337ab7;background:#f0f4f8;">${this.escapeHtml(note).replace(/\n/g, '<br>')}</blockquote>` : ''}
        <h3 style="margin-bottom:6px;">Request Details</h3>
        <table style="border-collapse:collapse;width:100%;">${rows}</table>
        <p style="margin-top:16px;color:#666;font-size:12px;">Submitted ${this.item.submittedAt ? new Date(this.item.submittedAt).toLocaleString() : ''} via ${this.escapeHtml(this.item.formName)}.</p>
      </div>`;
  }

  private escapeHtml(value: string): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

  private senderName(): string {
    const user = this.authService.getLoggedInUser();
    return user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : 'An admin';
  }

  private updatePreview(): void {
    const recipient = this.recipient();
    const note = (this.form?.getRawValue()?.note as string) ?? '';
    this.previewSubject = `New Request Forwarded: ${this.item.formName}`;
    this.previewHtml = this.buildEmailHtml(recipient?.name || 'there', note);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSend(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const recipient = this.recipient();
    if (!recipient) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const note = (this.form.getRawValue().note as string) ?? '';
    const subject = `New Request Forwarded: ${this.item.formName}`;
    const html = this.buildEmailHtml(recipient.name, note);

    this.emailService.sendHtmlEmail(recipient.email, subject, html).then(() => {
      const updated: FormSubmissionModel = {
        ...this.item,
        status: 'routed',
        routedTo: recipient,
        routedNote: note,
        routedAt: new Date(),
        routedBy: this.senderName(),
        newRecordStatus: 'seen'
      };
      return this.submissionService.update(this.item.id!, updated);
    }).then(() => {
      this.snackbar.success(`Request forwarded to ${recipient.name}`);
      this.inProgress$.next(false);
      this.dialogRef.close(true);
    }).catch((err) => {
      this.inProgress$.next(false);
      this.snackbar.error('There was an error forwarding this request: ' + (err?.message ?? 'Unknown error'));
    });
  }
}
