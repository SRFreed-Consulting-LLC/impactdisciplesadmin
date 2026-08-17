import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import {
  BlockType,
  ButtonBlock,
  DividerBlock,
  EmailBlock,
  EmailRow,
  EmailSection,
  FooterBlock,
  HeadingBlock,
  ImageBlock,
  ImageProps,
  LogoBlock,
  SocialBlock,
  SocialNetwork,
  SpacerBlock,
  VideoBlock
} from 'src/app/common/models/admin/email-design.model';
import { parseVideoUrl, vimeoOembedUrl } from '../video-url.util';
import { ImageModel } from 'src/app/common/models/utils/image.model';
import { BLOCK_PALETTE_ID, LAYOUT_PALETTE_ID, LAYOUT_PRESETS, LayoutPreset } from '../block-drop.util';
import { DesignerStateService } from '../designer-state.service';

interface PaletteEntry {
  type: BlockType;
  label: string;
  icon: string;
}

// The right-hand panel: Add (block + layout palettes) and Styles tabs, or
// the contextual Settings panel whenever something on the canvas is
// selected - the Mailchimp panel model.
@Component({
    selector: 'app-designer-side-panel',
    templateUrl: './designer-side-panel.component.html',
    styleUrls: ['./designer-side-panel.component.scss'],
    standalone: false
})
export class DesignerSidePanelComponent {
  activeTab: 'add' | 'styles' = 'add';

  readonly blockPaletteId = BLOCK_PALETTE_ID;
  readonly layoutPaletteId = LAYOUT_PALETTE_ID;
  readonly layoutPresets: LayoutPreset[] = LAYOUT_PRESETS;

  readonly palette: PaletteEntry[] = [
    { type: 'heading', label: 'Heading', icon: 'title' },
    { type: 'text', label: 'Text', icon: 'notes' },
    { type: 'image', label: 'Image', icon: 'image' },
    { type: 'logo', label: 'Logo', icon: 'stars' },
    { type: 'button', label: 'Button', icon: 'smart_button' },
    { type: 'divider', label: 'Divider', icon: 'horizontal_rule' },
    { type: 'spacer', label: 'Spacer', icon: 'height' },
    { type: 'video', label: 'Video', icon: 'play_circle' },
    { type: 'social', label: 'Social', icon: 'share' },
    { type: 'footer', label: 'Footer', icon: 'call_to_action' }
  ];

  // Palette drag data: handleBlockDrop reads the dragged TYPE out of this
  // array by index, so it must stay aligned with the rendered chip order.
  get paletteTypes(): BlockType[] {
    return this.palette.map((entry) => entry.type);
  }

  // app-image-uploader contract: it writes an ImageModel into card[field].
  // The picker serves two callers - image/logo blocks (imageTarget) and a
  // video block's custom thumbnail (videoThumbnailTarget).
  imageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  imageCard: { image?: ImageModel } = {};
  private imageTarget: ImageProps | null = null;
  private videoThumbnailTarget: VideoBlock | null = null;

  constructor(public state: DesignerStateService, private http: HttpClient) {}

  get selectedBlock(): EmailBlock | null {
    const selection = this.state.selection$.value;
    if (selection?.kind !== 'block') {
      return null;
    }
    return this.state.findBlock(selection.id)?.block ?? null;
  }

  get selectedRow(): EmailRow | null {
    const selection = this.state.selection$.value;
    if (selection?.kind !== 'row') {
      return null;
    }
    return this.state.findRow(selection.id)?.row ?? null;
  }

  get selectedSection(): EmailSection | null {
    const selection = this.state.selection$.value;
    if (selection?.kind !== 'section') {
      return null;
    }
    return this.state.findSection(selection.id);
  }

  get selectionTitle(): string {
    const block = this.selectedBlock;
    if (block) {
      const entry = this.palette.find((candidate) => candidate.type === block.type);
      return entry?.label ?? 'Block';
    }
    const selection = this.state.selection$.value;
    if (selection?.kind === 'row') {
      return 'Row';
    }
    if (selection?.kind === 'section') {
      return (this.selectedSection?.kind ?? 'Section') + ' section';
    }
    return '';
  }

  closeSettings(): void {
    this.state.deselect();
  }

  // ------------------------------------------------------------ mutations

  // The template composes commitBlockChange(setXxx(...)) - each setter
  // returns a mutator closure, and commitBlockChange runs it through the
  // state service's undo-snapshotting commit(). Text inputs bind (change),
  // not (ngModelChange), so a commit (one undo step) lands per edit, not
  // per keystroke.
  commitBlockChange(mutate: () => void): void {
    this.state.commit(mutate);
  }

  setHeadingLevel(block: EmailBlock, level: 1 | 2 | 3 | 4): () => void {
    return () => {
      (block as HeadingBlock).props.level = level;
    };
  }

