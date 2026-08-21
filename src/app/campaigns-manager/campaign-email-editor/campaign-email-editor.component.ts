import { Component, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, filter, firstValueFrom, take } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { CampaignModel, emptyEmailStats } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailModel, CampaignEmailSendConfig } from 'src/app/common/models/domain/campaign-email.model';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import {
  EmailDesign,
  createDefaultDesign,
  createDesignFromFullHtml
} from 'src/app/common/models/admin/email-design.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { stripUndefinedDeep } from 'src/app/common/utils/strip-undefined';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { DesignerStateService } from 'src/app/tools-manager/email-designer/designer-state.service';
import { PreviewDialogComponent } from 'src/app/tools-manager/email-designer/preview/preview-dialog.component';
import {
  TemplatePickerDialogComponent,
  TemplatePickerData,
  TemplatePickerResult
} from 'src/app/tools-manager/email-designer/template-picker/template-picker-dialog.component';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { SaveAsTemplateDialogComponent } from './save-as-template-dialog.component';

// ONE screen for a campaign email: design it and schedule it together
// (2026-08-21). Replaces the old split where EmailTouchEditorComponent
// picked a template's html from a dropdown and the real builder lived
// somewhere else entirely - an admin had to leave the campaign to design
// anything, and the two halves never met.
//
// Full-screen route rather than an in-page mode inside campaign detail, so
// the canvas gets the whole window and the browser's own back button and
// the unsaved-changes guard work - the same treatment the System Templates
// designer already gets. Hosts EmailBuilderModule's canvas + side panel and
// provides its OWN DesignerStateService, so each editor instance has a
// fresh design and undo history.
//
// The send settings that used to be a column of form fields are behind the
// toolbar's Schedule button now; their behaviour is unchanged, including
// which status a save resolves to and the audience-count confirm before a
// real send.
//
// Storage: `design` (builder JSON) rides the touch while it is a draft and
// `html` is recompiled from it on every save - the send engine only ever
// reads html. That matches CampaignEmailModel's own contract, which already
// carried a `design` field the old editor never populated.
@Component({
    selector: 'app-campaign-email-editor',
    templateUrl: './campaign-email-editor.component.html',
    styleUrls: ['./campaign-email-editor.component.scss'],
    standalone: false,
    providers: [DesignerStateService]
})
export class CampaignEmailEditorComponent implements OnInit {
  campaign: CampaignModel | null = null;
  touch: CampaignEmailModel | null = null;

  form: FormGroup;
  loading$ = new BehaviorSubject<boolean>(true);
  saving = false;
  sending = false;

  /** The Schedule slide-over. */
  scheduleOpen = false;

  knownTags: string[] = [];
  testEmail = '';

  private campaignId = '';
  private touchId: string | null = null;
  /** True until the first save gives a brand-new email its id. */
  private isNew = false;
  private currentUserEmail = '';

