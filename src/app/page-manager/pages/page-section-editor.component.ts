import { Component, EventEmitter, HostListener, Input, OnDestroy, Output } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { BehaviorSubject, Subject, debounceTime } from 'rxjs';
import {
  PageContentBlock, PageContentItem
} from '@impact-common/shared/models/domain/page-content.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import menuData from 'src/app/common/services/data/nav-menu-data';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import {
  EntryFields, EntrySpec, GIVING_DESTINATIONS, ICON_CHOICES, PageSectionKind,
  WEB_CONFIG_AMOUNTS, pluralise
} from './page-section-catalogue';

/** How long to wait after a keystroke before showing it in the preview.
 *  Short enough to feel immediate, long enough that a sentence is not
 *  twenty reloads of a frame. */
const LIVE_PREVIEW_DEBOUNCE_MS = 250;

/**
 * Edits ONE section of ONE public page.
 *
 * One editor for every type on every page: which fields a type uses, and what
 * they are called on that page, is declared once in the catalogue - so a new
 * section type that reuses existing fields needs no change here.
 *
 * IT WAS A DIALOG UNTIL 2026-08-29, and the change is not cosmetic. A pop-up
 * has to be small enough to sit over the screen, which meant a rich-text box
 * at 220px and a seven-passage list scrolling inside a scroller. The screen
 * hosts it full-width now, beside a preview of the section being edited.
 *
 * IT STILL DOES NOT SAVE. It edits a copy the stack screen owns and hands
 * changes back; the stack writes, because the whole page is one document and
 * a per-section write would race the ordering.
 *
 * `dirty` is what makes the preview live. Rather than an ngModelChange on
 * every one of two dozen bindings, it listens for `input` on its own host -
 * which covers every text box, textarea and rich-text editor, because those
 * all fire it and it bubbles. What does NOT bubble to here is a Material
 * select (its options live in a CDK overlay outside this component) or a
 * slide toggle, so those carry an explicit output in the template. The
 * uploader calls it directly on close.
 */
@Component({
    selector: 'app-page-section-editor',
    templateUrl: './page-section-editor.component.html',
    styleUrls: ['./page-section-editor.component.css'],
    standalone: false
})
export class PageSectionEditorComponent implements OnDestroy {
  readonly richTextModules = RICH_TEXT_TOOLBAR;
  readonly amounts = WEB_CONFIG_AMOUNTS;
  readonly givingDestinations = GIVING_DESTINATIONS;
  readonly icons = ICON_CHOICES;

  /**
   * The WORKING COPY, owned by the stack screen. Mutated in place through
   * ngModel; the stack clones before handing it over, so cancelling costs
   * nothing.
   */
  @Input({ required: true }) section!: PageContentBlock;
  @Input({ required: true }) kind!: PageSectionKind;

  /** Every change, debounced - what drives the live preview beside it. */
  @Output() dirty = new EventEmitter<PageContentBlock>();
  @Output() save = new EventEmitter<PageContentBlock>();
  /** `cancelled`, not `cancel` - that is a native DOM event name and an
   *  output sharing one is ambiguous at the call site. */
  @Output() cancelled = new EventEmitter<void>();

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  /** Which entry is picking a picture, or null for the section's own. */
  private target: number | null = null;
  card: { image?: ImageModel } = {};

  destinations: { text: string; value: string }[] = [];

  private readonly edits = new Subject<void>();

  constructor() {
    this.edits.pipe(debounceTime(LIVE_PREVIEW_DEBOUNCE_MS))
      .subscribe(() => this.dirty.emit(this.section));

    menuData.forEach((menu) => {
      this.destinations.push({ text: menu.title, value: menu.link });
      if (menu.hasDropdown) {
        menu.dropdownItems.forEach((dd) => {
          this.destinations.push({ text: dd.title, value: dd.link });
        });
      }
    });
    // An anchor is a real destination: the About Us story buttons all point
    // at #history, which is the banner further down that same page.
    this.destinations.push({ text: 'The banner on this page', value: '#history' });
    this.destinations.push({ text: 'External', value: 'external' });
  }

  ngOnDestroy(): void {
    this.edits.complete();
  }

