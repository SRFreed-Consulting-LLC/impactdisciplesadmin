import {
  Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, inject
} from '@angular/core';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { BehaviorSubject, Subject, debounceTime } from 'rxjs';
import {
  ContentPiece, PageContentBlock, PageContentItem, SectionColumn
} from '@impact-common/shared/models/domain/page-content.model';
import { TestimonialModel } from '@impact-common/shared/models/domain/testimonial.model';
import { TESTIMONIAL_TYPES } from '@impact-common/shared/lists/testimonial_types.enum';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import {
  EntryFields, EntrySpec, GIVING_DESTINATIONS, ICON_CHOICES, PageSectionKind,
  WEB_CONFIG_AMOUNTS, pluralise
} from './page-section-catalogue';
// KindVariant, SectionSurface and GRID_LIST_LOOKS left with the appearance
// panel on 2026-09-05 - the shell no longer names a look or a ground.
import {
  CONTENT_PIECES, ContentPieceKindKey, SECTION_ARCHETYPE, SECTION_SURFACES, SIGNUP_LISTS
} from '@impact-common/shared/lists/section_kit';
import { FormDefinitionModel } from '@impact-common/shared/models/domain/form-definition.model';
import { FormDefinitionService } from 'src/app/common/services/data/form-definition.service';
import { MatDialog } from '@angular/material/dialog';
import {
  TestimonialDialogComponent
} from '../../shared/testimonial-dialog/testimonial-dialog.component';
import {
  PageEntryDialogComponent, PageEntryDialogData
} from './page-entry-dialog.component';
import {
  activeSurfaceOf, activeVariantOf, isOnPhotoSurface
} from './section-appearance.util';

/** How long to wait after a keystroke before showing it in the preview.
 *  Short enough to feel immediate, long enough that a sentence is not
 *  twenty reloads of a frame. */
const LIVE_PREVIEW_DEBOUNCE_MS = 250;

/**
 * The words out of a rich-text field, for a one-line summary.
 *
 * Tags stripped and entities left as they are: this is only ever shown
 * truncated in an interpolation, which escapes what it draws, so an entity
 * that survives is a cosmetic `&amp;` in a preview rather than anything that
 * can reach the page.
 *
 * @param html The stored rich text, or nothing.
 * @returns The text with tags removed and whitespace collapsed.
 */
