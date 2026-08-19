import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Timestamp } from 'firebase/firestore';
import { CampaignModel } from 'src/app/common/models/domain/campaign.model';
import { CampaignPopupModel, PopupTemplateModel } from 'src/app/common/models/domain/campaign-popup.model';
import { CampaignPopupService, PopupTemplateService } from 'src/app/common/services/data/campaign-popup.service';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';

// Popup editor (Campaign Manager v2, Phase 5): authors a campaign's web
// popup - shown to EVERY site visitor (no targeting, a user decision)
// during its date window, with a don't-show-again checkbox rendered by
// the storefront. One popup per campaign (doc id == campaignId). Content
// starts from a popup_templates recipe or raw HTML; "save as template?"
// grows the recipe library. Saving with the popup active also adds 'web'
// to the campaign's channels so the funnel shows the popup tiles.
@Component({
    selector: 'app-popup-editor',
    templateUrl: './popup-editor.component.html',
    styleUrls: ['./popup-editor.component.scss'],
    standalone: false
})
export class PopupEditorComponent implements OnInit {
  @Input() campaign!: CampaignModel;
  @Input() popup: CampaignPopupModel | null = null;
  @Output() closed = new EventEmitter<boolean>();

  form: FormGroup;
  saving = false;
  saveAsTemplate = false;
  templates: PopupTemplateModel[] = [];

  previewSrcdoc: SafeHtml | null = null;

  constructor(
    private popupService: CampaignPopupService,
    private templateService: PopupTemplateService,
    private campaignService: CampaignService,
    private snackbar: SnackbarService,
    private sanitizer: DomSanitizer,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      isActive: [false],
      title: ['', Validators.required],
      html: ['', Validators.required],
      templateId: [null],
      fromDate: [null, Validators.required],
      toDate: [null, Validators.required],
      width: [480],
      height: [360],
      bgColor: ['#ffffff'],
      ctaUrl: ['']
    });
    this.form.get('html')?.valueChanges.subscribe(() => this.refreshPreview());
    this.form.get('bgColor')?.valueChanges.subscribe(() => this.refreshPreview());
  }

  ngOnInit(): void {
    this.templateService.getAll().then((templates) => this.templates = templates);

    if (this.popup) {
      this.form.patchValue({
        isActive: this.popup.isActive,
        title: this.popup.title,
        html: this.popup.html,
        fromDate: this.toInputDate(this.popup.fromDate),
        toDate: this.toInputDate(this.popup.toDate),
        width: this.popup.width ?? 480,
        height: this.popup.height ?? 360,
        bgColor: this.popup.bgColor ?? '#ffffff',
        // Strip the auto-appended attribution params for editing; they're
        // re-appended on save.
        ctaUrl: this.stripAttribution(this.popup.ctaUrl ?? '')
      });
      this.refreshPreview();
    }
  }

  onTemplatePicked(templateId: string): void {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) {
      return;
    }
    this.form.patchValue({
      title: this.form.value.title || template.title,
      html: template.html,
      width: template.width ?? this.form.value.width,
      height: template.height ?? this.form.value.height,
      bgColor: template.bgColor ?? this.form.value.bgColor
    });
  }

  private refreshPreview(): void {
    const html = this.form?.value?.html ?? '';
    const bg = this.form?.value?.bgColor ?? '#ffffff';
    this.previewSrcdoc = html
      ? this.sanitizer.bypassSecurityTrustHtml(
          `<div style="background:${bg};height:100%;box-sizing:border-box;padding:8px;">${html}</div>`)
      : null;
  }

  private stripAttribution(url: string): string {
    return url.replace(/[?&]cid=[^&]*/g, '').replace(/[?&]csrc=[^&]*/g, '')
      .replace(/\?$/, '');
  }

  private decorateCta(url: string): string | null {
    const trimmed = (url ?? '').trim();
    if (!trimmed) {
      return null;
    }
    const sep = trimmed.includes('?') ? '&' : '?';
    return `${trimmed}${sep}cid=${encodeURIComponent(this.campaign.id!)}&csrc=popup`;
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.value;
    this.saving = true;
    try {
      const payload: CampaignPopupModel = {
        ...(this.popup ?? new CampaignPopupModel()),
        campaignId: this.campaign.id!,
        isActive: value.isActive === true,
        title: value.title,
        html: value.html,
        fromDate: Timestamp.fromDate(new Date(value.fromDate)),
        toDate: Timestamp.fromDate(new Date(value.toDate)),
        width: value.width ?? null,
        height: value.height ?? null,
        bgColor: value.bgColor ?? null,
        ctaUrl: this.decorateCta(value.ctaUrl),
        recipeName: this.popup?.recipeName ?? null
      };
      // Doc id == campaignId - update() with a fixed id is an upsert
      // (BaseService.update uses setDoc).
      await this.popupService.update(this.campaign.id!, payload);

      // The campaign gains the web channel the moment it has a popup.
      if (!(this.campaign.channels ?? []).includes('web')) {
        const channels = [...(this.campaign.channels ?? []), 'web'] as CampaignModel['channels'];
        await this.campaignService.update(this.campaign.id!, { ...this.campaign, channels });
        this.campaign.channels = channels;
      }

      if (this.saveAsTemplate) {
        await this.templateService.add({
          ...new PopupTemplateModel(),
          name: value.title,
          title: value.title,
          html: value.html,
          width: value.width ?? null,
          height: value.height ?? null,
          bgColor: value.bgColor ?? null
        });
      }

      this.snackbar.success('Popup Saved');
      this.closed.emit(true);
    } catch (err) {
      this.snackbar.error('Save failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.saving = false;
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