  setButtonLabel(block: EmailBlock, label: string): () => void {
    return () => {
      (block as ButtonBlock).props.label = label;
    };
  }

  setButtonHref(block: EmailBlock, href: string): () => void {
    return () => {
      (block as ButtonBlock).props.href = href;
    };
  }

  setButtonFullWidth(block: EmailBlock, fullWidth: boolean): () => void {
    return () => {
      (block as ButtonBlock).props.fullWidth = fullWidth;
    };
  }

  setSpacerHeight(block: EmailBlock, height: string | number): () => void {
    return () => {
      (block as SpacerBlock).props.height = Math.min(200, Math.max(4, Number(height) || 24));
    };
  }

  setImageSizing(block: EmailBlock, sizing: ImageProps['sizing']): () => void {
    return () => {
      (block as ImageBlock).props.sizing = sizing;
    };
  }

  setImageScale(block: EmailBlock, percent: string | number): () => void {
    return () => {
      (block as ImageBlock).props.scalePercent = Math.min(100, Math.max(10, Number(percent) || 100));
    };
  }

  setImageHref(block: EmailBlock, href: string): () => void {
    return () => {
      (block as ImageBlock).props.href = href.trim() ? href.trim() : null;
    };
  }

  setImageNewTab(block: EmailBlock, openInNewTab: boolean): () => void {
    return () => {
      (block as ImageBlock).props.openInNewTab = openInNewTab;
    };
  }

  setImageAlt(block: EmailBlock, alt: string): () => void {
    return () => {
      (block as ImageBlock).props.alt = alt;
    };
  }

  setSectionBackground(section: EmailSection, color: string | null): () => void {
    return () => {
      section.backgroundColor = color;
    };
  }

  // ------------------------------------------------------------ video

  // URL entry drives everything: parse provider/id, auto-thumbnail for
  // YouTube, async oEmbed thumbnail for Vimeo, manual for anything else
  // (matching Mailchimp's video block behavior).
  onVideoUrlChange(block: EmailBlock, url: string): void {
    const video = block as VideoBlock;
    const parsed = parseVideoUrl(url);
    this.state.commit(() => {
      video.props.url = url.trim();
      video.props.provider = parsed.provider;
      video.props.videoId = parsed.videoId;
      if (!video.props.customThumbnail) {
        video.props.thumbnailUrl = parsed.thumbnailUrl;
      }
    });
    if (parsed.provider === 'vimeo' && !video.props.customThumbnail) {
      this.http.get<{ thumbnail_url?: string }>(vimeoOembedUrl(url)).subscribe({
        next: (response) => {
          if (response?.thumbnail_url) {
            this.state.commit(() => {
              video.props.thumbnailUrl = response.thumbnail_url!;
            });
          }
        },
        // Private/unlisted videos or a network hiccup: leave the thumbnail
        // empty, the author can set one manually.
        error: () => undefined
      });
    }
  }

  setVideoCaption(block: EmailBlock, caption: string): () => void {
    return () => {
      (block as VideoBlock).props.caption = caption;
    };
  }

  openVideoThumbnailPicker(block: EmailBlock): void {
    const video = block as VideoBlock;
    this.videoThumbnailTarget = video;
    this.imageCard = {};
    this.imageUploaderVisible$.next(true);
  }

  useSourceThumbnail(block: EmailBlock): void {
    const video = block as VideoBlock;
    const parsed = parseVideoUrl(video.props.url);
    this.state.commit(() => {
      video.props.customThumbnail = false;
      video.props.thumbnailUrl = parsed.thumbnailUrl;
    });
    if (parsed.provider === 'vimeo') {
      this.onVideoUrlChange(block, video.props.url);
    }
  }

  // ------------------------------------------------------------ social

  readonly networkPresets: { network: SocialNetwork; label: string; urlHint: string }[] = [
    { network: 'facebook', label: 'Facebook', urlHint: 'https://facebook.com/yourpage' },
    { network: 'instagram', label: 'Instagram', urlHint: 'https://instagram.com/yourprofile' },
    { network: 'x', label: 'X', urlHint: 'https://x.com/yourhandle' },
    { network: 'youtube', label: 'YouTube', urlHint: 'https://youtube.com/@yourchannel' },
    { network: 'linkedin', label: 'LinkedIn', urlHint: 'https://linkedin.com/company/yours' },
    { network: 'tiktok', label: 'TikTok', urlHint: 'https://tiktok.com/@yourhandle' },
    { network: 'custom', label: 'Custom link', urlHint: 'https://' }
  ];

  addSocialNetwork(block: EmailBlock, preset: { network: SocialNetwork; label: string }): void {
    const social = block as SocialBlock;
    this.state.commit(() => {
      social.props.networks.push({ network: preset.network, url: '', label: preset.label, iconUrl: null });
    });
  }

  removeSocialNetwork(block: EmailBlock, index: number): void {
    const social = block as SocialBlock;
    this.state.commit(() => {
      social.props.networks.splice(index, 1);
    });
  }

