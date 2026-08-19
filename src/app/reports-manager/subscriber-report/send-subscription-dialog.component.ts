import { Component, Inject } from '@angular/core';
import Quill from 'quill';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { SubscriptionType, subscriptionFieldsForType } from 'src/app/common/models/domain/utils/customer.model';
import { CampaignAudience, CampaignModel, emptyCampaignStats } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { emptyEmailStats } from 'src/app/common/models/domain/campaign.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { insertQuillVariable } from '../../shared/rich-text-editor/variable-inserter.component';

export interface SendSubscriptionDialogData {
  // Which audience this send targets. Always the WHOLE audience for this
  // type - no way to narrow who a send reaches to some subset (per the
  // user, explicitly - this app doesn't do subscriber sub-lists).
  type: SubscriptionType;
}

// Newsletter / Prayer Request blast - since Campaign Manager v2's Phase 6
// consolidation, a THIN FLOW over the unified send engine: composing here
// creates a campaign (goal other/newsletter|prayer-letter, audience = the
// flag group) with one email touch and hands it to enqueueCampaignEmail.
// What died with the old version (deliberately): the client-side
// per-recipient sendHtmlEmail() loop (un-awaited, unpaced, no ledger,
// no unsubscribe for prayer sends) and the write-only newsletters/prayers
// archive collections - the campaign + its touch ARE the archive now,
// visible with a real funnel on Campaigns Manager.
@Component({
    selector: 'app-send-subscription-dialog',
    templateUrl: './send-subscription-dialog.component.html',
    styleUrls: ['./send-subscription-dialog.component.scss'],
    standalone: false
})
export class SendSubscriptionDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  richTextModules = RICH_TEXT_TOOLBAR;

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

  private quill: Quill | undefined;

  constructor(
    private dialogRef: MatDialogRef<SendSubscriptionDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SendSubscriptionDialogData,
    private fb: FormBuilder,
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

  get dialogTitle(): string {
    return this.data.type === 'prayer' ? 'SEND PRAYER REQUEST' : 'SEND NEWSLETTER';
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

  // Sender name is a per-SEND constant, not per-recipient - the send
  // engine's per-recipient context doesn't carry it, so those tokens are
  // baked in here before the touch is saved. Recipient/date tokens stay
  // for the engine to render per recipient.
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
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.inProgress$.next(true);

    const type = this.data.type;
    const subject = this.form.value.subject as string;
    const { flagField } = subscriptionFieldsForType(type);
    const audience: CampaignAudience = { mode: 'flags', flags: [flagField] };
    const kindLabel = type === 'prayer' ? 'Prayer Request' : 'Newsletter';

    try {
      // Real recipient count BEFORE anything is created or sent - the
      // same resolver the engine uses.
      const preview = await this.campaignService.previewAudience(audience);
      const confirmed = await this.confirmService.confirm(
        `Send "${subject}" to <b>${preview.count}</b> ${kindLabel.toLowerCase()} subscriber(s)? ` +
        'Large sends roll out in paced hourly batches.', `Confirm ${kindLabel}`);
      if (!confirmed) {
        return;
      }

      const campaign = await this.campaignService.add({
        ...new CampaignModel(),
        name: `${kindLabel} — ${subject}`,
        goal: 'other',
        otherKind: type === 'prayer' ? 'prayer-letter' : 'newsletter',
        channels: ['email'],
        status: 'live',
        startDate: new Date(),
        endDate: null,
        audience,
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
        `${kindLabel} queued to ${result.recipients} recipient(s) - ` +
        `${result.sentImmediately} sent immediately, the rest go out in hourly batches.`);
      this.dialogRef.close(true);
    } catch (err) {
      this.snackbar.error('Send failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.inProgress$.next(false);
    }
  }
}
