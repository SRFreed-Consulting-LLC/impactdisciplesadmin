import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Timestamp } from 'firebase/firestore';
import { CampaignModel } from 'src/app/common/models/domain/campaign.model';
import { CampaignPopupModel, PopupTemplateModel } from 'src/app/common/models/domain/campaign-popup.model';
import { CampaignPopupService, PopupTemplateService } from 'src/app/common/services/data/campaign-popup.service';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { ProductModel } from 'src/app/common/models/utils/product.model';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { registerQuillStyleAttributors } from '../../shared/rich-text-editor/quill-style-attributors';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { environment } from 'src/environments/environment';

// Popup editor (Campaign Manager v2, Phase 5; WYSIWYG rework 2026-08-19):
// authors a campaign's web popup - shown to EVERY site visitor (no
// targeting, a user decision) during its date window. Content is edited
// in the same Quill rich-text editor the newsletter dialog uses - no HTML
// knowledge needed - with inline-style attributors registered so the
// output renders on the storefront without Quill's stylesheet. A
// SPOTLIGHT section pulls a product's/event's image + info into the
// content and defaults the click-through to that item's public page -
// pre-selected from the campaign's own goal, overridable here. The live
// preview is a plain styled DIV (not an iframe - the iframe variant had a
// first-selection blank-preview bug and popups need no frame isolation
// inside the admin).
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
  richTextModules = RICH_TEXT_TOOLBAR;

  // Spotlight pickers (defaulted from the campaign's goal).
  products: ProductModel[] = [];
  events: EventModel[] = [];
  spotlightType: 'product' | 'event' = 'product';
  spotlightId: string | null = null;

  previewHtml: SafeHtml | null = null;

  constructor(
    private popupService: CampaignPopupService,
    private templateService: PopupTemplateService,
    private campaignService: CampaignService,
    private productService: ProductService,
    private eventService: EventService,
    private snackbar: SnackbarService,
    private sanitizer: DomSanitizer,
    private fb: FormBuilder
  ) {
    // Same global inline-style registration the email designer uses -
    // Quill output must render via [innerHTML] on the storefront, where
    // ql-* classes would mean nothing.
    registerQuillStyleAttributors();

    this.form = this.fb.group({
      isActive: [false],
      title: ['', Validators.required],
      html: ['', Validators.required],
      templateId: [null],
      fromDate: [null, Validators.required],
      toDate: [null, Validators.required],
      width: [480],
      height: [420],
      bgColor: ['#ffffff'],
      ctaUrl: ['']
    });
    this.form.get('html')?.valueChanges.subscribe(() => this.refreshPreview());
    this.form.get('bgColor')?.valueChanges.subscribe(() => this.refreshPreview());
  }

  ngOnInit(): void {
    this.templateService.getAll().then((templates) => this.templates = templates);
    this.productService.getAllByValue('isActive', true).then((products) => this.products = products);
    this.eventService.getAllByValue('isActive', true).then((events) => this.events = events);

    // Spotlight defaults follow the campaign's own goal/selection.
    if (this.campaign.goal === 'event' && this.campaign.eventId) {
      this.spotlightType = 'event';
      this.spotlightId = this.campaign.eventId;
    } else if (this.campaign.goal === 'product' && this.campaign.productId) {
      this.spotlightType = 'product';
      this.spotlightId = this.campaign.productId;
    }

    if (this.popup) {
      this.form.patchValue({
        isActive: this.popup.isActive,
        title: this.popup.title,
        html: this.popup.html,
        fromDate: this.toInputDate(this.popup.fromDate),
        toDate: this.toInputDate(this.popup.toDate),
        width: this.popup.width ?? 480,
        height: this.popup.height ?? 420,
        bgColor: this.popup.bgColor ?? '#ffffff',
        // Strip the auto-appended attribution params for editing; they're
        // re-appended on save.
        ctaUrl: this.stripAttribution(this.popup.ctaUrl ?? '')
      });
      this.refreshPreview();
    }
  }

  get spotlightItems(): { id: string; label: string }[] {
    return this.spotlightType === 'product'
      ? this.products.map((p) => ({ id: p.id!, label: p.title }))
      : this.events.map((e) => ({ id: e.id!, label: e.eventName ?? '(unnamed event)' }));
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
    this.refreshPreview();
  }

  // Pulls the selected product's/event's image + info into the popup
  // content (editable afterward like any rich text) and defaults the
  // click-through to that item's page on the public site.
  applySpotlight(): void {
    if (!this.spotlightId) {
      this.snackbar.error('Pick a ' + this.spotlightType + ' to spotlight first.');
      return;
    }
    if (this.spotlightType === 'product') {
      const product = this.products.find((p) => p.id === this.spotlightId);
      if (!product) {
        return;
      }
      const price = product.salePrice > 0 ? product.salePrice : product.cost;
      this.form.patchValue({
        title: this.form.value.title || product.title,
        html: this.spotlightHtml(
          product.imageUrl?.url,
          product.title,
          price > 0 ? '$' + price.toFixed(2) : 'Free',
          product.description),
        ctaUrl: `${environment.publicSiteUrl}/product-details/${product.id}`
      });
    } else {
      const event = this.events.find((e) => e.id === this.spotlightId);
      if (!event) {
        return;
      }
      const date = dateFromTimestamp(event.startDate as never);
      this.form.patchValue({
        title: this.form.value.title || (event.eventName ?? ''),
        html: this.spotlightHtml(
          event.imageUrl?.url,
          event.eventName ?? '',
          date ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
          event.description),
        ctaUrl: `${environment.publicSiteUrl}/event-details/${event.id}`
      });
    }
    this.refreshPreview();
    this.snackbar.success('Spotlight applied - tweak the text and image like any rich text.');
  }

  // Inline-styled so it renders identically in Quill, the preview, and the
  // storefront's [innerHTML].
  private spotlightHtml(imageUrl: string | undefined, heading: string, subline: string, description?: string): string {
    const blurb = (description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const shortBlurb = blurb.length > 160 ? blurb.slice(0, 157).trimEnd() + '…' : blurb;
    return (imageUrl
        ? `<p style="text-align:center;"><img src="${imageUrl}" style="max-width:60%;" alt="${heading}"></p>`
        : '') +
      `<h2 style="text-align:center;">${heading}</h2>` +
      (subline ? `<p style="text-align:center;"><strong>${subline}</strong></p>` : '') +
      (shortBlurb ? `<p style="text-align:center;">${shortBlurb}</p>` : '');
  }

  private refreshPreview(): void {
    const html = this.form?.value?.html ?? '';
    this.previewHtml = html ? this.sanitizer.bypassSecurityTrustHtml(html) : null;
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
      if (!this.form.value.html) {
        this.snackbar.error('Give the popup some content first.');
      }
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