  constructor(
    public state: DesignerStateService,
    private route: ActivatedRoute,
    private router: Router,
    private campaignService: CampaignService,
    private emailService: CampaignEmailService,
    private templatesService: EMailTemplatesService,
    private tagRuleService: TagRuleService,
    private permissionService: PermissionService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private dialog: MatDialog,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      label: [''],
      subject: ['', Validators.required],
      sendMode: ['now', Validators.required],
      scheduledAt: [null],
      triggerTags: [[]],
      afterDays: [3]
    });
  }

  ngOnInit(): void {
    this.campaignId = this.route.snapshot.paramMap.get('campaignId') ?? '';
    const touchParam = this.route.snapshot.paramMap.get('touchId');
    this.touchId = touchParam && touchParam !== 'new' ? touchParam : null;
    this.isNew = !this.touchId;

    // Same cold-load guard the System Templates designer uses: on a direct
    // URL hit PermissionService's cached user hasn't arrived yet, and a
    // synchronous canAdd/canEdit would bounce a legitimate admin.
    this.authService.dao.loggedInUser$
      .pipe(filter((user) => !!user), take(1))
      .subscribe((user) => {
        this.currentUserEmail = user?.email ?? '';
        this.testEmail = this.currentUserEmail;
        this.load();
      });

    this.tagRuleService.getAll().then((rules) => {
      this.knownTags = [...new Set(rules.map((r) => r.tag).filter(Boolean))].sort();
    });
  }

  private load(): void {
    const screenKey = 'campaigns-manager.campaigns';
    const allowed = this.touchId
      ? this.permissionService.canEdit(screenKey)
      : this.permissionService.canAdd(screenKey);
    if (!allowed) {
      this.backToCampaign();
      return;
    }

    this.campaignService.getById(this.campaignId).then((campaign) => {
      if (!campaign) {
        this.snackbar.error('Campaign not found.');
        this.router.navigate(['/campaigns-manager'], { queryParams: { tab: 'campaigns' } });
        return;
      }
      this.campaign = campaign;

      if (!this.touchId) {
        this.state.load(createDefaultDesign());
        this.loading$.next(false);
        this.openTemplatePicker();
        return;
      }

      this.emailService.getById(this.touchId).then((touch) => {
        if (!touch) {
          this.snackbar.error('Email not found.');
          this.backToCampaign();
          return;
        }
        // Sent history is immutable - the timeline only offers edit on
        // draft/scheduled touches, and a hand-typed URL must not get round
        // that.
        if (touch.status !== 'draft' && touch.status !== 'scheduled') {
          this.snackbar.error('This email has already gone out and cannot be edited.');
          this.backToCampaign();
          return;
        }
        this.touch = touch;
        const config = touch.sendConfig;
        this.form.patchValue({
          label: touch.label ?? '',
          subject: touch.subject,
          sendMode: config?.mode ?? 'now',
          scheduledAt: this.toInputDate(config?.scheduledAt),
          triggerTags: config?.tagTrigger?.tags ?? [],
          afterDays: config?.tagTrigger?.afterDays ?? 3
        });
        // Touches authored before this editor existed carry only compiled
        // html - imported as one text block, the same path ?fromEmail= uses.
        this.state.load((touch.design as EmailDesign) ?? createDesignFromFullHtml(touch.html ?? ''));
        this.loading$.next(false);
      });
    });
  }

  // ---- template gallery ----

  openTemplatePicker(): void {
    this.dialog
      .open<TemplatePickerDialogComponent, TemplatePickerData, TemplatePickerResult>(
        TemplatePickerDialogComponent,
        { width: '980px', maxWidth: '95vw', data: { mode: 'campaign' } }
      )
      .afterClosed()
      .subscribe((result) => {
        if (result?.kind !== 'use') {
          // Cancel (or the unreachable 'edit') keeps whatever is on the
          // canvas - a blank default on a new email.
          return;
        }
        this.state.load(result.design);
        this.state.dirty = true;
        if (result.subject && !this.form.value.subject) {
          this.form.patchValue({ subject: result.subject });
        }
      });
  }

  async saveAsTemplate(): Promise<void> {
    const suggested = (this.form.value.label || this.form.value.subject || '').trim();
    const name = await firstValueFrom(
      this.dialog
        .open<SaveAsTemplateDialogComponent, { suggestedName: string }, string | false>(
          SaveAsTemplateDialogComponent, { width: '440px', data: { suggestedName: suggested } }
        )
        .afterClosed()
    );

    if (!name) {
      return;
    }

    const design = stripUndefinedDeep(this.state.design);
    const template: MailTemplateModel = {
      name,
      subject: (this.form.value.subject ?? '').trim(),
      // Marketing starting point, never a template the app sends from.
      kind: 'campaign',
      design,
      html: compileEmailDesign(design, { title: name }),
      attachments: []
    } as MailTemplateModel;

    try {
      await this.templatesService.add(template);
      this.snackbar.success(`Saved "${name}" to the campaign template gallery`);
    } catch (err) {
      this.snackbar.error('Could not save template: ' + ((err as Error)?.message ?? err));
    }
  }

  // ---- designer chrome ----

  get sendMode(): string {
    return this.form.get('sendMode')?.value;
  }

  get statusLabel(): string {
    const status = this.touch?.status ?? 'draft';
    if (status === 'scheduled') {
      const when = dateFromTimestamp(this.touch?.sendConfig?.scheduledAt as never);
      return when ? 'Scheduled · ' + when.toLocaleString() : 'Scheduled';
    }
    if (this.sendMode === 'tagTriggered') {
      return 'Draft · automated';
    }
    return this.touch?.id ? 'Draft' : 'New · not saved';
  }

  get primaryActionLabel(): string {
    if (this.sendMode === 'tagTriggered') {
      return 'ACTIVATE';
    }
    return this.sendMode === 'scheduled' ? 'SAVE SCHEDULE' : 'SEND NOW';
  }

  setViewMode(mode: 'desktop' | 'mobile'): void {
    this.state.viewMode = mode;
  }

  onCanvasBackgroundClick(): void {
    this.state.deselect();
  }

  toggleSchedule(): void {
    this.scheduleOpen = !this.scheduleOpen;
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.scheduleOpen) {
      this.scheduleOpen = false;
      return;
    }
    if (this.state.inlineEditing || !(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.state.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      this.state.redo();
    }
  }

  onPreview(): void {
    this.dialog.open(PreviewDialogComponent, {
      width: '900px',
      height: '90vh',
      maxWidth: '95vw',
      data: {
        design: this.state.design,
        subject: this.form.value.subject,
        title: this.form.value.label || this.form.value.subject
      }
    });
  }

  // Consulted by campaignEmailEditorCanDeactivateGuard.
  canLeave(): Promise<boolean> {
    if (!this.state.dirty && !this.form.dirty) {
      return Promise.resolve(true);
    }
    return this.confirmService.confirm('Discard unsaved changes to this email?', 'Unsaved Changes');
  }

  // ---- persistence (ported verbatim from EmailTouchEditorComponent) ----

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
   *  until an explicit send/activate). The design is compiled to html on
   *  every save - html is what the send engine reads. */
  private async persist(status?: string): Promise<CampaignEmailModel> {
    const value = this.form.value;
    const resolved = status ??
      (value.sendMode === 'scheduled' && value.scheduledAt ? 'scheduled' : 'draft');
    const design = stripUndefinedDeep(this.state.design);
    const title = value.label || value.subject || 'Email';
    const payload: CampaignEmailModel = {
      ...(this.touch ?? new CampaignEmailModel()),
      campaignId: this.campaignId,
      label: value.label || null,
      subject: value.subject,
      design,
      html: compileEmailDesign(design, { title }),
      status: resolved as CampaignEmailModel['status'],
      sendConfig: this.buildSendConfig(),
      audienceOverride: this.touch?.audienceOverride ?? null,
      sentAt: this.touch?.sentAt ?? null,
      recipientCount: this.touch?.recipientCount ?? null,
      stats: this.touch?.stats ?? emptyEmailStats(),
      source: this.touch?.source ?? null,
      mailchimpCampaignId: this.touch?.mailchimpCampaignId ?? null,
      capturedAt: this.touch?.capturedAt ?? null,
      links: this.touch?.links ?? null
    };
    const saved = this.touch?.id
      ? await this.emailService.update(this.touch.id, payload)
      : await this.emailService.add(payload);
    this.touch = saved;
    this.touchId = saved.id ?? this.touchId;
    this.state.dirty = false;
    this.form.markAsPristine();
    return saved;
  }

  private validate(): boolean {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.scheduleOpen = true;
      this.snackbar.error('Give this email a subject before saving.');
      return false;
    }
    if (this.sendMode === 'scheduled' && !this.form.value.scheduledAt) {
      this.scheduleOpen = true;
      this.snackbar.error('Pick when this email should send.');
      return false;
    }
    if (this.sendMode === 'tagTriggered' && !(this.form.value.triggerTags ?? []).length) {
      this.scheduleOpen = true;
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
      const saved = await this.persist();
      this.snackbar.success('Email Saved');
      // Re-anchor the URL to the new id so refresh and re-edit work - same
      // move the System Templates designer makes after a first save.
      if (this.isNew && saved.id) {
        this.isNew = false;
        this.router.navigate(['/campaigns-manager/email', this.campaignId, saved.id], { replaceUrl: true });
      }
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
    if (!this.validate() || !this.campaign) {
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
        this.backToCampaign();
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
      this.backToCampaign();
    } catch (err) {
      this.snackbar.error('Send failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.sending = false;
    }
  }

  onPrimaryAction(): void {
    if (this.sendMode === 'scheduled') {
      this.saveDraft();
      return;
    }
    this.sendNow();
  }

  backToCampaign(): void {
    this.router.navigate(['/campaigns-manager'], {
      queryParams: { tab: 'campaigns', campaignId: this.campaignId }
    });
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
