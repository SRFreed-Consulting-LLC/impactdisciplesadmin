import { Component, Input } from '@angular/core';
import { BLOCK_BOUNDS, BorderStyle, DividerBlock, clampToBounds } from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for a divider block - extracted from
// DesignerSidePanelComponent 2026-09-05 (review item 3). Every field is an
// OVERRIDE: null means "inherit globalStyles.divider", which is why the
// thickness clamp must let an explicit null through untouched.
@Component({
    selector: 'app-divider-block-settings',
    templateUrl: './divider-block-settings.component.html',
    styleUrls: ['./divider-block-settings.component.scss'],
    standalone: false
})
export class DividerBlockSettingsComponent {
  @Input() block!: DividerBlock;

  constructor(private state: DesignerStateService) {}

  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  setStyle(style: string | null): () => void {
    return () => {
      this.block.props.style = (style as BorderStyle) || null;
    };
  }

  setThickness(value: string | number | null): () => void {
    return () => {
      // null is meaningful here - it means "inherit globalStyles.divider"
      // - so it is preserved rather than clamped to the minimum.
      this.block.props.thickness = value === null || value === '' ?
        null :
        clampToBounds(value, BLOCK_BOUNDS.dividerThickness);
    };
  }

  setColor(color: string | null): () => void {
    return () => {
      this.block.props.color = color ?? null;
    };
  }
}
