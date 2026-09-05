import { Component, Input } from '@angular/core';
import { BLOCK_BOUNDS, SpacerBlock, clampToBounds } from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for a spacer block - extracted from
// DesignerSidePanelComponent 2026-09-05 (review item 3). One control, but
// the same shape as every other block editor so the panel has one rule.
@Component({
    selector: 'app-spacer-block-settings',
    templateUrl: './spacer-block-settings.component.html',
    styleUrls: ['./spacer-block-settings.component.scss'],
    standalone: false
})
export class SpacerBlockSettingsComponent {
  @Input() block!: SpacerBlock;

  constructor(private state: DesignerStateService) {}

  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  setHeight(height: string | number): () => void {
    return () => {
      // R4: bounds live in BLOCK_BOUNDS so the compiler holds a design to
      // exactly what this control allows. They used to disagree.
      this.block.props.height = clampToBounds(height, BLOCK_BOUNDS.spacerHeight);
    };
  }
}
