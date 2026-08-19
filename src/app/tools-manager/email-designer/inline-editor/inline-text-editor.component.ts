import { AfterViewInit, Component, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';
import Quill from 'quill';
import { HeadingBlock, TextBlock } from 'src/app/common/models/admin/email-design.model';
import { MERGE_TAGS, MergeTagDef, mergeTagToken } from 'src/app/common/utils/email/merge-tags';
import { DesignerStateService } from '../designer-state.service';
import { normalizeInlineHtml } from './inline-html.util';

// The inline-STYLE attributor registration moved to the shared
// quill-style-attributors util (2026-08-19) so the campaign popup editor
// gets the same portable inline-styled output - see that file's comment
// for the original P1 decision rationale.
import { QUILL_SIZE_WHITELIST, registerQuillStyleAttributors } from 'src/app/shared/rich-text-editor/quill-style-attributors';

// The single live inline editor (Mailchimp's click-to-edit): a minimal
// Quill instance with the BUBBLE theme, whose floating selection toolbar is
// exactly the interaction Mailchimp has. Only one exists at a time -
// block-host swaps it in for the block being edited.
//
// P1 gap-closure (2026-08-18): the toolbar now carries per-selection size,
// text color, highlight, and alignment (inline-style attributors above) on
// top of the original bold/italic/underline/strike/link/lists set. Font
// FAMILY stays per-block (the settings panel), matching how the wrapper/
// compiler already inline the family.
@Component({
    selector: 'app-inline-text-editor',
    templateUrl: './inline-text-editor.component.html',
    styleUrls: ['./inline-text-editor.component.scss'],
    standalone: false
})
export class InlineTextEditorComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) block!: TextBlock | HeadingBlock;

  mergeTags: MergeTagDef[] = MERGE_TAGS;

  quillModules = {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ size: QUILL_SIZE_WHITELIST }],
      [{ color: [] }, { background: [] }],
      [{ align: '' }, { align: 'center' }, { align: 'right' }],
      ['link'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['clean']
    ]
  };


  private quill: Quill | undefined;
  private finished = false;

  constructor(private host: ElementRef<HTMLElement>, private state: DesignerStateService) {
    registerQuillStyleAttributors();
  }

  ngAfterViewInit(): void {
    this.state.inlineEditing = true;
  }

  onEditorCreated(quill: Quill): void {
    this.quill = quill;
    quill.clipboard.dangerouslyPasteHTML(this.block.props.html ?? '');
    quill.focus();
    quill.setSelection(quill.getLength(), 0);
  }

  insertMergeTag(def: MergeTagDef): void {
    if (!this.quill) {
      return;
    }
    const token = mergeTagToken(def);
    const range = this.quill.getSelection(true);
    const index = range ? range.index : this.quill.getLength();
    this.quill.insertText(index, token, 'user');
    this.quill.setSelection(index + token.length, 0);
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (this.host.nativeElement.contains(target)) {
      return;
    }
    // Clicks inside CDK overlays (the merge-tag mat-menu, Quill's own
    // tooltip lives inside the host) shouldn't end the editing session.
    if (target.closest('.cdk-overlay-container')) {
      return;
    }
    this.finish();
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    this.finish();
  }

  ngOnDestroy(): void {
    this.finish();
    this.state.inlineEditing = false;
  }

  // Normalize + commit once per editing session (not per keystroke) - one
  // undo step per "edited this text", like Mailchimp.
  private finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    const raw = this.quill ? this.quill.getSemanticHTML() : this.block.props.html;
    const html = normalizeInlineHtml(raw);
    if (html !== this.block.props.html) {
      const block = this.block;
      this.state.commit(() => {
        block.props.html = html;
      });
    }
    this.state.inlineEditing = false;
    if (this.state.editingBlockId === this.block.id) {
      this.state.editingBlockId = null;
    }
  }
}
