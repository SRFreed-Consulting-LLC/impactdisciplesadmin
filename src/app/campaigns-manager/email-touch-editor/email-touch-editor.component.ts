import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Timestamp } from 'firebase/firestore';
import { CampaignModel } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailModel, CampaignEmailSendConfig } from 'src/app/common/models/domain/campaign-email.model';
import { emptyEmailStats } from 'src/app/common/models/domain/campaign.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';

// Email touch editor (Campaign Manager v2, Phase 2): authors ONE email of
// a campaign - subject, content (snapshotted from a mail_templates doc at
// selection time: the touch is historical-by-default, editing the
// template later never rewrites what a campaign sent), and how it goes
// out (now / scheduled / tag-triggered). Send actions call the
// server-side send engine; the admin never loops recipients client-side
// (the v1 blast dialogs' un-awaited loops are exactly what this
// replaces). Hosted in-page by campaign-detail.
@Component({
    selector: 'app-email-touch-editor',
    templateUrl: './email-touch-editor.component.html',
    styleUrls: ['./email-touch-editor.component.scss'],
    standalone: false
})
export class EmailTouchEditorComponent implements OnInit {
  @Input() campaign!: CampaignModel;
  /** null = new touch. Only draft/scheduled touches are editable. */
  @Input() touch: CampaignEmailModel | null = null;
  @Output() closed = new EventEmitter<boolean>();

  form: FormGroup;
  saving = false;
  sending = false;

  templates: MailTemplateModel[] = [];
  knownTags: string[] = [];

  // Snapshot of the chosen content + its memoized preview (a per-CD-cycle
  // SafeHtml rebuild reloads the iframe in a loop - designer lesson).
  private html = '';
  previewSrcdoc: SafeHtml | null = null;

  testEmail = '';