  /**
   * Anything typed anywhere inside this editor.
   *
   * `input` covers every text box, textarea and rich-text editor at once,
   * because they all fire it and it bubbles - which is why there is not an
   * ngModelChange on each of two dozen bindings. A Material select and a
   * slide toggle do NOT reach here (a select's options render in a CDK
   * overlay outside this component), so those two carry an explicit output
   * in the template and call this.
   */
  @HostListener('input')
  edited(): void {
    // A list that does not exist yet must not be undefined by the time the
    // preview draws it - see addEntry.
    this.edits.next();
  }

  get fields() {
    return this.kind.fields;
  }

  get entrySpec(): EntrySpec | undefined {
    return this.kind.entry;
  }

  get entryFields(): EntryFields {
    return this.kind.entry?.fields ?? {};
  }

  get headingLabel(): string {
    return this.kind.headingLabel ?? 'Heading';
  }

  get subheadingLabel(): string {
    return this.kind.subheadingLabel ?? 'Second heading';
  }

  get bodyLabel(): string {
    return this.kind.bodyLabel ?? 'Copy';
  }

  get imageLabel(): string {
    return this.kind.imageLabel ?? 'Picture';
  }

  get noteLabel(): string {
    return this.kind.noteLabel ?? 'Small line';
  }

  get ctaLabel(): string {
    return this.kind.ctaLabel ?? 'Button text';
  }

  get cta2Label(): string {
    return this.kind.cta2Label ?? 'Second button text';
  }

  // ---------------------------------------------------------- the entries

  get entries(): PageContentItem[] {
    return this.section.items ?? [];
  }

  get entryNoun(): string {
    return this.entrySpec?.noun ?? 'entry';
  }

  /** "Entries", not "Entrys" - see pluralise(). */
  get entryNounPlural(): string {
    return pluralise(this.entryNoun, 2);
  }

  addEntry(): void {
    // A two-column list defaults a new passage to the left, which is where
    // the eye goes first and where staff can see it landed.
    const seed: PageContentItem = {
      title: '', isActive: true,
      ...(this.entryFields.column ? { column: 'left' as const } : {})
    };
    this.section.items = [...this.entries, seed];
    this.edited();
  }

  removeEntry(index: number): void {
    this.section.items = this.entries.filter((_, i) => i !== index);
    this.edited();
  }

  reorderEntries(event: CdkDragDrop<PageContentItem[]>): void {
    moveItemInArray(this.entries, event.previousIndex, event.currentIndex);
    this.edited();
  }

  /**
   * Which side this entry lands on - DERIVED, never stored.
   *
   * Shown so the editor does not hide a layout rule the page applies: an
   * order that silently changes which side a photo sits on looks like a bug
   * until you know it is the rule.
   *
   * Counted among entries of the same COLUMN where there is one, so a
   * two-column block does not claim an alternation it does not have (it
   * returns nothing there - it does not alternate at all).
   */
  sideOf(index: number): string {
    const labels = this.entrySpec?.sideLabels;
    if (!labels) {
      return '';
    }
    return labels[index % 2];
  }

  /** The "01", "02" chip a numbered list draws, counted here exactly as the
   *  public page counts it. */
  chipOf(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  // --------------------------------------------------------- the uploader

  showImageUploader(index: number | null = null): void {
    this.target = index;
    this.card.image = index === null ? this.section.image : this.entries[index]?.image;
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    if (this.target === null) {
      this.section.image = this.card.image;
    } else if (this.entries[this.target]) {
      this.entries[this.target].image = this.card.image;
    }
    this.target = null;
    this.card.image = undefined;
    this.isImageUploaderVisible$.next(false);
    this.edited();
  }

  clearImage(): void {
    this.section.image = undefined;
    this.edited();
  }

  // ---------------------------------------------------------------- close

  onCancel(): void {
    this.cancelled.emit();
  }

  onSave(): void {
    if (this.fields.video) {
      this.section.videoId = parseVideoId(this.section.videoUrl);
    }
    this.save.emit(this.section);
  }
}

/**
 * The bare YouTube id out of whatever staff pasted - a watch URL, a share
 * link, an embed URL, or an id on its own. Parsed on save so the public
 * page never has to.
 */
export function parseVideoId(input: string | undefined): string | undefined {
  const value = (input ?? '').trim();
  if (!value) {
    return undefined;
  }
  if (/^[\w-]{11}$/.test(value)) {
    return value;
  }
  const match = value.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return match ? match[1] : undefined;
}
