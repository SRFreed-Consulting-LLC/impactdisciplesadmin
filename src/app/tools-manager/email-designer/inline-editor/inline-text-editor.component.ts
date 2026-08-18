import { AfterViewInit, Component, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';
import Quill from 'quill';
import { HeadingBlock, TextBlock } from 'src/app/common/models/admin/email-design.model';
import { MERGE_TAGS, MergeTagDef, mergeTagToken } from 'src/app/common/utils/email/merge-tags';
import { DesignerStateService } from '../designer-state.service';
import { normalizeInlineHtml } from './inline-html.util';

// Registered ONCE, module-scope: swap Quill's class-based attributors for
// their inline-STYLE twins so size/color/highlight/alignment emit
// `style="..."` (what email clients need) instead of ql-* classes (which
// need Quill's stylesheet to mean anything). NOTE this is a GLOBAL Quill
// config, deliberately accepted (P1 gap-closure decision): the app's other
// quill-editor sites (products, bios, web config...) already offer
// color/background/align in RICH_TEXT_TOOLBAR, and their output being
// inline-styled instead of class-based is strictly MORE portable for the
// public site that renders it (no Quill CSS needed) - existing stored
// content with ql-* classes still renders fine inside Quill itself.
const SIZE_WHITELIST = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'];
let styleAttributorsRegistered = false;
function registerStyleAttributors(): void {
  if (styleAttributorsRegistered) {
    return;
  }
  styleAttributorsRegistered = true;
  const size = Quill.import('attributors/style/size') as { whitelist: string[] };
  size.whitelist = SIZE_WHITELIST;
  Quill.register(size as never, true);
  Quill.register(Quill.import('attributors/style/color') as never, true);
  Quill.register(Quill.import('attributors/style/background') as never, true);
  Quill.register(Quill.import('attributors/style/align') as never, true);
}

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
      [{ size: SIZE_WHITELIST }],
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
    registerStyleAttributors();
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
