import { Component, EventEmitter, Input, Output } from '@angular/core';
import { PageContentBlock } from '@impact-common/shared/models/domain/page-content.model';
import {
  GRID_LIST_LOOKS, SECTION_SURFACES, SectionSurface
} from '@impact-common/shared/lists/section_kit';
import { KindVariant, PageSectionKind } from './page-section-catalogue';
import { activeSurfaceOf, activeVariantOf, isOnPhotoSurface } from './section-appearance.util';

/**
 * HOW A SECTION LOOKS - the Appearance tab, on its own.
 *
 * Extracted from PageSectionEditorComponent on 2026-09-05, which had grown to
 * 1,250 lines and a 700-line template holding two unrelated jobs. Every one
 * of that day's six changes went through that file, three of them in these
 * same regions, and each had to be threaded past a thousand lines of
 * unrelated code.
 *
 * THE SPLIT IS THE ONE THE SCREEN ALREADY MAKES. The tabs put these controls
 * behind "Appearance" and everything else behind "Content"; this is that line
 * drawn in the code as well as on the screen. The tab strip itself stays on
 * the shell, because deciding whether to draw this panel is not this panel's
 * business.
 *
 * IT OWNS NOTHING. `section` is the shell's working copy, mutated in place -
 * the same contract app-content-piece has with its `piece` - and `changed`
 * is the ping that drives the live preview. Nothing here reads or writes
 * Firestore, and nothing decides when it is visible.
 */
@Component({
  selector: 'app-page-section-appearance',
  templateUrl: './page-section-appearance.component.html',
  styleUrls: ['./page-section-editor.component.css'],
  standalone: false
})
export class PageSectionAppearanceComponent {
  /** The shell's working copy, mutated in place - the same contract
   *  app-content-piece has with its own `piece`. The shell owns saving. */
  @Input({ required: true }) section!: PageContentBlock;
  @Input({ required: true }) kind!: PageSectionKind;

  /** Anything touched here. The shell debounces it into the live preview. */
  @Output() changed = new EventEmitter<void>();

  get onPhotoSurface(): boolean {
    return isOnPhotoSurface(this.section);
  }

  /**
   * Which fields the CHOSEN LOOK declares.
   *
   * The panel needs this for two of its own controls: the heading style and
   * the text colour are only worth offering on a section that has a heading
   * or a body to apply them to.
   *
   * The same derivation the shell uses for the content form, through the same
   * shared helper - so "which look is selected" has exactly one answer across
   * both halves. Two copies of it would show a Heading control on a section
   * with no heading, or hide one that has it.
   */
  get fields() {
    return activeVariantOf(this.kind, this.section)?.fields ?? this.kind.fields;
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
    return activeVariantOf(this.kind, this.section);
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
    this.changed.emit();
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
    return activeSurfaceOf(this.section) as SectionSurface;
  }

  pickSurface(surface: SectionSurface): void {
    this.section.surface = surface;
    this.changed.emit();
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
    this.changed.emit();
  }

  pickCopySize(value: 'large' | 'compact' | 'display'): void {
    this.section.copySize = value;
    this.changed.emit();
  }

  pickMediaSize(value: 'large' | 'balanced'): void {
    this.section.mediaSize = value;
    this.changed.emit();
  }

  readonly photoFocuses = [
    { key: 'top', label: 'Top' },
    { key: 'center', label: 'Centre' },
    { key: 'bottom', label: 'Bottom' }
  ] as const;

  pickPhotoFocus(value: 'top' | 'center' | 'bottom'): void {
    this.section.photoFocus = value;
    this.changed.emit();
  }

