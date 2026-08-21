import { Component, EventEmitter, Input, NgZone, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Timestamp } from 'firebase/firestore';
import DOMPurify from 'dompurify';
import html2canvas from 'html2canvas';
import { CampaignModel, CampaignSocial, SocialChannel } from 'src/app/common/models/domain/campaign.model';
import { CampaignPopupModel } from 'src/app/common/models/domain/campaign-popup.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { WebConfigService } from 'src/app/common/services/data/web-config.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { environment } from 'src/environments/environment';

// Human names for snackbars/buttons - distinct from the chip labels in
// campaign.model.ts (those are ALL-CAPS chips; these read as prose).
const CHANNEL_DISPLAY: Record<SocialChannel, string> = {
  facebook: 'Facebook',
  twitter: 'X (Twitter)',
  instagram: 'Instagram'
};

// X counts every URL as 23 characters (t.co wrapping), regardless of its
// real length.
const X_URL_LENGTH = 23;
const X_LIMIT = 280;

// Social composer (assisted-manual publishing, 2026-08-20): the campaign's
// POPUP is the artwork - it's rendered offscreen and snapshotted to a PNG
// via html2canvas, so the same creative runs on the site and on social.
// The admin downloads the image, copies a per-channel caption, posts by
// hand on the platform, then marks the channel posted here (which stamps
// campaign.social.posted and adds the channel chip). Data is API-ready for
// a future auto-publish phase, but tokens will never live client-side -
// see CampaignSocial's comment.
//
// The three previews deliberately use literal platform styling (white
// cards, platform greys) rather than --app-* tokens - they exist to show
// what the post will look like THERE, not here.
@Component({
    selector: 'app-social-composer',
    templateUrl: './social-composer.component.html',
    styleUrls: ['./social-composer.component.scss'],
    standalone: false
})
export class SocialComposerComponent implements OnInit, OnChanges {
  @Input() campaign!: CampaignModel;
  @Input() popup: CampaignPopupModel | null = null;
  /** true = the campaign doc changed (captions saved / channel posted). */
  @Output() closed = new EventEmitter<boolean>();

  form: FormGroup;
  saving = false;

  // The rendered popup PNG (data URL) all three previews share. Rendered
  // once on load and on the explicit REFRESH ARTWORK button - not on every
  // keystroke, html2canvas is too heavy for that.
  artworkUrl: string | null = null;
  rendering = false;

  // Public identity from Web Config (fallbacks keep the previews honest
  // before it's configured).
  facebookName = 'Your Page';
  twitterHandle = '@yourhandle';
  instagramHandle = '@yourhandle';

  channelDisplay = CHANNEL_DISPLAY;
  xLimit = X_LIMIT;

  /** Set by any successful save so the back button reports it. */
  private changed = false;

