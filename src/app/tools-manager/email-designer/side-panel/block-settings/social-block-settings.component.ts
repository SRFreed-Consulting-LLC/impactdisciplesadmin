import { Component, Input } from '@angular/core';
import {
  SocialBlock,
  SocialNetwork,
  BLOCK_BOUNDS,
  clampToBounds
} from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for a social block - extracted from
// DesignerSidePanelComponent 2026-08-21 (bucket A item #5). That panel is a
// switch over eleven block types; this is the first of those cases to get
// its own component, and the shape the rest should follow: one @Input()
// block, its own mutations, no outputs.
//
// It talks to DesignerStateService directly rather than emitting upward,
// because every mutation in this designer must go through commit() to be
// undoable - routing that through a parent would add a hop without adding
// a decision. Text inputs bind (change), not (ngModelChange), so one commit
// (one undo step) lands per edit rather than per keystroke.
@Component({
    selector: 'app-social-block-settings',
    templateUrl: './social-block-settings.component.html',
    styleUrls: ['./social-block-settings.component.scss'],
    standalone: false
})
export class SocialBlockSettingsComponent {
  @Input() block!: SocialBlock;

  constructor(private state: DesignerStateService) {}

  readonly networkPresets: { network: SocialNetwork; label: string; urlHint: string }[] = [
    { network: 'facebook', label: 'Facebook', urlHint: 'https://facebook.com/yourpage' },
    { network: 'instagram', label: 'Instagram', urlHint: 'https://instagram.com/yourprofile' },
    { network: 'x', label: 'X', urlHint: 'https://x.com/yourhandle' },
    { network: 'youtube', label: 'YouTube', urlHint: 'https://youtube.com/@yourchannel' },
    { network: 'linkedin', label: 'LinkedIn', urlHint: 'https://linkedin.com/company/yours' },
    { network: 'tiktok', label: 'TikTok', urlHint: 'https://tiktok.com/@yourhandle' },
    { network: 'custom', label: 'Custom link', urlHint: 'https://' }
  ];

  /** The template composes commit(setXxx(...)) - each setter returns a
   *  mutator closure that commit() runs inside one undo snapshot. */
  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  addNetwork(preset: { network: SocialNetwork; label: string }): void {
    this.state.commit(() => {
      this.block.props.networks.push({ network: preset.network, url: '', label: preset.label, iconUrl: null });
    });
  }

  removeNetwork(index: number): void {
    this.state.commit(() => {
      this.block.props.networks.splice(index, 1);
    });
  }

  moveNetwork(index: number, delta: -1 | 1): void {
    const to = index + delta;
    if (to < 0 || to >= this.block.props.networks.length) {
      return;
    }
    this.state.commit(() => {
      const [entry] = this.block.props.networks.splice(index, 1);
      this.block.props.networks.splice(to, 0, entry);
    });
  }

  setUrl(index: number, url: string): () => void {
    return () => {
      this.block.props.networks[index].url = url;
    };
  }

  setIconSize(value: string | number): () => void {
    return () => {
      // R4: shared with the compiler via BLOCK_BOUNDS - it used to apply
      // no bound at all to either of these.
      this.block.props.iconSize = clampToBounds(value, BLOCK_BOUNDS.socialIconSize);
    };
  }

  setSpacing(value: string | number): () => void {
    return () => {
      this.block.props.spacing = clampToBounds(value, BLOCK_BOUNDS.socialSpacing);
    };
  }
}
