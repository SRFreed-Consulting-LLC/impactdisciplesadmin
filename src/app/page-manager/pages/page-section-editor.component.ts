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
  EntryFields, EntrySpec, GIVING_DESTINATIONS, ICON_CHOICES, KindVariant, PageSectionKind,
  WEB_CONFIG_AMOUNTS, pluralise
} from './page-section-catalogue';
import {
  CONTENT_PIECES, ContentPieceKindKey, SECTION_ARCHETYPE, SECTION_SURFACES, SIGNUP_LISTS,
  SectionSurface, GRID_LIST_LOOKS } from '@impact-common/shared/lists/section_kit';
import { FormDefinitionModel } from '@impact-common/shared/models/domain/form-definition.model';
import { FormDefinitionService } from 'src/app/common/services/data/form-definition.service';
import { MatDialog } from '@angular/material/dialog';
import {
  TestimonialDialogComponent
} from '../../shared/testimonial-dialog/testimonial-dialog.component';

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
    if (this.fields.form || anyVariantHasForm) {
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
    this.section.testimonialIds = this.testimonials.map((t) => t.id);
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

  // ------------------------------------------------ variant, and its fields
  //
  // A KIT PAGE ONLY. The twelve original pages declare no variants, so every
  // getter below falls straight through to the kind and they are unaffected.
  //
  // The whole reason this works with no other change to the editor: every
  // field block in the template is already gated on `fields`, and the entry
  // control on `entrySpec`. Point those at the chosen variant and the form
  // reshapes itself.

  get variants(): readonly KindVariant[] {
    return this.kind.variants ?? [];
  }

  /** The chosen look, or the first - so a section written before variants
   *  existed, or one whose variant was retired, still shows real fields
   *  rather than none. */
  get activeVariant(): KindVariant | undefined {
    const variants = this.kind.variants;
    if (!variants?.length) {
      return undefined;
    }
    return variants.find((v) => v.key === this.section.variant) ?? variants[0];
  }

  /**
   * Changing the look does NOT clear what was typed.
   *
   * A variant that drops a field leaves its value on the block, unshown. That
   * is deliberate: switching to look at another arrangement and back must not
   * cost you the paragraph you had written. The renderer only reads the
   * fields the variant declares, so an unused value is inert - and the far
   * worse behaviour is a form that silently eats copy.
   */
  pickVariant(key: string): void {
    this.section.variant = key;
    this.edits.next();
  }

  // ------------------------------------------------------------- surface

  get surfaces(): readonly SectionSurface[] {
    return this.kind.surfaces ?? [];
  }

  get surfaceLabels(): typeof SECTION_SURFACES {
    return SECTION_SURFACES;
  }

  /** 'inherit' rather than undefined, so the control always has a selection
   *  and "same as the page" reads as a choice rather than a blank. */
  get activeSurface(): SectionSurface {
    return this.section.surface ?? 'inherit';
  }

  pickSurface(surface: SectionSurface): void {
    this.section.surface = surface;
    this.edits.next();
  }

  // -------------------------------------------------- text-style options
  //
  // KIT PAGES ONLY, like the axes above. Each defaults (absent) to the
  // site's own measured style, so the toggles read as a choice away from
  // the house look rather than a mandatory decision. Closed unions on
  // purpose - a font box would be a second web designer inside every
  // editor. (Shane's call, comparing Lunch and Learns 2026-08-30.)

  readonly headingStyles = [
    { key: 'bold', label: 'Bold (site style)' },
    // The site's own prose headings - OVERVIEW is the same 50px at weight
    // 500, never 900. Measured, not invented.
    { key: 'light', label: 'Light (site style)' },
    { key: 'standard', label: 'Standard' }
  ] as const;

  readonly copySizes = [
    { key: 'compact', label: 'Compact (site style)' },
    { key: 'large', label: 'Large (site style)' },
    { key: 'display', label: 'Statement (site style)' }
  ] as const;

  readonly mediaSizes = [
    { key: 'large', label: 'Large (site style)' },
    { key: 'balanced', label: 'Even split' }
  ] as const;

  readonly copyTones = [
    { key: 'soft', label: 'Soft grey (site style)' },
    { key: 'dark', label: 'Dark' }
  ] as const;

  /**
   * Whether this section's copy contains a list at all.
   *
   * The Bullets control styles `li`s, so on a passage with none it is a
   * control that visibly does nothing - which reads as broken rather than as
   * inapplicable. Checked against the stored HTML rather than a flag,
   * because the copy is edited in a rich-text field and a flag would drift
   * from it the moment someone deleted the last bullet.
   */
  get copyHasBullets(): boolean {
    return /<\s*(ul|ol|li)\b/i.test(this.section?.body ?? '');
  }

  readonly bulletStyles = [
    { key: 'dots', label: 'Dots (site style)' },
    { key: 'none', label: 'None' }
  ] as const;

  pickHeadingStyle(value: 'bold' | 'light' | 'standard'): void {
    this.section.headingStyle = value;
    this.edits.next();
  }

  pickCopySize(value: 'large' | 'compact' | 'display'): void {
    this.section.copySize = value;
    this.edits.next();
  }

  pickMediaSize(value: 'large' | 'balanced'): void {
    this.section.mediaSize = value;
    this.edits.next();
  }

  readonly photoFocuses = [
    { key: 'top', label: 'Top' },
    { key: 'center', label: 'Centre' },
    { key: 'bottom', label: 'Bottom' }
  ] as const;

  pickPhotoFocus(value: 'top' | 'center' | 'bottom'): void {
    this.section.photoFocus = value;
    this.edits.next();
  }

  /** The focus lever only means anything while the photo is a cropped
   *  BACKGROUND - i.e. this section is actually on the photo surface. */
  /**
   * Which entry's picture is being positioned, or null.
   *
   * One at a time: the picker is a real drag target, and a list of eight
   * coaches showing eight of them at once would be a wall of photographs
   * with the words nowhere to be seen.
   */
  focusEntry: PageContentItem | null = null;

  toggleEntryFocus(entry: PageContentItem): void {
    this.focusEntry = this.focusEntry === entry ? null : entry;
  }

  /** This entry's point, defaulting to the middle. */
  entryFocusPoint(entry: PageContentItem): { x: number; y: number } {
    const point = entry.photoFocusPoint;
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ?
      { x: point.x, y: point.y } : { x: 50, y: 50 };
  }

  /**
   * Moves one entry's focal point to the pointer.
   * @param entry The entry being positioned.
   * @param event The pointer event on its picture.
   */
  moveEntryFocus(entry: PageContentItem, event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!el) {
      return;
    }
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) {
      return;
    }
    const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
    entry.photoFocusPoint = {
      x: pct(((event.clientX - box.left) / box.width) * 100),
      y: pct(((event.clientY - box.top) / box.height) * 100)
    };
    this.edits.next();
  }

  startEntryFocusDrag(entry: PageContentItem, event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.moveEntryFocus(entry, event);
  }

  dragEntryFocus(entry: PageContentItem, event: PointerEvent): void {
    if (event.buttons === 1) {
      this.moveEntryFocus(entry, event);
    }
  }

  /** Keyboard equivalent - a drag is unreachable without a pointer. */
  nudgeEntryFocus(entry: PageContentItem, dx: number, dy: number): void {
    const { x, y } = this.entryFocusPoint(entry);
    const clamp = (n: number) => Math.min(100, Math.max(0, n));
    entry.photoFocusPoint = { x: clamp(x + dx), y: clamp(y + dy) };
    this.edits.next();
  }

  /** Back to the card's own default - the ABSENCE of a point, not a
   *  centred one, so the card keeps whatever crop it was designed with. */
  clearEntryFocus(entry: PageContentItem): void {
    delete entry.photoFocusPoint;
    this.edits.next();
  }
  /**
   * The focal point as percentages, for the drag control and its preview.
   *
   * Falls back to whatever the old top/centre/bottom said, so opening a
   * section that has never been dragged shows the marker where the photo
   * actually sits rather than jumping it to the middle.
   */
  get focusPoint(): { x: number; y: number } {
    const point = this.section.photoFocusPoint;
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return { x: point.x, y: point.y };
    }
    const legacy = this.section.photoFocus ?? 'center';
    return { x: 50, y: legacy === 'top' ? 0 : legacy === 'bottom' ? 100 : 50 };
  }

  /** Where to draw the marker, and how to crop the thumbnail's own preview. */
  get focusCss(): string {
    const { x, y } = this.focusPoint;
    return `${x}% ${y}%`;
  }

  /**
   * Moves the focal point to where the pointer is, in the picture's own
   * percentages.
   *
   * Writing the POINT retires the old three-way value for this section: two
   * fields describing one thing would disagree the moment either is touched,
   * and the renderer prefers the point anyway - so leaving the old one behind
   * would be a value that no longer means anything.
   * @param event The pointer event on the picture.
   */
  moveFocus(event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!el) {
      return;
    }
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) {
      return;
    }
    const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
    this.section.photoFocusPoint = {
      x: pct(((event.clientX - box.left) / box.width) * 100),
      y: pct(((event.clientY - box.top) / box.height) * 100)
    };
    delete this.section.photoFocus;
    this.edits.next();
  }

  /** Drag, not just click: the pointer is captured so it keeps tracking
   *  outside the thumbnail, which is where a corner point is chosen from. */
  startFocusDrag(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.moveFocus(event);
  }

  dragFocus(event: PointerEvent): void {
    if (event.buttons === 1) {
      this.moveFocus(event);
    }
  }

  /** Keyboard equivalent, because a drag is not reachable without a pointer. */
  nudgeFocus(dx: number, dy: number): void {
    const { x, y } = this.focusPoint;
    const clamp = (n: number) => Math.min(100, Math.max(0, n));
    this.section.photoFocusPoint = { x: clamp(x + dx), y: clamp(y + dy) };
    delete this.section.photoFocus;
    this.edits.next();
  }

  recentreFocus(): void {
    this.section.photoFocusPoint = { x: 50, y: 50 };
    delete this.section.photoFocus;
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
    return this.variants.length > 1 || this.surfaces.length > 0;
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
    const look = this.activeVariant?.label;
    if (look && this.variants.length > 1) {
      parts.push(look);
    }
    const ground = SECTION_SURFACES
      .find((surface) => surface.key === this.activeSurface)?.label;
    if (ground && this.surfaces.length) {
      parts.push(ground);
    }
    if (this.section.cardsPerRow) {
      parts.push(`${this.section.cardsPerRow} per row`);
    }
    return parts.join(' \u00b7 ');
  }

  showTab(tab: 'content' | 'appearance'): void {
    this.editorTab = tab;
  }
  get onPhotoSurface(): boolean {
    return this.activeSurface === 'photo';
  }

  // --------------------------------------------------------- card grounds
  //
  // A box behind a column or the tiles, from the same fixed palette as the
  // surfaces. Shane's own follow-up named the trap - "then we'd have to let
  // them change the text colours too" - and the palette IS the answer: each
  // ground defaults its text to what reads on it (brand defaults DARK,
  // because that is what the original blue box does), and the text lever is
  // its own two-way choice rather than a colour wheel.

  readonly cardGrounds = [
    { key: 'none', label: 'No box' },
    { key: 'panel', label: 'Light panel' },
    { key: 'brand', label: 'Brand blue' },
    { key: 'dark', label: 'Dark' }
  ] as const;

  readonly cardInks = [
    { key: 'dark', label: 'Dark text' },
    { key: 'light', label: 'Light text' }
  ] as const;

  setGround(which: 'card' | 'left' | 'right', value: 'none' | 'panel' | 'brand' | 'dark'): void {
    if (which === 'card') { this.section.cardGround = value; }
    this.edits.next();
  }

  setInk(which: 'card' | 'left' | 'right', value: 'dark' | 'light'): void {
    if (which === 'card') { this.section.cardInk = value; }
    this.edits.next();
  }

  /**
   * Does a cards-per-row setting mean anything to this section?
   *
   * Only the looks drawn as a grid of cards obey it - a timeline or a
   * carousel would ignore it silently, and a control that does nothing is
   * worse than no control. GRID_LIST_LOOKS is shared with the renderer so
   * the two answers cannot drift.
   */
  get showsCardsPerRow(): boolean {
    const look = this.activeVariant?.key;
    return !!look && GRID_LIST_LOOKS.includes(look);
  }

  /** The chosen count, or 0 for "as many as fit". */
  get activePerRow(): number {
    return this.section.cardsPerRow ?? 0;
  }

  readonly perRowChoices = [
    { key: 0, label: 'As many as fit' },
    { key: 2, label: '2' },
    { key: 3, label: '3' },
    { key: 4, label: '4' }
  ] as const;

  pickPerRow(value: number): void {
    // "As many as fit" is the ABSENCE of a count. `delete`, not
    // `= undefined` - see setColumnAlign below for what that costs.
    if (value === 0) {
      delete this.section.cardsPerRow;
    } else {
      this.section.cardsPerRow = value as 2 | 3 | 4;
    }
    this.edits.next();
  }

  /**
   * Whether this section shares its row with the next one.
   *
   * A method rather than an assignment in the template, for the same reason
   * the column levers became methods: `= $event.checked || undefined` writes
   * a PRESENT key holding undefined, and Firestore rejects the whole document
   * over it. Switching this ON saved; switching it OFF could not save at all,
   * and took every other edit in the sitting down with it.
   * @param shared Whether to pair with the next section.
   */
  setPairWithNext(shared: boolean): void {
    if (shared) {
      this.section.pairWithNext = true;
    } else {
      delete this.section.pairWithNext;
    }
    this.edits.next();
  }

  // titleTones and setTitleTone lived here until 2026-09-03. Both were dead:
  // nothing in any template or class referenced either, and setTitleTone
  // ignored both of its arguments and simply pinged `edits`. They are the
  // last remnant of the six left/right tone fields the two-member section kit
  // replaced with per-column grounds.

  // isColumns and isGrid asked whether this section was one of two
  // archetypes, and both are gone. Nothing has asked since.

  /** What a ground's text defaults to when no ink is stored - the pair that
   *  reads on it. Brand defaults LIGHT: the original's grey-on-blue measured
   *  ~1.4:1 and Shane called it terrible on sight. Shown as the toggle's
   *  value so the control never lies about what is rendering. */
  inkFor(ground: string | undefined, stored: string | undefined): string {
    return stored ?? (ground === 'panel' ? 'dark' : 'light');
  }

  // hasSplitMedia and isCentred asked which ARCHETYPE this was, to decide
  // whether a media-side or a stacking-order control applied. Both are
  // gone, and so is the question: a Section says which side its picture is
  // on by which COLUMN holds it, and a column that is centred says so
  // itself. The two controls they gated went with them.

  // The two controls themselves - `mediaSides` / `pickMediaSide` and
  // `pickStackOrder` - went with them on 2026-09-01. Both had already
  // stopped being reachable from the template when the archetype question
  // above was deleted, and neither has anything left to set: a picture's
  // side is which column it is in, and the order of a heading and its text
  // is the order they are dragged into.

  pickCopyTone(value: 'soft' | 'dark'): void {
    this.section.copyTone = value;
    this.edits.next();
  }

  pickBullets(value: 'dots' | 'none'): void {
    this.section.bullets = value;
    this.edits.next();
  }

  // --------------------------------------------------------------- fields

  get fields() {
    return this.activeVariant?.fields ?? this.kind.fields;
  }

  get entrySpec(): EntrySpec | undefined {
    return this.activeVariant ? this.activeVariant.entry : this.kind.entry;
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
