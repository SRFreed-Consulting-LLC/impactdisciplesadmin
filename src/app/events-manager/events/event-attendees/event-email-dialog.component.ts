import { Component, Inject, OnInit } from '@angular/core';
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
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';

export interface EventEmailDialogData {
  eventId: string | undefined;
  eventName?: string;
  // Pre-filtered recipient list (e.g. the Summit Command Center's
  // "registrants with no breakouts picked" reminder). When present,
  // onSend() uses it INSTEAD of fetching all of the event's registrants -
  // everything downstream (campaign + explicit-list audience) is unchanged.
  recipients?: string[];
  subjectPrefill?: string;
}

/** Picker sentinel: file this send under a brand-new campaign. */
export const NEW_CAMPAIGN = '__new__';

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
export class EventEmailDialogComponent implements OnInit {
  /** The event's own campaigns, live ones first (see ngOnInit). */
  campaigns: CampaignModel[] = [];
  readonly NEW_CAMPAIGN = NEW_CAMPAIGN;
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
      campaignId: [NEW_CAMPAIGN],
      subject: [data.subjectPrefill ?? '', Validators.required],
      html: ['']
    });
  }

  // An event email belongs to the campaign the author already made for that
  // event. Creating one per send (the pre-2026-08-24 behaviour) split a
  // single effort's reporting across one row per button click, and left the
  // popup's webShown/webClicks on one campaign and the email's opens on
  // another. Live campaigns sort first, then newest by createdAt - falling
  // back to startDate for campaigns made before createdAt existed.
  async ngOnInit(): Promise<void> {
    if (!this.data.eventId) {
      return;
    }
    const found = await this.campaignService.getAllByValue('eventId', this.data.eventId);
    const madeAt = (c: CampaignModel) => toMillis(c.createdAt as never) || toMillis(c.startDate as never) || 0;
    this.campaigns = found.sort((a, b) =>
      (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1) || madeAt(b) - madeAt(a));
    this.form.patchValue({ campaignId: this.campaigns[0]?.id ?? NEW_CAMPAIGN });
  }

  /** The campaign this send will be filed under, for the confirm prompt. */
  get targetCampaignName(): string {
    const id = this.form.value.campaignId as string;
    return id === NEW_CAMPAIGN
      ? 'a new campaign'
      : (this.campaigns.find((c) => c.id === id)?.name ?? 'this campaign');
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

  // Fallback for an event with NO campaign yet. The name used to be
  // `${eventName} - ${subject}`, but the Command Center prefills the subject
  // with the event name already, which produced titles carrying it twice.
  private createCampaignFor(subject: string, emails: string[]): Promise<CampaignModel> {
    const eventName = this.data.eventName || 'Event';
    const name = subject.includes(eventName) ? subject : `${eventName} — ${subject}`;
    return this.campaignService.add({
      ...new CampaignModel(),
      name,
      goal: 'event',
      otherKind: null,
      eventId: this.data.eventId,
      channels: ['email'],
      status: 'live',
      startDate: new Date(),
      endDate: null,
      // Explicit list + unsubType 'none' = operational info email (see the
      // class comment). The touch carries the same list as an override, so
      // a later send to a different audience does not have to fight this.
      audience: { mode: 'list', emails, unsubType: 'none' },
      couponId: null,
      source: null,
      stats: emptyCampaignStats(),
      schemaVersion: 2
    });
  }

  // A campaign gains the email channel the moment it carries an email -
  // the same thing the popup editor does for 'web'. Nothing else on the
  // campaign is written.
  private async ensureEmailChannel(campaignId: string): Promise<void> {
    const campaign = this.campaigns.find((c) => c.id === campaignId);
    if (!campaign || (campaign.channels ?? []).includes('email')) {
      return;
    }
    const channels = [...(campaign.channels ?? []), 'email'] as CampaignModel['channels'];
    await this.campaignService.updateFields(campaignId, { channels });
    campaign.channels = channels;
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
      const source = this.data.recipients?.length
        ? this.data.recipients
        : (await this.service.getAllByValue('eventId', this.data.eventId)).map((r) => r.email ?? '');
      const emails = [...new Set(source
        .map((e) => (e ?? '').trim().toLowerCase())
        .filter((e) => e.includes('@')))];
      if (emails.length === 0) {
        this.snackbar.error('This event has no registrants to email.');
        return;
      }

      const confirmed = await this.confirmService.confirm(
        `Send "${subject}" to <b>${emails.length}</b> registrant(s) of this event?` +
        `<br><br>It will be filed under <b>${this.targetCampaignName}</b>.`,
        'Confirm Attendee Email');
      if (!confirmed) {
        return;
      }

      const chosen = this.form.value.campaignId as string;
      const campaignId = chosen === NEW_CAMPAIGN
        ? (await this.createCampaignFor(subject, emails)).id!
        : chosen;
      if (chosen !== NEW_CAMPAIGN) {
        await this.ensureEmailChannel(chosen);
      }

      const touch = await this.emailService.add({
        ...new CampaignEmailModel(),
        campaignId,
        // The recipient list rides on the TOUCH, never the campaign:
        // enqueueTouch resolves `touch.audienceOverride ?? campaign.audience`
        // (campaign-send.functions.ts), so an existing campaign's own
        // audience - and its web/popup channel - is left exactly as authored.
        // unsubType 'none' rides along, keeping this an operational send.
        audienceOverride: { mode: 'list', emails, unsubType: 'none' },
        label: null,
        subject,
        html: this.bakeSenderTokens(this.form.value.html as string),
        status: 'draft',
        sendConfig: { mode: 'now', scheduledAt: null, tagTrigger: null },
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
