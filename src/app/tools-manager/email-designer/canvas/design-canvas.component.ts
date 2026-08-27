import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import {
  EmailBlock,
  EmailRow,
  EmailSection,
  createSection,
  newDesignId,
  resolveMobileGlobalStyles,
  resolveMobileStyles
} from 'src/app/common/models/admin/email-design.model';
import { BlockDropEvent, BlockSeed, handleBlockDrop, handleRowDrop } from '../block-drop.util';
import { DesignerStateService } from '../designer-state.service';
import { EmailBrandDefaultsService } from 'src/app/common/services/email-brand-defaults.service';

// The center editing surface: the email "page" (600px desktop / 375px
// mobile) with its header/body/footer sections, each a cdkDropList of rows.
// Blocks inside rows/columns are rendered by <app-block-host>.
@Component({
    selector: 'app-design-canvas',
    templateUrl: './design-canvas.component.html',
    styleUrls: ['./design-canvas.component.scss'],
    standalone: false
})
export class DesignCanvasComponent implements OnInit {
  @Output() backgroundClick = new EventEmitter<void>();

  /** Organisation details for newly dropped Social/Footer blocks. Loaded
   *  once here rather than fetched per drop - WebConfigService caches the
   *  read for the session anyway, and a drop must not wait on a promise. */
  private blockSeed: BlockSeed = {};

  constructor(
    public state: DesignerStateService,
    private brandDefaults: EmailBrandDefaultsService
  ) {}

  ngOnInit(): void {
    void Promise.all([
      this.brandDefaults.socialLinks(),
      this.brandDefaults.addressHtml()
    ]).then(([socialLinks, addressHtml]) => {
      this.blockSeed = { socialLinks, addressHtml };
    });
  }

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
      // A Social block used to arrive with three networks and EMPTY urls, and
      // a Footer with no address at all - so emails went out with dead icons
      // and no postal address, which commercial mail is required to carry.
      // The seed is whatever config has loaded by now; nothing waits on it.
      handleBlockDrop(event, this.blockSeed);
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

  onRowDuplicate(section: EmailSection, row: EmailRow, event: Event): void {
    event.stopPropagation();
    const clone = this.cloneRow(row);
    this.state.commit(() => {
      section.rows.splice(section.rows.indexOf(row) + 1, 0, clone);
    });
    this.state.select('row', clone.id);
  }

  // ---- Section management (P1) ----

  // Inline-rename state: the section tag swaps to an input while set.
  renamingSectionId: string | null = null;
  renameDraft = '';

  sectionLabel(section: EmailSection): string {
    return (section.name?.trim() || section.kind).toUpperCase();
  }

  addSectionAfter(section: EmailSection | null, event: Event): void {
    event.stopPropagation();
    const fresh = createSection('body', 'Section');
    this.state.commit((design) => {
      const index = section ? design.sections.indexOf(section) + 1 : design.sections.length;
      design.sections.splice(index, 0, fresh);
    });
    this.state.select('section', fresh.id);
  }

  duplicateSection(section: EmailSection, event: Event): void {
    event.stopPropagation();
    const clone: EmailSection = {
      id: newDesignId(),
      kind: section.kind,
      name: (section.name?.trim() || section.kind) + ' copy',
      backgroundColor: section.backgroundColor,
      rows: section.rows.map((row) => this.cloneRow(row))
    };
    this.state.commit((design) => {
      design.sections.splice(design.sections.indexOf(section) + 1, 0, clone);
    });
    this.state.select('section', clone.id);
  }

  deleteSection(section: EmailSection, event: Event): void {
    event.stopPropagation();
    this.state.commit((design) => {
      if (design.sections.length <= 1) {
        return; // never delete the last section - undo covers mistakes
      }
      design.sections.splice(design.sections.indexOf(section), 1);
    });
    this.state.deselect();
  }

  moveSection(section: EmailSection, delta: -1 | 1, event: Event): void {
    event.stopPropagation();
    this.state.commit((design) => {
      const from = design.sections.indexOf(section);
      const to = from + delta;
      if (to < 0 || to >= design.sections.length) {
        return;
      }
      design.sections.splice(from, 1);
      design.sections.splice(to, 0, section);
    });
  }

  canDeleteSection(): boolean {
    return this.state.design.sections.length > 1;
  }

  startRename(section: EmailSection, event: Event): void {
    event.stopPropagation();
    this.renamingSectionId = section.id;
    this.renameDraft = section.name?.trim() || section.kind;
  }

  commitRename(section: EmailSection): void {
    const name = this.renameDraft.trim();
    this.renamingSectionId = null;
    if (!name || name === (section.name ?? section.kind)) {
      return;
    }
    this.state.commit(() => {
      section.name = name;
    });
  }

  // Deep clone with fresh ids throughout, so drop-list ids, @media classes,
  // and selections never collide with the original.
  private cloneRow(row: EmailRow): EmailRow {
    const clone = JSON.parse(JSON.stringify(row)) as EmailRow;
    clone.id = newDesignId();
    for (const column of clone.columns) {
      column.id = newDesignId();
      for (const block of column.blocks as EmailBlock[]) {
        block.id = newDesignId();
      }
    }
    return clone;
  }

  onBackgroundClick(): void {
    this.state.deselect();
    this.backgroundClick.emit();
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }
}
