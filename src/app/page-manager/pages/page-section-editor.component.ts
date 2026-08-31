import {
  Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, inject
} from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { BehaviorSubject, Subject, debounceTime } from 'rxjs';
import {
  PageContentBlock, PageContentItem
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
import { SECTION_SURFACES, SIGNUP_LISTS, SectionSurface } from '@impact-common/shared/lists/section_kit';
import { FormDefinitionModel } from '@impact-common/shared/models/domain/form-definition.model';
import { FormDefinitionService } from 'src/app/common/services/data/form-definition.service';

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
  /** Which entry is picking a picture, or null for the section's own. */
  private target: number | null = null;
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
    if (which === 'left') { this.section.leftGround = value; }
    if (which === 'right') { this.section.rightGround = value; }
    this.edits.next();
  }

  setInk(which: 'card' | 'left' | 'right', value: 'dark' | 'light'): void {
    if (which === 'card') { this.section.cardInk = value; }
    if (which === 'left') { this.section.leftInk = value; }
    if (which === 'right') { this.section.rightInk = value; }
    this.edits.next();
  }

  readonly perRowChoices = [
    { key: 0, label: 'As many as fit' },
    { key: 2, label: '2' },
    { key: 3, label: '3' },
    { key: 4, label: '4' }
  ] as const;

  pickPerRow(value: number): void {
    this.section.cardsPerRow = value === 0 ? undefined : (value as 2 | 3 | 4);
    this.edits.next();
  }

  readonly titleTones = [
    { key: 'ink', label: 'Ink' },
    { key: 'brand', label: 'Brand blue' }
  ] as const;

  setTitleTone(which: 'left' | 'right', value: 'ink' | 'brand'): void {
    if (which === 'left') { this.section.leftTitleTone = value; }
    if (which === 'right') { this.section.rightTitleTone = value; }
    this.edits.next();
  }

  get isColumns(): boolean {
    return this.kind.type === 'listColumns';
  }

  get isGrid(): boolean {
    return this.kind.type === 'listGrid';
  }

  /** What a ground's text defaults to when no ink is stored - the pair that
   *  reads on it. Brand defaults LIGHT: the original's grey-on-blue measured
   *  ~1.4:1 and Shane called it terrible on sight. Shown as the toggle's
   *  value so the control never lies about what is rendering. */
  inkFor(ground: string | undefined, stored: string | undefined): string {
    return stored ?? (ground === 'panel' ? 'dark' : 'light');
  }

  /** Whether this section splits copy beside media - the only place a media
   *  share means anything. */
  get hasSplitMedia(): boolean {
    return !!this.fields.video
      || (this.kind.type === 'copyMedia' || this.kind.type === 'heroSplit');
  }

  /** A stacked section, where "which side" has no meaning but "which first"
   *  does. */
  get isCentred(): boolean {
    return this.kind.type === 'copyCentred';
  }

  /**
   * WHICH SIDE the picture sits on.
   *
   * 'auto' is not a third position - it is "leave it to the look", which for
   * the alternating archetypes means the side still flips down the page. It
   * has to stay available, or a section that was deliberately alternating
   * could never be put back.
   */
  readonly mediaSides = [
    { key: 'auto', label: 'As the page decides' },
    { key: 'left', label: 'Picture left' },
    { key: 'right', label: 'Picture right' }
  ] as const;

  pickMediaSide(value: 'auto' | 'left' | 'right'): void {
    // Stored as absent rather than 'auto', so a section that never had an
    // opinion does not start carrying one.
    this.section.mediaSide = value === 'auto' ? undefined : value;
    this.edits.next();
  }

  pickStackOrder(value: 'heading' | 'text'): void {
    this.section.textFirst = value === 'text' ? true : undefined;
    this.edits.next();
  }

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
