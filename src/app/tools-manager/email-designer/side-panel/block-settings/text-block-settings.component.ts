import { Component, Input } from '@angular/core';
import { EMAIL_FONT_FAMILIES, HeadingBlock, TextBlock } from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for a heading OR a text block - extracted from
// DesignerSidePanelComponent 2026-09-05 (review item 3, block editors), the
// shape SocialBlockSettingsComponent set: one @Input() block, its own
// mutations, no outputs, every change through DesignerStateService.commit()
// so it is one undo step.
//
// One component for two block types on purpose: the two editors are the
// same font picker and the same "edit it on the canvas" hint, and a heading
// adds only its level. Splitting them would mean a third component just to
// hold the shared half.
@Component({
    selector: 'app-text-block-settings',
    templateUrl: './text-block-settings.component.html',
    styleUrls: ['./text-block-settings.component.scss'],
    standalone: false
})
export class TextBlockSettingsComponent {
  @Input() block!: HeadingBlock | TextBlock;

  readonly fontFamilies = EMAIL_FONT_FAMILIES;

  constructor(private state: DesignerStateService) {}

  get isHeading(): boolean {
    return this.block.type === 'heading';
  }

  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  setLevel(level: 1 | 2 | 3 | 4): () => void {
    return () => {
      (this.block as HeadingBlock).props.level = level;
    };
  }

  /** The family the select shows: '' for "email default". */
  get font(): string {
    return this.block.props.fontFamily ?? '';
  }

  /** '' (the "Email default" option) is stored as null, never as ''. */
  setFont(family: string): () => void {
    return () => {
      this.block.props.fontFamily = family || null;
    };
  }

  fontLabel(family: string): string {
    return family.split(',')[0];
  }
}
