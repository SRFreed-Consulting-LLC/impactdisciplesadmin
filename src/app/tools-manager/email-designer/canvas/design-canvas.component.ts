import { Component, EventEmitter, Output } from '@angular/core';
import {
  EmailRow,
  EmailSection,
  resolveMobileGlobalStyles,
  resolveMobileStyles
} from 'src/app/common/models/admin/email-design.model';
import { BlockDropEvent, handleBlockDrop, handleRowDrop } from '../block-drop.util';
import { DesignerStateService } from '../designer-state.service';

// The center editing surface: the email "page" (600px desktop / 375px
// mobile) with its header/body/footer sections, each a cdkDropList of rows.
// Blocks inside rows/columns are rendered by <app-block-host>.
@Component({
    selector: 'app-design-canvas',
    templateUrl: './design-canvas.component.html',
    styleUrls: ['./design-canvas.component.scss'],
    standalone: false
})
export class DesignCanvasComponent {
  @Output() backgroundClick = new EventEmitter<void>();

  constructor(public state: DesignerStateService) {}

  get pageWidth(): number {
    return this.state.viewMode === 'mobile' ? 375 : this.state.design.contentWidth;
  }

  get globalStyles() {
    return this.state.viewMode === 'mobile'
      ? resolveMobileGlobalStyles(this.state.design)
      : this.state.design.globalStyles.desktop;
  }

  sectionBackground(section: EmailSection): string {
    return section.backgroundColor ?? this.globalStyles.bodyBackgroundColor;
  }

  rowStyles(row: EmailRow) {
    const styles = this.state.viewMode === 'mobile' ? resolveMobileStyles(row) : row.styles;
    return {
      padding: `${styles.padding.top}px ${styles.padding.right}px ${styles.padding.bottom}px ${styles.padding.left}px`,
      'background-color': styles.backgroundColor ?? 'transparent'
    };
  }

  onRowDrop(event: BlockDropEvent): void {
    this.state.commit(() => {
      handleRowDrop(event);
    });
  }

  onBlockDrop(event: BlockDropEvent): void {
    this.state.commit(() => {
      handleBlockDrop(event);
    });
  }

  onSectionClick(section: EmailSection, event: Event): void {
    event.stopPropagation();
    this.state.select('section', section.id);
  }

  onRowClick(row: EmailRow, event: Event): void {
    event.stopPropagation();
    this.state.select('row', row.id);
  }

  onRowDelete(section: EmailSection, row: EmailRow, event: Event): void {
    event.stopPropagation();
    this.state.commit(() => {
      section.rows.splice(section.rows.indexOf(row), 1);
    });
    this.state.deselect();
  }

  onBackgroundClick(): void {
    this.state.deselect();
    this.backgroundClick.emit();
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }
}