  constructor(
    private campaignService: CampaignService,
    private emailService: CampaignEmailService,
    private templatesService: EMailTemplatesService,
    private tagRuleService: TagRuleService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private sanitizer: DomSanitizer,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      label: [''],
      subject: ['', Validators.required],
      templateId: [null],
      sendMode: ['now', Validators.required],
      scheduledAt: [null],
      triggerTags: [[]],
      afterDays: [3]
    });
  }

  ngOnInit(): void {
    this.templatesService.getAll().then((templates) => this.templates = templates);
    this.tagRuleService.getAll().then((rules) => {
      this.knownTags = [...new Set(rules.map((r) => r.tag).filter(Boolean))].sort();
    });
    this.authService.dao.loggedInUser$.subscribe((user) => {
      if (user?.email && !this.testEmail) {
        this.testEmail = user.email;
      }
    });

    if (this.touch) {
      this.html = this.touch.html ?? '';
      this.refreshPreview();
      const config = this.touch.sendConfig;
      this.form.patchValue({
        label: this.touch.label ?? '',
        subject: this.touch.subject,
        sendMode: config?.mode ?? 'now',
        scheduledAt: this.toInputDate(config?.scheduledAt),
        triggerTags: config?.tagTrigger?.tags ?? [],
        afterDays: config?.tagTrigger?.afterDays ?? 3
      });
    }
  }

  get sendMode(): string {
    return this.form.get('sendMode')?.value;
  }

  get hasContent(): boolean {
    return !!this.html.trim();
  }

  onTemplatePicked(templateId: string): void {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) {
      return;
    }
    // SNAPSHOT - the touch keeps this html even if the template changes.
    this.html = template.html ?? '';
    if (!this.form.get('subject')?.value && template.subject) {
      this.form.patchValue({ subject: template.subject });
    }
    this.refreshPreview();
  }

  private refreshPreview(): void {
    this.previewSrcdoc = this.html
      ? this.sanitizer.bypassSecurityTrustHtml(this.html)
      : null;
  }

  private buildSendConfig(): CampaignEmailSendConfig {
    const value = this.form.value;
    return {
      mode: value.sendMode,
      scheduledAt: value.sendMode === 'scheduled' && value.scheduledAt
        ? Timestamp.fromDate(new Date(value.scheduledAt)) : null,
      tagTrigger: value.sendMode === 'tagTriggered'
        ? { tags: value.triggerTags ?? [], afterDays: value.afterDays ?? 0 }
        : null
    };
  }

  /** Persists the touch and returns it (status decided by the send mode:
   *  scheduled-with-a-date saves as 'scheduled', everything else 'draft'
   *  until an explicit send/activate). */
  private async persist(status?: string): Promise<CampaignEmailModel> {
    const value = this.form.value;
    const resolved = status ??
      (value.sendMode === 'scheduled' && value.scheduledAt ? 'scheduled' : 'draft');
    const payload: CampaignEmailModel = {
      ...(this.touch ?? new CampaignEmailModel()),
      campaignId: this.campaign.id!,
      label: value.label || null,
      subject: value.subject,
      html: this.html,
      status: resolved as CampaignEmailModel['status'],
      sendConfig: this.buildSendConfig(),
      audienceOverride: this.touch?.audienceOverride ?? null,
      sentAt: this.touch?.sentAt ?? null,
      recipientCount: this.touch?.recipientCount ?? null,
      stats: this.touch?.stats ?? emptyEmailStats(),
      source: this.touch?.source ?? null,
      mailchimpCampaignId: this.touch?.mailchimpCampaignId ?? null,
      capturedAt: this.touch?.capturedAt ?? null,
      design: this.touch?.design ?? null,
      links: this.touch?.links ?? null
    };
    const saved = this.touch?.id
      ? await this.emailService.update(this.touch.id, payload)
      : await this.emailService.add(payload);
    this.touch = saved;
    return saved;
  }

  private validate(): boolean {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return false;
    }
    if (!this.hasContent) {
      this.snackbar.error('Pick a template to give this email its content.');
      return false;
    }
    if (this.sendMode === 'scheduled' && !this.form.value.scheduledAt) {
      this.snackbar.error('Pick when this email should send.');
      return false;
    }
    if (this.sendMode === 'tagTriggered' && !(this.form.value.triggerTags ?? []).length) {
      this.snackbar.error('Pick at least one trigger tag.');
      return false;
    }
    return true;
  }

  async saveDraft(): Promise<void> {
    if (!this.validate()) {
      return;
    }
    this.saving = true;
    try {
      await this.persist();
      this.snackbar.success('Email Saved');
      this.closed.emit(true);
    } catch (err) {
      this.snackbar.error('Save failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.saving = false;
    }
  }

  async sendTest(): Promise<void> {
    if (!this.validate() || !this.testEmail.includes('@')) {
      return;
    }
    this.saving = true;
    try {
      const saved = await this.persist();
      await this.campaignService.sendTestEmail(saved.id!, this.testEmail.trim());
      this.snackbar.success('Test email queued to ' + this.testEmail);
    } catch (err) {
      this.snackbar.error('Test failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.saving = false;
    }
  }

  /** Send-now / activate-trigger: preview the audience, confirm the real
   *  count, then hand off to the server-side engine. */
  async sendNow(): Promise<void> {
    if (!this.validate()) {
      return;
    }
    this.sending = true;
    try {
      const audience = this.campaign.audience;
      if (!audience?.mode) {
        this.snackbar.error('The campaign has no audience - edit the campaign first.');
        return;
      }

      if (this.sendMode === 'tagTriggered') {
        const confirmed = await this.confirmService.confirm(
          'Activate this automated email? Each tagged contact receives it once, ' +
          this.form.value.afterDays + ' day(s) after the activity that tagged them, ' +
          'while the campaign is live.', 'Activate Automation');
        if (!confirmed) {
          return;
        }
        await this.persist('sending');
        this.snackbar.success('Automation activated - the hourly scheduler owns it now.');
        this.closed.emit(true);
        return;
      }

      const preview = await this.campaignService.previewAudience(audience);
      const confirmed = await this.confirmService.confirm(
        `Send "${this.form.value.subject}" to <b>${preview.count}</b> recipient(s)? ` +
        'Large sends roll out in paced hourly batches.', 'Confirm Send');
      if (!confirmed) {
        return;
      }
      const saved = await this.persist();
      const result = await this.campaignService.enqueueEmail(saved.id!);
      this.snackbar.success(
        `Queued ${result.queued} of ${result.recipients} - ${result.sentImmediately} sent immediately.`);
      this.closed.emit(true);
    } catch (err) {
      this.snackbar.error('Send failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.sending = false;
    }
  }

  cancel(): void {
    this.closed.emit(false);
  }

  private toInputDate(value: unknown): string | null {
    const date = dateFromTimestamp(value as never);
    if (!date) {
      return null;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}
