import { Component, Input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  BlockStyles,
  DEFAULT_SOCIAL_ICON_URLS,
  EmailBlock,
  EmailColumn,
  GlobalStyleSet,
  SocialNetworkLink,
  newDesignId,
  resolveMobileGlobalStyles,
  resolveMobileStyles
} from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../designer-state.service';

// Renders one block on the canvas: selection/hover chrome (toolbar with
// duplicate/delete; the whole element is the drag handle) plus a per-type
// static view. Text/heading blocks swap to the single live inline Quill
// editor (<app-inline-text-editor>) while being edited.
@Component({
    selector: 'app-block-host',
    templateUrl: './block-host.component.html',
    styleUrls: ['./block-host.component.scss'],
    standalone: false
})
export class BlockHostComponent {
  @Input({ required: true }) block!: EmailBlock;
  @Input({ required: true }) column!: EmailColumn;

  constructor(public state: DesignerStateService, private sanitizer: DomSanitizer) {}

  get selected(): boolean {
    return this.state.isSelected('block', this.block.id);
  }

  get editing(): boolean {
    return this.state.editingBlockId === this.block.id;
  }

  get global(): GlobalStyleSet {
    return this.state.viewMode === 'mobile'
      ? resolveMobileGlobalStyles(this.state.design)
      : this.state.design.globalStyles.desktop;
  }

  get styles(): BlockStyles {
    return this.state.viewMode === 'mobile' ? resolveMobileStyles(this.block) : this.block.styles;
  }

  get wrapperStyle(): Record<string, string> {
    const s = this.styles;
    const m = s.margin;
    const style: Record<string, string> = {
      padding: `${s.padding.top}px ${s.padding.right}px ${s.padding.bottom}px ${s.padding.left}px`,
      ...(m && (m.top || m.right || m.bottom || m.left)
        ? { margin: `${m.top}px ${m.right}px ${m.bottom}px ${m.left}px` }
        : {}),
      'text-align': s.align
    };
    if (s.backgroundColor) {
      style['background-color'] = s.backgroundColor;
    }
    if (s.border && s.border.width > 0) {
      style['border'] = `${s.border.width}px ${s.border.style} ${s.border.color}`;
    }
    const r = s.borderRadius;
    if (r.topLeft || r.topRight || r.bottomRight || r.bottomLeft) {
      style['border-radius'] = `${r.topLeft}px ${r.topRight}px ${r.bottomRight}px ${r.bottomLeft}px`;
    }
    return style;
  }

  // Block html fragments are authored in our own inline editor and
  // normalized through dompurify before they're stored, so re-trusting them
  // here (to keep the inline color/style spans Angular's sanitizer would
  // strip) does not open XSS surface to outside content.
  trustHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  onClick(event: Event): void {
    event.stopPropagation();
    if (this.editing) {
      return;
    }
    const wasSelected = this.selected;
    this.state.select('block', this.block.id);
    // Mailchimp behavior: first click selects, clicking a selected
    // text/heading starts editing in place.
    if (wasSelected && (this.block.type === 'text' || this.block.type === 'heading')) {
      this.state.editingBlockId = this.block.id;
    }
  }

  // Mailchimp's slashed-eye: grayed on the canvas, excluded from sends.
  onToggleHidden(event: Event): void {
    event.stopPropagation();
    const block = this.block;
    this.state.commit(() => {
      block.hidden = !block.hidden;
    });
  }

  // Whether this block is invisible in the CURRENT canvas view mode
  // (per-device hide preview) - distinct from `hidden` which kills it
  // everywhere.
  get hiddenInViewMode(): boolean {
    return this.state.viewMode === 'mobile' ? !!this.block.hideOnMobile : !!this.block.hideOnDesktop;
  }

  onDuplicate(event: Event): void {
    event.stopPropagation();
    const clone = JSON.parse(JSON.stringify(this.block)) as EmailBlock;
    clone.id = newDesignId();
    const index = this.column.blocks.indexOf(this.block);
    this.state.commit(() => {
      this.column.blocks.splice(index + 1, 0, clone);
    });
    this.state.select('block', clone.id);
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    // No confirm - undo covers it (Mailchimp behavior).
    this.state.commit(() => {
      this.column.blocks.splice(this.column.blocks.indexOf(this.block), 1);
    });
    this.state.deselect();
  }

  // The icon the canvas shows for a social network: explicit per-network
  // icon, else the shared hosted default set (same resolution the compiler
  // uses), else a letter circle.
  socialIconUrl(network: SocialNetworkLink): string {
    return network.iconUrl || DEFAULT_SOCIAL_ICON_URLS[network.network] || '';
  }

  headingSize(): number {
    if (this.block.type !== 'heading') {
      return this.global.heading.sizes.h2;
    }
    const sizes = this.global.heading.sizes;
    const byLevel = { 1: sizes.h1, 2: sizes.h2, 3: sizes.h3, 4: sizes.h4 };
    return byLevel[this.block.props.level];
  }
}