  moveSocialNetwork(block: EmailBlock, index: number, delta: -1 | 1): void {
    const social = block as SocialBlock;
    const to = index + delta;
    if (to < 0 || to >= social.props.networks.length) {
      return;
    }
    this.state.commit(() => {
      const [entry] = social.props.networks.splice(index, 1);
      social.props.networks.splice(to, 0, entry);
    });
  }

  setSocialUrl(block: EmailBlock, index: number, url: string): () => void {
    return () => {
      (block as SocialBlock).props.networks[index].url = url;
    };
  }

  setSocialLabel(block: EmailBlock, index: number, label: string): () => void {
    return () => {
      (block as SocialBlock).props.networks[index].label = label;
    };
  }

  setSocialIconSize(block: EmailBlock, value: string | number): () => void {
    return () => {
      (block as SocialBlock).props.iconSize = Math.min(64, Math.max(16, Number(value) || 32));
    };
  }

  setSocialSpacing(block: EmailBlock, value: string | number): () => void {
    return () => {
      (block as SocialBlock).props.spacing = Math.min(40, Math.max(0, Number(value) || 14));
    };
  }

  // ------------------------------------------------------------ footer

  setFooterAddress(block: EmailBlock, text: string): () => void {
    return () => {
      // Stored as a simple div so the compiler treats it like any other
      // authored fragment; plain text in, escaped-ish out (no markup entry).
      const footer = block as FooterBlock;
      footer.props.addressHtml = text.trim() ? '<div>' + this.escapeText(text.trim()).replace(/\n/g, '<br>') + '</div>' : '';
    };
  }

  footerAddressText(block: EmailBlock): string {
    const html = (block as FooterBlock).props.addressHtml ?? '';
    return html
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  setFooterReminder(block: EmailBlock, text: string): () => void {
    return () => {
      (block as FooterBlock).props.permissionReminder = text;
    };
  }

  setFooterUnsubscribe(block: EmailBlock, include: boolean): () => void {
    return () => {
      (block as FooterBlock).props.includeUnsubscribe = include;
    };
  }

  setFooterUnsubscribeLabel(block: EmailBlock, label: string): () => void {
    return () => {
      (block as FooterBlock).props.unsubscribeLabel = label.trim() || 'Unsubscribe';
    };
  }

  // ------------------------------------------------------------ button / divider overrides

  setButtonOverrideColor(block: EmailBlock, key: 'backgroundColor' | 'color', value: string | null): () => void {
    return () => {
      (block as ButtonBlock).props[key] = value;
    };
  }

  setDividerOverride(block: EmailBlock, key: 'style' | 'thickness' | 'color', value: string | number | null): () => void {
    return () => {
      const divider = block as DividerBlock;
      if (key === 'thickness') {
        divider.props.thickness = value === null ? null : Math.min(12, Math.max(1, Number(value) || 1));
      } else if (key === 'style') {
        divider.props.style = (value as DividerBlock['props']['style']) ?? null;
      } else {
        divider.props.color = (value as string) ?? null;
      }
    };
  }

  private escapeText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  asHeading(block: EmailBlock): HeadingBlock {
    return block as HeadingBlock;
  }

  asImage(block: EmailBlock): ImageBlock | LogoBlock {
    return block as ImageBlock;
  }

  asButton(block: EmailBlock): ButtonBlock {
    return block as ButtonBlock;
  }

  asSpacer(block: EmailBlock): SpacerBlock {
    return block as SpacerBlock;
  }

  asVideo(block: EmailBlock): VideoBlock {
    return block as VideoBlock;
  }

  asSocial(block: EmailBlock): SocialBlock {
    return block as SocialBlock;
  }

  asFooter(block: EmailBlock): FooterBlock {
    return block as FooterBlock;
  }

  asDivider(block: EmailBlock): DividerBlock {
    return block as DividerBlock;
  }

  // ------------------------------------------------------------ images

  openImagePicker(target: ImageProps): void {
    this.imageTarget = target;
    this.imageCard = {};
    this.imageUploaderVisible$.next(true);
  }

  onImagePickerClosed(): void {
    this.imageUploaderVisible$.next(false);
    const picked = this.imageCard.image;
    const target = this.imageTarget;
    const videoTarget = this.videoThumbnailTarget;
    this.imageTarget = null;
    this.videoThumbnailTarget = null;
    if (!picked?.url) {
      return;
    }
    if (videoTarget) {
      this.state.commit(() => {
        videoTarget.props.thumbnailUrl = picked.url;
        videoTarget.props.customThumbnail = true;
      });
      return;
    }
    if (!target) {
      return;
    }
    this.state.commit(() => {
      target.src = picked.url;
      target.naturalWidth = null;
      if (!target.alt) {
        target.alt = picked.name ?? '';
      }
    });
  }
}