  constructor(
    private campaignService: CampaignService,
    private webConfigService: WebConfigService,
    private snackbar: SnackbarService,
    private zone: NgZone,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      caption: [''],
      hashtags: [''],
      facebookOverride: [''],
      twitterOverride: [''],
      instagramOverride: ['']
    });
  }

  ngOnInit(): void {
    const social = this.campaign.social;
    if (social) {
      this.form.patchValue({
        caption: social.caption ?? '',
        hashtags: social.hashtags ?? '',
        facebookOverride: social.overrides?.facebook ?? '',
        twitterOverride: social.overrides?.twitter ?? '',
        instagramOverride: social.overrides?.instagram ?? ''
      });
    }

    // Same singleton-doc read as the Web Config screen itself.
    this.webConfigService.getAll().then((configs) => {
      const config = configs?.[0];
      if (!config) {
        return;
      }
      this.facebookName = (config.socialFacebookPageName ?? '').trim() || this.facebookName;
      this.twitterHandle = this.normalizeHandle(config.socialTwitterHandle) ?? this.twitterHandle;
      this.instagramHandle = this.normalizeHandle(config.socialInstagramHandle) ?? this.instagramHandle;
    });

    this.renderArtwork();
  }

  // The host detail screen loads the popup asynchronously - opening the
  // composer quickly can race that load, so ngOnInit may run with popup
  // still null (live-caught in Playwright). Render as soon as the input
  // actually arrives instead of only at init.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['popup'] && this.popup?.html && !this.artworkUrl && !this.rendering) {
      this.renderArtwork();
    }
  }

  get hasArtworkSource(): boolean {
    return !!this.popup?.html;
  }

  private normalizeHandle(value: string | null | undefined): string | null {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.startsWith('@') ? trimmed : '@' + trimmed;
  }

  // ---- Captions ----

  // Caption + hashtags, per-channel override applied - everything EXCEPT
  // the link (X counts the link separately, so the two halves stay split).
  private captionBody(channel: SocialChannel): string {
    const value = this.form.value;
    const override = (value[channel + 'Override'] ?? '').trim();
    const caption = override || (value.caption ?? '').trim();
    const hashtags = (value.hashtags ?? '').trim();
    return [caption, hashtags].filter(Boolean).join('\n');
  }

  // The campaign link: the popup's click-through when it has one, else the
  // public site root - ALWAYS re-decorated with this channel's own
  // ?cid/&csrc so purchases that follow a social post credit the campaign
  // (same attribution vocabulary as popup/email links; csrc tells the
  // sources apart).
  campaignLink(channel: SocialChannel): string {
    const raw = this.popup?.cta?.linkUrl || this.popup?.ctaUrl || environment.publicSiteUrl;
    // Strip any existing attribution (popup CTAs are stored ?cid-decorated
    // with csrc=popup - see popup-editor's decorateCta) before appending
    // this channel's own.
    const base = raw.replace(/[?&]cid=[^&]*/g, '').replace(/[?&]csrc=[^&]*/g, '')
      .replace(/\?$/, '');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}cid=${encodeURIComponent(this.campaign.id!)}&csrc=${channel}`;
  }

  effectiveCaption(channel: SocialChannel): string {
    return [this.captionBody(channel), this.campaignLink(channel)].filter(Boolean).join('\n');
  }

  // X's real count: body characters + the newline before the link + the
  // link at its flat t.co length.
  get xCharCount(): number {
    const body = this.captionBody('twitter');
    return (body ? body.length + 1 : 0) + X_URL_LENGTH;
  }

  async copyCaption(channel: SocialChannel): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.effectiveCaption(channel));
      this.snackbar.success(CHANNEL_DISPLAY[channel] + ' caption copied');
    } catch {
      this.snackbar.error('Clipboard copy failed - select and copy the preview text instead.');
    }
  }

  // ---- Artwork ----

  async renderArtwork(): Promise<void> {
    if (!this.popup?.html || this.rendering) {
      return;
    }
    this.rendering = true;
    // Offscreen (not display:none - html2canvas needs real layout) clone of
    // the popup at its authored size, same framing as popup-editor's
    // preview box. Sanitized like the designer's inline HTML - the content
    // is admin-authored Quill output, but it costs nothing to be safe
    // before touching innerHTML.
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.width = (this.popup.width ?? 480) + 'px';
    host.style.minHeight = (this.popup.height ?? 420) + 'px';
    host.style.boxSizing = 'border-box';
    host.style.padding = '24px 28px';
    host.style.background = this.popup.bgColor ?? '#ffffff';
    host.style.color = '#22282f';
    host.style.fontFamily = 'Inter, Arial, sans-serif';
    host.innerHTML = DOMPurify.sanitize(this.popup.html);
    host.querySelectorAll('img').forEach((img) => img.style.maxWidth = '100%');
    document.body.appendChild(host);
    try {
      // Let any content images finish loading first - html2canvas snapshots
      // whatever is painted, and a half-loaded image renders as a gap.
      await Promise.all(Array.from(host.querySelectorAll('img')).map((img) =>
        img.complete ? Promise.resolve() : new Promise((resolve) => {
          img.onload = img.onerror = () => resolve(null);
        })
      ));
      const canvas = await html2canvas(host, {
        // 2x for retina-sharp platform uploads.
        scale: 2,
        backgroundColor: this.popup.bgColor ?? '#ffffff',
        // Firebase Storage serves CORS-friendly images; without this a
        // remote image would taint the canvas and toDataURL would throw.
        useCORS: true,
        logging: false
      });
      const url = canvas.toDataURL('image/png');
      // html2canvas resolves through its own cloned-iframe window, whose
      // timers zone.js never patched - so this continuation runs OUTSIDE
      // the Angular zone and a bare assignment never triggers change
      // detection (live-diagnosed: the PNG only appeared after the next
      // unrelated UI event flushed CD). Re-enter the zone to publish it.
      this.zone.run(() => this.artworkUrl = url);
    } catch (err) {
      this.zone.run(() => this.snackbar.error('Artwork render failed: ' + ((err as Error)?.message ?? err)));
    } finally {
      host.remove();
      this.zone.run(() => this.rendering = false);
    }
  }

  downloadImage(): void {
    if (!this.artworkUrl) {
      return;
    }
    const link = document.createElement('a');
    link.href = this.artworkUrl;
    link.download = this.fileSlug(this.campaign.name) + '-social.png';
    link.click();
  }

  private fileSlug(name: string): string {
    return (name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'campaign';
  }

  // ---- Saving ----

  postedAt(channel: SocialChannel): Date | null {
    return dateFromTimestamp(this.campaign.social?.posted?.[channel] as never) ?? null;
  }

  // Existing posted stamps with only the keys that are actually set -
  // never a key holding undefined (Firestore rejects the whole write,
  // CLAUDE.md gotcha).
  private currentPosted(): CampaignSocial['posted'] {
    const posted = this.campaign.social?.posted ?? {};
    return {
      ...(posted.facebook ? { facebook: posted.facebook } : {}),
      ...(posted.twitter ? { twitter: posted.twitter } : {}),
      ...(posted.instagram ? { instagram: posted.instagram } : {})
    };
  }

  private buildSocial(posted: CampaignSocial['posted']): CampaignSocial {
    const value = this.form.value;
    return {
      caption: value.caption ?? '',
      hashtags: value.hashtags ?? '',
      overrides: {
        // Empty override = "use the shared caption" - stored as null, not
        // '' (and never undefined).
        facebook: (value.facebookOverride ?? '').trim() || null,
        twitter: (value.twitterOverride ?? '').trim() || null,
        instagram: (value.instagramOverride ?? '').trim() || null
      },
      posted
    };
  }

  private async saveCampaign(social: CampaignSocial, channels: CampaignModel['channels']): Promise<void> {
    // One whole-campaign update, same as popup-editor's channel add - the
    // spread carries every other field through unchanged.
    await this.campaignService.update(this.campaign.id!, { ...this.campaign, social, channels });
    this.campaign.social = social;
    this.campaign.channels = channels;
    this.changed = true;
  }

  async saveCaptions(): Promise<void> {
    this.saving = true;
    try {
      await this.saveCampaign(this.buildSocial(this.currentPosted()), this.campaign.channels);
      this.snackbar.success('Social captions saved');
    } catch (err) {
      this.snackbar.error('Save failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.saving = false;
    }
  }

  async markPosted(channel: SocialChannel): Promise<void> {
    this.saving = true;
    try {
      const social = this.buildSocial({ ...this.currentPosted(), [channel]: Timestamp.now() });
      // The channel chip appears the moment the first post goes out - same
      // rule as the popup adding 'web'.
      const channels = (this.campaign.channels ?? []).includes(channel)
        ? this.campaign.channels
        : ([...(this.campaign.channels ?? []), channel] as CampaignModel['channels']);
      await this.saveCampaign(social, channels);
      this.snackbar.success('Marked posted on ' + CHANNEL_DISPLAY[channel]);
    } catch (err) {
      this.snackbar.error('Save failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.saving = false;
    }
  }

  back(): void {
    this.closed.emit(this.changed);
  }
}
