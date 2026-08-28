import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import {
  BlockType,
  ButtonBlock,
  DividerBlock,
  EMAIL_FONT_FAMILIES,
  EmailBlock,
  EmailRow,
  EmailSection,
  FooterBlock,
  HeadingBlock,
  HtmlBlock,
  ImageBlock,
  ImageProps,
  LogoBlock,
  SocialBlock,
  SpacerBlock,
  TextBlock,
  VideoBlock,
  createDefaultDesign,
  newDesignId,
  BLOCK_BOUNDS,
  clampToBounds
} from 'src/app/common/models/admin/email-design.model';
import DOMPurify from 'dompurify';
import { parseVideoUrl, vimeoOembedUrl } from '../video-url.util';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import {
  BLOCK_PALETTE_ID,
  CHROME_PALETTE_ID,
  LAYOUT_PALETTE_ID,
  LAYOUT_PRESETS,
  LayoutPreset
} from '../block-drop.util';
import { DesignerStateService } from '../designer-state.service';
import { CHROME_PIECES, ChromeFamily, ChromePiece } from 'src/app/common/utils/email/chrome-pieces';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';

interface PaletteEntry {
  type: BlockType;
  label: string;
  icon: string;
}

/** One chrome chip: the piece plus its preview, compiled ONCE. */
interface ChromeTile {
  piece: ChromePiece;
  srcdoc: SafeHtml;
}

/** A labelled run of chrome chips. */
interface ChromeGroup {
  label: string;
  hint: string;
  tiles: ChromeTile[];
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
  readonly chromePaletteId = CHROME_PALETTE_ID;
  readonly layoutPresets: LayoutPreset[] = LAYOUT_PRESETS;

  // Declared before chromeGroups: field initializers run top-down, and
  // buildChromeGroups needs the sanitizer.
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * Ready-made headers and footers, grouped so the two families read
   * differently at a glance - a receipt should not get newsletter chrome by
   * accident, but neither is blocked (see chrome-pieces.ts).
   */
  readonly chromeGroups: ChromeGroup[] = this.buildChromeGroups();

  /**
   * Drag data for the chrome palette: IDS, exactly as paletteTypes does for
   * blocks - handleRowDrop reads the id out of this array BY INDEX.
   *
   * Derived from chromeGroups rather than from CHROME_PIECES so it cannot
   * drift out of step with the chips actually rendered: one cdkDropList holds
   * every chip across both groups, so its index space is the flattened order.
   */
  readonly chromePieceIds: string[] =
    this.chromeGroups.flatMap((group) => group.tiles.map((tile) => tile.piece.id));

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
    { type: 'footer', label: 'Footer', icon: 'call_to_action' },
    { type: 'html', label: 'HTML', icon: 'code' }
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

  /**
   * Builds the chrome chips and their previews.
   *
   * Compiled ONCE and trusted ONCE, at construction - NOT from a getter. A
   * SafeHtml rebuilt per change-detection cycle makes the preview iframes
   * reload in a loop; that is a live-diagnosed bug the preview dialog and the
   * template picker both hit, and the picker's cards carry the same warning.
   * @return {ChromeGroup[]} The groups, in the order they are rendered.
   */
  private buildChromeGroups(): ChromeGroup[] {
    const groupsInOrder: { family: ChromeFamily; label: string; hint: string }[] = [
      {
        family: 'transactional',
        label: 'RECEIPTS & CONFIRMATIONS',
        hint: 'Plain chrome, matching the receipt and registration emails.'
      },
      {
        family: 'newsletter',
        label: 'NEWSLETTER',
        hint: 'Mastheads and footers from real campaigns. Heavy for a receipt.'
      }
    ];

    return groupsInOrder.map(({ family, label, hint }) => ({
      label,
      hint,
      tiles: CHROME_PIECES
        .filter((piece) => piece.family === family)
        .map((piece) => ({ piece, srcdoc: this.compileChromePreview(piece) }))
    }));
  }

