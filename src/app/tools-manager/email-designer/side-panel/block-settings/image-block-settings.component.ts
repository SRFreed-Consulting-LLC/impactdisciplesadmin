import { Component, Input } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BLOCK_BOUNDS, ImageBlock, ImageProps, LogoBlock, clampToBounds } from 'src/app/common/models/admin/email-design.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for an image OR a logo block (a logo is an image block the
// palette treats as the brand mark - same props) - extracted from
// DesignerSidePanelComponent 2026-09-05 (review item 3). Same shape as the
// other block editors: one @Input() block, commits to the state service.
//
// It owns its OWN image picker. The panel used to run one picker for two
// callers (image blocks and a video's custom thumbnail) and juggle two
// target fields, clearing both after every close so a later pick could not
// leak onto the wrong block. With the picker inside the block that needs
// it, there is one target and nothing to leak.
@Component({
    selector: 'app-image-block-settings',
    templateUrl: './image-block-settings.component.html',
    styleUrls: ['./image-block-settings.component.scss'],
    standalone: false
})
export class ImageBlockSettingsComponent {
  @Input() block!: ImageBlock | LogoBlock;

  // app-image-uploader contract: it writes an ImageModel into card[field].
  readonly pickerVisible$ = new BehaviorSubject<boolean>(false);
  pickerCard: { image?: ImageModel } = {};

  constructor(private state: DesignerStateService) {}

  get props(): ImageProps {
    return this.block.props;
  }

  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  setSizing(sizing: ImageProps['sizing']): () => void {
    return () => {
      this.props.sizing = sizing;
    };
  }

  setScale(percent: string | number): () => void {
    return () => {
      // R4: bounds live in BLOCK_BOUNDS so the compiler holds a design to
      // exactly what this control allows.
      this.props.scalePercent = clampToBounds(percent, BLOCK_BOUNDS.imageScalePercent);
    };
  }

  /** A blank link is stored as null, never as ''. */
  setHref(href: string): () => void {
    return () => {
      this.props.href = href.trim() ? href.trim() : null;
    };
  }

  setNewTab(openInNewTab: boolean): () => void {
    return () => {
      this.props.openInNewTab = openInNewTab;
    };
  }

  setAlt(alt: string): () => void {
    return () => {
      this.props.alt = alt;
    };
  }

  openPicker(): void {
    this.pickerCard = {};
    this.pickerVisible$.next(true);
  }

  onPickerClosed(): void {
    this.pickerVisible$.next(false);
    const picked = this.pickerCard.image;
    if (!picked?.url) {
      return;
    }
    this.state.commit(() => {
      this.props.src = picked.url;
      // Cleared so the compiler re-measures rather than reusing the old size.
      this.props.naturalWidth = null;
      if (!this.props.alt) {
        this.props.alt = picked.name ?? '';
      }
    });
  }
}
