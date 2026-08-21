import { Component, Input } from '@angular/core';
import { FooterBlock } from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for a footer block - extracted from
// DesignerSidePanelComponent 2026-08-21 (bucket A item #5), same shape as
// SocialBlockSettingsComponent: one @Input() block, its own mutations, no
// outputs, commits straight to DesignerStateService so every change is one
// undo step.
//
// The address is the interesting part. Authors type PLAIN TEXT into a
// textarea, but it is stored as HTML (the compiler treats it like any other
// authored fragment), so this component owns both directions of that
// conversion: escape + newline-to-<br> on the way in, strip + unescape on
// the way back out. The round trip has to survive characters that are
// meaningful in markup - "Smith & Sons <HQ>" is a real address shape - which
// is why both halves live together here rather than being split across a
// setter and a template pipe.
@Component({
    selector: 'app-footer-block-settings',
    templateUrl: './footer-block-settings.component.html',
    styleUrls: ['./footer-block-settings.component.scss'],
    standalone: false
})
export class FooterBlockSettingsComponent {
  @Input() block!: FooterBlock;

  constructor(private state: DesignerStateService) {}

  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  setAddress(text: string): () => void {
    return () => {
      // Stored as a simple div so the compiler treats it like any other
      // authored fragment; plain text in, escaped-ish out (no markup entry).
      this.block.props.addressHtml = text.trim()
        ? '<div>' + this.escapeText(text.trim()).replace(/\n/g, '<br>') + '</div>'
        : '';
    };
  }

  addressText(): string {
    const html = this.block.props.addressHtml ?? '';
    return html
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  setReminder(text: string): () => void {
    return () => {
      this.block.props.permissionReminder = text;
    };
  }

  setUnsubscribe(include: boolean): () => void {
    return () => {
      this.block.props.includeUnsubscribe = include;
    };
  }

  setUnsubscribeLabel(label: string): () => void {
    return () => {
      this.block.props.unsubscribeLabel = label.trim() || 'Unsubscribe';
    };
  }

  private escapeText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