  /** The focus lever only means anything while the photo is a cropped
   *  BACKGROUND - i.e. this section is actually on the photo surface. */
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
    this.changed.emit();
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
    this.changed.emit();
  }

  recentreFocus(): void {
    this.section.photoFocusPoint = { x: 50, y: 50 };
    delete this.section.photoFocus;
    this.changed.emit();
  }

  // --------------------------------------------------- the box behind a card
  //
  // A coloured box behind each card of a grid, and whether the words on it
  // are dark or light.
  //
  // THESE CONTROLS WERE MISSING, not new. The renderer never stopped drawing
  // them - kit-section's groundClasses() reads both fields and maps them to
  // --kit-card-bg - but the editor's controls were removed at some point and
  // only the unused member declarations were left behind. So the Give page
  // has carried `cardGround: 'dark'` on its donation options the whole time,
  // drawing black boxes nobody could see, change or switch off from the
  // admin. Restored with a real control 2026-09-05.
  //
  // The ink is a separate lever because a box and its text have to be chosen
  // together to be readable: grey on the brand blue measures ~1.4:1. Each
  // ground therefore carries a default that reads on it, and this is the
  // override rather than a colour wheel.

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

  /** 'none' rather than undefined, so the control always shows a selection
   *  and "No box" reads as a choice rather than a blank. */
  get activeCardGround(): string {
    return this.section.cardGround ?? 'none';
  }

  /**
   * What the text will actually be, stored or not.
   *
   * Shown as the toggle's value so the control never lies about what is
   * rendering: brand and dark default to LIGHT, panel to dark - the same
   * defaults groundClasses() applies, and they have to stay the same or the
   * editor and the page disagree about a colour nobody typed.
   */
  get activeCardInk(): string {
    return this.section.cardInk ??
      (this.activeCardGround === 'panel' ? 'dark' : 'light');
  }

  /** The ink lever means nothing without a box to put it on. */
  get showsCardInk(): boolean {
    return this.showsCardsPerRow && this.activeCardGround !== 'none';
  }

  /**
   * @param value Which ground, or 'none' to remove the box entirely.
   *
   * DELETE on 'none', never `= undefined`: a key explicitly set to undefined
   * rejects the whole page document. Same rule as every other lever here.
   */
  pickCardGround(value: 'none' | 'panel' | 'brand' | 'dark'): void {
    if (value === 'none') {
      delete this.section.cardGround;
      // The ink is meaningless without a ground and would otherwise sit on
      // the document forever, reappearing if a box is ever chosen again.
      delete this.section.cardInk;
    } else {
      this.section.cardGround = value;
    }
    this.changed.emit();
  }

  /** @param value Dark or light text on the box. */
  pickCardInk(value: 'dark' | 'light'): void {
    this.section.cardInk = value;
    this.changed.emit();
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
    this.changed.emit();
  }

  // setPairWithNext, and the "Share the row with the next section" switch it
  // backed, were removed on 2026-09-05 (owner). It was a section-level lever
  // describing a relationship with a NEIGHBOUR - "put the next section beside
  // me, half and half" - and it was the wrong shape twice over.
  //
  // It said something the archetype already said. A SECTION holds one to
  // three columns of any piece kind, and `form` is a piece kind, so "text on
  // the left, a form on the right" was always one section with two columns.
  //
  // And the two spellings did not look the same. A paired row is a two-cell
  // grid of separate sections, and a grid cell stretches: each half paints
  // its own ground for the height of the taller one, so the shorter half drew
  // a slab of empty ground under its last line - which is what the Contact
  // page looked like. Columns inside ONE section centre against each other on
  // a single ground.
  //
  // One block on the site ever used it. scripts/merge-paired-sections.js
  // folded it into a two-column section; `pairWithNext` is still in the model
  // and still honoured by the web app, but nothing can set it any more.

  // titleTones and setTitleTone lived here until 2026-09-03. Both were dead:
  // nothing in any template or class referenced either, and setTitleTone
  // ignored both of its arguments and simply pinged `edits`. They are the
  // last remnant of the six left/right tone fields the two-member section kit
  // replaced with per-column grounds.

  // isColumns and isGrid asked whether this section was one of two
  // archetypes, and both are gone. Nothing has asked since.

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
    this.changed.emit();
  }

  pickBullets(value: 'dots' | 'none'): void {
    this.section.bullets = value;
    this.changed.emit();
  }
}
