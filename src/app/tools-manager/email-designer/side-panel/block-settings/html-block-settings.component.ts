import { Component, Input } from '@angular/core';
import DOMPurify from 'dompurify';
import { HtmlBlock } from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for a raw-HTML block - extracted from
// DesignerSidePanelComponent 2026-09-05 (review item 3). Same shape as the
// other block editors: one @Input() block, commits straight to the state
// service.
//
// Sanitized HERE, at edit time (scripts and event handlers stripped, layout
// markup kept) - the compiler then passes the stored markup through
// untouched. That split is deliberate: the author sees what survived while
// they can still fix it.
@Component({
    selector: 'app-html-block-settings',
    templateUrl: './html-block-settings.component.html',
    styleUrls: ['./html-block-settings.component.scss'],
    standalone: false
})
export class HtmlBlockSettingsComponent {
  @Input() block!: HtmlBlock;

  constructor(private state: DesignerStateService) {}

  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  setHtml(html: string): () => void {
    return () => {
      this.block.props.html = DOMPurify.sanitize(html ?? '');
    };
  }
}
