import { Component, Inject } from '@angular/core';
import Quill from 'quill';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { CampaignModel, emptyCampaignStats, emptyEmailStats } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../../shared/rich-text-editor/quill-toolbar.config';
import { insertQuillVariable } from '../../../shared/rich-text-editor/variable-inserter.component';

export interface EventEmailDialogData {
  eventId: string | undefined;
  eventName?: string;
}

// Email this event's registrants - since Campaign Manager v2's Phase 6
// consolidation, a THIN FLOW over the unified send engine: creates a
// campaign (goal 'event', audience = the registrants' emails as an
// explicit list) with one touch and hands it to enqueueCampaignEmail.
// The audience carries unsubType 'none': these are OPERATIONAL info
// emails to people who registered - no unsubscribe footer, and the
// newsletter opt-out is deliberately NOT applied (the pre-v2 version of
// this dialog removed the unsubscribe link for exactly this reason -
// 2026-08-12 fullsweep note). What died: the un-awaited per-recipient
// sendHtmlEmail loop and the write-only customer-emails archive - the
// campaign IS the archive now.
@Component({
    selector: 'app-event-email-dialog',
    templateUrl: './event-email-dialog.component.html',
    styleUrls: ['./event-email-dialog.component.scss'],
    standalone: false
})
export class EventEmailDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  richTextModules = RICH_TEXT_TOOLBAR;

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

  private quill: Quill | undefined;

  constructor(
    private dialogRef: MatDialogRef<EventEmailDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: EventEmailDialogData,
    private fb: FormBuilder,
    private service: EventRegistrationService,
    private campaignService: CampaignService,
    private emailService: CampaignEmailService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      subject: ['', Validators.required],
      html: ['']
    });
  }

  onEditorCreated(quill: Quill): void {
    this.quill = quill;
  }

  insertVariable(variableName: string): void {
    insertQuillVariable(this.quill, variableName);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  // Sender name is a per-SEND constant - baked in before the touch saves
  // (the engine's per-recipient context doesn't carry it).
  private bakeSenderTokens(html: string): string {
    const user = this.authService.getLoggedInUser();
    const replacements: Record<string, string> = {
      '*|SENDER_FNAME|*': user?.firstName ?? '',
      '{{Sender First Name}}': user?.firstName ?? '',
      '*|SENDER_LNAME|*': user?.lastName ?? '',
      '{{Sender Last Name}}': user?.lastName ?? ''
    };
    let result = html;
    for (const [token, value] of Object.entries(replacements)) {
      result = result.split(token).join(value);
    }
    return result;
  }

  async onSend(): Promise<void> {
    if (this.form.invalid || !this.data.eventId) {
      this.form.markAllAsTouched();
      return;
    }
    this.inProgress$.next(true);

    const subject = this.form.value.subject as string;

    try {
      const registrations = await this.service.getAllByValue('eventId', this.data.eventId);
      const emails = [...new Set(registrations
        .map((r) => (r.email ?? '').trim().toLowerCase())
        .filter((e) => e.includes('@')))];
      if (emails.length === 0) {
        this.snackbar.error('This event has no registrants to email.');
        return;
      }

      const confirmed = await this.confirmService.confirm(
        `Send "${subject}" to <b>${emails.length}</b> registrant(s) of this event?`,
        'Confirm Attendee Email');
      if (!confirmed) {
        return;
      }

      const campaign = await this.campaignService.add({
        ...new CampaignModel(),
        name: `${this.data.eventName || 'Event'} — ${subject}`,
        goal: 'event',
        otherKind: null,
        eventId: this.data.eventId,
        channels: ['email'],
        status: 'live',
        startDate: new Date(),
        endDate: null,
        // Explicit list + unsubType 'none' = operational info email (see
        // the class comment).
        audience: { mode: 'list', emails, unsubType: 'none' },
        couponId: null,
        source: null,
        stats: emptyCampaignStats(),
        schemaVersion: 2
      });

      const touch = await this.emailService.add({
        ...new CampaignEmailModel(),
        campaignId: campaign.id!,
        label: null,
        subject,
        html: this.bakeSenderTokens(this.form.value.html as string),
        status: 'draft',
        sendConfig: { mode: 'now', scheduledAt: null, tagTrigger: null },
        audienceOverride: null,
        sentAt: null,
        recipientCount: null,
        stats: emptyEmailStats(),
        source: null,
        mailchimpCampaignId: null,
        capturedAt: null,
        design: null,
        links: null
      });

      const result = await this.campaignService.enqueueEmail(touch.id!);
      this.snackbar.success(
        `Email queued to ${result.recipients} registrant(s) - ` +
        `${result.sentImmediately} sent immediately.`);
      this.dialogRef.close(true);
    } catch (err) {
      this.snackbar.error('Send failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.inProgress$.next(false);
    }
  }
}