  /** One piece, rendered in the section it belongs to, as a full email
   *  document an iframe can host. */
  private compileChromePreview(piece: ChromePiece): SafeHtml {
    const design = createDefaultDesign();
    design.sections[piece.kind === 'header' ? 0 : 2].rows = [piece.build()];
    return this.sanitizer.bypassSecurityTrustHtml(compileEmailDesign(design));
  }

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
      // R4: bounds live in BLOCK_BOUNDS so the compiler holds a design to
      // exactly what this control allows. They used to disagree.
      (block as SpacerBlock).props.height = clampToBounds(height, BLOCK_BOUNDS.spacerHeight);
    };
  }

  setImageSizing(block: EmailBlock, sizing: ImageProps['sizing']): () => void {
    return () => {
      (block as ImageBlock).props.sizing = sizing;
    };
  }

  setImageScale(block: EmailBlock, percent: string | number): () => void {
    return () => {
      (block as ImageBlock).props.scalePercent =
        clampToBounds(percent, BLOCK_BOUNDS.imageScalePercent);
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

  setHideOn(block: EmailBlock, key: 'hideOnMobile' | 'hideOnDesktop', value: boolean): () => void {
    return () => {
      block[key] = value;
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

  // ------------------------------------------------------------ footer

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
        // null is meaningful here - it means "inherit globalStyles.divider"
        // - so it is preserved rather than clamped to the minimum.
        divider.props.thickness = value === null ?
          null :
          clampToBounds(value, BLOCK_BOUNDS.dividerThickness);
      } else if (key === 'style') {
        divider.props.style = (value as DividerBlock['props']['style']) ?? null;
      } else {
        divider.props.color = (value as string) ?? null;
      }
    };
  }

  // ------------------------------------------------------------ fonts

  readonly fontFamilies = EMAIL_FONT_FAMILIES;

  fontLabel(family: string): string {
    return family.split(',')[0];
  }

  setBlockFont(block: EmailBlock, family: string): () => void {
    return () => {
      (block as TextBlock | HeadingBlock).props.fontFamily = family || null;
    };
  }

  blockFont(block: EmailBlock): string {
    return (block as TextBlock | HeadingBlock).props.fontFamily ?? '';
  }

  // ------------------------------------------------------------ html block

  // Sanitized here, at edit time (scripts/event handlers stripped, layout
  // markup kept) - the compiler then passes the stored markup through
  // untouched.
  setHtmlContent(block: EmailBlock, html: string): () => void {
    return () => {
      (block as HtmlBlock).props.html = DOMPurify.sanitize(html ?? '');
    };
  }

  // ------------------------------------------------------------ row columns

  // Change a placed row's column count/ratio (P1 gap-closure). Reducing the
  // count moves the orphaned columns' blocks into the last surviving
  // column; increasing appends empty columns.
  setRowColumns(row: EmailRow, widths: number[]): void {
    this.state.commit(() => {
      const keep = row.columns.slice(0, widths.length);
      const dropped = row.columns.slice(widths.length);
      const lastKept = keep[keep.length - 1];
      for (const column of dropped) {
        lastKept.blocks.push(...column.blocks);
      }
      while (keep.length < widths.length) {
        keep.push({ id: newDesignId(), widthPercent: 0, blocks: [] });
      }
      keep.forEach((column, index) => (column.widthPercent = widths[index]));
      row.columns = keep;
    });
  }

  readonly columnRatioPresets: Record<number, { label: string; widths: number[] }[]> = {
    1: [{ label: 'Full', widths: [100] }],
    2: [
      { label: '50 / 50', widths: [50, 50] },
      { label: '33 / 67', widths: [33.34, 66.66] },
      { label: '67 / 33', widths: [66.66, 33.34] },
      { label: '25 / 75', widths: [25, 75] },
      { label: '75 / 25', widths: [75, 25] }
    ],
    3: [
      { label: 'Equal', widths: [33.33, 33.34, 33.33] },
      { label: '25 / 50 / 25', widths: [25, 50, 25] }
    ],
    4: [{ label: 'Equal', widths: [25, 25, 25, 25] }]
  };

  ratioPresetsFor(count: number): { label: string; widths: number[] }[] {
    return this.columnRatioPresets[count] ?? [];
  }

  currentRatioLabel(row: EmailRow): string {
    const presets = this.ratioPresetsFor(row.columns.length);
    const current = row.columns.map((column) => Math.round(column.widthPercent));
    const match = presets.find((preset) =>
      preset.widths.every((width, index) => Math.abs(Math.round(width) - (current[index] ?? -1)) <= 1)
    );
    return match?.label ?? 'Custom';
  }

  changeColumnCount(row: EmailRow, count: number): void {
    const preset = this.ratioPresetsFor(count)[0];
    if (preset && row.columns.length !== count) {
      this.setRowColumns(row, preset.widths);
    }
  }

  changeRatio(row: EmailRow, label: string): void {
    const preset = this.ratioPresetsFor(row.columns.length).find((candidate) => candidate.label === label);
    if (preset) {
      this.setRowColumns(row, preset.widths);
    }
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