export function plainText(html: string | undefined): string {
  return (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

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
export class PageSectionEditorComponent implements OnInit, OnDestroy {
  private readonly testimonialService = inject(TestimonialService);
  private readonly dialog = inject(MatDialog);
  private readonly formDefinitions = inject(FormDefinitionService);
  readonly richTextModules = RICH_TEXT_TOOLBAR;
  readonly amounts = WEB_CONFIG_AMOUNTS;
  readonly givingDestinations = GIVING_DESTINATIONS;
  readonly icons = ICON_CHOICES;
  readonly signupLists = SIGNUP_LISTS;

  /** The Form Builder forms a FORM section may show, by name. Loaded only
   *  when the variant declares `form` - most sections never pay the read. */
  formOptions: FormDefinitionModel[] = [];
  formsFailed = false;

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
  /** Whatever is picking a picture - see showImageUploader. */
  private target: { image?: ImageModel } | null = null;
  card: { image?: ImageModel } = {};

  private readonly edits = new Subject<void>();

  // The list of places a button can go moved to app-destination-field, which
  // owns it along with the "somewhere else" case this editor used to get
  // wrong - see that component.
  constructor() {
    this.edits.pipe(debounceTime(LIVE_PREVIEW_DEBOUNCE_MS))
      .subscribe(() => this.dirty.emit(this.section));
  }

  /**
   * The coach testimonials, in the order this section will show them.
   *
   * The list is EVERY live one, not just the ids the section knows: the page
   * appends anything it has not been told about, by author, so a quote added
   * after this section was last saved is already showing on the site. Putting
   * the same rule here means the editor shows what the page shows rather than
   * a shorter list staff would then have to guess about.
   */
  testimonials: TestimonialModel[] = [];
  testimonialsFailed = false;

  ngOnInit(): void {
    this.loadPalette();
    if (this.fields.testimonials) {
      this.loadTestimonials();
    }
    // ANY variant, not just the active one: on the FORM archetype the picker
    // appears the moment staff switch from the sign-up variant to one that
    // shows a Form Builder form, and ngOnInit has long passed by then.
    const anyVariantHasForm = (this.kind.variants ?? []).some((v) => v.fields.form);
    // AND EVERY COLUMN SECTION, because `form` is a PIECE kind as well as a
    // section field, and a piece's fields are not the section's.
    //
    // This is what the Seminars page's "START TODAY" section hit: its form
    // lives in a column as a `form` piece, so neither test above was true,
    // loadForms() never ran, and the picker had no options at all. The stored
    // id then matched nothing in the (empty) list, so mat-select drew a blank
    // control under a floating "Which form" label - the section was correctly
    // configured and looked unset, which is the worst of both.
    //
    // Gated on the archetype rather than on "does a form piece exist right
    // now", for the same reason as the variant test: the palette can drop one
    // in long after ngOnInit. It costs one read of a five-document collection
    // on the sections that can contain pieces at all.
    if (this.fields.form || anyVariantHasForm || this.isColumnSection) {
      this.loadForms();
    }
  }

  private async loadForms(): Promise<void> {
    try {
      const all = await this.formDefinitions.getAll();
      this.formOptions = (all ?? [])
        .filter((form) => !!form.id)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      this.formsFailed = false;
    } catch (err) {
      console.error('Section editor: could not read the forms', err);
      this.formsFailed = true;
    }
  }

  ngOnDestroy(): void {
    this.edits.complete();
  }

  private async loadTestimonials(): Promise<void> {
    try {
      const all = await this.testimonialService
        .getAllByValue('type', TESTIMONIAL_TYPES.COACHING);
      const live = (all ?? []).filter((t) => t.isActive);
      const byId = new Map(live.map((t) => [t.id, t]));

      const known = (this.section.testimonialIds ?? [])
        .map((id) => byId.get(id))
        .filter((t): t is TestimonialModel => !!t);
      const knownIds = new Set(known.map((t) => t.id));
      const rest = live
        .filter((t) => !knownIds.has(t.id))
        .sort((a, b) => (a.author ?? '').localeCompare(b.author ?? ''));

      this.testimonials = [...known, ...rest];
      this.testimonialsFailed = false;
    } catch (err) {
      console.error('Section editor: could not read the testimonials', err);
      this.testimonialsFailed = true;
    }
  }

  reorderTestimonials(event: CdkDragDrop<TestimonialModel[]>): void {
    moveItemInArray(this.testimonials, event.previousIndex, event.currentIndex);
    this.section.testimonialIds = this.testimonials.map((t) => t.id).filter((id): id is string => !!id);
    this.edited();
  }

  /**
   * WRITE a quote from the page that shows it.
   *
   * The section could order quotes and nothing else: adding one, or fixing a
   * typo in one, meant leaving the page, finding Site > Data > Testimonials,
   * and coming back - and the note above the list said so, which made it a
   * documented dead end rather than a missing feature.
   *
   * It is the SAME dialog the Testimonials screen opens (moved into shared/
   * for exactly this), so there is one quote editor rather than two that can
   * drift. What is edited here is the quote itself, not a copy of it: a
   * testimonial belongs to no one page, and a correction made here shows
   * everywhere it appears. That is the honest behaviour, and the note beside
   * the buttons says it in as many words.
   *
   * A NEW one is seeded with this list's own type and switched on, because a
   * quote added from the coaching page and saved as a customer review would
   * vanish the moment the dialog closed - the list only holds its own type -
   * and would read as a failed save.
   */
  addQuote(): void {
    this.openQuoteDialog({
      isActive: true,
      type: TESTIMONIAL_TYPES.COACHING
    } as TestimonialModel);
  }

  editQuote(quote: TestimonialModel): void {
    this.openQuoteDialog(quote);
  }

  private openQuoteDialog(item: TestimonialModel): void {
    this.dialog.open(TestimonialDialogComponent, {
      data: { item },
      width: '980px',
      maxWidth: '96vw',
      autoFocus: false
    }).afterClosed().subscribe((saved) => {
      if (!saved) {
        return;
      }
      // Re-read rather than patch the row in place: the dialog can switch a
      // quote OFF or change its type, either of which takes it out of this
      // list entirely, and a patched row would leave it sitting there.
      this.loadTestimonials();
    });
  }
  /** The first line of a quote, so a row is recognisable without opening it. */
  quotePreview(t: TestimonialModel): string {
    const text = (t.text ?? '').replace(/\s+/g, ' ').trim();
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
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

  // ---------------------------------------------------- content / appearance
  //
  // This editor asks TWO kinds of question and used to ask them in one
  // undivided column, appearance first. Look, Ground, Cards per row and the
  // text styles belong to the section as a whole and are set once; the
  // heading, the picture and the entries are the words on the page and are
  // why anyone opens a section at all. Six settings and four explanatory
  // lines stood between opening a section and reaching its first word.
  //
  // Tabs rather than two stacked groups, chosen by the owner: the screen is
  // half the height and it opens on the half you almost always want. The
  // known cost is that the live preview beside this editor reflects BOTH
  // tabs, so a section can change shape for a reason sitting on the tab you
  // cannot see - which is why the appearance tab carries a summary of its own
  // settings, readable without switching to it.

  editorTab: 'content' | 'appearance' = 'content';

  /**
   * Is there anything on the appearance side at all?
   *
   * The twelve original pages declare neither variants nor surfaces - each
   * has its own component in the web app, so its look is not a choice. A tab
   * strip over an empty tab would be two clicks to nothing, so those screens
   * keep the single column they have always had.
   */
  get hasAppearanceControls(): boolean {
    return (this.kind.variants ?? []).length > 1 ||
      (this.kind.surfaces ?? []).length > 0;
  }

  /** How many entries the content tab holds, for the badge on it. */
  get contentCount(): number {
    if (this.isColumnSection) {
      return (this.section.columns ?? []).length;
    }
    if (this.fields.testimonials) {
      return (this.section.testimonialIds ?? []).length;
    }
    return (this.section.items ?? []).length;
  }

  /**
   * What the appearance tab currently says, shown ON the tab strip.
   *
   * The point of the whole change is that you should not have to switch tabs
   * to answer "what look is this?" - so the answer travels with the tab.
   */
  get appearanceSummary(): string {
    const parts: string[] = [];
    const look = activeVariantOf(this.kind, this.section)?.label;
    if (look && (this.kind.variants ?? []).length > 1) {
      parts.push(look);
    }
    const ground = SECTION_SURFACES
      .find((surface) => surface.key === activeSurfaceOf(this.section))?.label;
    if (ground && (this.kind.surfaces ?? []).length) {
      parts.push(ground);
    }
    if (this.section.cardsPerRow) {
      parts.push(`${this.section.cardsPerRow} per row`);
    }
    return parts.join(' \u00b7 ');
  }

  /**
   * Whether this section's picture is a cropped BACKGROUND.
   *
   * Kept on the shell as well as the appearance panel because the CONTENT
   * side needs it too: a photo-surface section is offered a picture field
   * even when its kind declares none, and the field's label changes to
   * "Background photo". Both read the same shared derivation rather than one
   * asking the other, which is what keeps the two tabs from disagreeing about
   * a section they are both looking at.
   */
  get onPhotoSurface(): boolean {
    return isOnPhotoSurface(this.section);
  }

  showTab(tab: 'content' | 'appearance'): void {
    this.editorTab = tab;
  }

  // --------------------------------------------------------------- fields
  //
  // WHICH fields the content side shows is decided by the chosen VARIANT,
  // which is set on the appearance tab - so the shell reads the same shared
  // derivation the panel does. This is the one real coupling between the two
  // halves and it runs one way: picking a look reshapes the content form.

  get fields() {
    return activeVariantOf(this.kind, this.section)?.fields ?? this.kind.fields;
  }

  get entrySpec(): EntrySpec | undefined {
    const variant = activeVariantOf(this.kind, this.section);
    return variant ? variant.entry : this.kind.entry;
  }

  get entryFields(): EntryFields {
    return this.entrySpec?.fields ?? {};
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
    // On the photo surface the picture is the GROUND, not content in the
    // section - and a field called "Picture" beside a ground control reads as
    // a second, inline image.
    if (this.onPhotoSurface) {
      return 'Background photo';
    }
    return this.kind.imageLabel ?? 'Picture';
  }

  /** What an empty picture field means, which differs by what it is for. */
  get emptyImageHint(): string {
    return this.onPhotoSurface ?
      'No picture - this section will draw on a plain ground instead' :
      'No picture - this section will draw a gap';
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
    // Straight into the dialog, and only added if it comes back: the old
    // behaviour appended a blank row you then had to find and fill in, and
    // an abandoned one sat in the list drawing an empty card.
    this.openEntryDialog(seed, this.entries.length, true, (entry) => {
      this.section.items = [...this.entries, entry];
    });
  }

  /**
   * Opens one entry's fields.
   *
   * @param index Which entry in the list.
   *
   * A LIST SHOULD READ AS A LIST. Every entry used to hold every field it
   * has open at once - a picture, a title, a headline, a paragraph, a
   * rich-text box, a destination and two button fields - so eight coaches
   * were eight stacked forms and finding the third meant scrolling past two
   * of them. The row identifies the entry now; this is where its fields are
   * (owner, 2026-09-05).
   */
  openEntry(index: number): void {
    const entry = this.entries[index];
    if (!entry) {
      return;
    }
    this.openEntryDialog(entry, index, false, (edited) => {
      this.section.items = this.entries.map((e, i) => (i === index ? edited : e));
    });
  }

  private openEntryDialog(
    entry: PageContentItem,
    index: number,
    isNew: boolean,
    apply: (entry: PageContentItem) => void
  ): void {
    const spec = this.entrySpec;
    if (!spec) {
      return;
    }
    // A COPY, so Cancel means cancel. The dialog covers the live preview, so
    // nothing is gained by writing through to the section as you type, and
    // the ordinary expectation of a dialog is that it can be abandoned.
    // structuredClone rather than a spread: an entry holds an image object
    // and a focal point, and a shallow copy would let the dialog edit those
    // in place on the real entry.
    const data: PageEntryDialogData = {
      entry: structuredClone(entry),
      spec,
      index,
      chip: this.chipOf(index),
      side: this.sideOf(index),
      isNew
    };
    // WIDE, and as tall as the window allows (owner, 2026-09-05). At 860px an
    // entry carrying a picture, a paragraph and a rich-text field scrolled
    // inside the dialog while the screen around it sat empty - a scrollbar
    // inside a pop-up, with Done below the fold of it. This is a back-office
    // screen on a desktop; the room is there, so use it.
    this.dialog.open(PageEntryDialogComponent, {
      data,
      width: '1160px',
      maxWidth: '95vw',
      maxHeight: '92vh',
      autoFocus: false
    }).afterClosed().subscribe((result: PageContentItem | undefined) => {
      if (!result) {
        return;
      }
      apply(result);
      this.edited();
    });
  }

  /**
   * The one line that has to tell one entry from another in a closed list.
   *
   * Falls through whatever this kind of entry actually carries, because no
   * single field is present on all of them: a price tile has no title, a
   * quote card's words are its body, an icon row is a headline and a
   * sentence. The last resort names the position rather than showing a blank
   * row, which is the one thing a list must never do.
   */
  entryLabel(entry: PageContentItem, index: number): string {
    const first = [entry.title, entry.heading, entry.description]
      .map((v) => (v ?? '').trim())
      .find((v) => v.length > 0);
    if (first) {
      return first.length > 80 ? `${first.slice(0, 80)}…` : first;
    }
    const fromBody = plainText(entry.body).trim();
    if (fromBody) {
      return fromBody.length > 80 ? `${fromBody.slice(0, 80)}…` : fromBody;
    }
    return `Untitled ${this.entryNoun} ${index + 1}`;
  }

  /**
   * The quieter second line - whatever the label did NOT use.
   *
   * Empty is fine and common: a row with one field has nothing to say twice,
   * and repeating the label underneath itself would be noise.
   */
  entryDetail(entry: PageContentItem, index: number): string {
    const label = this.entryLabel(entry, index);
    const rest = [entry.heading, entry.description, plainText(entry.body), entry.ctaTitle]
      .map((v) => (v ?? '').replace(/\s+/g, ' ').trim())
      .find((v) => v.length > 0 && !label.startsWith(v.slice(0, 40)));
    if (!rest) {
      return '';
    }
    return rest.length > 110 ? `${rest.slice(0, 110)}…` : rest;
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

  // ------------------------------------------------------- the columns
  //
  // THE SECTION ARCHETYPE. One to three columns, each an ordered list of
  // pieces - see content-piece.component for why a piece is its own thing.
  // Everything here is absent on the fourteen archetypes, so they are
  // untouched.

  readonly pieceKinds = CONTENT_PIECES;

  /** The same fixed palette a two-column block already had, one per column
   *  instead of one per side. "None" is stored as absent, so a column that
   *  never had an opinion does not start carrying one. */
  readonly columnGrounds = [
    { key: undefined, label: 'No box' },
    { key: 'tint', label: 'Tinted box' },
    { key: 'panel', label: 'Dark panel' }
  ] as const;

  get isColumnSection(): boolean {
    return this.kind.type === SECTION_ARCHETYPE.SECTION;
  }

  get columns(): SectionColumn[] {
    return this.section.columns ?? [];
  }

  piecesOf(column: SectionColumn): ContentPiece[] {
    return column.pieces ?? [];
  }

  /**
   * ADDING a column adds an empty one; REMOVING one is refused while it has
   * anything in it.
   *
   * Dropping a column silently would take its pieces with it, and the pieces
   * are the work. Staff empty it first, which is a deliberate act, or leave
   * it - an empty column costs a little space and nothing else.
   */
  setColumnCount(count: number): void {
    const current = this.columns;
    if (count > current.length) {
      const added: SectionColumn[] = [];
      for (let i = 0; i < count - current.length; i++) {
        added.push({ key: freshKey('col', this.takenKeys([...current, ...added])), pieces: [] });
      }
      this.section.columns = [...current, ...added];
    } else if (count < current.length) {
      const doomed = current.slice(count);
      if (doomed.some((column) => this.piecesOf(column).length)) {
        this.columnWarning = 'Empty the last column before removing it, '
          + 'so nothing you wrote disappears with it.';
        return;
      }
      this.section.columns = current.slice(0, count);
    }
    this.columnWarning = '';
    this.edited();
  }

  /** Said out loud rather than silently refusing, which reads as a broken
   *  control. Cleared by the next successful change. */
  columnWarning = '';

  /** Every key in this section - columns and pieces alike. Unique across the
   *  whole section rather than within one column, so a piece keeps its key
   *  if it is ever moved between columns. */
  private takenKeys(columns: readonly SectionColumn[] = this.columns): Set<string> {
    const taken = new Set<string>();
    for (const column of columns) {
      taken.add(column.key);
      for (const piece of this.piecesOf(column)) {
        taken.add(piece.key);
      }
    }
    return taken;
  }

  // Stored as ABSENT rather than false, so a column that never had an
  // opinion does not start carrying one - the same rule the section's own
  // levers follow.
  //
  // `delete`, NOT `= undefined`, and the difference is the whole of a live
  // bug (2026-09-04). These four read as "absent" either way in TypeScript,
  // but a key explicitly set to undefined is PRESENT with an undefined
  // value, and Firestore rejects the ENTIRE write the moment it sees one:
  //
  //   Function updateDoc() called with invalid data.
  //   Unsupported field value: undefined
  //
  // So switching a toggle ON saved fine and switching it OFF could not save
  // at all - and the failure is the whole document, not the one field. Every
  // other edit made in the same sitting went down with it. See CLAUDE.md's
  // write gotcha, and the same house rule stated on FirebaseDAO.updateFields.

  setColumnAlign(column: SectionColumn, centred: boolean): void {
    if (centred) {
      column.align = 'centre';
    } else {
      delete column.align;
    }
    this.edited();
  }

  setColumnMeasure(column: SectionColumn, held: boolean): void {
    if (held) {
      column.measure = true;
    } else {
      delete column.measure;
    }
    this.edited();
  }

  setColumnInset(column: SectionColumn, inset: boolean): void {
    if (inset) {
      column.inset = true;
    } else {
      delete column.inset;
    }
    this.edited();
  }

  setColumnFull(column: SectionColumn, full: boolean): void {
    if (full) {
      column.full = true;
    } else {
      delete column.full;
    }
    this.edited();
  }

  /**
   * The ground select, whose "No box" option has no value.
   *
   * ngModel has already written `undefined` onto the column by the time this
   * runs - the same unsaveable key as the four toggles above - so this drops
   * it. Handled here rather than by giving the option a real value, because
   * "no box" genuinely is the absence of one and the renderer already reads
   * it that way.
   */
  setColumnGround(column: SectionColumn): void {
    if (!column.ground) {
      delete column.ground;
    }
    this.edited();
  }

  /** The CLICK path, and the only one a keyboard can take. Appends to the
   *  end of the column, which is where the Add button always put it. */
  addPiece(column: SectionColumn, kind: ContentPieceKindKey): void {
    if (!column) {
      return;
    }
    this.insertPiece(column, kind, this.pieces(column).length);
    this.edited();
  }

  removePiece(column: SectionColumn, piece: ContentPiece): void {
    column.pieces = this.piecesOf(column).filter((p) => p !== piece);
    this.edited();
  }

  /** The drop lists a piece may travel between - every column of this
   *  section, and nothing else. The palette connects TO these; they never
   *  connect back, which is what stops a piece being dragged into it. */
  get columnListIds(): string[] {
    return this.columns.map((column) => `piececol-${column.key}`);
  }

  /**
   * THREE DROPS, told apart by where the drag started.
   *
   * Within one column it is a reorder. From another column the piece MOVES,
   * keeping everything about it - which is the behaviour that makes columns
   * feel like places rather than fixed slots. From the palette it is not a
   * move at all: a new piece of that kind is made at the position it was
   * dropped, and the palette itself is left untouched, or it would empty
   * itself one drag at a time.
   */
  dropIntoColumn(column: SectionColumn, event: CdkDragDrop<SectionColumn>): void {
    if (event.previousContainer === event.container) {
      moveItemInArray(this.pieces(column), event.previousIndex, event.currentIndex);
    } else if (event.previousContainer.id === 'piece-palette') {
      this.insertPiece(column, event.item.data as ContentPieceKindKey, event.currentIndex);
    } else {
      const from = event.previousContainer.data as SectionColumn;
      transferArrayItem(
        this.pieces(from), this.pieces(column), event.previousIndex, event.currentIndex
      );
    }
    this.edited();
  }

  /**
   * The column's piece array, CREATED if it does not exist yet.
   *
   * piecesOf() returns a throwaway `[]` for a column that has none, which is
   * right for reading and silently useless for dropping into: the CDK would
   * splice the new piece into an array nothing holds a reference to, and the
   * drop would appear to do nothing.
   */
  private pieces(column: SectionColumn): ContentPiece[] {
    if (!column.pieces) {
      column.pieces = [];
    }
    return column.pieces;
  }

  private insertPiece(column: SectionColumn, kind: ContentPieceKindKey, at: number): void {
    const seed: ContentPiece = { key: freshKey(kind, this.takenKeys()), kind, isActive: true };
    if (kind === 'heading') {
      seed.level = 'section';
    }
    this.pieces(column).splice(at, 0, seed);
  }

  // ------------------------------------------------------- the palette

  /**
   * Icons only, remembered - the same bargain the preview rail strikes.
   *
   * Twelve names is a real amount of width on a screen that also wants three
   * columns and a preview, and which of those matters is the person's call
   * rather than ours.
   */
  paletteTight = false;

  private readonly PALETTE_KEY = 'page-piece-palette';

  togglePalette(): void {
    this.paletteTight = !this.paletteTight;
    try {
      localStorage.setItem(this.PALETTE_KEY, this.paletteTight ? 'tight' : 'wide');
    } catch {
      // Storage unavailable - the palette still works, it just forgets.
    }
  }

  private loadPalette(): void {
    try {
      this.paletteTight = localStorage.getItem(this.PALETTE_KEY) === 'tight';
    } catch {
      // Defaults stand.
    }
  }

  // --------------------------------------------------------- the uploader

  /**
   * WHICH object is picking a picture - the section, an entry, or a piece.
   *
   * It used to be an entry's numeric INDEX, with null meaning the section.
   * That could not name a piece at all (it is in a column, which is in a
   * list), and it silently retargeted if the entries were reordered while
   * the picker was open. A reference to the object cannot do either.
   */
  showImageUploader(target: { image?: ImageModel } = this.section): void {
    this.target = target;
    this.card.image = target.image;
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    if (this.target) {
      // Closing without a picture must leave the target with NO image key,
      // not one holding undefined - see setColumnAlign's comment. `card` is
      // this component's own staging object and is never written, so it can
      // hold whatever it likes.
      if (this.card.image) {
        this.target.image = this.card.image;
      } else {
        delete this.target.image;
      }
    }
    this.target = null;
    this.card.image = undefined;
    this.isImageUploaderVisible$.next(false);
    this.edited();
  }

  clearImage(): void {
    delete this.section.image;
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
 * A key nothing else in this section uses.
 *
 * The same rule page-stack applies to sections, one level down and for the
 * same reason: the lists are tracked BY KEY, and two rows sharing one behave
 * as a single row - dragging one moves the other, deleting one deletes both.
 */
export function freshKey(prefix: string, taken: ReadonlySet<string>): string {
  if (!taken.has(prefix)) {
    return prefix;
  }
  let n = 2;
  while (taken.has(`${prefix}-${n}`)) {
    n++;
  }
  return `${prefix}-${n}`;
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
