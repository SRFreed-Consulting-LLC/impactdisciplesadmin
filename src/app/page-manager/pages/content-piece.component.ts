import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ContentPiece } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentItem } from '@impact-common/shared/models/domain/page-content.model';
import { ContentPieceDef, contentPieceDef } from '@impact-common/shared/lists/section_kit';
import { SIGNUP_LISTS } from '@impact-common/shared/lists/section_kit';
import { FormDefinitionModel } from '@impact-common/shared/models/domain/form-definition.model';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { GIVING_DESTINATIONS, WEB_CONFIG_AMOUNTS } from './page-section-catalogue';

/**
 * Edits ONE piece of content, wherever it sits.
 *
 * THIS COMPONENT IS THE POINT OF THE WHOLE CHANGE. The editor used to hold
 * one hand-written control per field of the section, and a 160-line inline
 * list for entries - which is why a column could not be given "a heading, a
 * passage and two buttons" without writing that arrangement out again. A
 * piece is addressable on its own, so a column is just an ordered list of
 * these and three columns cost nothing more than one.
 *
 * WHICH CONTROLS APPEAR is the kind's own declaration in CONTENT_PIECES, the
 * same way a section's fields are its archetype's. A new kind of piece that
 * reuses existing fields needs no markup here.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT DO:
 *
 * - It does not save, or even own its piece. It mutates the object it is
 *   handed, exactly as the section editor mutates the stack's working copy,
 *   and the page above writes.
 * - It does not open the image picker. The uploader is a single overlay the
 *   editor above owns; this asks for it and is told what came back.
 *
 * THE CHANGE OUTPUT IS NOT DECORATION. Typing reaches the editor above on
 * its own, because `input` bubbles - but a Material select's options render
 * in a CDK overlay OUTSIDE this component's DOM, so nothing bubbles from
 * them and an edit made there would never reach the preview or the save.
 * Every select and toggle here calls `changed`.
 */
@Component({
  selector: 'app-content-piece',
  templateUrl: './content-piece.component.html',
  styleUrls: ['./content-piece.component.css'],
  standalone: false
})
export class ContentPieceComponent {
  /** The piece being edited, owned by whoever passed it in. */
  @Input({ required: true }) piece!: ContentPiece;

  /** The Form Builder forms a `form` piece may choose from. Passed down
   *  rather than read here, so twelve pieces cost one read. */
  @Input() forms: FormDefinitionModel[] = [];
  @Input() formsFailed = false;

  /** Anything that will not reach the editor above by bubbling. */
  @Output() changed = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
  /** "Open the picture picker for me" - the overlay belongs to the editor. */
  @Output() pickImage = new EventEmitter<void>();

  readonly richTextModules = RICH_TEXT_TOOLBAR;
  readonly signupLists = SIGNUP_LISTS;
  readonly amounts = WEB_CONFIG_AMOUNTS;
  readonly givingDestinations = GIVING_DESTINATIONS;

  readonly levels = [
    { key: 'page', label: 'Page title' },
    { key: 'section', label: 'Section heading' },
    { key: 'minor', label: 'Small heading' },
    { key: 'display', label: 'Big figure' }
  ] as const;

  /** What this kind is called and which controls it uses. Undefined for a
   *  kind this build does not know, which draws a plain row saying so rather
   *  than an empty box. */
  get def(): ContentPieceDef | undefined {
    return contentPieceDef(this.piece?.kind);
  }

  get fields() {
    return this.def?.fields ?? {};
  }

  /** The line shown on the row when it is closed, so a column of eight
   *  pieces is readable without opening any of them. */
  get summary(): string {
    const piece = this.piece;
    switch (piece?.kind) {
      case 'heading':
      case 'eyebrow':
      case 'note':
        return piece.text ?? '';
      case 'text':
        return stripTags(piece.html ?? '');
      case 'picture':
        return piece.image?.name ?? '';
      case 'video':
        return piece.videoId ?? '';
      case 'buttons':
        return (piece.buttons ?? []).map((b) => b.title).filter(Boolean).join(', ');
      case 'signup':
        return piece.signupList === 'prayer' ? 'Prayer team' : 'Newsletter';
      case 'countdown':
        return piece.targetDate ?? '';
      case 'price':
        return piece.amountKey ?? '';
      default:
        return '';
    }
  }

  // -------------------------------------------------------- the buttons

  /**
   * AS MANY BUTTONS AS STAFF WANT, not the one or two the old fields
   * allowed. The section used to carry ctaTitle/ctaUrl and a second pair,
   * which is why a band could never offer three.
   */
  get buttons(): PageContentItem[] {
    return this.piece.buttons ?? [];
  }

  addButton(): void {
    this.piece.buttons = [...this.buttons, { title: '', isActive: true }];
    this.changed.emit();
  }

  removeButton(index: number): void {
    this.piece.buttons = this.buttons.filter((_, i) => i !== index);
    this.changed.emit();
  }

  reorderButtons(event: CdkDragDrop<PageContentItem[]>): void {
    moveItemInArray(this.buttons, event.previousIndex, event.currentIndex);
    this.changed.emit();
  }

  /**
   * A GIVING destination is chosen from a list and stored as a KEY.
   *
   * Never a typed address. Anyone who can edit a page could otherwise point
   * "Give monthly" at a site they control, and the page would look right.
   * The renderer resolves the key against the environment.
   */
  isGiving(button: PageContentItem): boolean {
    return this.givingDestinations.some((d) => d.key === button.link);
  }
}

/** The first readable line of a rich-text passage, for the closed row. */
export function stripTags(html: string): string {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}
