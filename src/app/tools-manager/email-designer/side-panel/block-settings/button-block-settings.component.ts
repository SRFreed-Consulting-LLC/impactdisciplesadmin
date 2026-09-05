import { Component, Input } from '@angular/core';
import { ButtonBlock } from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for a button block - extracted from
// DesignerSidePanelComponent 2026-09-05 (review item 3). Same shape as the
// other block editors: one @Input() block, commits to the state service.
@Component({
    selector: 'app-button-block-settings',
    templateUrl: './button-block-settings.component.html',
    styleUrls: ['./button-block-settings.component.scss'],
    standalone: false
})
export class ButtonBlockSettingsComponent {
  @Input() block!: ButtonBlock;

  constructor(private state: DesignerStateService) {}

  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  setLabel(label: string): () => void {
    return () => {
      this.block.props.label = label;
    };
  }

  setHref(href: string): () => void {
    return () => {
      this.block.props.href = href;
    };
  }

  setFullWidth(fullWidth: boolean): () => void {
    return () => {
      this.block.props.fullWidth = fullWidth;
    };
  }

  /** null = inherit the corresponding globalStyles.button default. */
  setColor(key: 'backgroundColor' | 'color', value: string | null): () => void {
    return () => {
      this.block.props[key] = value;
    };
  }

  /** "Use defaults": both overrides back to inherit, as ONE undo step. */
  clearColors(): void {
    this.state.commit(() => {
      this.block.props.backgroundColor = null;
      this.block.props.color = null;
    });
  }
}
