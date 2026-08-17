import { Component } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  BlockType,
  ButtonBlock,
  EmailBlock,
  EmailSection,
  HeadingBlock,
  ImageBlock,
  ImageProps,
  LogoBlock,
  SpacerBlock
} from 'src/app/common/models/admin/email-design.model';
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
  imageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  imageCard: { image?: ImageModel } = {};
  private imageTarget: ImageProps | null = null;

  constructor(public state: DesignerStateService) {}

  get selectedBlock(): EmailBlock | null {
    const selection = this.state.selection$.value;
    if (selection?.kind !== 'block') {
      return null;
    }
    return this.state.findBlock(selection.id)?.block ?? null;
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
    this.imageTarget = null;
    if (!picked?.url || !target) {
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
